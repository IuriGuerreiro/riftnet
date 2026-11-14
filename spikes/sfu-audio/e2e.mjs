// Drive 2 headless Chromium tabs via CDP: both press Join, then read stats.
import { spawn } from "node:child_process";
const chrome = spawn("chromium", ["--headless=new", "--remote-debugging-port=9333",
  "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream",
  "--autoplay-policy=no-user-gesture-required", "--user-data-dir=" + process.argv[2], "about:blank"]);
const sleep = ms => new Promise(r => setTimeout(r, ms));
await sleep(4000);
async function tab() {
  const t = await (await fetch("http://127.0.0.1:9333/json/new?http://localhost:3000", { method: "PUT" })).json();
  const ws = new WebSocket(t.webSocketDebuggerUrl); let n = 0; const wait = {};
  ws.onmessage = e => { const m = JSON.parse(e.data); wait[m.id]?.(m); };
  await new Promise(r => (ws.onopen = r));
  return expr => new Promise(r => { const id = ++n; wait[id] = m => r(m.result?.result?.value);
    ws.send(JSON.stringify({ id, method: "Runtime.evaluate", params: { expression: expr, awaitPromise: true } })); });
}
const a = await tab(), b = await tab(); await sleep(1500);
await a(`document.getElementById("join").click()`); await b(`document.getElementById("join").click()`);
await sleep(8000);
const read = `(async()=>{let o={state:pc.connectionState};(await pc.getStats()).forEach(r=>{if(r.type==="inbound-rtp")o.recv=r.packetsReceived,o.lost=r.packetsLost,o.energy=r.totalAudioEnergy;if(r.type==="outbound-rtp")o.sent=r.packetsSent});return JSON.stringify(o)})()`;
console.log("A", await a(read)); console.log("B", await b(read));
chrome.kill(); process.exit(0);
