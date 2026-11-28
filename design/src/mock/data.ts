export type Status = "online" | "idle" | "dnd" | "offline" | "invisible";

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
  bio?: string;
  pronouns?: string;
  customStatus?: string;
  accent?: string;
  avatar?: string;
  avatarPos?: string;
  banner?: string;
  activity?: Activity;
}

export interface Channel {
  id: string;
  name: string;
  kind: "text" | "voice";
  category: string;
  topic?: string;
  readOnly?: boolean;
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
  icon?: string;
  emblem?: "owls" | "forge";
  owner?: string;
  description?: string;
  invites?: Invite[];
  bans?: string[];
  roles?: Role[];
  audit?: AuditEntry[];
  denied?: boolean;
}

export interface Invite {
  code: string;
  uses: number;
  expires: string;
}

export interface Role {
  id: string;
  name: string;
  color: string;
  members: string[];
  permissions: string[];
}

export interface AuditEntry {
  id: string;
  who: string;
  text: string;
  at: string;
}

export interface Reaction {
  emoji: string;
  count: number;
  mine?: boolean;
}

export type Attachment =
  | { kind: "image"; url: string; name: string; w: number; h: number; size: number }
  | { kind: "gif"; url: string; name: string; w: number; h: number }
  | { kind: "video"; url: string; name: string; w: number; h: number; size: number }
  | { kind: "file"; url?: string; name: string; size: number };

const media = (f: string) => `/media/${f}`;

export const GIFS: Extract<Attachment, { kind: "gif" }>[] = [
  { kind: "gif", url: media("riftnet-loop.gif"), name: "riftnet", w: 480, h: 480 },
  { kind: "gif", url: media("flower.gif"), name: "bloom", w: 360, h: 203 },
  { kind: "gif", url: media("friday.gif"), name: "friday", w: 300, h: 225 },
  { kind: "gif", url: media("flower-2.gif"), name: "petals", w: 320, h: 180 },
  { kind: "gif", url: media("friday-2.gif"), name: "weekend", w: 300, h: 225 },
];

export interface Message {
  id: string;
  author: string;
  text: string;
  time: string;
  replyTo?: string;
  edited?: boolean;
  day?: string;
  status?: "sending" | "failed";
  system?: boolean;
  pinned?: boolean;
  reactions?: Reaction[];
  attachments?: Attachment[];
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
  fresh?: boolean;
}

export const ME = "me";

const userList: User[] = [
  {
    id: ME,
    name: "Iuri",
    handle: "iuri",
    hue: 262,
    status: "online",
    bio: "Building things. Losing ranked games.",
  },
  {
    id: "maya",
    avatar: "/media/photo-2.jpg",
    avatarPos: "50% 30%",
    name: "Mariana",
    handle: "mari.ana",
    hue: 330,
    bio: "Support main. I will heal you if you ask nicely.",
    pronouns: "she/her",
    customStatus: "one more game",
    status: "online",
    activity: { kind: "playing", label: "Ridgeline", detail: "Ranked · 2-1", since: "41m" },
  },
  {
    id: "tom",
    name: "Tomás",
    handle: "tomz",
    hue: 200,
    status: "online",
    activity: { kind: "voice", label: "Squad room", detail: "Late Shift" },
  },
  {
    id: "lea",
    avatar: "/media/photo-4.jpg",
    avatarPos: "54% 40%",
    name: "Léa",
    handle: "lea",
    hue: 150,
    status: "online",
    activity: { kind: "streaming", label: "Trackmania", detail: "Screen share" },
  },
  {
    id: "kai",
    name: "Kestrel",
    handle: "kestrel",
    hue: 30,
    status: "idle",
    activity: { kind: "listening", label: "Tame Impala", detail: "The Less I Know the Better" },
  },
  {
    id: "sam",
    avatar: "/media/photo-5.jpg",
    avatarPos: "70% 40%",
    name: "Sam",
    handle: "sammy",
    hue: 100,
    status: "dnd",
    activity: { kind: "playing", label: "Satisfactory", since: "2h" },
  },
  {
    id: "noor",
    name: "Noor",
    handle: "noor",
    hue: 280,
    status: "online",
    activity: { kind: "voice", label: "Squad room", detail: "Late Shift" },
  },
  { id: "ben", name: "Bram", handle: "bramble", hue: 15, status: "offline" },
  { id: "ivy", name: "Ivo", handle: "ivo_", hue: 180, status: "idle" },
  { id: "rui", name: "Rui", handle: "rui", hue: 55, status: "offline" },
  { id: "zoe", name: "Zé", handle: "zepedro", hue: 300, status: "online" },
  { id: "otto", name: "Otto", handle: "otto", hue: 80, status: "idle" },
  { id: "nina", name: "Nina", handle: "nina_g", hue: 220, status: "online" },
];

