import { create as createProto } from "@bufbuild/protobuf";
import { create } from "zustand";

import type { WsClient } from "../api/ws";
import {
  type AudioPreferences,
  isParticipantMuted,
  participantVolume,
  useAudioSettings,
} from "../call/audioPreferences";
import { CallPlayback, captureMicrophone, type Microphone } from "../call/callAudio";
import { startVoiceActivation } from "../call/micActivation";
import {
  decodeTagged,
  encodeInput,
  type HostState,
  hostStep,
  type InputEvent,
  LATEST,
  type MonitorInfo,
  type Rect,
  RELIABLE,
} from "../call/sharePlayWire";
import {
  type Call,
  CallAcceptSchema,
  CallControlAction,
  CallControlSchema,
  CallDeclineSchema,
  CallJoinSchema,
  CallLeaveSchema,
  CallScreenShareSchema,
  CallStartSchema,
  CallState,
} from "../gen/v1/calls_pb";
import type { Envelope } from "../gen/v1/envelope_pb";
import { JoinFriendCallSchema } from "../gen/v1/presence_pb";
import { platform } from "../platform";

interface CallsState {
  current: Call | null;
  incoming: Call | null;
  joined: boolean;
  muted: boolean;
  deafened: boolean;
  audioError: string | null;
  audioStatus: string | null;
  shortcutStatus: string | null;
  speaking: bigint[];
  toggleDeafen: () => void;
  sharing: boolean;
  remoteScreen: MediaStream | null;
  error: string | null;
  hostArmedFor: bigint | null;

  attach: (ws: WsClient, myId: bigint | undefined) => void;
  call: (ws: WsClient, conversationId: bigint) => Promise<void>;
  joinFriend: (ws: WsClient, friendId: bigint) => Promise<void>;
  accept: (ws: WsClient) => Promise<void>;
  decline: (ws: WsClient) => Promise<void>;
  leave: (ws: WsClient) => Promise<void>;
  toggleMute: () => void;
  toggleShare: (ws: WsClient) => Promise<void>;
  requestControl: (ws: WsClient, hostId: bigint) => Promise<void>;
  answerControl: (
    ws: WsClient,
    requestId: bigint,
    approval: { monitor: Rect; warningAcknowledged: true } | null,
  ) => Promise<void>;
  revokeControl: (ws: WsClient) => Promise<void>;
}

let pc: RTCPeerConnection | null = null;
let mic: Microphone | null = null;
let micSender: RTCRtpSender | null = null;
let micChanges = Promise.resolve();
let mediaGeneration = 0;
let stopVoiceActivation: (() => void) | undefined;
let shortcutUpdates = Promise.resolve();
let shortcutKey: string | null = null;
let shortcutDown = false;
let releaseTimer = 0;
let stopShortcutEvents: (() => void) | undefined;
let screen: MediaStream | null = null;
let videoSender: RTCRtpSender | null = null;
let screenAudioSender: RTCRtpSender | null = null;
let picking = false;
let joiningFriend = false;
let screenIn: MediaStream | null = null;
let me: bigint | undefined;
let inputCh: RTCDataChannel | null = null;
let moveCh: RTCDataChannel | null = null;
let screenSize = { width: 0, height: 0 };
const host: HostState = { armed: null, seen: new Set() };
let armedController: bigint | null = null;
let hostSupported: Promise<boolean> | null = null;
let unlistenHotkey: (() => void) | null = null;
let liveWs: WsClient | null = null;
const legacyVoice = new CallPlayback();
const voices = new Map<bigint, RemoteAudio>();
const streamAudio = new Map<bigint, RemoteAudio>();
interface RemoteAudio {
  playback: CallPlayback;
  lastSpeech: number;
  normalization: number;
}
let audioPollTimer = 0;
let modernAudio = false;

const audioSignal = "call-audio-v1";
const remoteTrackId = /^(voice|screen)-([0-9]{1,20})-[0-9]+$/;

export function peerConnection() {
  return pc;
}

