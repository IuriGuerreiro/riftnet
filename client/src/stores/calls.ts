import { create as createProto } from "@bufbuild/protobuf";
import { create } from "zustand";

import type { WsClient } from "../api/ws";
import {
  type Call,
  CallAcceptSchema,
  CallDeclineSchema,
  CallJoinSchema,
  CallLeaveSchema,
  CallScreenShareSchema,
  CallStartSchema,
  CallState,
} from "../gen/v1/calls_pb";
import type { Envelope } from "../gen/v1/envelope_pb";

interface CallsState {
  current: Call | null;
  incoming: Call | null;
  joined: boolean;
  muted: boolean;
  sharing: boolean;
  remoteScreen: MediaStream | null;
  error: string | null;

  attach: (ws: WsClient, myId: bigint | undefined) => void;
  call: (ws: WsClient, conversationId: bigint) => Promise<void>;
  accept: (ws: WsClient) => Promise<void>;
  decline: (ws: WsClient) => Promise<void>;
  leave: (ws: WsClient) => Promise<void>;
  toggleMute: () => void;
  toggleShare: (ws: WsClient) => Promise<void>;
}

let pc: RTCPeerConnection | null = null;
let mic: MediaStream | null = null;
let screen: MediaStream | null = null;
let videoSender: RTCRtpSender | null = null;
let picking = false;
let screenIn: MediaStream | null = null;
let me: bigint | undefined;
const speaker = new Audio();
speaker.autoplay = true;

export function peerConnection() {
  return pc;
}

function hangUpMedia() {
  pc?.close();
  for (const t of [...(mic?.getTracks() ?? []), ...(screen?.getTracks() ?? [])]) t.stop();
  pc = mic = screen = screenIn = null;
  videoSender = null;
  speaker.srcObject = null;
}

