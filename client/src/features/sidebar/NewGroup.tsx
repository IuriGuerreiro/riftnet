import { useState } from "react";

import { fieldClass as field } from "../../components/ui";

export function NewGroup({
  disabled,
  onCreate,
}: {
  disabled: boolean;
  onCreate: (name: string, usernames: string[]) => void;
}) {
  const [name, setName] = useState("");
  const [usernames, setUsernames] = useState("");
  return (
    <form
      className="space-y-2 border-b border-zinc-800 p-3"
      onSubmit={(e) => {
        e.preventDefault();
        const list = usernames
          .split(",")
          .map((u) => u.trim())
          .filter(Boolean);
        if (!name.trim() || list.length === 0) return;
        onCreate(name.trim(), list);
        setName("");
        setUsernames("");
      }}
    >
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="group name"
        className={field}
      />
      <div className="flex gap-2">
        <input
          value={usernames}
          onChange={(e) => setUsernames(e.target.value)}
          placeholder="ana, bob, carl"
          className={field}
        />
        <button
          disabled={disabled}
          className="rounded-md bg-brand px-2 text-sm font-semibold text-zinc-950 disabled:opacity-50"
        >
          Group
        </button>
      </div>
    </form>
  );
}
