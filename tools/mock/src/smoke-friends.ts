// End-to-end friends checks against the real api: HTTP actions + live pushes.
// Run: API_HTTP=http://127.0.0.1:7130 pnpm --filter mock smoke:friends   (stack up)
// Registers 3 users: register is rate limited (5/min per IP), don't run it twice in a row.
import { create, fromBinary, toBinary } from "@bufbuild/protobuf";
import { AuthenticateSchema, EnvelopeSchema, type Envelope } from "../../../client/src/gen/v1/envelope_pb.ts";
import { FriendState } from "../../../client/src/gen/v1/friends_pb.ts";

const HTTP = process.env.API_HTTP ?? "http://127.0.0.1:7100";
const WS = HTTP.replace(/^http/, "ws") + "/ws";
let failed = 0;
const check = (name: string, ok: boolean, extra = "") => {
  console.log(`${ok ? "✓" : "✗"} ${name}${extra ? ` (${extra})` : ""}`);
  if (!ok) failed++;
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Calls the api as `token`. Returns status + JSON body (if any).
async function api(token: string, method: string, path: string, body?: unknown) {
  const res = await fetch(HTTP + path, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : null };
}

async function newUser(prefix: string) {
  const tag = `${prefix}${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
  const res = await fetch(`${HTTP}/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: `${tag}@test.local`, password: "Password1!", device: { name: "smoke", platform: "web" } }),
  });
  const session = (await res.json()) as { access_token: string; user: { id: string } };
  const named = await api(session.access_token, "PUT", "/me/username", { username: tag });
  check(`register + username ${tag}`, res.ok && named.status === 200);
  return { token: session.access_token, id: session.user.id, username: tag };
}

// Authenticated socket that collects friendUpdated pushes.
async function listen(token: string) {
  const ws = new WebSocket(WS);
  ws.binaryType = "arraybuffer";
  const pushes: Extract<Envelope["payload"], { case: "friendUpdated" }>["value"][] = [];
  await new Promise<void>((res) => {
    ws.onopen = () =>
      ws.send(toBinary(EnvelopeSchema, create(EnvelopeSchema, { id: 1n, payload: { case: "authenticate", value: create(AuthenticateSchema, { accessToken: token }) } })));
    ws.onmessage = (ev) => {
      const env = fromBinary(EnvelopeSchema, new Uint8Array(ev.data as ArrayBuffer));
      if (env.payload.case === "authOk") res();
      else if (env.payload.case === "friendUpdated") pushes.push(env.payload.value);
    };
  });
  return { pushes, stop: () => ws.close() };
}

const ana = await newUser("ana");
const bob = await newUser("bob");
const carl = await newUser("carl");
const bobSocket = await listen(bob.token);
const anaSocket = await listen(ana.token);

// Send + live push.
let r = await api(ana.token, "POST", "/friends/requests", { username: bob.username });
check("ana → bob request", r.status === 200 && r.json.state === "outgoing", `${r.status}`);
await sleep(300);
const pushToBob = bobSocket.pushes.at(-1);
check("bob gets a live INCOMING push", pushToBob?.state === FriendState.INCOMING && pushToBob.user?.username === ana.username);

r = await api(bob.token, "GET", "/friends");
check("bob sees ana in incoming", r.json.incoming.length === 1 && r.json.incoming[0].user.id === ana.id);
r = await api(ana.token, "GET", "/friends");
check("ana sees bob in outgoing", r.json.outgoing.length === 1);

// Rules.
r = await api(ana.token, "POST", "/friends/requests", { username: bob.username });
check("duplicate → 409 request_already_sent", r.status === 409 && r.json.code === "request_already_sent");
r = await api(ana.token, "POST", "/friends/requests", { username: ana.username });
check("self → 400 cannot_friend_self", r.status === 400 && r.json.code === "cannot_friend_self");
r = await api(ana.token, "POST", "/friends/requests", { username: "nobody_here_404" });
check("unknown → 400 user_not_found", r.status === 400 && r.json.code === "user_not_found");
r = await api(ana.token, "POST", `/friends/requests/${bob.id}/accept`);
check("sender can't accept own request → 404", r.status === 404);

// Accept.
r = await api(bob.token, "POST", `/friends/requests/${ana.id}/accept`);
check("bob accepts", r.status === 200 && r.json.state === "friend");
await sleep(300);
check("ana gets a live FRIEND push", anaSocket.pushes.at(-1)?.state === FriendState.FRIEND);
r = await api(ana.token, "GET", "/friends");
check("ana's friends list has bob", r.json.friends.length === 1 && r.json.friends[0].user.username === bob.username);

// Decline and cancel (with carl).
await api(carl.token, "POST", "/friends/requests", { username: ana.username });
r = await api(ana.token, "DELETE", `/friends/requests/${carl.id}`);
check("ana declines carl → 204", r.status === 204);
await api(carl.token, "POST", "/friends/requests", { username: ana.username });
r = await api(carl.token, "DELETE", `/friends/requests/${ana.id}`);
check("carl cancels → 204", r.status === 204);
r = await api(carl.token, "GET", "/friends");
check("carl has nothing pending", r.json.outgoing.length === 0);

// Request back = accept.
await api(carl.token, "POST", "/friends/requests", { username: bob.username });
r = await api(bob.token, "POST", "/friends/requests", { username: carl.username });
check("requesting back accepts", r.status === 200 && r.json.state === "friend");

// Remove.
r = await api(bob.token, "DELETE", `/friends/requests/${ana.id}`);
check("remove-request on a friend → 404", r.status === 404);
r = await api(bob.token, "DELETE", `/friends/${ana.id}`);
check("bob removes ana → 204", r.status === 204);
await sleep(300);
check("ana gets a live NONE push", anaSocket.pushes.at(-1)?.state === FriendState.NONE);
r = await api(ana.token, "GET", "/friends");
check("ana's list is empty", r.json.friends.length + r.json.incoming.length + r.json.outgoing.length === 0);

bobSocket.stop();
anaSocket.stop();
console.log(failed ? `\n${failed} failed` : "\nall good");
process.exit(failed ? 1 : 0);
