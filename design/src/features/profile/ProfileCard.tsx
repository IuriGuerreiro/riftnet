import { Ban, Flag, MessageSquare, MoreHorizontal, UserMinus, UserPlus } from "lucide-react";
import type { ReactNode } from "react";

import { Avatar } from "@/components/Avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ActivityLine } from "@/features/adept/ActivityLine";
import { ME, type User, user } from "@/mock/data";
import {
  addFriend,
  blockUser,
  cancelRequest,
  ensureDm,
  friendState,
  openDialog,
  removeFriend,
  unblock,
  useWorld,
  world,
} from "@/mock/world";

import { openChat } from "./openChat";

export function bannerStyle(u: User) {
  if (u.banner) return { background: `center / cover url(${u.banner})` };
  return {
    background:
      u.accent ?? `linear-gradient(135deg, hsl(${u.hue} 45% 30%), hsl(${u.hue + 40} 40% 18%))`,
  };
}

export function UserMenu({ id, children }: { id: string; children: ReactNode }) {
  useWorld();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        {friendState(id) === "friend" && (
          <DropdownMenuItem onSelect={() => removeFriend(id)}>
            <UserMinus /> Remove friend
          </DropdownMenuItem>
        )}
        <DropdownMenuItem
          variant="destructive"
          onSelect={() => (world.blocked.has(id) ? unblock(id) : blockUser(id))}
        >
          <Ban /> {world.blocked.has(id) ? "Unblock" : "Block"}
        </DropdownMenuItem>
        <DropdownMenuItem
          variant="destructive"
          onSelect={() => openDialog({ kind: "report", what: user(id).name })}
        >
          <Flag /> Report
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function ProfileBody({ u, onDone }: { u: User; onDone?: () => void }) {
  useWorld();
  const state = friendState(u.id);
  return (
    <div className="overflow-hidden rounded-xl">
      <div className="h-20" style={bannerStyle(u)} />
      <div className="-mt-8 p-4 pt-0">
        <Avatar
          id={u.id}
          size={64}
          status
          ringBg="var(--popover)"
          className="rounded-full ring-4 ring-popover"
        />
        <h3 className="mt-1 text-base font-semibold">{u.name}</h3>
        <p className="text-xs text-muted-foreground">
          @{u.handle}
          {u.pronouns ? ` · ${u.pronouns}` : ""}
        </p>
        {u.customStatus && <p className="mt-2 text-sm">{u.customStatus}</p>}
        {u.bio && <p className="mt-2 text-sm whitespace-pre-wrap text-foreground/80">{u.bio}</p>}
        {u.activity && (
          <div className="mt-2">
            <ActivityLine a={u.activity} />
          </div>
        )}
        {u.id !== ME && (
          <div className="mt-3 flex gap-1.5">
            <Button
              size="sm"
              className="flex-1"
              disabled={world.blocked.has(u.id)}
              onClick={() => {
                openChat(ensureDm(u.id));
                onDone?.();
              }}
            >
              <MessageSquare /> Message
            </Button>
            {state !== "friend" && (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => (state === "outgoing" ? cancelRequest(u.id) : addFriend(u.id))}
              >
                <UserPlus />
                {state === "outgoing" ? "Cancel" : state === "incoming" ? "Accept" : "Add"}
              </Button>
            )}
            <UserMenu id={u.id}>
              <Button size="icon-sm" variant="secondary" aria-label="More">
                <MoreHorizontal />
              </Button>
            </UserMenu>
          </div>
        )}
      </div>
    </div>
  );
}

export function ProfileTrigger({
  id,
  className,
  children,
}: {
  id: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" aria-label={`Open ${user(id).name}'s profile`} className={className}>
          {children}
        </button>
      </PopoverTrigger>
      <PopoverContent side="right" align="start" className="w-72 overflow-hidden rounded-xl p-0">
        <ProfileBody u={user(id)} />
      </PopoverContent>
    </Popover>
  );
}
