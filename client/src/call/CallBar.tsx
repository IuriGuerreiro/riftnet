import { useEffect, useRef, useState } from "react";

import type { WsClient } from "../api/ws";
import { CallState, peerConnection, useCalls } from "../stores/calls";

// TEST UI: call controls in the DM header. Logic is in stores/calls.ts.

const btn = "rounded-md px-2 py-1 text-xs font-semibold disabled:opacity-50";

export function CallBar({ ws, conversationId }: { ws: WsClient | null; conversationId: bigint }) {
  const { current, joined, muted, sharing, error, call, leave, toggleMute, toggleShare } =
    useCalls();
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
    current.state === CallState.RINGING
      ? "ringing…"
      : joined
        ? `🔊 in call (${current.participantIds.length})`
        : "connecting…";
  return (
    <div className="flex items-center gap-2 text-xs font-normal text-zinc-400">
      {info && <span>{info}</span>}
      <span>{status}</span>
      <button onClick={toggleMute} className={`${btn} bg-zinc-700 text-zinc-100`}>
        {muted ? "Unmute" : "Mute"}
      </button>
      <button
        disabled={!joined}
        onClick={() => ws && void toggleShare(ws)}
        className={`${btn} ${sharing ? "bg-blue-600 text-white" : "bg-zinc-700 text-zinc-100"}`}
      >
        {sharing ? "Stop sharing" : "🖥 Share screen"}
      </button>
      <button
        disabled={!ws}
        onClick={() => ws && leave(ws)}
        className={`${btn} bg-red-600 text-white`}
      >
        Hang up
      </button>
    </div>
  );
}

// Banner shown anywhere on the page when someone calls.
export function IncomingCall({
  ws,
  callerName,
}: {
  ws: WsClient | null;
  callerName: (id: bigint) => string;
}) {
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

// The other person's screen share, in a panel at the bottom right.
// Double-click for fullscreen.
export function RemoteScreen() {
  const stream = useCalls((s) => s.remoteScreen);
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.srcObject = stream;
  }, [stream]);
  if (!stream) return null;
  return (
    <video
      ref={ref}
      autoPlay
      playsInline
      muted
      onDoubleClick={(e) => void e.currentTarget.requestFullscreen()}
      className="fixed bottom-4 right-4 z-40 w-[48rem] max-w-[calc(100vw-2rem)] rounded-xl bg-black shadow-lg ring-2 ring-blue-600"
    />
  );
}

// Once a second: delay to the SFU, audio packets in/lost, and screen share
// video (resolution, fps, bitrate) going out or coming in.
function useStats(active: boolean) {
  const [info, setInfo] = useState("");
  useEffect(() => {
    if (!active) return;
    const last = new Map<string, { bytes: number; at: number }>();
    // Bytes at the previous tick, per stats id, to get a bitrate.
    function mbps(r: {
      id: string;
      timestamp: number;
      bytesSent?: number;
      bytesReceived?: number;
    }) {
      const bytes = r.bytesSent ?? r.bytesReceived ?? 0;
      const prev = last.get(r.id);
      last.set(r.id, { bytes, at: r.timestamp });
      if (!prev || r.timestamp <= prev.at) return "";
      return `${(((bytes - prev.bytes) * 8) / (r.timestamp - prev.at) / 1000).toFixed(1)} Mbps`;
    }
    const t = setInterval(async () => {
      const stats = await peerConnection()?.getStats();
      let rtt = 0;
      let got = 0;
      let lost = 0;
      let video = "";
      // RTCStatsReport entries are untyped; these are the fields we read.
      interface Stat {
        id: string;
        timestamp: number;
        type: string;
        kind?: string;
        nominated?: boolean;
        currentRoundTripTime?: number;
        packetsReceived?: number;
        packetsLost?: number;
        framesPerSecond?: number;
        frameWidth?: number;
        frameHeight?: number;
        bytesSent?: number;
        bytesReceived?: number;
        qualityLimitationReason?: string;
      }
      stats?.forEach((r: Stat) => {
        if (r.type === "candidate-pair" && r.nominated)
          rtt = Math.round((r.currentRoundTripTime ?? 0) * 1000);
        if (r.type === "inbound-rtp" && r.kind === "audio") {
          got = r.packetsReceived ?? 0;
          lost = r.packetsLost ?? 0;
        }
        if (r.type === "inbound-rtp" && r.kind === "video" && r.framesPerSecond) {
          video = `⬇ ${r.frameWidth}x${r.frameHeight}@${r.framesPerSecond} ${mbps(r)} · ${r.packetsLost ?? 0} lost`;
        }
        if (r.type === "outbound-rtp" && r.kind === "video" && r.framesPerSecond) {
          const why =
            r.qualityLimitationReason && r.qualityLimitationReason !== "none"
              ? ` (${r.qualityLimitationReason})`
              : "";
          video = `⬆ ${r.frameWidth}x${r.frameHeight}@${r.framesPerSecond} ${mbps(r)}${why}`;
        }
      });
      setInfo(`${rtt} ms · ${got} in · ${lost} lost${video ? ` · ${video}` : ""}`);
    }, 1000);
    return () => {
      clearInterval(t);
      setInfo("");
    };
  }, [active]);
  return info;
}
