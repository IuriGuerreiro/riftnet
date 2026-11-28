import { X } from "lucide-react";
import { useState } from "react";

import { Avatar } from "@/components/Avatar";
import { ME, type Message, user } from "@/mock/data";
import { change, useWorld, world } from "@/mock/world";

import { clock } from "./chatState";
import { Markdown } from "./Markdown";

function Line({ m }: { m: Message }) {
  return (
    <div className="flex gap-2.5 px-3 py-2">
      <Avatar id={m.author} size={30} />
      <div className="min-w-0 flex-1 text-sm">
        <p>
          <b className="font-semibold">{user(m.author).name}</b>{" "}
          <span className="text-[11px] text-muted-foreground">{m.time}</span>
        </p>
        <div className="[overflow-wrap:anywhere]">
          <Markdown text={m.text || "Attachment"} />
        </div>
      </div>
    </div>
  );
}

export function Thread({
  root,
  conversationId,
  blockedReason,
  onClose,
}: {
  root: Message;
  conversationId: string;
  blockedReason: string | null;
  onClose: () => void;
}) {
  useWorld();
  const [text, setText] = useState("");
  const key = `${conversationId}:${root.id}`;
  const replies = world.threads[key] ?? [];
  return (
    <aside
      aria-label="Thread"
      className="flex w-80 max-w-full shrink-0 flex-col border-l border-border bg-surface-1 @max-3xl:absolute @max-3xl:inset-y-0 @max-3xl:right-0 @max-3xl:z-30 @max-3xl:shadow-2xl"
    >
      <div className="flex items-center justify-between p-4">
        <h3 className="font-semibold">Thread</h3>
        <button type="button" aria-label="Close thread" onClick={onClose}>
          <X className="size-4" />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <Line m={root} />
        <p className="border-b border-border px-3 pb-2 text-xs text-muted-foreground">
          {replies.length} {replies.length === 1 ? "reply" : "replies"}
        </p>
        {replies.map((m) => (
          <Line key={m.id} m={m} />
        ))}
      </div>
      <form
        className="p-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (blockedReason || !text.trim()) return;
          const reply = { id: `t-${root.id}-${replies.length}`, author: ME, text, time: clock() };
          change(() => {
            world.threads = { ...world.threads, [key]: [...replies, reply] };
          });
          setText("");
        }}
      >
        <input
          autoFocus
          value={text}
          maxLength={4000}
          aria-label="Reply in thread"
          disabled={Boolean(blockedReason)}
          placeholder={blockedReason ?? "Reply in thread"}
          onChange={(e) => setText(e.target.value)}
          className="h-10 w-full rounded-xl border border-border bg-surface-2 px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-brand"
        />
      </form>
    </aside>
  );
}
