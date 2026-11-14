import { useEffect, useRef, useState } from "react";

// TEST ONLY: voice call through the spike SFU (spikes/sfu-audio).
// No ringing yet: both people open the same DM and press "Join call".
// Signaling is a plain HTTP POST to the SFU (vite proxies /sfu). Later it moves to our WebSocket.
// See docs/architecture/calls.md.

type State = "idle" | "joining" | "connected" | "failed";

export function CallBar({ conversationId }: { conversationId: bigint }) {
  const [state, setState] = useState<State>("idle");
  const [info, setInfo] = useState("");
  const [muted, setMuted] = useState(false);
  const pc = useRef<RTCPeerConnection | null>(null);
  const mic = useRef<MediaStream | null>(null);
  const audio = useRef<HTMLAudioElement>(null);

  const leave = () => {
    pc.current?.close();
    mic.current?.getTracks().forEach((t) => t.stop());
    pc.current = mic.current = null;
    setState("idle");
    setInfo("");
    setMuted(false);
  };

  // Leave when switching DM or closing the page.
  useEffect(() => leave, [conversationId]);

  // Live stats once a second while in a call.
  useEffect(() => {
    if (state !== "connected") return;
    const t = setInterval(async () => {
      const stats = await pc.current?.getStats();
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
      setInfo(`${rtt} ms to SFU · ${got} pkts in · ${lost} lost`);
    }, 1000);
    return () => clearInterval(t);
  }, [state]);

  const join = async () => {
    try {
      setState("joining");
      mic.current = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      const p = (pc.current = new RTCPeerConnection());
      // One two-way audio track: our mic goes up, the other person comes back on it.
      p.addTransceiver(mic.current.getAudioTracks()[0], { direction: "sendrecv", streams: [mic.current] });
      p.ontrack = (e) => {
        if (audio.current) audio.current.srcObject = new MediaStream([e.track]);
      };
      p.onconnectionstatechange = () => {
        if (p.connectionState === "connected") setState("connected");
        if (p.connectionState === "failed") setState("failed");
      };
      const offer = await p.createOffer();
      // Opus: DTX on, 64 kbps (FEC is on by default in Chrome).
      offer.sdp = offer.sdp?.replace(/(a=fmtp:111 [^\r\n]*)/, "$1;usedtx=1;maxaveragebitrate=64000");
      await p.setLocalDescription(offer);
      const res = await fetch(`/sfu/join?room=${conversationId}`, {
        method: "POST",
        body: JSON.stringify(p.localDescription),
      });
      if (!res.ok) throw new Error(`SFU: ${res.status} ${await res.text()}`);
      await p.setRemoteDescription(await res.json());
    } catch (e) {
      leave();
      setState("failed");
      setInfo(e instanceof Error ? e.message : String(e));
    }
  };

  const toggleMute = () => {
    mic.current?.getAudioTracks().forEach((t) => (t.enabled = muted));
    setMuted(!muted);
  };

  const btn = "rounded-md px-2 py-1 text-xs font-semibold";
  return (
    <div className="flex items-center gap-2 text-xs font-normal text-zinc-400">
      <audio ref={audio} autoPlay />
      {info && <span>{info}</span>}
      {state === "idle" || state === "failed" ? (
        <button onClick={join} className={`${btn} bg-green-600 text-white`}>
          {state === "failed" ? "Retry call" : "Join call"}
        </button>
      ) : (
        <>
          <span>{state === "joining" ? "joining…" : "🔊 in call"}</span>
          <button onClick={toggleMute} className={`${btn} bg-zinc-700`}>
            {muted ? "Unmute" : "Mute"}
          </button>
          <button onClick={leave} className={`${btn} bg-red-600 text-white`}>
            Leave
          </button>
        </>
      )}
    </div>
  );
}
