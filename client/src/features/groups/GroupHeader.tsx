import { useState } from "react";

import { Button, fieldClass as field } from "../../components/ui";
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
    <header className="space-y-2 border-b border-line p-4">
      <div className="flex items-center gap-3">
        <button
          className="font-semibold hover:text-brand"
          title="Rename group"
          onClick={() => {
            const name = prompt("Enter a new group name", group.name);
            if (name?.trim()) onRename(name.trim());
          }}
        >
          # {group.name}
        </button>
        <span className="text-xs text-fg-subtle">{group.members.length}/5</span>
        <button className="ml-auto text-xs text-danger hover:text-danger" onClick={onLeave}>
          Leave group
        </button>
      </div>
      <p className="text-xs text-fg-muted">
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
            placeholder="Add member by username"
            className={field}
          />
          <Button type="submit" size="sm" variant="secondary">
            Add
          </Button>
        </form>
      )}
    </header>
  );
}
