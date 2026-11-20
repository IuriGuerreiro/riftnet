import { Mic, MicOff, Phone, PhoneOff, ScreenShare, ScreenShareOff } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import type { WsClient } from "../api/ws";
import { Button, IconButton } from "../components/ui";
import { CallState, peerConnection, useCalls } from "../stores/calls";

export function CallBar({ ws, conversationId }: { ws: WsClient | null; conversationId: bigint }) {
  const { current, joined, muted, sharing, error, call, leave, toggleMute, toggleShare } =
    useCalls();
  const here = current?.conversationId === conversationId;
  const info = useStats(here && joined);

  if (!here) {
    return (
      <div className="flex items-center gap-2 text-xs font-normal">
        {error && <span className="text-danger">{error}</span>}
        <IconButton
          label={current ? "Already in a call" : "Start voice call"}
          icon={<Phone size={18} />}
          disabled={!ws || current !== null}
          onClick={() => ws && call(ws, conversationId)}
        />
      </div>
    );
  }

  const status =
    current.state === CallState.RINGING
      ? "Ringing…"
      : joined
        ? `In call (${current.participantIds.length})`
        : "Connecting…";
  return (
    <div className="flex items-center gap-2 text-xs font-normal text-fg-muted">
      {info && <span>{info}</span>}
      <span>{status}</span>
      <IconButton
        label={muted ? "Unmute" : "Mute"}
        icon={muted ? <MicOff size={18} /> : <Mic size={18} />}
        active={muted}
        onClick={toggleMute}
      />
      <IconButton
        label={sharing ? "Stop sharing" : "Share screen"}
        icon={sharing ? <ScreenShareOff size={18} /> : <ScreenShare size={18} />}
        active={sharing}
        disabled={!joined}
        onClick={() => ws && void toggleShare(ws)}
      />
      <Button variant="danger" size="sm" disabled={!ws} onClick={() => ws && leave(ws)}>
        <PhoneOff size={16} />
        Hang up
      </Button>
    </div>
  );
}

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
    <div className="fixed left-1/2 top-4 z-50 flex -translate-x-1/2 items-center gap-3 rounded-panel bg-surface-2 px-4 py-3 shadow-pop ring-2 ring-success">
      <Phone size={18} className="text-success" />
      <span className="text-sm">{callerName(incoming.callerId)} is calling…</span>
      <Button
        size="sm"
        className="bg-success text-surface-0 hover:brightness-110"
        onClick={() => accept(ws)}
      >
        Accept
      </Button>
      <Button size="sm" variant="danger" onClick={() => decline(ws)}>
        Decline
      </Button>
    </div>
  );
}

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

function useStats(active: boolean) {
  const [info, setInfo] = useState("");
  useEffect(() => {
    if (!active) return;
    const last = new Map<string, { bytes: number; at: number }>();
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
