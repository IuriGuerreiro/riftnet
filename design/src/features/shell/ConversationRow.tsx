import { Hash } from "lucide-react";

import { Avatar, Face } from "@/components/Avatar";
import { ServerIcon } from "@/components/ServerIcon";
import { cn } from "@/lib/utils";
import { type Conversation, server } from "@/mock/data";

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
    const picks = c.members.slice(0, 3);
    return (
      <span
        className="grid shrink-0 grid-cols-2 grid-rows-2 gap-[1.5px] overflow-hidden rounded-[30%] bg-ink ring-1 ring-white/[0.09] ring-inset"
        style={{ width: size, height: size }}
      >
        {picks.map((m, i) => (
          <span
            key={m}
            className={cn("overflow-hidden", (i === 0 || picks.length === 2) && "row-span-2")}
          >
            <Face id={m} size={size / 2} />
          </span>
        ))}
      </span>
    );
  }
  return <Avatar id={c.members[0] ?? ""} size={size} status />;
}
