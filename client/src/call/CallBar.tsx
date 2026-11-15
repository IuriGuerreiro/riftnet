import { useEffect, useState } from "react";
import type { WsClient } from "../api/ws";
import { CallState, useCalls } from "../stores/calls";
import { peerConnection } from "../platform/webMedia";

// TEST UI: call controls in the DM header. Logic is in stores/calls.ts.

const btn = "rounded-md px-2 py-1 text-xs font-semibold disabled:opacity-50";

export function CallBar({ ws, conversationId }: { ws: WsClient | null; conversationId: bigint }) {
  const { current, joined, muted, error, call, leave, toggleMute } = useCalls();
  const here = current?.conversationId === conversationId;
  const info = useStats(here && joined);

  if (!here) {
    return (
      <div className="flex items-center gap-2 text-xs font-normal">
        {error && <span className="text-red-400">{error}</span>}
        <button
          disabled={!ws || current !== null}
          title={current ? "already in a call" : undefined}
          onClick={() => ws && call(ws, conversationId)}
          className={`${btn} bg-green-600 text-white`}
        >
          📞 Call
        </button>
      </div>
    );
  }

  const status =
    current.state === CallState.RINGING ? "ringing…" : joined ? `🔊 in call (${current.participantIds.length})` : "connecting…";
  return (
    <div className="flex items-center gap-2 text-xs font-normal text-zinc-400">
      {info && <span>{info}</span>}
      <span>{status}</span>
      <button onClick={toggleMute} className={`${btn} bg-zinc-700 text-zinc-100`}>
        {muted ? "Unmute" : "Mute"}
      </button>
      <button disabled={!ws} onClick={() => ws && leave(ws)} className={`${btn} bg-red-600 text-white`}>
        Hang up
      </button>
    </div>
  );
}

// Banner shown anywhere on the page when someone calls.
export function IncomingCall({ ws, callerName }: { ws: WsClient | null; callerName: (id: bigint) => string }) {
  const { incoming, accept, decline } = useCalls();
  if (!incoming || !ws) return null;
  return (
    <div className="fixed left-1/2 top-4 z-50 flex -translate-x-1/2 items-center gap-3 rounded-xl bg-zinc-800 px-4 py-3 shadow-lg ring-2 ring-green-600">
      <span className="text-sm">📞 @{callerName(incoming.callerId)} is calling…</span>
      <button onClick={() => accept(ws)} className={`${btn} bg-green-600 text-white`}>
        Accept
      </button>
      <button onClick={() => decline(ws)} className={`${btn} bg-red-600 text-white`}>
        Decline
      </button>
    </div>
  );
}

// Once a second: delay to the SFU, packets in, packets lost.
function useStats(active: boolean) {
  const [info, setInfo] = useState("");
  useEffect(() => {
    if (!active) return;
    const t = setInterval(async () => {
      const stats = await peerConnection()?.getStats();
      let rtt = 0;
      let got = 0;
      let lost = 0;
      stats?.forEach((r) => {
        if (r.type === "candidate-pair" && r.nominated) rtt = Math.round((r.currentRoundTripTime ?? 0) * 1000);
        if (r.type === "inbound-rtp") {
          got = r.packetsReceived;
          lost = r.packetsLost;
        }
      });
      setInfo(`${rtt} ms · ${got} in · ${lost} lost`);
    }, 1000);
    return () => {
      clearInterval(t);
      setInfo("");
    };
  }, [active]);
  return info;
}
