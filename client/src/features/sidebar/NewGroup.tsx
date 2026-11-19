import { useState } from "react";

import { Button, fieldClass as field } from "../../components/ui";

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
      className="space-y-2 border-b border-line p-3"
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
        <Button type="submit" size="sm" disabled={disabled}>
          Group
        </Button>
      </div>
    </form>
  );
}