export function activeAudioDevices() {
  return {
    input: mic?.input.label,
  };
}

export function myId() {
  return me;
}

async function tauri<T>(cmd: string, args?: Record<string, unknown>): Promise<T | null> {
  if (platform.kind !== "desktop") return null;
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
}

function canHost(): Promise<boolean> {
  hostSupported ??= tauri<boolean>("share_play_supported")
    .then((ok) => ok === true)
    .catch(() => false);
  return hostSupported;
}

export function sendInput(e: InputEvent) {
  const ch = e.t === "move" ? moveCh : inputCh;
  const control = useCalls.getState().current?.control;
  if (!control?.granted || control.controllerId !== me) return;
  if (ch?.readyState === "open") {
    ch.send(encodeInput(e, control.grantId));
  }
}

export function listMonitors(): Promise<{ monitors: MonitorInfo[]; suggested: number | null }> {
  return tauri<{ monitors: MonitorInfo[]; suggested: number | null }>("share_play_monitors", {
    ...screenSize,
  }).then((r) => r ?? { monitors: [], suggested: null });
}

function disarm() {
  host.armed = null;
  armedController = null;
  useCalls.setState({ hostArmedFor: null });
  void tauri("share_play_revoke").catch((e: unknown) => console.warn("share play", e));
}

function syncHost(call: Call | null, sharing: boolean) {
  for (;;) {
    const step = hostStep(host, call?.control, me, sharing);
    if (step.kind === "none") return;
    if (step.kind === "revoke") {
      disarm();
      continue;
    }
    host.seen.add(step.grantId);
    host.armed = step.grantId;
    armedController = step.controllerId;
    useCalls.setState({ hostArmedFor: step.controllerId });
    tauri("share_play_arm", {
      grantId: step.grantId.toString(),
      controllerId: step.controllerId.toString(),
      requestId: step.requestId.toString(),
    }).catch((e: unknown) => {
      console.warn("share play arm", e);
      if (host.armed === step.grantId) hostLost("Couldn't start remote control");
    });
    return;
  }
}

function hostLost(reason?: string) {
  if (host.armed === null && armedController === null) return;
  disarm();
  if (reason) useCalls.setState({ error: reason });
  const ws = liveWs;
  if (ws) void useCalls.getState().revokeControl(ws);
}

function onRemoteInput(data: unknown, lossy: boolean) {
  if (!(data instanceof ArrayBuffer) || armedController === null) return;
  const msg = decodeTagged(data);
  if (msg?.sender !== armedController || msg.grantId !== host.armed) return;
  let event: unknown;
  try {
    event = JSON.parse(msg.json);
  } catch {
    return;
  }
  // INVARIANT: the Rust side checks the grant again before touching the OS.
  void tauri("share_play_input", {
    sender: msg.sender.toString(),
    grantId: msg.grantId.toString(),
    lossy,
    event,
  }).catch(() => {});
}

function hangUpMedia() {
  disarm();
  inputCh = moveCh = null;
  mediaGeneration++;
  stopVoiceActivation?.();
  stopVoiceActivation = undefined;
  stopShortcutEvents?.();
  stopShortcutEvents = undefined;
  resetPushToTalk();
  pc?.close();
  mic?.close();
  for (const t of screen?.getTracks() ?? []) t.stop();
  pc = mic = micSender = screen = screenIn = null;
  videoSender = screenAudioSender = null;
  legacyVoice.close();
  for (const tracks of [voices, streamAudio]) {
    for (const source of tracks.values()) source.playback.close();
    tracks.clear();
  }
  window.clearInterval(audioPollTimer);
  modernAudio = false;
  updateShortcut();
  useCalls.setState({ deafened: false, audioError: null, audioStatus: null, speaking: [] });
}

