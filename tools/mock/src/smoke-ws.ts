// End-to-end WebSocket auth checks against the real api.
// Run: node tools/mock/src/smoke-ws.ts   (api on :7100, stack up)
import { create, fromBinary, toBinary } from "@bufbuild/protobuf";
import { AuthenticateSchema, EnvelopeSchema, PingSchema, type Envelope } from "../../../client/src/gen/v1/envelope_pb.ts";

const HTTP = process.env.API_HTTP ?? "http://127.0.0.1:7100";
const WS = HTTP.replace(/^http/, "ws") + "/ws";
let failed = 0;
const check = (name: string, ok: boolean, extra = "") => {
  console.log(`${ok ? "✓" : "✗"} ${name}${extra ? ` (${extra})` : ""}`);
  if (!ok) failed++;
};

// Opens a socket, sends the frames, collects replies until `want` frames or close.
function talk(payloads: Envelope["payload"][], want: number): Promise<{ replies: Envelope[]; closeCode?: number }> {
  return new Promise((resolve) => {
    const ws = new WebSocket(WS);
    ws.binaryType = "arraybuffer";
    const replies: Envelope[] = [];
    ws.onopen = () =>
      payloads.forEach((payload, i) => ws.send(toBinary(EnvelopeSchema, create(EnvelopeSchema, { id: BigInt(i + 1), payload }))));
    ws.onmessage = (ev) => {
      replies.push(fromBinary(EnvelopeSchema, new Uint8Array(ev.data as ArrayBuffer)));
      if (replies.length >= want) { ws.close(); resolve({ replies }); }
    };
    ws.onclose = (ev) => resolve({ replies, closeCode: ev.code });
  });
}

const email = `ws_${Date.now()}@test.local`;
const res = await fetch(`${HTTP}/auth/register`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email, password: "Password1!", device: { name: "smoke", platform: "web" } }),
});
const { access_token } = (await res.json()) as { access_token: string };
check("register", res.ok);

const auth = (accessToken: string) => ({ case: "authenticate" as const, value: create(AuthenticateSchema, { accessToken }) });
const ping = { case: "ping" as const, value: create(PingSchema) };

let r = await talk([auth(access_token), ping], 2);
check("valid token → authOk", r.replies[0]?.payload.case === "authOk");
check("reply keeps the request id", r.replies[0]?.id === 1n && r.replies[1]?.id === 2n);
check("then ping → pong", r.replies[1]?.payload.case === "pong");

r = await talk([ping], 99);
check("ping before auth → error + close 4001", r.replies[0]?.payload.case === "error" && r.closeCode === 4001, `close ${r.closeCode}`);

r = await talk([auth(access_token.slice(0, -4) + "AAAA")], 99);
const e = r.replies[0]?.payload;
check("forged token → invalid_token + close 4001", e?.case === "error" && e.value.code === "invalid_token" && r.closeCode === 4001);

r = await talk([auth(access_token), auth(access_token)], 2);
const e2 = r.replies[1]?.payload;
check("second authenticate → already_authenticated", e2?.case === "error" && e2.value.code === "already_authenticated");

process.exit(failed ? 1 : 0);
