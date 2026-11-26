import { Copy, Link2, Trash2 } from "lucide-react";
import { useState } from "react";

import { Avatar } from "@/components/Avatar";
import { Choice } from "@/components/Controls";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { openChat } from "@/features/profile/openChat";
import { cn } from "@/lib/utils";
import { ME, server, user } from "@/mock/data";
import {
  audit,
  change,
  createServer,
  ensureDm,
  openDialog,
  pushMessage,
  toast,
  world,
} from "@/mock/world";

import { Modal } from "./Modal";

async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast("Copied");
  } catch {
    toast("Couldn't copy. Select the link instead.");
  }
}

const INVITES: Record<string, string> = { cozy: "Cozy Corner", speed: "Speedrun Lab" };

export function AddServer({ code = "" }: { code?: string }) {
  const [mode, setMode] = useState<"create" | "join">(code ? "join" : "create");
  const [value, setValue] = useState(code);
  const key = value.trim().split("/").at(-1) ?? "";
  const found = INVITES[key];
  const bad = mode === "join" && key.length > 2 && !found;
  const text =
    key === "expired" ? "This invite has expired." : "We can't find that invite. Check the link.";
  const submit = () => {
    const name = mode === "create" ? value.trim() : found;
    if (!name) return;
    const id = createServer(name);
    openDialog(null);
    openChat(`${id}-general`);
    toast(mode === "create" ? `${name} is ready` : `Welcome to ${name}`);
  };
  return (
    <Modal title="Add a server">
      <form
        className="grid gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <Choice
          label="What do you want to do?"
          value={mode}
          options={[
            ["create", "Create new"],
            ["join", "Join with invite"],
          ]}
          onChange={(m) => {
            setMode(m);
            setValue("");
          }}
        />
        <Input
          autoFocus
          value={value}
          maxLength={mode === "create" ? 40 : 120}
          aria-invalid={bad}
          aria-label={mode === "create" ? "Server name" : "Invite link"}
          placeholder={mode === "create" ? "Server name" : "adept.gg/cozy"}
          onChange={(e) => setValue(e.target.value)}
        />
        {bad && (
          <p role="alert" className="text-xs text-destructive">
            {text}
          </p>
        )}
        {mode === "join" && found && (
          <div className="rounded-xl border border-border p-3 text-sm">
            <b>{found}</b>
            <p className="text-xs text-muted-foreground">128 members · 24 online</p>
          </div>
        )}
        {mode === "join" && !value && (
          <p className="text-xs text-muted-foreground">
            Mock invites: cozy, speed. Try “expired” to see an error.
          </p>
        )}
        <Button disabled={mode === "create" ? !value.trim() : !found}>
          {mode === "create" ? "Create server" : "Join server"}
        </Button>
      </form>
    </Modal>
  );
}

export function Discover() {
  const [q, setQ] = useState("");
  const list = Object.entries(INVITES).filter(([, n]) =>
    n.toLowerCase().includes(q.trim().toLowerCase()),
  );
  return (
    <Modal title="Explore servers">
      <Input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search servers"
        aria-label="Search servers"
      />
      {list.length === 0 && (
        <p className="py-6 text-center text-sm text-muted-foreground">No servers found.</p>
      )}
      {list.map(([code, name]) => (
        <div key={code} className="flex items-center gap-3 rounded-xl border border-border p-3">
          <div className="flex-1">
            <p className="text-sm font-semibold">{name}</p>
            <p className="text-xs text-muted-foreground">128 members · open to everyone</p>
          </div>
          <Button size="sm" onClick={() => openDialog({ kind: "addServer", code })}>
            View
          </Button>
        </div>
      ))}
    </Modal>
  );
}

