import {
  Bell,
  Info,
  Keyboard,
  KeyRound,
  Lock,
  LogOut,
  Mic,
  Palette,
  RotateCcw,
  Search,
  UserRound,
  X,
} from "lucide-react";
import { Dialog } from "radix-ui";
import { useEffect, useRef, useState } from "react";

import { Avatar } from "@/components/Avatar";
import { Pick } from "@/components/Controls";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EMOJI_SETS, setEmojiSet, useEmojiSet } from "@/features/emoji/sets";
import { ProfileBody } from "@/features/profile/ProfileCard";
import { cn } from "@/lib/utils";
import { conversation, ME, server, user } from "@/mock/data";
import {
  change,
  openDialog,
  resetSettings,
  saveSettings,
  toast,
  unblock,
  updateMe,
  useWorld,
  world,
} from "@/mock/world";

import { Group, Row, SelectBox, SelectRow, SliderRow, SwitchRow } from "./rows";

const NAV = [
  [
    "You",
    [
      ["Profile", UserRound],
      ["Account", KeyRound],
      ["Privacy", Lock],
    ],
  ],
  [
    "App",
    [
      ["Notifications", Bell],
      ["Voice and video", Mic],
      ["Appearance", Palette],
      ["Shortcuts", Keyboard],
    ],
  ],
  ["Riftnet", [["About", Info]]],
] as const;

const INDEX: [string, string][] = [
  ["Display name", "Profile"],
  ["Pronouns", "Profile"],
  ["Custom status", "Profile"],
  ["Bio", "Profile"],
  ["Avatar", "Profile"],
  ["Banner", "Profile"],
  ["Accent color", "Profile"],
  ["Email", "Account"],
  ["Password", "Account"],
  ["Two-step login", "Account"],
  ["This device", "Account"],
  ["Delete account", "Account"],
  ["Who can message you", "Privacy"],
  ["Activity status", "Privacy"],
  ["Link previews", "Privacy"],
  ["Blocked people", "Privacy"],
  ["Messages", "Notifications"],
  ["Incoming calls", "Notifications"],
  ["Friend requests", "Notifications"],
  ["Sounds", "Notifications"],
  ["Microphone", "Voice and video"],
  ["Speakers", "Voice and video"],
  ["Camera", "Voice and video"],
  ["Microphone volume", "Voice and video"],
  ["Call volume", "Voice and video"],
  ["Input mode", "Voice and video"],
  ["Noise removal", "Voice and video"],
  ["Remove echo", "Voice and video"],
  ["Even out volume", "Voice and video"],
  ["Message spacing", "Appearance"],
  ["Text size", "Appearance"],
  ["Reduce motion", "Appearance"],
  ["Emoji style", "Appearance"],
  ["Updates", "About"],
];

