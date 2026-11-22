import { useState } from "react";

import { Button, Input, Modal } from "../../components/ui";
import { useChat } from "../../stores/chat";
import { useConnection } from "../../stores/connection";
import { useUi } from "../../stores/ui";

export type NewConversation = "dm" | "group";

export function NewConversationDialog({
  kind,
  onClose,
}: {
  kind: NewConversation;
  onClose: () => void;
}) {
  return kind === "dm" ? <NewDmDialog onClose={onClose} /> : <NewGroupDialog onClose={onClose} />;
}

function NewDmDialog({ onClose }: { onClose: () => void }) {
  const ws = useConnection((s) => s.ws);
  const openDm = useChat((s) => s.openDm);
  const showChat = useUi((s) => s.showChat);
  const [username, setUsername] = useState("");
  const ok = !!ws && !!username.trim();
  return (
    <Modal
      open
      title="New message"
      onClose={onClose}
      footer={
        <Button type="submit" form="new-dm" disabled={!ok}>
          Start conversation
        </Button>
      }
    >
      <form
        id="new-dm"
        onSubmit={(e) => {
          e.preventDefault();
          if (!ok) return;
          void openDm(ws, username.trim().replace(/^@/, ""));
          showChat();
          onClose();
        }}
      >
        <Input
          autoFocus
          label="Username"
          placeholder="username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
        />
      </form>
    </Modal>
  );
}

function NewGroupDialog({ onClose }: { onClose: () => void }) {
  const ws = useConnection((s) => s.ws);
  const createGroup = useChat((s) => s.createGroup);
  const showChat = useUi((s) => s.showChat);
  const [name, setName] = useState("");
  const [members, setMembers] = useState("");
  const list = members
    .split(",")
    .map((u) => u.trim().replace(/^@/, ""))
    .filter(Boolean);
  const ok = !!ws && !!name.trim() && list.length > 0 && list.length <= 4;
  return (
    <Modal
      open
      title="Create group"
      onClose={onClose}
      footer={
        <Button type="submit" form="new-group" disabled={!ok}>
          Create group
        </Button>
      }
    >
      <form
        id="new-group"
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (!ok) return;
          void createGroup(ws, name.trim(), list);
          showChat();
          onClose();
        }}
      >
        <Input
          autoFocus
          label="Group name"
          placeholder="Weekend plans"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <Input
          label="Members"
          placeholder="ana, bob"
          hint="Up to 4 usernames, separated by commas."
          error={list.length > 4 ? "Groups can have at most 5 people, including you." : undefined}
          value={members}
          onChange={(e) => setMembers(e.target.value)}
        />
      </form>
    </Modal>
  );
}
