import { useSyncExternalStore } from "react";

import type { USERS } from "./data";
import { CONVERSATIONS, ME, type Message, type Server, SERVERS, type Status, user } from "./data";

export type Dialog =
  | { kind: "newDm" }
  | { kind: "newGroup" }
  | { kind: "addMembers"; id: string }
  | { kind: "renameGroup"; id: string }
  | { kind: "addServer"; code?: string }
  | { kind: "discover" }
  | { kind: "invite"; server: string }
  | { kind: "channel"; server: string; channel?: string }
  | { kind: "serverSettings"; server: string; tab?: string }
  | { kind: "forward"; text: string }
  | { kind: "report"; what: string }
  | { kind: "share" }
  | { kind: "shortcuts" }
  | { kind: "settings"; tab?: string }
  | { kind: "expired" }
  | { kind: "confirm"; title: string; body: string; action: string; run: () => void };

export interface Toast {
  id: number;
  text: string;
  who?: string;
  open?: string;
  undo?: () => void;
}

export interface Settings {
  inputMode: "open" | "voice" | "push";
  input: string;
  output: string;
  camera: string;
  inputVolume: number;
  outputVolume: number;
  sensitivity: number;
  pushKey: string;
  noise: "off" | "standard" | "enhanced";
  echo: boolean;
  gain: boolean;
  notifyMessages: boolean;
  notifyCalls: boolean;
  notifyRequests: boolean;
  sounds: boolean;
  dmFrom: "everyone" | "mutual" | "friends";
  showActivity: boolean;
  embeds: boolean;
  density: "cozy" | "compact";
  scale: number;
  reduceMotion: boolean;
  twoFactor: boolean;
}

export interface ShareOptions {
  source: string;
  quality: string;
  audio: boolean;
  control: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  inputMode: "open",
  input: "Default microphone",
  output: "Default speakers",
  camera: "Built-in camera",
  inputVolume: 100,
  outputVolume: 100,
  sensitivity: 35,
  pushKey: "V",
  noise: "enhanced",
  echo: true,
  gain: true,
  notifyMessages: true,
  notifyCalls: true,
  notifyRequests: true,
  sounds: true,
  dmFrom: "everyone",
  showActivity: true,
  embeds: true,
  density: "cozy",
  scale: 100,
  reduceMotion: false,
  twoFactor: false,
};