export const USERS: Record<string, User> = Object.fromEntries(userList.map((u) => [u.id, u]));
export const FRIENDS = userList.filter((u) => u.id !== ME);

export function user(id: string): User {
  return USERS[id] ?? { id, name: id, handle: id, hue: 0, status: "offline" };
}

export const SERVERS: Server[] = [
  {
    id: "owls",
    name: "Late Shift",
    short: "LS",
    emblem: "owls",
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
    name: "Forge Co-op",
    short: "FC",
    emblem: "forge",
    hue: 30,
    members: [ME, "sam", "kai", "ivy", "rui"],
    channels: [
      {
        id: "forge-announcements",
        name: "announcements",
        readOnly: true,
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
    name: "Ridgeline Scrims",
    short: "RS",
    icon: "/media/photo-1.jpg",
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
    title: "Mariana",
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
    title: "Kestrel",
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
    title: "Ivo",
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
  if (found && found.kind !== "channel") return found;
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
        preview: found?.preview ?? "",
        at: found?.at ?? "",
        rank: found?.rank ?? 99,
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
    fresh: true,
  };
}

export function olderMessages(c: Conversation, page: number): Message[] {
  const people = c.members.filter((m) => m !== ME);
  const lines = [
    "did anyone save the replay?",
    "yeah I have it, sending later",
    "that last round was painful",
    "we hold the left side next time",
    "agreed, their mid was always open",
    "same time tomorrow?",
    "works for me",
    "I'll be ten minutes late",
    "no worries, we can warm up",
    "also I changed my mic, sounds better?",
  ];
  return lines.map((text, i) => ({
    id: `old-${c.id}-${page}-${i}`,
    author: i % 3 === 1 ? ME : (people[i % Math.max(people.length, 1)] ?? ME),
    text,
    time: `${18 + Math.floor(i / 4)}:${String((i * 7) % 60).padStart(2, "0")}`,
    day: page === 0 ? "Yesterday" : "Monday",
  }));
}

const SCRIPTS: Record<string, Message[]> = {
  "dm-maya": [
    { id: "m1", author: "maya", text: "you coming to the scrim later?", time: "21:02" },
    { id: "m2", author: ME, text: "yeah if Tomás stops lagging 😂", time: "21:03" },
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
      attachments: [
        {
          kind: "video",
          url: media("flower.mp4"),
          name: "clip_0412.mp4",
          w: 960,
          h: 540,
          size: 276_705,
        },
      ],
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
    {
      id: "m6b",
      author: "maya",
      text: "",
      time: "21:07",
      attachments: [{ kind: "gif", url: media("friday.gif"), name: "friday", w: 300, h: 225 }],
    },
    {
      id: "m6c",
      author: ME,
      text: "screens from last night's run",
      time: "21:07",
      attachments: [
        {
          kind: "image",
          url: media("photo-2.jpg"),
          name: "run_01.jpg",
          w: 1280,
          h: 853,
          size: 151_038,
        },
        {
          kind: "image",
          url: media("photo-3.jpg"),
          name: "run_02.jpg",
          w: 1280,
          h: 853,
          size: 278_754,
        },
        {
          kind: "image",
          url: media("photo-4.jpg"),
          name: "run_03.jpg",
          w: 1280,
          h: 853,
          size: 65_509,
        },
      ],
    },
    {
      id: "m6d",
      author: "maya",
      text: "this guy broke down the new dash tech https://www.youtube.com/watch?v=adept-dash",
      time: "21:08",
    },
    { id: "m7", author: "maya", text: "ok one more game then I'm out 😅", time: "21:08" },
  ],
  "owls-general": [
    { id: "g0", author: "ivy", text: "night all 🌙", time: "23:48", day: "Yesterday" },
    { id: "g1", author: "kai", text: "morning 🦉 just woke up", time: "20:58" },
    {
      id: "g2",
      author: "lea",
      text: "it's 9pm kestrel",
      time: "21:01",
      reactions: [{ emoji: "😂", count: 4, mine: true }],
    },
    { id: "g3", author: "kai", text: "time is a construct", time: "21:01" },
    {
      id: "g4",
      author: "lea",
      text: "streaming Trackmania in Squad room if anyone wants to watch",
      time: "21:04",
    },
    {
      id: "g5",
      pinned: true,
      author: "sam",
      text: "new lighting pass on the forge map, thoughts?",
      time: "21:06",
      attachments: [
        {
          kind: "image",
          url: media("photo-1.jpg"),
          name: "forge_lighting_v3.jpg",
          w: 1280,
          h: 853,
          size: 210_296,
        },
      ],
      reactions: [
        { emoji: "🔥", count: 6 },
        { emoji: "✨", count: 2, mine: true },
      ],
    },
    { id: "g6", author: "maya", text: "the fog is so good", time: "21:07", replyTo: "g5" },
    {
      id: "g6b",
      author: "kai",
      text: "patch notes + the trailer cut",
      time: "21:08",
      attachments: [
        { kind: "file", name: "patch-notes-v0.9.pdf", size: 1_482_112 },
        {
          kind: "video",
          url: media("friday.mp4"),
          name: "trailer_cut.mp4",
          w: 960,
          h: 540,
          size: 647_077,
        },
      ],
    },
    {
      id: "g6c",
      author: "noor",
      text: "",
      time: "21:08",
      attachments: [
        { kind: "gif", url: media("riftnet-loop.gif"), name: "riftnet", w: 480, h: 480 },
      ],
    },
    {
      id: "g6d",
      author: "lea",
      text: "dump from the meetup",
      time: "21:09",
      attachments: [
        {
          kind: "image",
          url: media("photo-5.jpg"),
          name: "meetup_1.jpg",
          w: 1280,
          h: 853,
          size: 156_304,
        },
        {
          kind: "image",
          url: media("photo-2.jpg"),
          name: "meetup_2.jpg",
          w: 1280,
          h: 853,
          size: 151_038,
        },
        {
          kind: "image",
          url: media("photo-3.jpg"),
          name: "meetup_3.jpg",
          w: 1280,
          h: 853,
          size: 278_754,
        },
        {
          kind: "image",
          url: media("photo-4.jpg"),
          name: "meetup_4.jpg",
          w: 1280,
          h: 853,
          size: 65_509,
        },
        {
          kind: "image",
          url: media("photo-1.jpg"),
          name: "meetup_5.jpg",
          w: 1280,
          h: 853,
          size: 210_296,
        },
      ],
    },
    {
      id: "g6e",
      author: "sam",
      text: "found the bug with the dash cooldown btw:\n```ts\nfunction canDash(p: Player, now: number) {\n  // cooldown was compared in seconds, not ms\n  return now - p.lastDash > DASH_COOLDOWN_MS;\n}\n```\nfix ships **tonight** ~~maybe~~ 🤞",
      time: "21:09",
      reactions: [{ emoji: "🙏", count: 3 }],
    },
    {
      id: "g6f",
      author: "maya",
      text: "> fix ships tonight\nsam you said that last week 😭\nalso the final boss is ||literally the tutorial guy||",
      time: "21:09",
    },
    {
      id: "g6g",
      pinned: true,
      author: "noor",
      text: "plan for tonight:\n- warmup in *Ridgeline*\n- 2 ranked games\n- then Trackmania on stream\nrules here https://adept.example/night-owls",
      time: "21:09",
    },
    {
      id: "g6h",
      author: "kai",
      text: "also it's on sale rn https://store.steampowered.com/app/4242/Hollow_Drift/",
      time: "21:09",
    },
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
  if (c.fresh) return [];
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