export const useCalls = create<CallsState>((set, get) => {
  async function join(
    ws: WsClient,
    target: { kind: "call"; call: Call } | { kind: "friend"; id: bigint },
  ) {
    const generation = mediaGeneration;
    const prefs = useAudioSettings.getState();
    const captured = await captureMicrophone(prefs, true);
    if (generation !== mediaGeneration) {
      captured.close();
      return;
    }
    mic = captured;
    const connection = new RTCPeerConnection();
    pc = connection;
    syncMicrophoneMute();
    micSender = pc.addTransceiver(mic.track, { direction: "sendrecv" }).sender;
    watchMicrophone(mic, prefs);
    bindPushToTalk();
    updateShortcut();
    const latest = useAudioSettings.getState();
    if (captureChanged(prefs, latest)) refreshMicrophone();
    else if (mic.gain) mic.gain.gain.value = latest.inputVolume / 100;
    videoSender = pc.addTransceiver("video", { direction: "sendrecv" }).sender;
    inputCh = pc.createDataChannel(RELIABLE, { ordered: true });
    moveCh = pc.createDataChannel(LATEST, { ordered: false, maxRetransmits: 0 });
    for (const ch of [inputCh, moveCh]) {
      ch.binaryType = "arraybuffer";
      const lossy = ch === moveCh;
      ch.onmessage = (e: MessageEvent) => onRemoteInput(e.data, lossy);
      ch.onclose = () => hostLost("Remote control ended: connection lost");
    }
    const audioChannel = connection.createDataChannel(audioSignal);
    audioChannel.onmessage = (event: MessageEvent<unknown>) => {
      if (typeof event.data !== "string" || pc !== connection) return;
      void answerAudioOffer(connection, audioChannel, event.data).catch(() => {
        if (pc === connection) set({ audioError: "Could not negotiate the call audio tracks." });
      });
    };
    audioPollTimer = window.setInterval(updatePlayback, 90);
    pc.ontrack = (e) => {
      if (pc !== connection) return;
      const track = e.track;
      if (track.kind === "audio") {
        attachRemoteAudio(track);
        return;
      }
      screenIn = new MediaStream([track]);
      showScreen(get().current);
    };
    pc.onconnectionstatechange = () => {
      if (pc !== connection) return;
      const state = connection.connectionState;
      if (state === "disconnected" || state === "failed" || state === "closed")
        hostLost("Remote control ended: connection lost");
      if (state === "connected") set({ joined: true });
      if (state === "failed") set({ error: "Audio connection failed", joined: false });
    };
    const offer = await pc.createOffer();
    offer.sdp = offer.sdp?.replace(/(a=fmtp:111 [^\r\n]*)/, "$1;usedtx=1;maxaveragebitrate=64000");
    await pc.setLocalDescription(offer);

    const reply = await ws.request(
      target.kind === "friend"
        ? {
            case: "joinFriendCall",
            value: createProto(JoinFriendCallSchema, {
              friendId: target.id,
              sdpOffer: offer.sdp ?? "",
            }),
          }
        : {
            case: "callJoin",
            value: createProto(CallJoinSchema, {
              callId: target.call.id,
              sdpOffer: offer.sdp ?? "",
            }),
          },
    );
    if (reply.case !== "callJoined") throw new Error("Could not join the call");
    if (pc !== connection) return;
    await connection.setRemoteDescription({ type: "answer", sdp: reply.value.sdpAnswer });
    if (pc !== connection) return;
    set({ current: reply.value.call ?? (target.kind === "friend" ? null : target.call) });
    showScreen(get().current);
    updatePlayback();
  }

  function showScreen(call: Call | null) {
    const other = call?.sharingUserIds.some((id) => id !== me) ?? false;
    const remoteScreen = other ? screenIn : null;
    if (get().remoteScreen !== remoteScreen) set({ remoteScreen });
  }

  async function announceShare(ws: WsClient, sharing: boolean, controllable = false) {
    const call = get().current;
    if (!call) return;
    await ws.request({
      case: "callScreenShare",
      value: createProto(CallScreenShareSchema, { callId: call.id, sharing, controllable }),
    });
  }

  async function stopShare(ws: WsClient) {
    for (const t of screen?.getTracks() ?? []) t.stop();
    screen = null;
    set({ sharing: false });
    syncHost(get().current, false);
    await Promise.allSettled([
      videoSender?.replaceTrack(null),
      screenAudioSender?.replaceTrack(null),
      announceShare(ws, false),
    ]);
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
          syncHost(call, get().sharing);
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

  async function sendControl(ws: WsClient, action: CallControlAction, userId = 0n, requestId = 0n) {
    const call = get().current;
    if (!call) return;
    try {
      const reply = await ws.request({
        case: "callControl",
        value: createProto(CallControlSchema, { callId: call.id, action, userId, requestId }),
      });
      if (reply.case === "callResult" && reply.value.call && get().current?.id === call.id) {
        set({ current: reply.value.call });
        syncHost(reply.value.call, get().sharing);
      }
    } catch (e) {
      if (action === CallControlAction.GRANT && host.armed === null) disarm();
      set({ error: e instanceof Error ? e.message : String(e) });
    }
  }

  return {
    current: null,
    incoming: null,
    joined: false,
    muted: false,
    deafened: false,
    audioError: null,
    audioStatus: null,
    shortcutStatus: null,
    speaking: [],
    toggleDeafen: () => {
      set(({ deafened }) => ({ deafened: !deafened }));
      syncMicrophoneMute();
    },
    sharing: false,
    remoteScreen: null,
    error: null,
    hostArmedFor: null,

    attach: (ws, myId) => {
      me = myId;
      liveWs = ws;
      const prevClose = ws.onClose;
      ws.onClose = (code) => {
        if (liveWs === ws) liveWs = null;
        hostLost();
        prevClose(code);
      };
      if (platform.kind === "desktop") {
        unlistenHotkey?.();
        unlistenHotkey = null;
        void import("@tauri-apps/api/event").then(async ({ listen }) => {
          const off = await listen("share-play://revoked", () => {
            hostLost("Remote control ended");
            void get().revokeControl(ws);
          });
          unlistenHotkey = off;
        });
      }
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
        set(({ incoming }) => ({
          current: reply.value.call,
          incoming: incoming?.id === reply.value.call?.id ? null : incoming,
        }));
        await join(ws, { kind: "call", call: reply.value.call });
      }),

    joinFriend: async (ws, friendId) => {
      if (joiningFriend || get().current || pc || mic) return;
      joiningFriend = true;
      try {
        await run(() => join(ws, { kind: "friend", id: friendId }));
        if (get().current?.id === get().incoming?.id) set({ incoming: null });
      } finally {
        joiningFriend = false;
      }
    },

    accept: (ws) =>
      run(async () => {
        const call = get().incoming;
        if (!call) return;
        set({ incoming: null, current: call });
        await ws.request({
          case: "callAccept",
          value: createProto(CallAcceptSchema, { callId: call.id }),
        });
        await join(ws, { kind: "call", call });
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
      set({ muted });
      syncMicrophoneMute();
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
          audio: Boolean(screenAudioSender && useAudioSettings.getState().shareAudio),
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
      if (!track) {
        for (const t of picked.getTracks()) t.stop();
        screen = null;
        return;
      }
      const audio = picked.getAudioTracks()[0];
      set({
        audioError:
          useAudioSettings.getState().shareAudio && !audio
            ? "This share did not include audio."
            : null,
      });
      const settings = track.getSettings();
      screenSize = { width: settings.width ?? 0, height: settings.height ?? 0 };
      const controllable = settings.displaySurface === "monitor" && (await canHost());
      track.contentHint = "detail";
      track.onended = () => void stopShare(ws);
      if (pc === null || videoSender !== sender || screen !== picked) return;
      try {
        await announceShare(ws, true, controllable);
        if (screen !== picked || videoSender !== sender) return;
        await Promise.all([
          sender.replaceTrack(track),
          screenAudioSender?.replaceTrack(audio ?? null),
        ]);
      } catch {
        await stopShare(ws);
        set({
          audioError: "Could not start sharing the screen. Check if someone is already sharing.",
        });
        return;
      }
      if (screen !== picked) return;
      const params = sender.getParameters();
      const encoding = params.encodings[0] ?? {};
      encoding.maxBitrate = 8_000_000;
      encoding.maxFramerate = 60;
      params.encodings = [encoding, ...params.encodings.slice(1)];
      params.degradationPreference = "maintain-framerate";
      await sender.setParameters(params).catch((e: unknown) => console.warn("setParameters", e));
      set({ sharing: true });
    },

    requestControl: (ws, hostId) => sendControl(ws, CallControlAction.REQUEST, hostId),

    answerControl: async (ws, requestId, approval) => {
      const c = get().current?.control;
      if (!c || c.hostId !== me || c.granted || c.requestId !== requestId) return;
      if (approval) {
        try {
          await tauri("share_play_approve", {
            controllerId: c.controllerId.toString(),
            requestId: requestId.toString(),
            ...approval,
          });
        } catch (e) {
          disarm();
          set({ error: e instanceof Error ? e.message : String(e) });
          await sendControl(ws, CallControlAction.DENY, c.controllerId, requestId);
          return;
        }
      }
      if (!approval) disarm();
      await sendControl(
        ws,
        approval ? CallControlAction.GRANT : CallControlAction.DENY,
        c.controllerId,
        requestId,
      );
    },

    revokeControl: async (ws) => {
      if (host.armed !== null) disarm();
      if (get().current?.control) await sendControl(ws, CallControlAction.REVOKE);
    },
  };
});

export { CallState };

function syncMicrophoneMute() {
  const { muted, deafened } = useCalls.getState();
  if (mic) mic.track.enabled = microphoneEnabled(muted, deafened);
}

async function answerAudioOffer(
  connection: RTCPeerConnection,
  channel: RTCDataChannel,
  sdp: string,
) {
  await connection.setRemoteDescription({ type: "offer", sdp });
  const sections = sdp.split("\r\nm=");
  const screenInput = sections.find(
    (section) => section.startsWith("audio ") && /^a=recvonly\r?$/m.test(section),
  );
  const inputMid = screenInput?.match(/^a=mid:([^\r\n]+)$/m)?.[1];
  if (!inputMid) throw new Error("Screen audio input was not offered");
  const transceivers = connection.getTransceivers();
  const input = transceivers.find((t) => t.mid === inputMid);
  if (!input) throw new Error("Screen audio input was not created");
  input.direction = "sendonly";
  const screenOutputs = new Set(
    transceivers.filter((t) => t.receiver.track.id.startsWith("screen-")).map((t) => t.mid),
  );
  const answer = await connection.createAnswer();
  const stereoSdp = answer.sdp
    ?.split("\r\nm=")
    .map((section) => {
      const mid = /^a=mid:([^\r\n]+)$/m.exec(section)?.[1];
      if (!mid || !screenOutputs.has(mid)) return section;
      return section.replace(/(^a=fmtp:\d+ [^\r\n]*useinbandfec=[^\r\n]*)/m, (line) =>
        line.includes(";stereo=") ? line : `${line};stereo=1`,
      );
    })
    .join("\r\nm=");
  await connection.setLocalDescription({ type: "answer", sdp: stereoSdp });
  if (pc !== connection || channel.readyState !== "open") return;
  modernAudio = true;
  legacyVoice.close();
  screenAudioSender = input.sender;
  channel.send(connection.localDescription?.sdp ?? "");
}

function attachRemoteAudio(track: MediaStreamTrack) {
  const identity = remoteTrackId.exec(track.id);
  const id = identity?.[2];
  if (!id) {
    if (!modernAudio) {
      updatePlayback();
      legacyVoice.attach(track);
    }
    return;
  }
  modernAudio = true;
  legacyVoice.close();
  const user = BigInt(id);
  const sources = identity[1] === "voice" ? voices : streamAudio;
  sources.get(user)?.playback.close();
  const source: RemoteAudio = {
    playback: new CallPlayback(),
    lastSpeech: -Infinity,
    normalization: 1,
  };
  sources.set(user, source);
  updatePlayback();
  source.playback.attach(track);
  track.addEventListener(
    "ended",
    () => {
      if (sources.get(user) !== source) return;
      source.playback.close();
      sources.delete(user);
    },
    { once: true },
  );
}

function updatePlayback() {
  const { current, deafened, speaking } = useCalls.getState();
  const prefs = useAudioSettings.getState();
  const peer =
    current?.participantIds.find((id) => id !== me) ??
    (current?.callerId !== me ? current?.callerId : undefined);
  const voiceVolume = !deafened ? prefs.voiceVolume / 100 : 0;
  const legacyVolume =
    current && current.participantIds.length <= 2 && !isParticipantMuted(prefs, peer)
      ? (voiceVolume * participantVolume(prefs, peer)) / 100
      : 0;
  legacyVoice.configure(legacyVolume, prefs.outputId);

  const active: bigint[] = [];
  const now = performance.now();
  for (const [id, source] of voices) {
    const present = current?.participantIds.includes(id) ?? false;
    const volume = present && !isParticipantMuted(prefs, id) ? (voiceVolume * participantVolume(prefs, id)) / 100 : 0;
    const level = source.playback.level();
    if (present && level >= 0.016) {
      source.lastSpeech = now;
      const target = Math.min(2, Math.max(0.55, 0.08 / level));
      source.normalization += (target - source.normalization) * 0.12;
    }
    if (volume > 0 && now - source.lastSpeech < 240) active.push(id);
    source.playback.configure(
      volume * (prefs.normalizeVoices ? source.normalization : 1),
      prefs.outputId,
    );
  }
  const selected = current?.sharingUserIds.find((id) => id !== me);
  const ducking = prefs.duckStreams && active.length > 0 ? 0.3 : 1;
  for (const [id, source] of streamAudio) {
    const volume =
      !deafened && selected === id && current?.sharingUserIds.includes(id)
        ? (prefs.streamVolume / 100) * ducking
        : 0;
    source.playback.configure(volume, prefs.outputId);
  }
  if (speaking.length !== active.length || active.some((id, index) => speaking[index] !== id))
    useCalls.setState({ speaking: active });
}

function watchMicrophone(
  microphone: Microphone,
  prefs: ReturnType<typeof useAudioSettings.getState>,
) {
  stopVoiceActivation?.();
  stopVoiceActivation = startVoiceActivation(microphone, useAudioSettings.getState);
  const usingDefault = prefs.inputId && microphone.input.getSettings().deviceId !== prefs.inputId;
  const enhancedUnavailable = prefs.suppression === "enhanced" && !microphone.enhanced;
  useCalls.setState({
    audioError: null,
    audioStatus:
      [
        usingDefault ? "Using the system microphone." : "",
        enhancedUnavailable ? "Enhanced suppression is unavailable. Using Standard." : "",
        !microphone.analyser
          ? "Microphone gain and voice activation are unavailable on this client."
          : "",
      ]
        .filter(Boolean)
        .join(" ") || null,
  });
  microphone.input.addEventListener(
    "ended",
    () => {
      if (mic === microphone) refreshMicrophone(true);
    },
    { once: true },
  );
}

function refreshMicrophone(allowDefault = false) {
  const sender = micSender;
  const generation = mediaGeneration;
  if (!sender) return;
  micChanges = micChanges
    .then(async () => {
      if (generation !== mediaGeneration) return;
      const prefs = useAudioSettings.getState();
      const next = await captureMicrophone(prefs, allowDefault);
      if (generation !== mediaGeneration) {
        next.close();
        return;
      }
      const { muted, deafened } = useCalls.getState();
      next.track.enabled = microphoneEnabled(muted, deafened);
      try {
        await sender.replaceTrack(next.track);
      } catch (error) {
        next.close();
        throw error;
      }
      if (generation !== mediaGeneration) {
        next.close();
        return;
      }
      mic?.close();
      mic = next;
      syncMicrophoneMute();
      if (mic.gain) mic.gain.gain.value = useAudioSettings.getState().inputVolume / 100;
      watchMicrophone(mic, prefs);
    })
    .catch((error: unknown) => {
      if (generation === mediaGeneration)
        useCalls.setState({
          audioError: error instanceof Error ? error.message : "Could not switch microphone",
        });
    });
}

useCalls.subscribe((state, previous) => {
  if (state.current !== previous.current || state.deafened !== previous.deafened) updatePlayback();
});

useAudioSettings.subscribe((prefs, previous) => {
  updatePlayback();
  if (mic?.gain && prefs.inputVolume !== previous.inputVolume)
    mic.gain.gain.setTargetAtTime(prefs.inputVolume / 100, mic.gain.context.currentTime, 0.015);
  if (captureChanged(prefs, previous)) refreshMicrophone();
  if (prefs.inputMode !== previous.inputMode || prefs.pushKey !== previous.pushKey) {
    resetPushToTalk();
    updateShortcut();
  }
});

function captureChanged(prefs: AudioPreferences, previous: AudioPreferences) {
  return (
    prefs.inputId !== previous.inputId ||
    prefs.suppression !== previous.suppression ||
    prefs.echoCancellation !== previous.echoCancellation ||
    prefs.autoGainControl !== previous.autoGainControl
  );
}

function microphoneEnabled(muted: boolean, deafened: boolean) {
  return !muted && !deafened && (useAudioSettings.getState().inputMode !== "push" || shortcutDown);
}

function resetPushToTalk() {
  window.clearTimeout(releaseTimer);
  shortcutDown = false;
  syncMicrophoneMute();
}

function setPushToTalk(pressed: boolean) {
  window.clearTimeout(releaseTimer);
  if (pressed) {
    shortcutDown = true;
    syncMicrophoneMute();
  } else {
    releaseTimer = window.setTimeout(resetPushToTalk, useAudioSettings.getState().releaseDelay);
  }
}

function bindPushToTalk() {
  const controller = new AbortController();
  const { signal } = controller;
  let unlisten: (() => void) | undefined;
  function key(event: KeyboardEvent) {
    const prefs = useAudioSettings.getState();
    if (shortcutKey || prefs.inputMode !== "push" || event.code !== prefs.pushKey) return;
    if (
      event.type === "keydown" &&
      (event.altKey || event.metaKey || event.ctrlKey || event.shiftKey)
    )
      return;
    event.preventDefault();
    if (!event.repeat) setPushToTalk(event.type === "keydown");
  }
  window.addEventListener("keydown", key, { signal });
  window.addEventListener("keyup", key, { signal });
  window.addEventListener("blur", resetPushToTalk, { signal });
  if (platform.kind === "desktop")
    void import("@tauri-apps/api/event")
      .then(({ listen }) =>
        listen<[string, boolean]>("voice://push-to-talk", ({ payload: [key, pressed] }) => {
          if (!signal.aborted && shortcutKey === key) setPushToTalk(pressed);
        }),
      )
      .then((off) => {
        if (signal.aborted) off();
        else unlisten = off;
      })
      .catch(() => {});
  stopShortcutEvents = () => {
    controller.abort();
    unlisten?.();
  };
}

function updateShortcut() {
  if (platform.kind !== "desktop") return;
  const prefs = useAudioSettings.getState();
  const key = mic && prefs.inputMode === "push" ? prefs.pushKey : null;
  shortcutKey = null;
  shortcutUpdates = shortcutUpdates.then(async () => {
    try {
      await tauri("voice_shortcut", { key });
      const latest = useAudioSettings.getState();
      if (key && mic && latest.inputMode === "push" && latest.pushKey === key) {
        shortcutKey = key;
        useCalls.setState({ shortcutStatus: null });
      }
    } catch {
      useCalls.setState({
        shortcutStatus: key
          ? "Global shortcut unavailable. Push-to-talk works while the app is focused."
          : null,
      });
    }
  });
}