export const useCalls = create<CallsState>((set, get) => {
  async function join(ws: WsClient, call: Call) {
    mic = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    pc = new RTCPeerConnection();
    const micTrack = mic.getAudioTracks()[0];
    if (!micTrack) throw new Error("No microphone found");
    pc.addTransceiver(micTrack, { direction: "sendrecv", streams: [mic] });
    // WARN: the idle video slot avoids renegotiation, which only works for 1:1 calls.
    videoSender = pc.addTransceiver("video", { direction: "sendrecv" }).sender;
    pc.ontrack = (e) => {
      const track = e.track;
      if (track.kind === "audio") {
        speaker.srcObject = new MediaStream([track]);
        return;
      }
      screenIn = new MediaStream([track]);
      showScreen(get().current);
    };
    pc.onconnectionstatechange = () => {
      if (pc?.connectionState === "connected") set({ joined: true });
      if (pc?.connectionState === "failed")
        set({ error: "Audio connection failed", joined: false });
    };
    const offer = await pc.createOffer();
    offer.sdp = offer.sdp?.replace(/(a=fmtp:111 [^\r\n]*)/, "$1;usedtx=1;maxaveragebitrate=64000");
    await pc.setLocalDescription(offer);

    const reply = await ws.request({
      case: "callJoin",
      value: createProto(CallJoinSchema, { callId: call.id, sdpOffer: offer.sdp ?? "" }),
    });
    if (reply.case !== "callJoined") throw new Error("Could not join the call");
    await pc.setRemoteDescription({ type: "answer", sdp: reply.value.sdpAnswer });
    set({ current: reply.value.call ?? call });
    showScreen(get().current);
  }

  function showScreen(call: Call | null) {
    const other = call?.sharingUserIds.some((id) => id !== me) ?? false;
    const remoteScreen = other ? screenIn : null;
    if (get().remoteScreen !== remoteScreen) set({ remoteScreen });
  }

  async function announceShare(ws: WsClient, sharing: boolean) {
    const call = get().current;
    if (!call) return;
    await ws
      .request({
        case: "callScreenShare",
        value: createProto(CallScreenShareSchema, { callId: call.id, sharing }),
      })
      .catch((e: unknown) => console.warn("callScreenShare", e));
  }

  async function stopShare(ws: WsClient) {
    for (const t of screen?.getTracks() ?? []) t.stop();
    screen = null;
    set({ sharing: false });
    await videoSender?.replaceTrack(null);
    await announceShare(ws, false);
  }

  async function run(fn: () => Promise<void>) {
    try {
      set({ error: null });
      await fn();
    } catch (e) {
      hangUpMedia();
      set({
        current: null,
        joined: false,
        sharing: false,
        remoteScreen: null,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  function onPush(p: Envelope["payload"], myId: bigint | undefined) {
    const { current, incoming } = get();
    switch (p.case) {
      case "callIncoming":
        if (p.value.call && current?.id !== p.value.call.id) set({ incoming: p.value.call });
        break;
      case "callUpdated": {
        const call = p.value.call;
        if (!call) break;
        if (current?.id === call.id) {
          set({ current: call });
          showScreen(call);
        }
        if (
          incoming?.id === call.id &&
          myId !== undefined &&
          call.participantIds.includes(myId) &&
          current?.id !== call.id
        )
          set({ incoming: null });
        break;
      }
      case "callEnded":
        if (current?.id === p.value.callId) {
          hangUpMedia();
          set({ current: null, joined: false, muted: false, sharing: false, remoteScreen: null });
        }
        if (incoming?.id === p.value.callId) set({ incoming: null });
        break;
      default:
        break;
    }
  }

  return {
    current: null,
    incoming: null,
    joined: false,
    muted: false,
    sharing: false,
    remoteScreen: null,
    error: null,

    attach: (ws, myId) => {
      me = myId;
      const chatPush = ws.onPush;
      ws.onPush = (p) => {
        onPush(p, myId);
        chatPush(p);
      };
      if (get().current) {
        hangUpMedia();
        set({
          current: null,
          joined: false,
          sharing: false,
          remoteScreen: null,
          error: "Disconnected from the call",
        });
      }
    },

    call: (ws, conversationId) =>
      run(async () => {
        const reply = await ws.request({
          case: "callStart",
          value: createProto(CallStartSchema, { conversationId }),
        });
        if (reply.case !== "callResult" || !reply.value.call)
          throw new Error("Could not start the call");
        set({ current: reply.value.call });
        await join(ws, reply.value.call);
      }),

    accept: (ws) =>
      run(async () => {
        const call = get().incoming;
        if (!call) return;
        set({ incoming: null, current: call });
        await ws.request({
          case: "callAccept",
          value: createProto(CallAcceptSchema, { callId: call.id }),
        });
        await join(ws, call);
      }),

    decline: (ws) =>
      run(async () => {
        const call = get().incoming;
        if (!call) return;
        set({ incoming: null });
        await ws.request({
          case: "callDecline",
          value: createProto(CallDeclineSchema, { callId: call.id }),
        });
      }),

    leave: (ws) =>
      run(async () => {
        const call = get().current;
        hangUpMedia();
        set({ current: null, joined: false, muted: false, sharing: false, remoteScreen: null });
        if (call)
          await ws.request({
            case: "callLeave",
            value: createProto(CallLeaveSchema, { callId: call.id }),
          });
      }),

    toggleMute: () => {
      const muted = !get().muted;
      for (const t of mic?.getAudioTracks() ?? []) t.enabled = !muted;
      set({ muted });
    },

    toggleShare: async (ws) => {
      const sender = videoSender;
      if (!sender || picking) return;
      if (get().sharing) {
        await stopShare(ws);
        return;
      }
      picking = true;
      let picked: MediaStream;
      try {
        picked = await navigator.mediaDevices.getDisplayMedia({
          video: { width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 60 } },
          audio: false,
        });
      } catch {
        return;
      } finally {
        picking = false;
      }
      if (videoSender !== sender) {
        for (const t of picked.getTracks()) t.stop();
        return;
      }
      screen = picked;
      const track = picked.getVideoTracks()[0];
      if (!track) return;
      track.contentHint = "detail";
      track.onended = () => void stopShare(ws);
      await sender.replaceTrack(track);
      const params = sender.getParameters();
      const encoding = params.encodings[0] ?? {};
      encoding.maxBitrate = 8_000_000;
      encoding.maxFramerate = 60;
      params.encodings = [encoding, ...params.encodings.slice(1)];
      params.degradationPreference = "maintain-framerate";
      await sender.setParameters(params).catch((e: unknown) => console.warn("setParameters", e));
      set({ sharing: true });
      await announceShare(ws, true);
    },
  };
});

export { CallState };
