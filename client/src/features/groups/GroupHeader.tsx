import { useState } from "react";

import { fieldClass as field } from "../../components/ui";
import type { Conversation } from "../../gen/v1/conversations_pb";
import { nameOf, useProfiles } from "../../stores/profiles";

export function GroupHeader({
  group,
  onAdd,
  onRename,
  onLeave,
}: {
  group: Conversation;
  onAdd: (username: string) => void;
  onRename: (name: string) => void;
  onLeave: () => void;
}) {
  const [username, setUsername] = useState("");
  const profiles = useProfiles((s) => s.byId);
  return (
    <header className="space-y-2 border-b border-zinc-800 p-4">
      <div className="flex items-center gap-3">
        <button
          className="font-semibold hover:text-brand"
          title="Rename"
          onClick={() => {
            const name = prompt("New group name", group.name);
            if (name?.trim()) onRename(name.trim());
          }}
        >
          # {group.name}
        </button>
        <span className="text-xs text-zinc-500">{group.members.length}/5</span>
        <button className="ml-auto text-xs text-red-400 hover:text-red-300" onClick={onLeave}>
          Leave
        </button>
      </div>
      <p className="text-xs text-zinc-400">
        {group.members.map((m) => nameOf(profiles[m.id.toString()])).join(", ")}
      </p>
      {group.members.length < 5 && (
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!username.trim()) return;
            onAdd(username.trim());
            setUsername("");
          }}
        >
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="add username"
            className={field}
          />
          <button className="rounded-md bg-zinc-700 px-2 text-sm hover:bg-zinc-600">Add</button>
        </form>
      )}
    </header>
  );
}
