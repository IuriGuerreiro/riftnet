import { AtSign, Hash, Phone, Search, Upload, Users, Video } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";

import { Avatar, AvatarStack } from "@/components/Avatar";
import { EmojiText } from "@/features/emoji/EmojiText";
import { type Staged } from "@/features/media/StagedTray";
import { toAttachment } from "@/features/media/toAttachment";
import { activityText } from "@/features/shell/activityText";
import { cn } from "@/lib/utils";
import {
  type Attachment,
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
  const [staged, setStaged] = useState<Staged[]>([]);
  const [dragging, setDragging] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const messages = [...messagesFor(c), ...sent];

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight });
  }, [messages.length]);

  const typing = c.id === "dm-maya" ? "Maya" : c.id === "owls-general" ? "Tom" : undefined;
  const placeholder = c.kind === "channel" ? `Message #${c.title}` : `Message ${c.title}`;
  const post = (text: string, attachments?: Attachment[]) =>
    setSent((s) => [...s, { id: `s${s.length}`, author: ME, text, time: "now", attachments }]);
  const addFiles = (files: File[]) => {
    void Promise.all(files.map(toAttachment)).then((atts) =>
      setStaged((s) => [...s, ...atts.map((att, i) => ({ id: `${Date.now()}-${i}`, att }))]),
    );
  };
  const laneClass =
    lane === "center" ? "mx-auto w-full max-w-3xl" : lane === "left" ? "w-full max-w-[820px]" : "";

  return (
    <section
      className={cn("relative flex min-w-0 flex-1 flex-col bg-background", className)}
      onDragEnter={(e) => {
        if (e.dataTransfer.types.includes("Files")) setDragging(true);
      }}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes("Files")) e.preventDefault();
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        const files = Array.from(e.dataTransfer.files);
        if (files.length) addFiles(files);
      }}
    >
      {dragging && (
        <div className="animate-in fade-in pointer-events-none absolute inset-3 z-30 grid place-items-center rounded-2xl border-2 border-dashed border-brand bg-background/85 backdrop-blur-sm duration-150">
          <div className="flex flex-col items-center gap-3 text-center">
            <span className="grid size-14 place-items-center rounded-2xl bg-brand/15 text-brand">
              <Upload className="size-7" />
            </span>
            <p className="text-lg font-semibold">Drop to upload</p>
            <p className="text-sm text-muted-foreground">
              Images, videos, GIFs and files go to <EmojiText text={c.title} size={14} />
            </p>
          </div>
        </div>
      )}
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
          staged={staged}
          onAddFiles={addFiles}
          onRemoveStaged={(id) => setStaged((s) => s.filter((x) => x.id !== id))}
          onSendGif={(g) => post("", [g])}
          onSend={(text) => {
            post(text, staged.length ? staged.map((x) => x.att) : undefined);
            setStaged([]);
          }}
        />
      </div>
    </section>
  );
}