function Profile() {
  const me = user(ME);
  const [draft, setDraft] = useState(() => ({ ...me }));
  const blobs = useRef(new Set<string>());
  useEffect(
    () => () => {
      for (const url of blobs.current) {
        if (url !== user(ME).avatar && url !== user(ME).banner) URL.revokeObjectURL(url);
      }
    },
    [],
  );
  const set = (patch: Partial<typeof draft>) => {
    for (const key of ["avatar", "banner"] as const) {
      if (key in patch && draft[key] !== patch[key]) {
        const old = draft[key];
        if (old?.startsWith("blob:") && old !== me.avatar && old !== me.banner) {
          URL.revokeObjectURL(old);
          blobs.current.delete(old);
        }
      }
    }
    setDraft((d) => ({ ...d, ...patch }));
  };
  const bad = !draft.name.trim();
  const image = (key: "avatar" | "banner") => (
    <div className="flex items-center gap-2 py-2">
      <span className="flex-1 text-sm font-medium capitalize">{key}</span>
      <label className="flex h-8 cursor-pointer items-center rounded-md bg-secondary px-3 text-xs font-medium focus-within:ring-2 focus-within:ring-brand">
        Upload
        <input
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          className="sr-only"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (!file) return;
            if (!/^image\/(png|jpeg|webp|gif)$/.test(file.type))
              toast("Use a PNG, JPEG, WebP or GIF");
            else if (file.size > 8 * 1024 * 1024) toast("That image is over 8 MB");
            else {
              const url = URL.createObjectURL(file);
              blobs.current.add(url);
              set({ [key]: url });
            }
          }}
        />
      </label>
      {draft[key] && (
        <Button size="sm" variant="ghost" onClick={() => set({ [key]: undefined })}>
          Remove
        </Button>
      )}
    </div>
  );
  return (
    <div className="grid gap-6 md:grid-cols-[1fr_280px]">
      <div>
        <Group>
          <div className="px-4 py-2">
            <label className="block py-2 text-sm font-medium">
              Display name
              <Input
                className="mt-1.5"
                value={draft.name}
                maxLength={32}
                aria-invalid={bad}
                onChange={(e) => set({ name: e.target.value })}
              />
            </label>
            <label className="block py-2 text-sm font-medium">
              Pronouns
              <Input
                className="mt-1.5"
                value={draft.pronouns ?? ""}
                maxLength={40}
                onChange={(e) => set({ pronouns: e.target.value })}
              />
            </label>
            <label className="block py-2 text-sm font-medium">
              Custom status
              <Input
                className="mt-1.5"
                value={draft.customStatus ?? ""}
                maxLength={128}
                onChange={(e) => set({ customStatus: e.target.value })}
              />
            </label>
            <label className="block py-2 text-sm font-medium">
              Bio
              <textarea
                value={draft.bio ?? ""}
                maxLength={190}
                rows={3}
                onChange={(e) => set({ bio: e.target.value })}
                className="mt-1.5 w-full rounded-md border border-input bg-transparent p-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-brand"
              />
              <span className="block text-right text-xs text-muted-foreground">
                {(draft.bio ?? "").length}/190
              </span>
            </label>
            {image("avatar")}
            {image("banner")}
            <label className="flex items-center py-2 text-sm font-medium">
              <span className="flex-1">Accent color</span>
              <input
                type="color"
                value={draft.accent ?? "#8b45ff"}
                onChange={(e) => set({ accent: e.target.value })}
                className="h-8 w-12 bg-transparent"
              />
            </label>
          </div>
        </Group>
        <div className="flex gap-2">
          <Button
            disabled={bad}
            onClick={() => {
              for (const key of ["avatar", "banner"] as const) {
                if (me[key]?.startsWith("blob:") && me[key] !== draft[key])
                  URL.revokeObjectURL(me[key]);
              }
              updateMe({ ...draft, name: draft.name.trim(), status: me.status });
              toast("Profile saved");
            }}
          >
            Save
          </Button>
          <Button variant="ghost" onClick={() => setDraft({ ...me })}>
            Discard
          </Button>
        </div>
      </div>
      <div>
        <p className="mb-1 text-[11px] font-semibold text-muted-foreground uppercase">Preview</p>
        <div className="overflow-hidden rounded-xl border border-border bg-popover">
          <ProfileBody u={draft} />
        </div>
      </div>
    </div>
  );
}

function Account() {
  const [sessions, setSessions] = useState(["Windows desktop · Lisbon", "Linux · Porto"]);
  const [email, setEmail] = useState("you@example.com");
  const [old, setOld] = useState("");
  const [next, setNext] = useState("");
  return (
    <>
      <Group title="Login">
        <Row label="Email" hint="Used to log in and reset your password.">
          <Input
            aria-label="Email"
            className="h-8 w-52"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <Button
            size="sm"
            disabled={!/^\S+@\S+\.\S+$/.test(email)}
            onClick={() => toast("Check your inbox to confirm the new email")}
          >
            Change
          </Button>
        </Row>
        <Row label="Password" hint="Use 8 characters or more.">
          <Input
            type="password"
            className="h-8 w-40"
            value={old}
            aria-label="Current password"
            placeholder="Current"
            onChange={(e) => setOld(e.target.value)}
          />
          <Input
            type="password"
            className="h-8 w-40"
            value={next}
            aria-label="New password"
            placeholder="New"
            onChange={(e) => setNext(e.target.value)}
          />
          <Button
            size="sm"
            disabled={!old || next.length < 8}
            onClick={() => {
              setOld("");
              setNext("");
              toast("Password changed");
            }}
          >
            Change
          </Button>
        </Row>
        <SwitchRow
          k="twoFactor"
          label="Two-step login"
          hint="Ask for a code from your authenticator app."
        />
      </Group>
      <Group title="Active devices">
        <Row label="This device" hint="Active now" />
        {sessions.map((x) => (
          <Row key={x} label={x}>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setSessions((list) => list.filter((y) => y !== x))}
            >
              Sign out
            </Button>
          </Row>
        ))}
      </Group>
      <Group>
        <Row label="Delete account" hint="Removes your profile and messages for good.">
          <Button
            size="sm"
            variant="destructive"
            onClick={() =>
              openDialog({
                kind: "confirm",
                title: "Delete your account?",
                body: "Your profile and messages are removed. This can't be undone.",
                action: "Delete account",
                run: () => window.location.assign("/login"),
              })
            }
          >
            Delete
          </Button>
        </Row>
      </Group>
    </>
  );
}