export function Invite({ id }: { id: string }) {
  const s = server(id);
  const [sent, setSent] = useState<string[]>([]);
  if (!s) return null;
  const invites = s.invites ?? [];
  return (
    <Modal title={`Invite people to ${s.name}`}>
      <Button
        onClick={() =>
          change(() => {
            s.invites = [
              ...invites,
              { code: `${s.id}-${invites.length + 1}`, uses: 0, expires: "7 days" },
            ];
            audit(s, "created an invite");
          })
        }
      >
        <Link2 /> Create invite link
      </Button>
      {invites.map((i) => (
        <div key={i.code} className="flex items-center gap-2 rounded-lg bg-surface-2 p-2 text-sm">
          <span className="min-w-0 flex-1 truncate">
            adept.gg/{i.code}
            <span className="block text-xs text-muted-foreground">
              Expires in {i.expires} · {i.uses} uses
            </span>
          </span>
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="Copy invite"
            onClick={() => void copy(`https://adept.gg/${i.code}`)}
          >
            <Copy />
          </Button>
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="Revoke invite"
            onClick={() =>
              change(() => {
                s.invites = invites.filter((x) => x.code !== i.code);
                audit(s, "revoked an invite");
              })
            }
          >
            <Trash2 />
          </Button>
        </div>
      ))}
      <div className="max-h-56 overflow-y-auto">
        {[...world.friends]
          .filter((f) => !s.members.includes(f))
          .map((f) => (
            <div key={f} className="flex h-11 items-center gap-2.5 text-sm">
              <Avatar id={f} size={28} />
              <span className="flex-1">{user(f).name}</span>
              <Button
                size="sm"
                variant="secondary"
                disabled={sent.includes(f)}
                onClick={() => {
                  setSent((x) => [...x, f]);
                  pushMessage(ensureDm(f), {
                    author: ME,
                    text: `Join me on ${s.name}: https://adept.gg/${s.id}`,
                  });
                }}
              >
                {sent.includes(f) ? "Sent" : "Invite"}
              </Button>
            </div>
          ))}
      </div>
    </Modal>
  );
}

export function ChannelForm({ id, channel }: { id: string; channel?: string }) {
  const s = server(id);
  const current = s?.channels.find((c) => c.id === channel);
  const [name, setName] = useState(current?.name ?? "");
  const [topic, setTopic] = useState(current?.topic ?? "");
  const [category, setCategory] = useState(current?.category ?? "Text");
  const [kind, setKind] = useState<"text" | "voice">(current?.kind ?? "text");
  const [readOnly, setReadOnly] = useState<"no" | "yes">(current?.readOnly ? "yes" : "no");
  if (!s) return null;
  const clean = kind === "text" ? name.trim().toLowerCase().replaceAll(/\s+/g, "-") : name.trim();
  const taken = s.channels.some((c) => c.id !== channel && c.name === clean);
  const save = () => {
    if (!clean || taken) return;
    change(() => {
      const fields = {
        name: clean,
        topic: topic.trim() || undefined,
        category: category.trim() || "Text",
        readOnly: readOnly === "yes",
      };
      if (current) Object.assign(current, fields);
      else s.channels.push({ id: `${s.id}-${clean}-${s.channels.length}`, kind, ...fields });
      audit(s, `${current ? "edited" : "created"} ${kind === "text" ? "#" : ""}${clean}`);
    });
    openDialog(null);
  };
  return (
    <Modal title={current ? "Edit channel" : "Create channel"}>
      <form
        className="grid gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        {!current && (
          <Choice
            label="Type"
            value={kind}
            options={[
              ["text", "Text"],
              ["voice", "Voice"],
            ]}
            onChange={(k) => {
              setKind(k);
              setCategory(k === "text" ? "Text" : "Voice");
            }}
          />
        )}
        <Input
          autoFocus
          value={name}
          maxLength={40}
          aria-label="Channel name"
          placeholder="Channel name"
          aria-invalid={taken}
          onChange={(e) => setName(e.target.value)}
        />
        {taken && (
          <p role="alert" className="text-xs text-destructive">
            That name is already used.
          </p>
        )}
        {kind === "text" && (
          <>
            <Input
              value={topic}
              maxLength={120}
              aria-label="Topic"
              placeholder="Topic (optional)"
              onChange={(e) => setTopic(e.target.value)}
            />
            <Choice
              label="Who can post?"
              value={readOnly}
              options={[
                ["no", "Everyone"],
                ["yes", "Owner only"],
              ]}
              onChange={setReadOnly}
            />
          </>
        )}
        <Input
          value={category}
          aria-label="Category"
          placeholder="Category"
          onChange={(e) => setCategory(e.target.value)}
        />
        <div className={cn("flex gap-2", current ? "justify-between" : "justify-end")}>
          {current && (
            <Button
              type="button"
              variant="destructive"
              disabled={s.channels.filter((c) => c.kind === "text").length < 2}
              onClick={() =>
                openDialog({
                  kind: "confirm",
                  title: `Delete ${current.name}?`,
                  body: "Its messages are deleted too. This can't be undone.",
                  action: "Delete channel",
                  run: () => {
                    const next = s.channels.find((c) => c.kind === "text" && c.id !== channel);
                    change(() => {
                      s.channels = s.channels.filter((c) => c.id !== channel);
                      audit(s, `deleted ${current.name}`);
                    });
                    if (next) openChat(next.id);
                  },
                })
              }
            >
              Delete
            </Button>
          )}
          <Button disabled={!clean || taken}>{current ? "Save" : "Create"}</Button>
        </div>
      </form>
    </Modal>
  );
}
