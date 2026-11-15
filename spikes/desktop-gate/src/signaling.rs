//! Talks to our api: HTTP login, then the WebSocket (protobuf `Envelope`s).
//!
//! Spike-simple: one request at a time. Pushes (id = 0) that arrive while we
//! wait for a reply are skipped.

use anyhow::{Context, bail};
use futures_util::{SinkExt, StreamExt};
use protocol::Message;
use protocol::v1::{self, Envelope, envelope::Payload};
use tokio::net::TcpStream;
use tokio_tungstenite::{MaybeTlsStream, WebSocketStream, tungstenite::Message as WsMsg};

pub struct Api {
    ws: WebSocketStream<MaybeTlsStream<TcpStream>>,
    next_id: u64,
}

impl Api {
    /// Logs in over HTTP, opens the WebSocket and authenticates it.
    pub async fn connect(http: &str, email: &str, password: &str) -> anyhow::Result<Self> {
        let body = serde_json::json!({
            "email": email,
            "password": password,
            "device": { "name": "desktop-gate spike", "platform": "desktop" },
        });
        let res = reqwest::Client::new()
            .post(format!("{http}/auth/login"))
            .json(&body)
            .send()
            .await?;
        if !res.status().is_success() {
            bail!("login failed: {}", res.status());
        }
        let session: serde_json::Value = res.json().await?;
        let token = session["access_token"]
            .as_str()
            .context("no access_token")?
            .to_string();

        let ws_url = format!("{}/ws", http.replacen("http", "ws", 1));
        let (ws, _) = tokio_tungstenite::connect_async(ws_url).await?;
        let mut api = Self { ws, next_id: 1 };
        api.request(Payload::Authenticate(v1::Authenticate {
            access_token: token,
        }))
        .await?;
        Ok(api)
    }

    /// Sends one request and waits for the reply with the same id.
    pub async fn request(&mut self, payload: Payload) -> anyhow::Result<Payload> {
        let id = self.next_id;
        self.next_id += 1;
        let env = Envelope {
            id,
            payload: Some(payload),
        };
        self.ws
            .send(WsMsg::Binary(env.encode_to_vec().into()))
            .await?;
        loop {
            let msg = self.ws.next().await.context("socket closed")??;
            let WsMsg::Binary(bytes) = msg else { continue };
            let env = Envelope::decode(bytes.as_ref())?;
            if env.id != id {
                continue; // a push, or an old reply
            }
            return match env.payload {
                Some(Payload::Error(e)) => bail!("{}: {}", e.code, e.message),
                Some(p) => Ok(p),
                None => bail!("empty reply"),
            };
        }
    }

    /// Waits until the other person accepts (a `call_updated` with 2+ people).
    pub async fn wait_for_answer(&mut self, call_id: u64) -> anyhow::Result<()> {
        loop {
            let msg = self.ws.next().await.context("socket closed")??;
            let WsMsg::Binary(bytes) = msg else { continue };
            match Envelope::decode(bytes.as_ref())?.payload {
                Some(Payload::CallUpdated(u)) => {
                    if let Some(c) = u.call
                        && c.id == call_id
                        && c.participant_ids.len() >= 2
                    {
                        return Ok(());
                    }
                }
                Some(Payload::CallEnded(e)) if e.call_id == call_id => bail!("call ended"),
                _ => {}
            }
        }
    }

    /// Reads (and drops) pushes until the call ends or the socket closes.
    pub async fn run_until_ended(&mut self, call_id: u64) {
        while let Some(Ok(msg)) = self.ws.next().await {
            let WsMsg::Binary(bytes) = msg else { continue };
            if let Ok(Envelope {
                payload: Some(Payload::CallEnded(e)),
                ..
            }) = Envelope::decode(bytes.as_ref())
                && e.call_id == call_id
            {
                return;
            }
        }
    }
}
