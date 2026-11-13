import { useState } from "react";
import { create } from "@bufbuild/protobuf";
import { PingSchema } from "./gen/v1/envelope_pb";
import { ApiClient } from "./api";
import { platform } from "./platform";

export default function App() {
  const [status, setStatus] = useState("not connected");

  async function ping() {
    setStatus("connecting…");
    try {
      const api = new ApiClient();
      await api.ready();
      const started = performance.now();
      const reply = await api.request({ case: "ping", value: create(PingSchema) });
      const ms = (performance.now() - started).toFixed(1);
      setStatus(reply.payload.case === "pong" ? `pong in ${ms} ms 🐒` : `unexpected: ${reply.payload.case}`);
    } catch (err) {
      setStatus(String(err));
    }
  }

  return (
    <main className="flex h-full flex-col items-center justify-center gap-6 bg-zinc-950 text-zinc-100">
      <h1 className="text-4xl font-bold">
        Discord <span className="text-brand">2.0</span>
      </h1>
      <p className="text-sm text-zinc-400">
        {platform.kind} · {platform.apiUrl}
      </p>
      <button
        onClick={ping}
        className="rounded-lg bg-brand px-5 py-2 font-semibold text-zinc-950 transition hover:brightness-110 active:scale-95"
      >
        Ping API
      </button>
      <p className="font-mono text-sm">{status}</p>
    </main>
  );
}
