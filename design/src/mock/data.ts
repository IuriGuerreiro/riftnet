export type Status = "online" | "idle" | "dnd" | "offline";

export interface Activity {
  kind: "playing" | "listening" | "streaming" | "voice";
  label: string;
  detail?: string;
  since?: string;
}

export interface User {
  id: string;
  name: string;
  handle: string;
  hue: number;
  status: Status;
  activity?: Activity;
}

export interface Channel {
  id: string;
  name: string;
  kind: "text" | "voice";
  category: string;
  topic?: string;
  unread?: number;
  mentions?: number;
  voice?: string[];
  live?: string;
}

export interface Server {
  id: string;
  name: string;
  short: string;
  hue: number;
  channels: Channel[];
  members: string[];
}

export interface Reaction {
  emoji: string;
  count: number;
  mine?: boolean;
}

export interface Message {
  id: string;
  author: string;
  text: string;
  time: string;
  replyTo?: string;
  reactions?: Reaction[];
  image?: { label: string; ratio: number };
}

export interface Conversation {
  id: string;
  kind: "dm" | "group" | "channel";
  title: string;
  members: string[];
  serverId?: string;
  topic?: string;
  unread: number;
  mentions: number;
  preview: string;
  previewAuthor?: string;
  at: string;
  rank: number;
  pinned?: boolean;
}

export const ME = "me";

const userList: User[] = [
  { id: ME, name: "Iuri", handle: "iuri", hue: 262, status: "online" },
  {
    id: "maya",
    name: "Maya",
    handle: "maya.r",
    hue: 330,
    status: "online",
    activity: { kind: "playing", label: "Hollow Drift", detail: "Ranked · 2-1", since: "41m" },
  },
  {
    id: "tom",
    name: "Tom",
    handle: "tomz",
    hue: 200,
    status: "online",
    activity: { kind: "voice", label: "Squad room", detail: "Night Owls" },
  },
  {
    id: "lea",
    name: "Léa",
    handle: "lea",
    hue: 150,
    status: "online",
    activity: { kind: "streaming", label: "Starline Racers", detail: "Screen share" },
  },
  {
    id: "kai",
    name: "Kai",
    handle: "kai_dev",
    hue: 30,
    status: "idle",
    activity: { kind: "listening", label: "Lo-fi beats", detail: "Spotify" },
  },
  {
    id: "sam",
    name: "Sam",
    handle: "sammy",
    hue: 100,
    status: "dnd",
    activity: { kind: "playing", label: "Pixel Forge", since: "2h" },
  },
  {
    id: "noor",
    name: "Noor",
    handle: "noor",
    hue: 280,
    status: "online",
    activity: { kind: "voice", label: "Squad room", detail: "Night Owls" },
  },
  { id: "ben", name: "Ben", handle: "benji", hue: 15, status: "offline" },
  { id: "ivy", name: "Ivy", handle: "ivy.codes", hue: 180, status: "idle" },
  { id: "rui", name: "Rui", handle: "rui", hue: 55, status: "offline" },
];

export const USERS: Record<string, User> = Object.fromEntries(userList.map((u) => [u.id, u]));
export const FRIENDS = userList.filter((u) => u.id !== ME);

export function user(id: string): User {
  return USERS[id] ?? { id, name: id, handle: id, hue: 0, status: "offline" };
}

