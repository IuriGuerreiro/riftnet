import { useState } from "react";

import { Button, fieldClass } from "../../components/ui";

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
      className="flex gap-2 border-b border-line p-3"
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
        placeholder="Username"
        className={fieldClass}
      />
      <Button type="submit" size="sm" disabled={disabled}>
        Message
      </Button>
    </form>
  );
}
