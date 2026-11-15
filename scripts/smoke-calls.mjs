import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
const [TA, NA, TB, NB] = readFileSync(process.argv[3], "utf8").trim().split("\n");
const UI = process.env.UI_URL ?? "http://localhost:7104";
const extra = process.env.CHROME_FLAGS ? [process.env.CHROME_FLAGS] : [];
const chrome = spawn("chromium", [...extra, "--headless=new", "--remote-debugging-port=9334",
  "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream",
  "--autoplay-policy=no-user-gesture-required", "--user-data-dir=" + process.argv[2], "about:blank"]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ok = true;
const check = (c, msg) => { console.log(`${c ? "✅" : "❌"} ${msg}`); ok &&= c; };
try {
  for (let i = 0; i < 20; i++) { try { await fetch("http://127.0.0.1:9334/json/version"); break; } catch { await sleep(500); } }
  async function tab() {
    const t = await (await fetch(`http://127.0.0.1:9334/json/new?${UI}/login`, { method: "PUT" })).json();
    const ws = new WebSocket(t.webSocketDebuggerUrl); let n = 0; const wait = {};
    ws.onmessage = (e) => { const m = JSON.parse(e.data); wait[m.id]?.(m); };
    await new Promise((r) => (ws.onopen = r));
    return (expr) => new Promise((r) => { const id = ++n; wait[id] = (m) => r(m.result?.exceptionDetails ? "ERR " + JSON.stringify(m.result.exceptionDetails.exception?.description) : m.result?.result?.value);
      ws.send(JSON.stringify({ id, method: "Runtime.evaluate", params: { expression: expr, awaitPromise: true } })); });
  }
  const setup = (token) => `(async () => {
    const { WsClient } = await import("/src/api/ws.ts");
    const { useChat } = await import("/src/stores/chat.ts");
    const { useCalls } = await import("/src/stores/calls.ts");
    const { ws, user } = await WsClient.connect(${JSON.stringify(token)});
    window.t = { ws, user, chat: useChat, calls: useCalls };
    await useChat.getState().attach(ws);
    useCalls.getState().attach(ws, user.id);
    return user.username;
  })()`;
  const a = await tab(), b = await tab(); await sleep(3000);
  check((await a(setup(TA))) === NA, "A connected");
  check((await b(setup(TB))) === NB, "B connected");

  await a(`t.chat.getState().openDm(t.ws, ${JSON.stringify(NB)})`);
  await a(`(async () => { const c = t.chat.getState().conversations[0]; await t.calls.getState().call(t.ws, c.id); })()`);
  await sleep(1000);
  check((await b(`String(t.calls.getState().incoming?.callerId === undefined ? "none" : "ringing")`)) === "ringing", "B is ringing");
  check((await a(`t.calls.getState().current?.state`)) === 1, "A sees RINGING");

  await b(`t.calls.getState().accept(t.ws)`);
  await sleep(6000);
  const st = `(async () => { const { peerConnection } = await import("/src/stores/calls.ts"); const s = t.calls.getState();
    let o = { joined: s.joined, state: s.current?.state, n: s.current?.participantIds.length, err: s.error };
    (await peerConnection().getStats()).forEach(r => { if (r.type === "inbound-rtp") { o.recv = r.packetsReceived; o.energy = r.totalAudioEnergy; } if (r.type === "outbound-rtp") o.sent = r.packetsSent; });
    return JSON.stringify(o); })()`;
  const sa = JSON.parse(await a(st)), sb = JSON.parse(await b(st));
  console.log("   A", JSON.stringify(sa)); console.log("   B", JSON.stringify(sb));
  check(sa.joined && sb.joined && sa.state === 2 && sa.n === 2, "both joined, call ACTIVE with 2 people");
  check(sa.recv > 150 && sb.recv > 150 && sa.energy > 0 && sb.energy > 0, "audio flows both ways");

  await a(`t.calls.getState().leave(t.ws)`);
  await sleep(1000);
  check((await b(`t.calls.getState().current === null`)) === true, "A hangs up → B's call ends");
} catch (e) { console.log("❌", e); ok = false; }
chrome.kill(); await sleep(500); process.exit(ok ? 0 : 1);