export const SERVERS: Server[] = [
  {
    id: "owls",
    name: "Night Owls",
    short: "NO",
    hue: 262,
    members: [ME, "maya", "tom", "lea", "kai", "sam", "noor", "ben", "ivy"],
    channels: [
      {
        id: "owls-general",
        name: "general",
        kind: "text",
        category: "Text",
        topic: "Hang out. Be nice. Post clips.",
        unread: 12,
        mentions: 1,
      },
      { id: "owls-clips", name: "clips", kind: "text", category: "Text", unread: 3 },
      { id: "owls-lfg", name: "looking-for-group", kind: "text", category: "Text" },
      { id: "owls-memes", name: "memes", kind: "text", category: "Text" },
      {
        id: "owls-squad",
        name: "Squad room",
        kind: "voice",
        category: "Voice",
        voice: ["tom", "noor", "lea"],
        live: "lea",
      },
      { id: "owls-chill", name: "Chill", kind: "voice", category: "Voice", voice: [] },
      { id: "owls-afk", name: "AFK", kind: "voice", category: "Voice", voice: [] },
    ],
  },
  {
    id: "forge",
    name: "Pixel Forge",
    short: "PF",
    hue: 30,
    members: [ME, "sam", "kai", "ivy", "rui"],
    channels: [
      {
        id: "forge-announcements",
        name: "announcements",
        kind: "text",
        category: "Info",
        unread: 1,
      },
      {
        id: "forge-dev",
        name: "dev-log",
        kind: "text",
        category: "Build",
        topic: "Daily progress, screenshots, rants.",
      },
      { id: "forge-art", name: "art", kind: "text", category: "Build" },
      { id: "forge-standup", name: "Standup", kind: "voice", category: "Voice", voice: ["sam"] },
    ],
  },
  {
    id: "drift",
    name: "Hollow Drift League",
    short: "HD",
    hue: 200,
    members: [ME, "maya", "tom", "ben"],
    channels: [
      { id: "drift-general", name: "general", kind: "text", category: "Text", unread: 48 },
      {
        id: "drift-scrims",
        name: "scrims",
        kind: "text",
        category: "Text",
        mentions: 2,
        unread: 5,
      },
      { id: "drift-lobby", name: "Lobby", kind: "voice", category: "Voice", voice: [] },
    ],
  },
  {
    id: "books",
    name: "Slow Readers",
    short: "SR",
    hue: 150,
    members: [ME, "ivy", "kai"],
    channels: [{ id: "books-general", name: "general", kind: "text", category: "Text" }],
  },
];

export function server(id: string): Server | undefined {
  return SERVERS.find((s) => s.id === id);
}

export const CONVERSATIONS: Conversation[] = [
  {
    id: "dm-maya",
    kind: "dm",
    title: "Maya",
    members: ["maya"],
    unread: 2,
    mentions: 2,
    preview: "ok one more game then I'm out 😅",
    previewAuthor: "maya",
    at: "now",
    rank: 1,
    pinned: true,
  },
  {
    id: "owls-general",
    kind: "channel",
    title: "general",
    serverId: "owls",
    members: SERVERS[0]?.members ?? [],
    topic: "Hang out. Be nice. Post clips.",
    unread: 12,
    mentions: 1,
    preview: "who's hopping on tonight?",
    previewAuthor: "tom",
    at: "2m",
    rank: 2,
    pinned: true,
  },
  {
    id: "group-trip",
    kind: "group",
    title: "Lisbon trip 🌊",
    members: ["maya", "tom", "lea", "noor"],
    unread: 5,
    mentions: 0,
    preview: "I found a place near Alfama",
    previewAuthor: "lea",
    at: "14m",
    rank: 3,
  },
  {
    id: "drift-scrims",
    kind: "channel",
    title: "scrims",
    serverId: "drift",
    members: SERVERS[2]?.members ?? [],
    unread: 5,
    mentions: 2,
    preview: "@iuri can you sub in at 9?",
    previewAuthor: "ben",
    at: "31m",
    rank: 4,
  },
  {
    id: "dm-kai",
    kind: "dm",
    title: "Kai",
    members: ["kai"],
    unread: 0,
    mentions: 0,
    preview: "You: sent the build, lmk",
    at: "1h",
    rank: 5,
  },
  {
    id: "forge-dev",
    kind: "channel",
    title: "dev-log",
    serverId: "forge",
    members: SERVERS[1]?.members ?? [],
    topic: "Daily progress, screenshots, rants.",
    unread: 0,
    mentions: 0,
    preview: "new lighting pass is in 🔥",
    previewAuthor: "sam",
    at: "3h",
    rank: 6,
  },
  {
    id: "dm-lea",
    kind: "dm",
    title: "Léa",
    members: ["lea"],
    unread: 0,
    mentions: 0,
    preview: "haha yes exactly",
    previewAuthor: "lea",
    at: "Yesterday",
    rank: 7,
  },
  {
    id: "dm-sam",
    kind: "dm",
    title: "Sam",
    members: ["sam"],
    unread: 0,
    mentions: 0,
    preview: "You: gg",
    at: "Mon",
    rank: 8,
  },
  {
    id: "dm-ivy",
    kind: "dm",
    title: "Ivy",
    members: ["ivy"],
    unread: 0,
    mentions: 0,
    preview: "thanks for the book rec!",
    previewAuthor: "ivy",
    at: "Sun",
    rank: 9,
  },
];

