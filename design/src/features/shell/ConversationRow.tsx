import { Hash } from "lucide-react";

import { Avatar } from "@/components/Avatar";
import { ServerIcon } from "@/components/ServerIcon";
import { EmojiText } from "@/features/emoji/EmojiText";
import { cn } from "@/lib/utils";
import { type Conversation, server, user } from "@/mock/data";

export function ConversationAvatar({ c, size = 40 }: { c: Conversation; size?: number }) {
  if (c.kind === "channel") {
    const s = server(c.serverId ?? "");
    return (
      <span className="relative shrink-0">
        {s && <ServerIcon server={s} size={size} />}
        <span className="absolute -right-1 -bottom-1 grid size-[18px] place-items-center rounded-md border-2 border-surface-1 bg-surface-3">
          <Hash className="size-2.5 text-foreground" strokeWidth={3} />
        </span>
      </span>
    );
  }
  if (c.kind === "group") {
    return (
      <span className="relative shrink-0" style={{ width: size, height: size }}>
        <span className="absolute top-0 left-0">
          <Avatar id={c.members[0] ?? ""} size={size * 0.68} />
        </span>
        <span className="absolute right-0 bottom-0 rounded-full ring-2 ring-surface-1">
          <Avatar id={c.members[1] ?? ""} size={size * 0.68} />
        </span>
      </span>
    );
  }
  return <Avatar id={c.members[0] ?? ""} size={size} status ringBg="var(--surface-1)" />;
}

export function ConversationRow({
  c,
  active,
  dense = false,
  onClick,
}: {
  c: Conversation;
  active: boolean;
  dense?: boolean;
  onClick: () => void;
}) {
  const unread = c.unread > 0;
  const srv = c.kind === "channel" ? server(c.serverId ?? "") : undefined;
  const author = c.previewAuthor ? `${user(c.previewAuthor).name}: ` : "";

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "group flex w-full items-center gap-3 rounded-lg px-2 text-left transition-colors",
        dense ? "py-1.5" : "py-2",
        active ? "bg-accent" : "hover:bg-accent/60",
      )}
    >
      <ConversationAvatar c={c} size={dense ? 32 : 40} />
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-2">
          <span
            className={cn(
              "truncate text-sm",
              unread || active ? "font-semibold text-foreground" : "font-medium text-foreground/80",
            )}
          >
            {c.kind === "channel" && <span className="text-muted-foreground">#</span>}
            <EmojiText text={c.title} size={15} />
            {srv && <span className="font-normal text-muted-foreground"> · {srv.name}</span>}
          </span>
          <span
            className={cn(
              "ml-auto shrink-0 text-[11px]",
              unread ? "text-brand" : "text-muted-foreground/70",
            )}
          >
            {c.at}
          </span>
        </span>
        {!dense && (
          <span className="flex items-center gap-2">
            <span
              className={cn(
                "truncate text-[13px]",
                unread ? "text-foreground/85" : "text-muted-foreground",
              )}
            >
              {c.kind !== "dm" && author}
              {c.preview}
            </span>
            {c.mentions > 0 ? (
              <span className="ml-auto grid h-[18px] min-w-[18px] shrink-0 place-items-center rounded-full bg-destructive px-1.5 text-[11px] font-bold text-white">
                @{c.mentions}
              </span>
            ) : unread ? (
              <span className="ml-auto grid h-[18px] min-w-[18px] shrink-0 place-items-center rounded-full bg-brand px-1.5 text-[11px] font-bold text-white">
                {c.unread}
              </span>
            ) : null}
          </span>
        )}
      </span>
    </button>
  );
}
