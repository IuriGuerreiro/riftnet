import exec from "k6/execution";
import { Counter, Trend } from "k6/metrics";
import { WebSocket } from "k6/websockets";

import {
  authenticate,
  decode,
  encode,
  fresh,
  identity,
  login,
  openDm,
  sendMessage,
  type Session,
  USERS,
  WS_URL,
} from "./lib.ts";

const PEAK = Number(__ENV.SOCKETS ?? 250);
const SEND_EVERY_MS = Number(__ENV.SEND_EVERY_MS ?? 5000);
const SESSION_MS = Number(__ENV.SESSION_MS ?? 120_000);

export const options = {
  scenarios: {
    chat: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { target: PEAK, duration: __ENV.RAMP ?? "3m" },
        { target: PEAK, duration: __ENV.HOLD ?? "10m" },
        { target: 0, duration: "1m" },
      ],
      gracefulRampDown: "30s",
    },
  },
  thresholds: {
    ws_auth_ms: ["p(95)<500"],
    ws_ack_ms: ["p(95)<150"],
    ws_delivery_ms: ["p(95)<500"],
    ws_errors: ["count<10"],
  },
};

const authMs = new Trend("ws_auth_ms", true);
const ackMs = new Trend("ws_ack_ms", true);
const deliveryMs = new Trend("ws_delivery_ms", true);
const sent = new Counter("ws_messages_sent");
const delivered = new Counter("ws_messages_delivered");
const errors = new Counter("ws_errors");

if (PEAK > USERS) throw new Error(`SOCKETS=${PEAK} needs USERS>=${PEAK}`);

let session: Session | undefined;
const utf8 = new TextDecoder();

export default function () {
  const me = exec.vu.idInTest - 1;
  const partner = identity(me ^ 1).username;
  session = session ? fresh(session) : login(me);
  const myId = session.userId;
  const ws = new WebSocket(WS_URL);
  ws.binaryType = "arraybuffer";

  let nextId = 1n;
  let dm: bigint | undefined;
  const pending = new Map<string, number>();
  const startedAt = Date.now();
  let ticker: ReturnType<typeof setInterval> | undefined;

  const send = (payload: Parameters<typeof encode>[1]) => ws.send(encode(nextId++, payload));

  ws.onopen = () => send(authenticate(session!.accessToken));

  ws.onmessage = (ev: { data: ArrayBuffer }) => {
    const env = decode(ev.data);
    const p = env.payload;
    switch (p.case) {
      case "authOk":
        authMs.add(Date.now() - startedAt);
        send(openDm(partner));
        break;
      case "conversation":
        dm = p.value.conversation?.id;
        ticker = setInterval(() => {
          if (Date.now() - startedAt > SESSION_MS) {
            clearInterval(ticker);
            ws.close();
            return;
          }
          const nonce = `${me}-${Date.now()}-${Math.random()}`;
          pending.set(nonce, Date.now());
          sent.add(1);
          send(sendMessage(dm!, String(Date.now()), nonce));
        }, SEND_EVERY_MS);
        break;
      case "messageAck": {
        const t = pending.get(p.value.nonce);
        if (t !== undefined) {
          ackMs.add(Date.now() - t);
          pending.delete(p.value.nonce);
        }
        break;
      }
      case "messageCreated": {
        const m = p.value.message;
        if (!m || m.authorId === myId) break;
        delivered.add(1);
        deliveryMs.add(Date.now() - Number(utf8.decode(m.content)));
        break;
      }
      case "error":
        errors.add(1, { code: p.value.code });
        break;
    }
  };

  ws.onerror = () => errors.add(1, { code: "socket" });
  ws.onclose = () => clearInterval(ticker);
}
