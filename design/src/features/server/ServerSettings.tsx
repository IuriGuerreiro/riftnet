import { Crown, Search } from "lucide-react";
import { useState } from "react";

import { Avatar } from "@/components/Avatar";
import { Toggle } from "@/components/Controls";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal } from "@/features/dialogs/Modal";
import { cn } from "@/lib/utils";
import { ME, type Role, type Server, server, user } from "@/mock/data";
import { audit, change, isOwner, openDialog, removeServer, useWorld } from "@/mock/world";

const TABS = ["Overview", "Members", "Roles", "Bans", "Audit log"] as const;
const PERMISSIONS = [
  "Manage channels",
  "Manage messages",
  "Kick members",
  "Ban members",
  "Mention everyone",
];

function Overview({ s }: { s: Server }) {
  const [name, setName] = useState(s.name);
  const [about, setAbout] = useState(s.description ?? "");
  return (
    <div className="grid gap-3">
      <Input
        value={name}
        maxLength={40}
        aria-label="Server name"
        onChange={(e) => setName(e.target.value)}
      />
      <Input
        value={about}
        maxLength={120}
        aria-label="Description"
        placeholder="Description"
        onChange={(e) => setAbout(e.target.value)}
      />
      <Button
        disabled={!name.trim()}
        onClick={() =>
          change(() => {
            s.name = name.trim();
            s.description = about.trim();
            audit(s, "updated the server");
          })
        }
      >
        Save changes
      </Button>
      <Button
        variant="destructive"
        onClick={() =>
          openDialog({
            kind: "confirm",
            title: `Delete ${s.name}?`,
            body: "Every channel and message is deleted. This can't be undone.",
            action: "Delete server",
            run: () => removeServer(s.id),
          })
        }
      >
        Delete server
      </Button>
    </div>
  );
}

function Members({ s }: { s: Server }) {
  const [q, setQ] = useState("");
  const [limit, setLimit] = useState(6);
  const list = s.members.filter((m) => user(m).name.toLowerCase().includes(q.toLowerCase()));
  const remove = (id: string, ban: boolean) =>
    openDialog({
      kind: "confirm",
      title: `${ban ? "Ban" : "Kick"} ${user(id).name}?`,
      body: ban ? "They can't rejoin until you unban them." : "They can rejoin with an invite.",
      action: ban ? "Ban" : "Kick",
      run: () =>
        change(() => {
          s.members = s.members.filter((m) => m !== id);
          if (ban) s.bans = [...(s.bans ?? []), id];
          audit(s, `${ban ? "banned" : "kicked"} ${user(id).name}`);
        }),
    });
  return (
    <div>
      <div className="relative mb-2">
        <Search className="absolute top-2.5 left-2.5 size-4 text-muted-foreground" />
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label="Search members"
          placeholder="Search members"
          className="pl-8"
        />
      </div>
      {list.slice(0, limit).map((id) => (
        <div key={id} className="flex h-12 items-center gap-2.5 text-sm">
          <Avatar id={id} size={30} status ringBg="var(--popover)" />
          <span className="flex flex-1 items-center gap-1.5">
            {user(id).name}
            {id === ME && <Crown className="size-3.5 text-warning" aria-label="Owner" />}
          </span>
          {id !== ME && (
            <>
              <Button size="sm" variant="ghost" onClick={() => remove(id, false)}>
                Kick
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="text-destructive"
                onClick={() => remove(id, true)}
              >
                Ban
              </Button>
            </>
          )}
        </div>
      ))}
      {list.length > limit && (
        <Button variant="secondary" className="w-full" onClick={() => setLimit(limit + 6)}>
          Show more
        </Button>
      )}
      {list.length === 0 && <p className="py-6 text-center text-sm">No members found.</p>}
    </div>
  );
}

