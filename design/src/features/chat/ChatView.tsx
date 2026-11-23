import { AtSign, Hash, Phone, Search, Users, Video } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";

import { Avatar, AvatarStack } from "@/components/Avatar";
import { EmojiText } from "@/features/emoji/EmojiText";
import { activityText } from "@/features/shell/activityText";
import { cn } from "@/lib/utils";
import {
  type Conversation,
  conversation,
  ME,
  type Message,
  messagesFor,
  server,
  user,
} from "@/mock/data";

import { Composer } from "./Composer";
import { MessageList } from "./MessageList";

export function ConversationIcon({ c, size = 24 }: { c: Conversation; size?: number }) {
  if (c.kind === "channel")
    return (
      <Hash className="text-muted-foreground" style={{ width: size * 0.8, height: size * 0.8 }} />
    );
  if (c.kind === "group")
    return <AvatarStack ids={c.members.slice(0, 2)} size={size * 0.8} max={2} />;
  return <Avatar id={c.members[0] ?? ""} size={size} status />;
}

function chatSubtitle(c: Conversation) {
  if (c.kind === "channel") return c.topic ?? server(c.serverId ?? "")?.name;
  if (c.kind === "group") return `${c.members.length + 1} members`;
  const u = user(c.members[0] ?? "");
  if (u.activity) return activityText(u.activity);
  return u.status === "offline" ? "Offline" : `@${u.handle}`;
}

function HeaderButton({
  label,
  active,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  onClick?: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={cn(
        "grid size-8 place-items-center rounded-md transition-colors",
        active
          ? "bg-accent text-foreground"
          : "text-muted-foreground hover:bg-accent hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

export function ChatView({
  conversationId,
  membersOpen,
  onToggleMembers,
  lane = "full",
  panelInDm = false,
  headerLeading,
  className,
}: {
  conversationId: string;
  membersOpen?: boolean;
  onToggleMembers?: () => void;
  lane?: "full" | "center" | "left";
  panelInDm?: boolean;
  headerLeading?: ReactNode;
  className?: string;
}) {
  const c = conversation(conversationId);
  const [sent, setSent] = useState<Message[]>([]);
  const scroller = useRef<HTMLDivElement>(null);
  const messages = [...messagesFor(c), ...sent];

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight });
  }, [messages.length]);

  const typing = c.id === "dm-maya" ? "Maya" : c.id === "owls-general" ? "Tom" : undefined;
  const placeholder = c.kind === "channel" ? `Message #${c.title}` : `Message ${c.title}`;
  const laneClass =
    lane === "center" ? "mx-auto w-full max-w-3xl" : lane === "left" ? "w-full max-w-[820px]" : "";

  return (
    <section className={cn("flex min-w-0 flex-1 flex-col bg-background", className)}>
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border px-4">
        {headerLeading}
        <ConversationIcon c={c} size={28} />
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-[15px] leading-tight font-semibold">
            <EmojiText text={c.title} size={16} />
          </h2>
          <p className="truncate text-xs text-muted-foreground">{chatSubtitle(c)}</p>
        </div>
        <div className="flex items-center gap-0.5">
          {c.kind !== "channel" && (
            <>
              <HeaderButton label="Start voice call">
                <Phone className="size-[18px]" />
              </HeaderButton>
              <HeaderButton label="Start video call">
                <Video className="size-[18px]" />
              </HeaderButton>
            </>
          )}
          {(c.kind !== "dm" || panelInDm) && onToggleMembers && (
            <HeaderButton
              label={c.kind === "dm" ? "Profile" : "Members"}
              active={membersOpen}
              onClick={onToggleMembers}
            >
              <Users className="size-[18px]" />
            </HeaderButton>
          )}
          <HeaderButton label="Mentions">
            <AtSign className="size-[18px]" />
          </HeaderButton>
          <HeaderButton label="Search">
            <Search className="size-[18px]" />
          </HeaderButton>
        </div>
      </header>
      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto">
        <div className={cn("flex min-h-full flex-col justify-end", laneClass)}>
          <MessageList messages={messages} unread={c.unread} />
        </div>
      </div>
      <div className={laneClass}>
        <Composer
          placeholder={placeholder}
          typing={typing}
          onSend={(text) =>
            setSent((s) => [...s, { id: `s${s.length}`, author: ME, text, time: "now" }])
          }
        />
      </div>
    </section>
  );
}
