import { useNavigate } from "@tanstack/react-router";

import { useLogout } from "../../api/auth";
import { useChat } from "../../stores/chat";
import { useConnection } from "../../stores/connection";
import { FriendsPanel } from "../friends/FriendsPanel";
import { ConversationList } from "./ConversationList";
import { NewDm } from "./NewDm";
import { NewGroup } from "./NewGroup";
import { UserHeader } from "./UserHeader";

export function Sidebar({ onEditProfile }: { onEditProfile: () => void }) {
  const logout = useLogout();
  const navigate = useNavigate();
  const { ws, disconnect } = useConnection();
  const { openDm, createGroup } = useChat();

  return (
    <aside className="flex w-64 shrink-0 flex-col border-r border-zinc-800">
      <UserHeader onEditProfile={onEditProfile} />
      <NewDm disabled={!ws} onOpen={(username) => ws && openDm(ws, username)} />
      <NewGroup
        disabled={!ws}
        onCreate={(name, usernames) => ws && createGroup(ws, name, usernames)}
      />
      <FriendsPanel onDm={(username) => ws && openDm(ws, username)} />
      <ConversationList />
      <button
        className="border-t border-zinc-800 p-3 text-sm text-zinc-400 hover:text-zinc-100"
        onClick={() => {
          disconnect();
          logout.mutate(undefined, { onSettled: () => void navigate({ to: "/login" }) });
        }}
      >
        Log out
      </button>
    </aside>
  );
}
