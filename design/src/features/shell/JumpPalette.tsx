import { Hash, Phone, Settings, Users, Volume2 } from "lucide-react";

import { Avatar } from "@/components/Avatar";
import { ServerIcon } from "@/components/ServerIcon";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@/components/ui/command";
import { CONVERSATIONS, FRIENDS, SERVERS } from "@/mock/data";
import { openDialog } from "@/mock/world";

import { ConversationAvatar } from "./ConversationRow";

export function JumpPalette({
  open,
  onOpenChange,
  onOpen,
  onOpenVoice,
  onCall,
  unreadOf,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpen: (id: string) => void;
  onOpenVoice?: (id: string) => void;
  onCall?: () => void;
  unreadOf?: (id: string, base: number) => number;
}) {
  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Jump to"
      description="Find a conversation, channel or person"
    >
      <CommandInput placeholder="Jump to a chat, channel or person…" />
      <CommandList>
        <CommandEmpty>Nothing found.</CommandEmpty>
        <CommandGroup heading="Recent">
          {CONVERSATIONS.slice(0, 5).map((x) => (
            <CommandItem key={x.id} value={`${x.title} ${x.id}`} onSelect={() => onOpen(x.id)}>
              <ConversationAvatar c={x} size={22} />
              <span>{x.kind === "channel" ? `#${x.title}` : x.title}</span>
              {(unreadOf?.(x.id, x.unread) ?? x.unread) > 0 && (
                <CommandShortcut>{x.unread} new</CommandShortcut>
              )}
            </CommandItem>
          ))}
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading="Channels">
          {SERVERS.flatMap((s) =>
            s.channels.map((ch) => (
              <CommandItem
                key={ch.id}
                value={`${ch.name} ${s.name}`}
                onSelect={() => (ch.kind === "text" ? onOpen(ch.id) : onOpenVoice?.(ch.id))}
              >
                <ServerIcon server={s} size={20} />
                {ch.kind === "text" ? <Hash /> : <Volume2 />}
                <span>{ch.name}</span>
                <CommandShortcut>{s.name}</CommandShortcut>
              </CommandItem>
            )),
          )}
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading="People">
          {FRIENDS.map((f) => (
            <CommandItem
              key={f.id}
              value={`${f.name} ${f.handle}`}
              onSelect={() => onOpen(`dm-${f.id}`)}
            >
              <Avatar id={f.id} size={20} />
              <span>{f.name}</span>
              <CommandShortcut>@{f.handle}</CommandShortcut>
            </CommandItem>
          ))}
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading="Actions">
          <CommandItem disabled={!onCall} onSelect={() => onCall?.()}>
            <Phone /> Start a call
          </CommandItem>
          <CommandItem
            onSelect={() => {
              onOpenChange(false);
              openDialog({ kind: "newGroup" });
            }}
          >
            <Users /> Create a group
          </CommandItem>
          <CommandItem
            onSelect={() => {
              onOpenChange(false);
              openDialog({ kind: "settings" });
            }}
          >
            <Settings /> Settings
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
