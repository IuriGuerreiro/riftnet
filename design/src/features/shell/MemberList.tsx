import { Avatar } from "@/components/Avatar";
import { user } from "@/mock/data";

import { activityText } from "./activityText";

export function MemberList({ ids }: { ids: string[] }) {
  const members = ids.map(user);
  const online = members.filter((m) => m.status !== "offline");
  const offline = members.filter((m) => m.status === "offline");

  return (
    <aside className="hidden w-60 shrink-0 overflow-y-auto border-l border-border bg-surface-1 px-2 py-4 xl:block">
      {[
        { label: "Online", list: online },
        { label: "Offline", list: offline },
      ].map(({ label, list }) =>
        list.length > 0 ? (
          <div key={label} className="mb-4">
            <p className="px-2 pb-1.5 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
              {label} — {list.length}
            </p>
            {list.map((m) => (
              <button
                key={m.id}
                type="button"
                className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left hover:bg-accent data-[off=true]:opacity-45"
                data-off={m.status === "offline"}
              >
                <Avatar id={m.id} size={32} status ringBg="var(--surface-1)" />
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium">{m.name}</span>
                  {m.activity && (
                    <span className="block truncate text-xs text-muted-foreground">
                      {activityText(m.activity)}
                    </span>
                  )}
                </span>
              </button>
            ))}
          </div>
        ) : null,
      )}
    </aside>
  );
}
