import { create as createProto } from "@bufbuild/protobuf";
import { create } from "zustand";
import type { WsClient } from "../api/ws";
import {
  CallAcceptSchema,
  CallDeclineSchema,
  CallJoinSchema,
  CallLeaveSchema,
  CallStartSchema,
  CallState,
  type Call,
} from "../gen/v1/calls_pb";
import type { Envelope } from "../gen/v1/envelope_pb";
import { platform } from "../platform/current";

// Voice calls (test UI). Signaling goes over our WebSocket; audio goes
// straight to the media server (SFU) over WebRTC. See docs/architecture/calls.md.
//
//   call(conv)  → call_start, then join (we hear ringing on their side)
//   incoming    → push call_incoming → Accept (call_accept + join) / Decline
//   leave       → call_leave; last one out ends it (push call_ended)

interface CallsState {
  /** The call this device is in (or calling out on). */
  current: Call | null;
  /** Someone is calling us. */
  incoming: Call | null;
  joined: boolean; // audio connected to the SFU
  muted: boolean;
  error: string | null;

  attach: (ws: WsClient, myId: bigint | undefined) => void;
  call: (ws: WsClient, conversationId: bigint) => Promise<void>;
  accept: (ws: WsClient) => Promise<void>;
  decline: (ws: WsClient) => Promise<void>;
  leave: (ws: WsClient) => Promise<void>;
  toggleMute: () => void;
}

// The mic, peer connection and speaker live in `platform.media`
// (browser WebRTC on web, react-native-webrtc on mobile).
const hangUpMedia = () => platform.media.stop();

export const useCalls = create<CallsState>((set, get) => {
  // Mic → WebRTC offer → call_join → SFU's answer.
  async function join(ws: WsClient, call: Call) {
    const sdpOffer = await platform.media.start({
      onConnected: () => set({ joined: true }),
      onFailed: () => set({ error: "audio connection failed", joined: false }),
    });

    const reply = await ws.request({
      case: "callJoin",
      value: createProto(CallJoinSchema, { callId: call.id, sdpOffer }),
    });
    if (reply.case !== "callJoined") throw new Error(`expected callJoined, got ${reply.case}`);
    await platform.media.setAnswer(reply.value.sdpAnswer);
    set({ current: reply.value.call ?? call });
  }

  async function run(fn: () => Promise<void>) {
    try {
      set({ error: null });
      await fn();
    } catch (e) {
      hangUpMedia();
      set({ current: null, joined: false, error: e instanceof Error ? e.message : String(e) });
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
        if (current?.id === call.id) set({ current: call });
        // Answered on another of my devices → stop ringing here.
        if (incoming?.id === call.id && myId !== undefined && call.participantIds.includes(myId) && current?.id !== call.id)
          set({ incoming: null });
        break;
      }
      case "callEnded":
        if (current?.id === p.value.callId) {
          hangUpMedia();
          set({ current: null, joined: false, muted: false });
        }
        if (incoming?.id === p.value.callId) set({ incoming: null });
        break;
    }
  }

  return {
    current: null,
    incoming: null,
    joined: false,
    muted: false,
    error: null,

    // Chain onto the chat store's push handler (call after useChat.attach).
    attach: (ws, myId) => {
      const chatPush = ws.onPush;
      ws.onPush = (p) => {
        onPush(p, myId);
        chatPush(p);
      };
      // New socket = the server already dropped us from any call.
      if (get().current) {
        hangUpMedia();
        set({ current: null, joined: false, error: "disconnected from the call" });
      }
    },

    call: (ws, conversationId) =>
      run(async () => {
        const reply = await ws.request({ case: "callStart", value: createProto(CallStartSchema, { conversationId }) });
        if (reply.case !== "callResult" || !reply.value.call) throw new Error("could not start the call");
        set({ current: reply.value.call });
        await join(ws, reply.value.call);
      }),

    accept: (ws) =>
      run(async () => {
        const call = get().incoming;
        if (!call) return;
        set({ incoming: null, current: call });
        await ws.request({ case: "callAccept", value: createProto(CallAcceptSchema, { callId: call.id }) });
        await join(ws, call);
      }),

    decline: (ws) =>
      run(async () => {
        const call = get().incoming;
        if (!call) return;
        set({ incoming: null });
        await ws.request({ case: "callDecline", value: createProto(CallDeclineSchema, { callId: call.id }) });
      }),

    leave: (ws) =>
      run(async () => {
        const call = get().current;
        hangUpMedia();
        set({ current: null, joined: false, muted: false });
        if (call) await ws.request({ case: "callLeave", value: createProto(CallLeaveSchema, { callId: call.id }) });
      }),

    toggleMute: () => {
      const muted = !get().muted;
      platform.media.setMuted(muted);
      set({ muted });
    },
  };
});

export { CallState };
