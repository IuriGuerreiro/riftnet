import {
  Mic,
  MicOff,
  Phone,
  PhoneOff,
  ScreenShare,
  ScreenShareOff,
  SlidersHorizontal,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

import type { WsClient } from "../api/ws";
import { Button, IconButton, Modal } from "../components/ui";
import { useNameFor } from "../features/session/useRealtime";
import { CallState, myId, peerConnection, useCalls } from "../stores/calls";
import { participantVolume, useAudioSettings } from "./audioPreferences";
import { VolumeControl } from "./AudioSettings";
import { ControlButton } from "./SharePlay";
import { controlView, useControlInput } from "./useControlInput";

export function CallBar({ ws, conversationId }: { ws: WsClient | null; conversationId: bigint }) {
  const { current, joined, muted, sharing, error, call, leave, toggleMute, toggleShare } =
    useCalls();
  const [mixer, setMixer] = useState(false);
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
        label="Mixer"
        icon={<SlidersHorizontal size={18} />}
        onClick={() => setMixer(true)}
      />
      {mixer && <CallMixer people={current.participantIds} onClose={() => setMixer(false)} />}
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

function CallMixer({ people, onClose }: { people: bigint[]; onClose: () => void }) {
  const prefs = useAudioSettings();
  const { deafened, toggleDeafen } = useCalls();
  const localUser = myId();
  const nameFor = useNameFor();
  const [unmuteVolumes, setUnmuteVolumes] = useState<Record<string, number>>({});
  return (
    <Modal open title="Call mixer" onClose={onClose}>
      <VolumeControl
        label="Call volume"
        value={prefs.voiceVolume}
        onChange={(voiceVolume) => prefs.update({ voiceVolume })}
      />
      <Button size="sm" variant="secondary" aria-pressed={deafened} onClick={toggleDeafen}>
        Deafen
      </Button>
      {people
        .filter((id) => id !== localUser)
        .map((id) => {
          const volume = participantVolume(prefs, id);
          return (
            <section key={id.toString()} className="space-y-2 border-t border-surface-3 pt-3">
              <VolumeControl
                label={nameFor(id)}
                value={volume}
                max={200}
                onChange={(next) => prefs.setPersonVolume(id, next)}
              />
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    if (volume) {
                      setUnmuteVolumes((previous) => ({ ...previous, [id.toString()]: volume }));
                      prefs.setPersonVolume(id, 0);
                    } else {
                      prefs.setPersonVolume(id, unmuteVolumes[id.toString()] ?? 100);
                    }
                  }}
                >
                  {volume ? "Mute locally" : "Unmute locally"}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => prefs.setPersonVolume(id, 100)}>
                  Reset volume
                </Button>
              </div>
            </section>
          );
        })}
    </Modal>
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

export function RemoteScreen({
  ws,
  nameFor,
}: {
  ws: WsClient | null;
  nameFor: (id: bigint) => string;
}) {
  const stream = useCalls((s) => s.remoteScreen);
  const current = useCalls((s) => s.current);
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.srcObject = stream;
  }, [stream]);
  const view = controlView(current, myId());
  const controlling = view.role === "viewer" && view.granted && stream !== null;
  useControlInput(ref, controlling);
  const hostId =
    view.role === "viewer" && view.granted
      ? view.other
      : current?.sharingUserIds.find((id) => id !== myId());
  if (!stream) return null;
  return (
    <div className="fixed bottom-4 right-4 z-40 w-[48rem] max-w-[calc(100vw-2rem)]">
      <video
        ref={ref}
        autoPlay
        playsInline
        muted
        tabIndex={controlling ? 0 : -1}
        onDoubleClick={controlling ? undefined : (e) => void e.currentTarget.requestFullscreen()}
        className={`w-full rounded-xl bg-black shadow-lg ring-2 outline-none ${
          controlling ? "cursor-none ring-warning" : "ring-blue-600"
        }`}
      />
      {hostId !== undefined && (
        <div className="absolute left-2 top-2 rounded-md bg-black/60 p-1">
          <ControlButton ws={ws} hostId={hostId} nameFor={nameFor} />
        </div>
      )}
    </div>
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