function loadSettings(): Settings {
  try {
    return {
      ...DEFAULT_SETTINGS,
      ...(JSON.parse(localStorage.getItem("adept-settings") ?? "{}") as Partial<Settings>),
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export const world = {
  friends: new Set(["maya", "tom", "lea", "kai", "sam", "noor", "ben", "ivy"]),
  incoming: ["rui", "nina"],
  outgoing: ["otto"],
  blocked: new Set<string>(),
  muted: new Set<string>(),
  closed: new Set<string>(),
  volumes: {} as Record<string, number>,
  silenced: new Set<string>(),
  speakingIn: ["tom", "noor", "lea"],
  threads: {} as Record<string, Message[]>,
  pending: {} as Record<string, Message[]>,
  dialog: null as Dialog | null,
  toasts: [] as Toast[],
  settings: loadSettings(),
  connection: "online" as "online" | "reconnecting" | "offline",
  update: null as null | "available" | "downloading" | "ready",
  ringing: null as { who: string; video: boolean } | null,
  controlRequest: null as string | null,
  callQuality: "good" as "good" | "poor" | "reconnecting",
  micBlocked: false,
  empty: false,
  share: {
    source: "Screen 1",
    quality: "1080p 60fps",
    audio: true,
    control: false,
  } as ShareOptions,
};

let version = 0;
const listeners = new Set<() => void>();

export function change(fn: () => void) {
  fn();
  version += 1;
  for (const l of listeners) l();
}

export function useWorld() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => version,
  );
}

export const openDialog = (dialog: Dialog | null) =>
  change(() => {
    world.dialog = dialog;
  });

let toastId = 0;
export function toast(text: string, extra: Partial<Toast> = {}) {
  const id = (toastId += 1);
  change(() => {
    world.toasts = [...world.toasts.slice(-2), { id, text, ...extra }];
  });
  setTimeout(() => dismissToast(id), 5000);
}

export const dismissToast = (id: number) =>
  change(() => {
    world.toasts = world.toasts.filter((t) => t.id !== id);
  });

export function saveSettings(patch: Partial<Settings>) {
  change(() => {
    world.settings = { ...world.settings, ...patch };
    try {
      localStorage.setItem("adept-settings", JSON.stringify(world.settings));
    } catch {
      return;
    }
  });
}

export const resetSettings = () => saveSettings(DEFAULT_SETTINGS);

export function updateMe(patch: Partial<(typeof USERS)[string]>) {
  change(() => {
    Object.assign(user(ME), patch);
  });
}

export const setStatus = (status: Status) => updateMe({ status });

export function friendState(id: string) {
  if (world.friends.has(id)) return "friend";
  if (world.incoming.includes(id)) return "incoming";
  if (world.outgoing.includes(id)) return "outgoing";
  return "none";
}

export function answerRequest(id: string, accept: boolean) {
  change(() => {
    world.incoming = world.incoming.filter((x) => x !== id);
    if (accept) world.friends.add(id);
  });
  toast(accept ? `You and ${user(id).name} are now friends` : "Request ignored");
}

export function addFriend(id: string) {
  if (world.incoming.includes(id)) {
    answerRequest(id, true);
    return;
  }
  change(() => world.outgoing.push(id));
  toast(`Request sent to ${user(id).name}`);
}

export const cancelRequest = (id: string) =>
  change(() => {
    world.outgoing = world.outgoing.filter((x) => x !== id);
  });

export function removeFriend(id: string) {
  openDialog({
    kind: "confirm",
    title: `Remove ${user(id).name}?`,
    body: "You can still see your old messages.",
    action: "Remove friend",
    run: () => change(() => world.friends.delete(id)),
  });
}

export function blockUser(id: string) {
  openDialog({
    kind: "confirm",
    title: `Block ${user(id).name}?`,
    body: "They can't message or call you. Their messages are hidden in shared chats.",
    action: "Block",
    run: () => {
      change(() => {
        world.blocked.add(id);
        world.friends.delete(id);
        world.incoming = world.incoming.filter((x) => x !== id);
      });
      toast(`Blocked ${user(id).name}`);
    },
  });
}

export const unblock = (id: string) => change(() => world.blocked.delete(id));

export const toggleMuted = (id: string) =>
  change(() => {
    if (!world.muted.delete(id)) world.muted.add(id);
  });

export function ensureDm(userId: string) {
  const found = CONVERSATIONS.find((c) => c.kind === "dm" && c.members[0] === userId);
  if (found) {
    if (world.closed.has(found.id)) change(() => world.closed.delete(found.id));
    return found.id;
  }
  const id = `dm-${userId}`;
  change(() => {
    CONVERSATIONS.push({
      id,
      kind: "dm",
      title: user(userId).name,
      members: [userId],
      unread: 0,
      mentions: 0,
      preview: "",
      at: "now",
      rank: 50,
      fresh: true,
    });
  });
  return id;
}

let groupId = 0;
export function createGroup(name: string, members: string[]) {
  const id = `group-new-${(groupId += 1)}`;
  change(() => {
    CONVERSATIONS.push({
      id,
      kind: "group",
      title: name.trim() || members.map((m) => user(m).name).join(", "),
      members,
      unread: 0,
      mentions: 0,
      preview: "",
      at: "now",
      rank: 0,
      fresh: true,
    });
  });
  return id;
}

let systemId = 0;
export function pushMessage(conversation: string, message: Omit<Message, "id" | "time">) {
  const now = new Date();
  change(() => {
    (world.pending[conversation] ??= []).push({
      id: `push-${(systemId += 1)}`,
      time: `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`,
      ...message,
    });
  });
}

export const systemMessage = (conversation: string, text: string) =>
  pushMessage(conversation, { author: ME, text, system: true });

export const removeConversation = (id: string) =>
  change(() => {
    const i = CONVERSATIONS.findIndex((c) => c.id === id);
    if (i >= 0) CONVERSATIONS.splice(i, 1);
  });

export function isOwner(s: Server) {
  return (s.owner ?? (s.id === "owls" ? ME : s.members[1])) === ME;
}

export function audit(s: Server, text: string) {
  s.audit = [
    { id: `a${(s.audit?.length ?? 0) + 1}`, who: ME, text, at: "just now" },
    ...(s.audit ?? []),
  ];
}

let serverId = 0;
export function createServer(name: string) {
  const id = `server-${(serverId += 1)}`;
  change(() => {
    SERVERS.push({
      id,
      name,
      short: name
        .split(/\s+/)
        .map((w) => w.charAt(0))
        .join("")
        .slice(0, 2)
        .toUpperCase(),
      hue: (name.length * 47) % 360,
      owner: ME,
      members: [ME],
      channels: [
        { id: `${id}-general`, name: "general", kind: "text", category: "Text" },
        { id: `${id}-voice`, name: "Lounge", kind: "voice", category: "Voice", voice: [] },
      ],
    });
  });
  return id;
}

export const removeServer = (id: string) =>
  change(() => {
    const i = SERVERS.findIndex((s) => s.id === id);
    if (i >= 0) SERVERS.splice(i, 1);
  });

export const volumeOf = (target: string) => world.volumes[target] ?? 100;
export const isSilenced = (target: string) => world.silenced.has(target) || volumeOf(target) === 0;

export const setVolume = (target: string, value: number) =>
  change(() => {
    world.volumes = { ...world.volumes, [target]: value };
    world.silenced.delete(target);
  });

export const setSilenced = (target: string, on: boolean) =>
  change(() => {
    if (on) world.silenced.add(target);
    else {
      world.silenced.delete(target);
      if (volumeOf(target) === 0) world.volumes = { ...world.volumes, [target]: 100 };
    }
  });
