import { useLayoutEffect, useMemo, useRef } from "react";

import { formatDay } from "../../lib/time";
import { useChat } from "../../stores/chat";
import { groupMessages } from "./groupMessages";
import { MessageRow } from "./MessageRow";

const NEAR_BOTTOM_PX = 120;

export function MessageList({
  conversationId,
  myId,
  intro,
}: {
  conversationId: bigint;
  myId?: bigint;
  intro: React.ReactNode;
}) {
  const messages = useChat((s) => s.messages[conversationId.toString()]);
  const rows = useMemo(() => groupMessages(messages ?? []), [messages]);
  const scroller = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  const [lastRow] = [...rows].reverse();
  const last = lastRow?.message;

  useLayoutEffect(() => {
    pinned.current = true;
  }, [conversationId]);

  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    if (pinned.current || last?.authorId === myId) el.scrollTop = el.scrollHeight;
  }, [rows.length, last, myId]);

  return (
    <div
      ref={scroller}
      onScroll={(e) => {
        const el = e.currentTarget;
        pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX;
      }}
      className="flex-1 overflow-y-auto pb-6"
    >
      <div className="flex min-h-full flex-col justify-end">
        <div className="px-4 pb-2 pt-8">{intro}</div>
        {rows.map(({ message: m, time, header, dayDivider }) => (
          <div key={m.nonce ?? m.id.toString()}>
            {dayDivider && (
              <div role="separator" className="mx-4 mb-1 mt-6 flex items-center gap-2">
                <span className="h-px flex-1 bg-line" />
                <span className="text-xs font-semibold text-fg-subtle">{formatDay(time)}</span>
                <span className="h-px flex-1 bg-line" />
              </div>
            )}
            <MessageRow
              m={m}
              mine={m.authorId === myId}
              header={header}
              time={time}
              conversationId={conversationId}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
