import { create, fromBinary, toBinary } from "@bufbuild/protobuf";

import { AuthenticateSchema, EnvelopeSchema } from "../../../client/src/gen/v1/envelope_pb.ts";

const HTTP = process.env.API_HTTP ?? "http://127.0.0.1:7100";
const WS = HTTP.replace(/^http/, "ws") + "/ws";
let failed = 0;
const check = (name: string, ok: boolean, extra = "") => {
  console.log(`${ok ? "✓" : "✗"} ${name}${extra ? ` (${extra})` : ""}`);
  if (!ok) failed++;
};

const tag = `revoke${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
const res = await fetch(`${HTTP}/auth/register`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    email: `${tag}@test.local`,
    password: "Password1!",
    device: { name: "smoke", platform: "web" },
  }),
});
check("register", res.ok, `${res.status}`);
if (!res.ok) process.exit(1);
const { access_token: token } = (await res.json()) as { access_token: string };

function open(): Promise<{ ws: WebSocket; closed: Promise<{ code: number; errors: string[] }> }> {
  const ws = new WebSocket(WS);
  ws.binaryType = "arraybuffer";
  const errors: string[] = [];
  const closed = new Promise<{ code: number; errors: string[] }>((res) => {
    ws.addEventListener("close", (ev) => res({ code: ev.code, errors }));
  });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("no authOk within 3s")), 3000);
    ws.addEventListener("close", (ev) => reject(new Error(`closed ${ev.code} before authOk`)));
    ws.onopen = () => {
      const payload = {
        case: "authenticate" as const,
        value: create(AuthenticateSchema, { accessToken: token }),
      };
      ws.send(toBinary(EnvelopeSchema, create(EnvelopeSchema, { id: 1n, payload })));
    };
    ws.onmessage = (ev) => {
      const env = fromBinary(EnvelopeSchema, new Uint8Array(ev.data as ArrayBuffer));
      if (env.payload.case === "authOk") {
        clearTimeout(timer);
        resolve({ ws, closed });
      }
      if (env.payload.case === "error") errors.push(env.payload.value.code);
    };
  });
}

const live = await open();
const logout = await fetch(`${HTTP}/auth/logout`, {
  method: "POST",
  headers: { Authorization: `Bearer ${token}` },
});
check("logout", logout.status === 204, `${logout.status}`);

const timeout = new Promise<{ code: number; errors: string[] }>((res) =>
  setTimeout(() => res({ code: -1, errors: [] }), 3000),
);
const kicked = await Promise.race([live.closed, timeout]);
check("open socket closed with 4003", kicked.code === 4003, `close ${kicked.code}`);
check("error frame session_revoked", kicked.errors.includes("session_revoked"));

const again = new WebSocket(WS);
again.binaryType = "arraybuffer";
const reconnect = await new Promise<number>((res) => {
  again.onopen = () => {
    const payload = {
      case: "authenticate" as const,
      value: create(AuthenticateSchema, { accessToken: token }),
    };
    again.send(toBinary(EnvelopeSchema, create(EnvelopeSchema, { id: 1n, payload })));
  };
  again.onclose = (ev) => res(ev.code);
  setTimeout(() => res(-1), 3000);
});
check("reconnect with the old token → 4003", reconnect === 4003, `close ${reconnect}`);

process.exit(failed ? 1 : 0);