function Privacy() {
  return (
    <>
      <Group title="Messages and activity">
        <SelectRow
          k="dmFrom"
          label="Who can message you"
          hint="Friends can always message you, whatever you pick."
          options={[
            ["everyone", "Everyone"],
            ["mutual", "Friends of friends"],
            ["friends", "Friends only"],
          ]}
        />
        <SwitchRow
          k="showActivity"
          label="Activity status"
          hint="Show your current game, stream or music."
        />
        <SwitchRow
          k="embeds"
          label="Link previews"
          hint="Load titles and images for links in chat."
        />
      </Group>
      <Group title="Blocked people">
        {world.blocked.size === 0 && (
          <Row label="No blocked people" hint="People you block show up here." />
        )}
        {[...world.blocked].map((id) => (
          <Row key={id} label={user(id).name} hint={`@${user(id).handle}`}>
            <Button size="sm" variant="secondary" onClick={() => unblock(id)}>
              Unblock
            </Button>
          </Row>
        ))}
      </Group>
    </>
  );
}

function Notifications() {
  return (
    <>
      <Group title="Alerts">
        <SwitchRow k="notifyMessages" label="Messages" hint="New DMs and mentions." />
        <SwitchRow k="notifyCalls" label="Incoming calls" hint="Ring when a friend calls you." />
        <SwitchRow
          k="notifyRequests"
          label="Friend requests"
          hint="When someone wants to add you."
        />
      </Group>
      <Group title="Sound">
        <SwitchRow
          k="sounds"
          label="Notification sounds"
          hint="Play a sound with each notification."
        />
      </Group>
      <Group title="Muted chats">
        {world.muted.size === 0 && (
          <Row label="No muted chats" hint="Chats you mute show up here." />
        )}
        {[...world.muted].map((id) => (
          <Row key={id} label={server(id)?.name ?? conversation(id).title}>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => change(() => world.muted.delete(id))}
            >
              Unmute
            </Button>
          </Row>
        ))}
      </Group>
    </>
  );
}