export function conversation(id: string): Conversation {
  const found = CONVERSATIONS.find((c) => c.id === id);
  if (found) return found;
  for (const s of SERVERS) {
    const ch = s.channels.find((c) => c.id === id);
    if (ch) {
      return {
        id: ch.id,
        kind: "channel",
        title: ch.name,
        serverId: s.id,
        members: s.members,
        topic: ch.topic,
        unread: ch.unread ?? 0,
        mentions: ch.mentions ?? 0,
        preview: "",
        at: "",
        rank: 99,
      };
    }
  }
  return {
    id,
    kind: "dm",
    title: user(id.replace("dm-", "")).name,
    members: [id.replace("dm-", "")],
    unread: 0,
    mentions: 0,
    preview: "",
    at: "",
    rank: 99,
  };
}

const SCRIPTS: Record<string, Message[]> = {
  "dm-maya": [
    { id: "m1", author: "maya", text: "you coming to the scrim later?", time: "21:02" },
    { id: "m2", author: ME, text: "yeah if Tom stops lagging 😂", time: "21:03" },
    {
      id: "m3",
      author: ME,
      text: "also did you see the new patch notes? they nerfed the dash again",
      time: "21:03",
    },
    {
      id: "m4",
      author: "maya",
      text: "ugh yes. dash is basically useless now",
      time: "21:05",
      reactions: [{ emoji: "💀", count: 1, mine: true }],
    },
    {
      id: "m5",
      author: "maya",
      text: "look at this though",
      time: "21:05",
      image: { label: "clip_0412.mp4 · 0:24", ratio: 16 / 9 },
    },
    {
      id: "m6",
      author: ME,
      text: "NO WAY. that's a triple off a wall bounce",
      time: "21:06",
      replyTo: "m5",
      reactions: [
        { emoji: "🔥", count: 2, mine: true },
        { emoji: "👀", count: 1 },
      ],
    },
    { id: "m7", author: "maya", text: "ok one more game then I'm out 😅", time: "21:08" },
  ],
  "owls-general": [
    { id: "g1", author: "kai", text: "morning owls 🦉", time: "09:14" },
    {
      id: "g2",
      author: "lea",
      text: "it's literally 9pm kai",
      time: "21:01",
      reactions: [{ emoji: "😂", count: 4, mine: true }],
    },
    { id: "g3", author: "kai", text: "time is a construct", time: "21:01" },
    {
      id: "g4",
      author: "noor",
      text: "streaming Starline in Squad room if anyone wants to watch",
      time: "21:04",
    },
    {
      id: "g5",
      author: "sam",
      text: "new lighting pass on the forge map, thoughts?",
      time: "21:06",
      image: { label: "forge_lighting_v3.png", ratio: 16 / 10 },
      reactions: [
        { emoji: "🔥", count: 6 },
        { emoji: "✨", count: 2, mine: true },
      ],
    },
    { id: "g6", author: "maya", text: "the fog is so good", time: "21:07", replyTo: "g5" },
    { id: "g7", author: "tom", text: "who's hopping on tonight?", time: "21:09" },
    { id: "g8", author: "tom", text: "@iuri you in?", time: "21:09" },
  ],
};

const FALLBACK: Message[] = [
  { id: "f1", author: "other", text: "hey! got a sec?", time: "18:40" },
  { id: "f2", author: ME, text: "sure, what's up", time: "18:42" },
  { id: "f3", author: "other", text: "sending you the thing from earlier", time: "18:43" },
  {
    id: "f4",
    author: "other",
    text: "lmk what you think, no rush",
    time: "18:43",
    reactions: [{ emoji: "👍", count: 1, mine: true }],
  },
];

export function messagesFor(c: Conversation): Message[] {
  const script = SCRIPTS[c.id];
  if (script) return script;
  const others = c.members.filter((m) => m !== ME);
  return FALLBACK.map((m, i) => ({
    ...m,
    author: m.author === "other" ? (others[i % Math.max(others.length, 1)] ?? "kai") : m.author,
    text:
      i === FALLBACK.length - 1 && c.preview && !c.preview.startsWith("You:") ? c.preview : m.text,
  }));
}

export interface LiveRoom {
  channelId: string;
  serverId: string;
  name: string;
  people: string[];
  live?: string;
}

export const LIVE_ROOMS: LiveRoom[] = SERVERS.flatMap((s) =>
  s.channels
    .filter((c) => c.kind === "voice" && (c.voice?.length ?? 0) > 0)
    .map((c) => ({
      channelId: c.id,
      serverId: s.id,
      name: c.name,
      people: c.voice ?? [],
      live: c.live,
    })),
);
