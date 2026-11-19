import { useState } from "react";

import { fieldClass } from "../../components/ui";

export function NewDm({
  disabled,
  onOpen,
}: {
  disabled: boolean;
  onOpen: (username: string) => void;
}) {
  const [username, setUsername] = useState("");
  return (
    <form
      className="flex gap-2 border-b border-zinc-800 p-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!username.trim()) return;
        onOpen(username.trim());
        setUsername("");
      }}
    >
      <input
        value={username}
        onChange={(e) => setUsername(e.target.value)}
        placeholder="username"
        className={fieldClass}
      />
      <button
        disabled={disabled}
        className="rounded-md bg-brand px-2 text-sm font-semibold text-zinc-950 disabled:opacity-50"
      >
        DM
      </button>
    </form>
  );
}