function MicTest() {
  const [on, setOn] = useState(false);
  const [level, setLevel] = useState(0);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!on) return;
    let live = true;
    let frame = 0;
    let stream: MediaStream | null = null;
    const ctx = new AudioContext();
    const start = async () => {
      try {
        if (world.micBlocked) throw new Error("blocked");
        const media = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream = media;
        if (!live) {
          for (const t of media.getTracks()) t.stop();
          return;
        }
        const node = ctx.createAnalyser();
        ctx.createMediaStreamSource(media).connect(node);
        const data = new Float32Array(node.fftSize);
        const tick = () => {
          node.getFloatTimeDomainData(data);
          setLevel(Math.min(1, data.reduce((m, v) => Math.max(m, Math.abs(v)), 0) * 1.5));
          frame = requestAnimationFrame(tick);
        };
        tick();
      } catch {
        if (!live) return;
        setError(
          "Riftnet can't use your microphone. Allow it in your system settings, then retry.",
        );
        setOn(false);
      }
    };
    void start();
    return () => {
      live = false;
      cancelAnimationFrame(frame);
      for (const t of stream?.getTracks() ?? []) t.stop();
      void ctx.close();
    };
  }, [on]);
  return (
    <div className="py-2.5">
      <div className="flex items-center gap-3">
        <Button
          size="sm"
          variant="secondary"
          onClick={() => {
            setError("");
            setLevel(0);
            setOn(!on);
          }}
        >
          {on ? "Stop test" : "Test microphone"}
        </Button>
        <div className="h-2 flex-1 overflow-hidden rounded-full bg-surface-3">
          <div
            className={cn("h-full", level > 0.9 ? "bg-destructive" : "bg-success")}
            style={{ width: `${level * 100}%` }}
          />
        </div>
      </div>
      {level > 0.9 && (
        <p className="mt-1 text-xs text-warning">Too loud. Lower your microphone volume.</p>
      )}
      {error && (
        <p role="alert" className="mt-1 text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

function beep() {
  const ctx = new AudioContext();
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  g.gain.value = (0.1 * world.settings.outputVolume) / 100;
  o.connect(g).connect(ctx.destination);
  o.start();
  o.stop(ctx.currentTime + 0.4);
  o.onended = () => void ctx.close();
}

export function DevicePicks() {
  const s = world.settings;
  return (
    <>
      <Pick
        label="Microphone"
        value={s.input}
        options={["Default microphone", "USB headset", "Webcam mic"]}
        onChange={(input) => saveSettings({ input })}
      />
      <Pick
        label="Speakers"
        value={s.output}
        options={["Default speakers", "USB headset", "Monitor"]}
        onChange={(output) => saveSettings({ output })}
      />
      <Pick
        label="Camera"
        value={s.camera}
        options={["Built-in camera", "USB webcam"]}
        onChange={(camera) => saveSettings({ camera })}
      />
    </>
  );
}

function KeyCapture() {
  const [waiting, setWaiting] = useState(false);
  return (
    <div className="flex items-center py-2 text-sm">
      <span className="flex-1 font-medium">Push-to-talk key</span>
      <Button
        size="sm"
        variant="secondary"
        data-key-capture={waiting || undefined}
        onClick={() => setWaiting(true)}
        onBlur={() => setWaiting(false)}
        onKeyDown={(e) => {
          if (!waiting || e.key === "Tab") return;
          e.preventDefault();
          e.stopPropagation();
          setWaiting(false);
          if (e.key !== "Escape")
            saveSettings({ pushKey: e.key === " " ? "Space" : e.key.toUpperCase() });
        }}
      >
        {waiting ? "Press a key…" : world.settings.pushKey}
      </Button>
    </div>
  );
}

function Voice() {
  const s = world.settings;
  const list = (...names: string[]) => names.map((n) => [n, n] as const);
  return (
    <>
      <Group title="Devices">
        <SelectRow
          k="input"
          label="Microphone"
          hint="The mic used in calls."
          options={list("Default microphone", "USB headset", "Webcam mic")}
        />
        <SelectRow
          k="output"
          label="Speakers"
          hint="Where calls and streams play."
          options={list("Default speakers", "USB headset", "Monitor")}
        />
        <SelectRow
          k="camera"
          label="Camera"
          hint="Used when you turn video on."
          options={list("Built-in camera", "USB webcam")}
        />
      </Group>
      <Group title="Levels">
        <SliderRow k="inputVolume" label="Microphone volume" hint="How loud you are to others." />
        <SliderRow k="outputVolume" label="Call volume" hint="How loud others are to you." />
        <div className="px-4">
          <MicTest />
        </div>
        <Row label="Speaker test" hint="Plays a short sound.">
          <Button size="sm" variant="secondary" onClick={beep}>
            Play
          </Button>
        </Row>
      </Group>
      <Group title="Your voice">
        <SelectRow
          k="inputMode"
          label="Input mode"
          hint="When your mic sends sound in calls."
          options={[
            ["open", "Open mic"],
            ["voice", "Voice activity"],
            ["push", "Push to talk"],
          ]}
        />
        {s.inputMode === "voice" && (
          <SliderRow
            k="sensitivity"
            max={100}
            label="Voice threshold"
            hint="Raise it to ignore background noise."
          />
        )}
        {s.inputMode === "push" && (
          <div className="px-4">
            <KeyCapture />
          </div>
        )}
        <SelectRow
          k="noise"
          label="Noise removal"
          hint="Cuts fans, keyboards and background noise."
          options={[
            ["off", "Off"],
            ["standard", "Standard"],
            ["enhanced", "Enhanced"],
          ]}
        />
        <SwitchRow
          k="echo"
          label="Remove echo"
          hint="Stops your speakers from looping into your mic."
        />
        <SwitchRow k="gain" label="Even out volume" hint="Keeps your voice at a steady level." />
      </Group>
    </>
  );
}

function Appearance() {
  const set = useEmojiSet();
  return (
    <Group title="Display">
      <SelectRow
        k="density"
        label="Message spacing"
        hint="Compact fits more on screen."
        options={[
          ["cozy", "Cozy"],
          ["compact", "Compact"],
        ]}
      />
      <SliderRow k="scale" min={85} max={125} label="Text size" hint="Scales the whole app." />
      <SwitchRow k="reduceMotion" label="Reduce motion" hint="Turns off most animations." />
      <Row label="Emoji style" hint="Only changes what you see.">
        <SelectBox
          label="Emoji style"
          value={set}
          options={EMOJI_SETS.map((e) => [e.id, e.label] as const)}
          onChange={(v) => {
            const next = EMOJI_SETS.find((e) => e.id === v);
            if (next) setEmojiSet(next.id);
          }}
        />
      </Row>
    </Group>
  );
}

export const SHORTCUTS = [
  ["Jump to anything", "Ctrl K"],
  ["Settings", "Ctrl ,"],
  ["Show shortcuts", "Ctrl /"],
  ["Search this chat", "Ctrl F"],
  ["Mute", "Ctrl Shift M"],
  ["Deafen", "Ctrl Shift D"],
  ["Previous or next chat", "Alt ↑ / ↓"],
  ["Next unread chat", "Alt Shift ↓"],
  ["Stop Share Play", "Ctrl Shift F12"],
  ["Move between messages", "↑ / ↓"],
  ["Edit last message", "↑ in an empty box"],
] as const;

export function ShortcutList() {
  return (
    <dl>
      {SHORTCUTS.map(([what, key]) => (
        <div key={what} className="flex items-center py-2 text-sm">
          <dt className="flex-1">{what}</dt>
          <dd>
            <kbd className="rounded bg-surface-3 px-2 py-0.5 text-xs">{key}</kbd>
          </dd>
        </div>
      ))}
    </dl>
  );
}

function About() {
  return (
    <Group>
      <Row label="Updates" hint="Version 0.1.0">
        <Button
          size="sm"
          variant="secondary"
          onClick={() =>
            change(() => {
              world.update ??= "available";
            })
          }
        >
          Check for updates
        </Button>
      </Row>
    </Group>
  );
}

function tabFor(tab?: string) {
  return INDEX.some(([, t]) => t === tab) || tab === "Shortcuts" ? (tab ?? "Profile") : "Profile";
}

export function SettingsScreen({ tab }: { tab?: string }) {
  useWorld();
  const [current, setCurrent] = useState(() => tabFor(tab));
  const [query, setQuery] = useState("");
  const body = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const me = user(ME);
  const q = query.trim().toLowerCase();
  const found = q ? INDEX.filter(([label, t]) => `${label} ${t}`.toLowerCase().includes(q)) : [];
  const open = (next: string, label?: string) => {
    setCurrent(next);
    setQuery("");
    requestAnimationFrame(() => {
      const row = label
        ? body.current?.querySelector(`[data-setting="${CSS.escape(label)}"]`)
        : null;
      if (!row) {
        body.current?.scrollTo({ top: 0 });
        return;
      }
      row.scrollIntoView({ block: "center" });
      row.setAttribute("data-found", "");
      setTimeout(() => row.removeAttribute("data-found"), 1500);
    });
  };
  const item =
    "flex h-8 w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-sm outline-none focus-visible:ring-2 focus-visible:ring-brand";
  return (
    <Dialog.Root
      open
      onOpenChange={(isOpen) => {
        if (!isOpen) openDialog(null);
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="animate-in fade-in fixed inset-0 z-50 bg-black/55 backdrop-blur-md duration-150" />
        <Dialog.Content
          aria-describedby={undefined}
          onEscapeKeyDown={(e) => {
            if (document.activeElement?.hasAttribute("data-key-capture")) e.preventDefault();
            else if (query) {
              e.preventDefault();
              setQuery("");
            }
          }}
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            (e.currentTarget as HTMLElement).focus();
          }}
          onKeyDown={(e) => {
            if (
              e.key !== "/" ||
              e.ctrlKey ||
              (e.target as HTMLElement).matches("input, textarea, select")
            )
              return;
            e.preventDefault();
            search.current?.focus();
          }}
          className="animate-in fade-in zoom-in-[0.98] fixed top-1/2 left-1/2 z-50 flex h-[min(860px,calc(100vh-3rem))] w-[min(1160px,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-2xl border border-white/[0.06] bg-background shadow-2xl shadow-black/60 outline-none duration-150"
        >
          <nav aria-label="Settings" className="flex w-44 shrink-0 flex-col bg-ink p-2 md:w-56">
            <label className="flex h-9 shrink-0 items-center gap-2.5 rounded-lg px-2.5 text-sm focus-within:bg-surface-2">
              <Search className="size-4 shrink-0 text-muted-foreground" />
              <input
                ref={search}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && found[0]) open(found[0][1], found[0][0]);
                }}
                aria-label="Search settings"
                placeholder="Search"
                className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted-foreground"
              />
              <kbd className="rounded bg-surface-3 px-1.5 text-[11px] text-muted-foreground">/</kbd>
            </label>
            <div className="min-h-0 flex-1 overflow-y-auto">
              {q
                ? found.map(([label, t]) => (
                    <button
                      key={`${t}-${label}`}
                      type="button"
                      onClick={() => open(t, label)}
                      className={cn(item, "h-auto py-1.5 hover:bg-surface-2")}
                    >
                      <span>
                        {label}
                        <span className="block text-xs text-muted-foreground">{t}</span>
                      </span>
                    </button>
                  ))
                : NAV.map(([title, tabs]) => (
                    <div key={title} className="pt-3">
                      <p className="px-2.5 pb-1 text-xs text-muted-foreground">{title}</p>
                      {tabs.map(([t, Icon]) => (
                        <button
                          key={t}
                          type="button"
                          aria-current={current === t ? "page" : undefined}
                          onClick={() => open(t)}
                          className={cn(
                            item,
                            current === t
                              ? "bg-brand/15 font-medium text-foreground"
                              : "text-muted-foreground hover:bg-surface-1 hover:text-foreground",
                          )}
                        >
                          <Icon className="size-4 shrink-0" />
                          <span className="truncate">{t}</span>
                        </button>
                      ))}
                    </div>
                  ))}
              {q && found.length === 0 && (
                <p className="px-2.5 py-4 text-sm text-muted-foreground">No settings match.</p>
              )}
            </div>
            <div className="flex items-center gap-2 pt-2">
              <button
                type="button"
                onClick={() => open("Profile")}
                className={cn(item, "h-10 min-w-0 flex-1 hover:bg-surface-1")}
              >
                <Avatar id={ME} size={26} />
                <span className="truncate">{me.name}</span>
              </button>
              <button
                type="button"
                aria-label="Log out"
                title="Log out"
                onClick={() =>
                  openDialog({
                    kind: "confirm",
                    title: "Log out?",
                    body: "Unsent drafts on this device are lost.",
                    action: "Log out",
                    run: () => window.location.assign("/login"),
                  })
                }
                className="grid size-8 shrink-0 place-items-center rounded-lg text-muted-foreground hover:bg-surface-2 hover:text-destructive"
              >
                <LogOut className="size-4" />
              </button>
            </div>
          </nav>
          <div className="flex min-w-0 flex-1 flex-col">
            <header className="flex h-12 shrink-0 items-center gap-2 border-b border-white/[0.04] px-4 text-sm">
              <Dialog.Title className="flex min-w-0 flex-1 gap-2 truncate text-sm font-medium">
                <span className="text-muted-foreground max-md:hidden">Settings</span>
                <span className="text-surface-4 max-md:hidden">/</span>
                {current}
              </Dialog.Title>
              <button
                type="button"
                onClick={() => {
                  resetSettings();
                  toast("Settings reset to defaults");
                }}
                className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-medium hover:bg-surface-2"
              >
                <RotateCcw className="size-3.5" />
                <span className="max-md:sr-only">Restore defaults</span>
              </button>
              <Dialog.Close
                aria-label="Close settings"
                className="grid size-8 place-items-center rounded-lg hover:bg-surface-2"
              >
                <X className="size-4" />
              </Dialog.Close>
            </header>
            <div ref={body} className="min-h-0 flex-1 overflow-y-auto px-4 py-6 md:px-8">
              <div className="mx-auto max-w-3xl">
                {current === "Profile" && <Profile />}
                {current === "Account" && <Account />}
                {current === "Privacy" && <Privacy />}
                {current === "Notifications" && <Notifications />}
                {current === "Voice and video" && <Voice />}
                {current === "Appearance" && <Appearance />}
                {current === "Shortcuts" && (
                  <Group>
                    <div className="px-4 py-1">
                      <ShortcutList />
                    </div>
                  </Group>
                )}
                {current === "About" && <About />}
              </div>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
