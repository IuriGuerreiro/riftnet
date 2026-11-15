import { PermissionsAndroid, Platform } from 'react-native';
import { mediaDevices, MediaStream, RTCPeerConnection } from 'react-native-webrtc';
import { tuneOpus, type CallMedia } from '@shared/platform/current';

// Voice calls on mobile: react-native-webrtc, same flow as desktop's webMedia.
// Remote audio plays through the native audio session on its own (no <audio>).
let pc: RTCPeerConnection | null = null;
let mic: MediaStream | null = null;

class MicPermissionError extends Error {
  constructor() {
    super('Microphone permission is needed for calls. Allow it in Settings.');
  }
}

// iOS asks on first getUserMedia (NSMicrophoneUsageDescription). Android needs
// an explicit runtime request.
async function ensureMicPermission() {
  if (Platform.OS !== 'android') return;
  const result = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO, {
    title: 'Microphone',
    message: 'Discord 2.0 needs your microphone for voice calls.',
    buttonPositive: 'Allow',
  });
  if (result !== PermissionsAndroid.RESULTS.GRANTED) throw new MicPermissionError();
}

export const nativeMedia: CallMedia = {
  async start({ onConnected, onFailed }) {
    await ensureMicPermission();
    try {
      mic = await mediaDevices.getUserMedia({ audio: true, video: false });
    } catch {
      throw new MicPermissionError();
    }
    const peer = new RTCPeerConnection({});
    pc = peer;
    // One two-way audio track: our mic goes up, the other side comes back on it.
    peer.addTransceiver(mic.getAudioTracks()[0], { direction: 'sendrecv', streams: [mic] });
    peer.addEventListener('connectionstatechange', () => {
      if (peer.connectionState === 'connected') onConnected();
      if (peer.connectionState === 'failed') onFailed();
    });
    const offer = await peer.createOffer({});
    const sdp = tuneOpus(offer.sdp ?? '');
    await peer.setLocalDescription({ type: 'offer', sdp });
    return sdp;
  },
  async setAnswer(sdp) {
    await pc?.setRemoteDescription({ type: 'answer', sdp });
  },
  setMuted(muted) {
    mic?.getAudioTracks().forEach(t => (t.enabled = !muted));
  },
  stop() {
    pc?.close();
    mic?.getTracks().forEach(t => t.stop());
    mic?.release();
    pc = null;
    mic = null;
  },
};
