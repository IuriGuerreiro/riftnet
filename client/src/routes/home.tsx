import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { create } from "@bufbuild/protobuf";
import { useLogout, useMe } from "../api/auth";
import { PingSchema } from "../gen/v1/envelope_pb";
import { platform } from "../platform";
import { useConnection } from "../stores/connection";
import { Button, Card, ErrorText } from "../components/ui";

const dot = { online: "bg-green-500", connecting: "bg-yellow-500", offline: "bg-red-500" };

// Test page: proves the token and the WebSocket work. Will become the app's main screen.
export function HomePage() {
  const me = useMe();
  const logout = useLogout();
  const navigate = useNavigate();
  const { status, error, ws, connect, disconnect } = useConnection();
  const [pingMs, setPingMs] = useState<number | null>(null);

  // Open the socket while this page is shown.
  useEffect(() => {
    void connect();
    return disconnect;
  }, [connect, disconnect]);

  async function ping() {
    if (!ws) return;
    const start = performance.now();
    await ws.request({ case: "ping", value: create(PingSchema) });
    setPingMs(Math.round(performance.now() - start));
  }

  return (
    <Card>
      <h1 className="text-2xl font-bold">
        Hi, <span className="text-brand">{me.data?.username ?? "…"}</span>
      </h1>
      <ErrorText error={me.error} />

      <div className="flex items-center gap-2 text-sm">
        <span className={`size-2.5 rounded-full ${dot[status]}`} />
        WebSocket: {status}
        {error && <span className="text-red-400">({error})</span>}
        {pingMs !== null && <span className="text-zinc-500">· ping {pingMs} ms</span>}
      </div>
      <Button onClick={ping} disabled={status !== "online"}>
        Ping
      </Button>

      <p className="text-xs text-zinc-500">
        {platform.kind} · {platform.httpUrl} · {platform.wsUrl}
      </p>
      <Button
        onClick={() => {
          disconnect();
          logout.mutate(undefined, { onSettled: () => navigate({ to: "/login" }) });
        }}
      >
        Log out
      </Button>
    </Card>
  );
}
