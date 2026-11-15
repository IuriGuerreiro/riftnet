import { tuneOpus, type CallMedia } from "./types";

// Browser / Tauri webview WebRTC.
let pc: RTCPeerConnection | null = null;
let mic: MediaStream | null = null;
/** For the debug stats in CallBar (web only). */
export const peerConnection = () => pc;

const speaker = new Audio();
speaker.autoplay = true;

export const webMedia: CallMedia = {
  async start({ onConnected, onFailed }) {
    mic = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    pc = new RTCPeerConnection();
    // One two-way audio track: our mic goes up, the other side comes back on it.
    pc.addTransceiver(mic.getAudioTracks()[0], { direction: "sendrecv", streams: [mic] });
    pc.ontrack = (e) => {
      speaker.srcObject = new MediaStream([e.track]);
    };
    pc.onconnectionstatechange = () => {
      if (pc?.connectionState === "connected") onConnected();
      if (pc?.connectionState === "failed") onFailed();
    };
    const offer = await pc.createOffer();
    offer.sdp = tuneOpus(offer.sdp ?? "");
    await pc.setLocalDescription(offer);
    return offer.sdp;
  },
  async setAnswer(sdp) {
    await pc?.setRemoteDescription({ type: "answer", sdp });
  },
  setMuted(muted) {
    mic?.getAudioTracks().forEach((t) => (t.enabled = !muted));
  },
  stop() {
    pc?.close();
    mic?.getTracks().forEach((t) => t.stop());
    pc = mic = null;
    speaker.srcObject = null;
  },
};