function Roles({ s }: { s: Server }) {
  const roles = s.roles ?? [];
  const [openId, setOpenId] = useState<string | null>(roles[0]?.id ?? null);
  const role = roles.find((r) => r.id === openId);
  const patch = (next: Partial<Role>) =>
    change(() => {
      s.roles = roles.map((r) => (r.id === openId ? { ...r, ...next } : r));
    });
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap gap-1.5">
        {roles.map((r) => (
          <button
            key={r.id}
            type="button"
            onClick={() => setOpenId(r.id)}
            className={cn(
              "flex h-8 items-center gap-2 rounded-lg border px-3 text-xs",
              r.id === openId ? "border-brand bg-brand/15" : "border-border",
            )}
          >
            <span className="size-2.5 rounded-full" style={{ background: r.color }} />
            {r.name}
          </button>
        ))}
        <Button
          size="sm"
          variant="secondary"
          onClick={() => {
            const id = `role-${crypto.randomUUID()}`;
            change(() => {
              s.roles = [
                ...roles,
                { id, name: "New role", color: "#a99eff", members: [], permissions: [] },
              ];
              audit(s, "created a role");
            });
            setOpenId(id);
          }}
        >
          Create role
        </Button>
      </div>
      {!role && (
        <p className="text-sm text-muted-foreground">
          No roles yet. Create one to give people permissions.
        </p>
      )}
      {role && (
        <div key={role.id}>
          <div className="flex gap-2">
            <Input
              value={role.name}
              aria-label="Role name"
              maxLength={30}
              onChange={(e) => patch({ name: e.target.value })}
            />
            <input
              type="color"
              aria-label="Role color"
              value={role.color}
              onChange={(e) => patch({ color: e.target.value })}
              className="h-9 w-12 rounded-md bg-transparent"
            />
          </div>
          {PERMISSIONS.map((p) => (
            <Toggle
              key={p}
              label={p}
              on={role.permissions.includes(p)}
              onChange={(on) =>
                patch({
                  permissions: on
                    ? [...role.permissions, p]
                    : role.permissions.filter((x) => x !== p),
                })
              }
            />
          ))}
          <p className="mt-2 text-xs font-semibold text-muted-foreground uppercase">Members</p>
          {s.members.map((m) => (
            <Toggle
              key={m}
              label={user(m).name}
              on={role.members.includes(m)}
              onChange={(on) =>
                patch({
                  members: on ? [...role.members, m] : role.members.filter((x) => x !== m),
                })
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function ServerSettings({ id, tab = "Overview" }: { id: string; tab?: string }) {
  useWorld();
  const s = server(id);
  const [current, setCurrent] = useState(tab);
  if (!s) return null;
  if (!isOwner(s))
    return (
      <Modal title={s.name}>
        <p className="text-sm text-muted-foreground">
          Only the server owner can change these settings.
        </p>
      </Modal>
    );
  return (
    <Modal title={`${s.name} settings`} wide>
      <div role="tablist" className="flex flex-wrap gap-1 border-b border-border pb-2">
        {TABS.map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={current === t}
            onClick={() => setCurrent(t)}
            className={cn(
              "h-8 rounded-lg px-3 text-xs font-medium",
              current === t ? "bg-accent" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {t}
          </button>
        ))}
      </div>
      <div className="min-h-72">
        {current === "Overview" && <Overview s={s} />}
        {current === "Members" && <Members s={s} />}
        {current === "Roles" && <Roles s={s} />}
        {current === "Bans" &&
          (s.bans?.length ? (
            s.bans.map((b) => (
              <div key={b} className="flex h-12 items-center gap-2.5 text-sm">
                <Avatar id={b} size={30} />
                <span className="flex-1">{user(b).name}</span>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() =>
                    change(() => {
                      s.bans = s.bans?.filter((x) => x !== b);
                      audit(s, `unbanned ${user(b).name}`);
                    })
                  }
                >
                  Unban
                </Button>
              </div>
            ))
          ) : (
            <p className="py-10 text-center text-sm text-muted-foreground">Nobody is banned.</p>
          ))}
        {current === "Audit log" &&
          (s.audit?.length ? (
            s.audit.map((a) => (
              <p key={a.id} className="border-b border-border py-2.5 text-sm">
                <b>{user(a.who).name}</b> {a.text}
                <span className="float-right text-xs text-muted-foreground">{a.at}</span>
              </p>
            ))
          ) : (
            <p className="py-10 text-center text-sm text-muted-foreground">
              Changes to this server show up here.
            </p>
          ))}
      </div>
    </Modal>
  );
}
