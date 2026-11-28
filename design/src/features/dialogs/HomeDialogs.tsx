import { Check, Search } from "lucide-react";
import { useState } from "react";

import { Avatar } from "@/components/Avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { openChat } from "@/features/profile/openChat";
import { cn } from "@/lib/utils";
import { conversation, CONVERSATIONS, ME, user, USERS } from "@/mock/data";
import {
  change,
  createGroup,
  ensureDm,
  openDialog,
  pushMessage,
  systemMessage,
  toast,
  world,
} from "@/mock/world";

import { Modal } from "./Modal";

const MAX_GROUP = 5;

function Picker({
  ids,
  picked,
  onPick,
}: {
  ids: string[];
  picked: string[];
  onPick: (id: string) => void;
}) {
  const [q, setQ] = useState("");
  const list = ids.filter((id) =>
    `${user(id).name} ${user(id).handle}`.toLowerCase().includes(q.trim().toLowerCase()),
  );
  return (
    <div>
      <div className="relative">
        <Search className="absolute top-2.5 left-2.5 size-4 text-muted-foreground" />
        <Input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search friends"
          aria-label="Search friends"
          className="pl-8"
        />
      </div>
      <div className="mt-2 max-h-64 overflow-y-auto">
        {list.length === 0 && (
          <p className="py-6 text-center text-sm text-muted-foreground">No matching friends.</p>
        )}
        {list.map((id) => (
          <button
            key={id}
            type="button"
            aria-pressed={picked.includes(id)}
            onClick={() => onPick(id)}
            className={cn(
              "flex h-11 w-full items-center gap-2.5 rounded-lg px-2 text-left text-sm hover:bg-accent",
              picked.includes(id) && "bg-brand/15",
            )}
          >
            <Avatar id={id} size={28} status />
            <span className="flex-1">{user(id).name}</span>
            <span className="text-xs text-muted-foreground">@{user(id).handle}</span>
            {picked.includes(id) && <Check className="size-4 text-brand-text" />}
          </button>
        ))}
      </div>
    </div>
  );
}

export function NewDm() {
  const ids = [...world.friends].filter((id) => !world.blocked.has(id));
  return (
    <Modal title="New message" description="Pick a friend to chat with.">
      <Picker
        ids={ids}
        picked={[]}
        onPick={(id) => {
          openDialog(null);
          openChat(ensureDm(id));
        }}
      />
      <Button variant="secondary" onClick={() => openDialog({ kind: "newGroup" })}>
        Create a group instead
      </Button>
    </Modal>
  );
}

export function GroupMembers({ id }: { id?: string }) {
  const group = id ? conversation(id) : undefined;
  const [picked, setPicked] = useState<string[]>([]);
  const [name, setName] = useState("");
  const room = MAX_GROUP - 1 - (group?.members.length ?? 0);
  const ids = [...world.friends].filter((x) => !group?.members.includes(x));
  const full = picked.length >= room;
  return (
    <Modal
      title={group ? "Add people" : "New group"}
      description={`Up to ${MAX_GROUP} people, including you.`}
    >
      {!group && (
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Group name (optional)"
          aria-label="Group name"
          maxLength={40}
        />
      )}
      <Picker
        ids={ids}
        picked={picked}
        onPick={(x) =>
          setPicked((p) => (p.includes(x) ? p.filter((y) => y !== x) : full ? p : [...p, x]))
        }
      />
      {full && <p className="text-xs text-warning">This group is full.</p>}
      <Button
        disabled={picked.length < (group ? 1 : 2)}
        onClick={() => {
          openDialog(null);
          if (group) {
            change(() => group.members.push(...picked));
            systemMessage(group.id, `You added ${picked.map((x) => user(x).name).join(", ")}.`);
          } else openChat(createGroup(name, picked));
        }}
      >
        {group ? "Add" : "Create group"}
      </Button>
    </Modal>
  );
}

export function RenameGroup({ id }: { id: string }) {
  const group = conversation(id);
  const [name, setName] = useState(group.title);
  return (
    <Modal title="Rename group">
      <form
        className="grid gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (!name.trim()) return;
          change(() => {
            group.title = name.trim();
          });
          systemMessage(id, `You renamed the group to ${name.trim()}.`);
          openDialog(null);
        }}
      >
        <Input
          autoFocus
          value={name}
          maxLength={40}
          aria-label="Group name"
          onChange={(e) => setName(e.target.value)}
        />
        <Button disabled={!name.trim()}>Save</Button>
      </form>
    </Modal>
  );
}

export function Forward({ text }: { text: string }) {
  return (
    <Modal title="Forward message" description={text.slice(0, 80)}>
      <div className="max-h-72 overflow-y-auto">
        {CONVERSATIONS.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => {
              pushMessage(c.id, { author: ME, text: `> ${text.replaceAll("\n", "\n> ")}` });
              openDialog(null);
              toast(`Forwarded to ${c.title}`, { open: c.id });
            }}
            className="flex h-10 w-full items-center rounded-lg px-3 text-left text-sm hover:bg-accent"
          >
            {c.kind === "channel" ? "# " : ""}
            {c.title}
          </button>
        ))}
      </div>
    </Modal>
  );
}

const REASONS = ["Spam", "Harassment", "Harmful content", "Impersonation", "Something else"];

export function Report({ what }: { what: string }) {
  const [reason, setReason] = useState("");
  return (
    <Modal title={`Report ${what}`} description="Why are you reporting this? They won't know.">
      <div role="radiogroup" aria-label="Reason" className="grid gap-1">
        {REASONS.map((r) => (
          <button
            key={r}
            type="button"
            role="radio"
            aria-checked={reason === r}
            onClick={() => setReason(r)}
            className={cn(
              "h-9 rounded-lg px-3 text-left text-sm hover:bg-accent",
              reason === r && "bg-brand/15",
            )}
          >
            {r}
          </button>
        ))}
      </div>
      <Button
        disabled={!reason}
        onClick={() => {
          openDialog(null);
          toast("Report sent. Thank you.");
        }}
      >
        Send report
      </Button>
    </Modal>
  );
}

export function searchPeople(q: string) {
  const query = q.trim().toLowerCase().replace(/^@/, "");
  if (query.length < 2) return [];
  return Object.values(USERS).filter(
    (u) => u.id !== ME && (u.handle.includes(query) || u.name.toLowerCase().includes(query)),
  );
}
