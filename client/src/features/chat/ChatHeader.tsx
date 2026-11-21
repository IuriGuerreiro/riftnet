import { AtSign, Hash, LogOut, MoreVertical, Pencil, UserPlus, Users } from "lucide-react";
import { useState } from "react";

import { CallBar } from "../../call/CallBar";
import { AvatarWithStatus } from "../../components/AvatarWithStatus";
import { ConfirmDialog, IconButton, Menu, PromptDialog } from "../../components/ui";
import type { Conversation } from "../../gen/v1/conversations_pb";
import { isGroup, useChat } from "../../stores/chat";
import { useConnection } from "../../stores/connection";
import { useUi } from "../../stores/ui";
import { useNameFor } from "../session/useRealtime";
import { otherMember } from "../sidebar/conversation";

const MAX_GROUP = 5;

export function ChatHeader({ conversation: c }: { conversation: Conversation }) {
  const { ws, user: me } = useConnection();
  const { addMember, renameGroup, leaveGroup } = useChat();
  const { membersOpen, toggleMembers } = useUi();
  const nameFor = useNameFor();
  const [dialog, setDialog] = useState<"rename" | "add" | "leave" | null>(null);
  const group = isGroup(c);
  const other = otherMember(c, me?.id);
  const close = () => setDialog(null);

  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b border-surface-0 px-4 shadow-sm">
      {group ? (
        <Hash size={22} className="shrink-0 text-fg-subtle" />
      ) : (
        <AtSign size={22} className="shrink-0 text-fg-subtle" />
      )}
      <h1 className="truncate font-semibold text-fg">{group ? c.name : nameFor(other?.id)}</h1>
      {!group && other && (
        <span className="ml-1 hidden sm:inline-flex">
          <AvatarWithStatus userId={other.id} size="xs" />
        </span>
      )}
      {group && (
        <span className="hidden truncate border-l border-line pl-3 text-sm text-fg-subtle sm:block">
          {c.members.length} of {MAX_GROUP} members
        </span>
      )}

      <div className="ml-auto flex items-center gap-1">
        <CallBar ws={ws} conversationId={c.id} />
        {group && (
          <>
            <IconButton
              label={membersOpen ? "Hide member list" : "Show member list"}
              icon={<Users size={20} />}
              active={membersOpen}
              onClick={toggleMembers}
              className="hidden lg:inline-flex"
            />
            <Menu
              trigger={({ open, toggle }) => (
                <IconButton
                  label="Group settings"
                  icon={<MoreVertical size={20} />}
                  active={open}
                  aria-expanded={open}
                  onClick={toggle}
                />
              )}
              items={[
                ...(c.members.length < MAX_GROUP
                  ? [
                      {
                        label: "Add member",
                        icon: <UserPlus size={16} />,
                        onSelect: () => setDialog("add"),
                      },
                    ]
                  : []),
                {
                  label: "Rename group",
                  icon: <Pencil size={16} />,
                  onSelect: () => setDialog("rename"),
                },
                {
                  label: "Leave group",
                  icon: <LogOut size={16} />,
                  danger: true,
                  onSelect: () => setDialog("leave"),
                },
              ]}
            />
          </>
        )}
      </div>

      {dialog === "rename" && (
        <PromptDialog
          open
          title="Rename group"
          label="Group name"
          initial={c.name}
          submitLabel="Save"
          onSubmit={(name) => ws && void renameGroup(ws, name)}
          onClose={close}
        />
      )}
      {dialog === "add" && (
        <PromptDialog
          open
          title="Add member"
          label="Username"
          placeholder="username"
          submitLabel="Add"
          onSubmit={(username) => ws && void addMember(ws, username)}
          onClose={close}
        />
      )}
      <ConfirmDialog
        open={dialog === "leave"}
        title={`Leave ${c.name}`}
        confirmLabel="Leave group"
        danger
        onConfirm={() => ws && void leaveGroup(ws)}
        onClose={close}
      >
        You won't get messages from this group anymore unless someone adds you back.
      </ConfirmDialog>
    </header>
  );
}
