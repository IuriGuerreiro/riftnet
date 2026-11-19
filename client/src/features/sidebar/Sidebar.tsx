import { useNavigate, useSearch } from "@tanstack/react-router";

import { useLogout } from "../../api/auth";
import { ServerNavigation } from "../../components/Servers";
import { readWorkspaceSearch } from "../../schemas/workspace";
import { useChat } from "../../stores/chat";
import { useConnection } from "../../stores/connection";
import { FriendsPanel } from "../friends/FriendsPanel";
import { ConversationList } from "./ConversationList";
import { NewDm } from "./NewDm";
import { NewGroup } from "./NewGroup";
import { UserHeader } from "./UserHeader";

export function Sidebar({ onEditProfile }: { onEditProfile: () => void }) {
  const { server, invite } = useSearch({ from: "__root__", select: readWorkspaceSearch });
  const logout = useLogout();
  const navigate = useNavigate();
  const { ws, disconnect } = useConnection();
  const { openDm, createGroup } = useChat();

  return (
    <aside className="flex w-64 shrink-0 flex-col border-r border-zinc-800">
      <UserHeader onEditProfile={onEditProfile} />
      <ServerNavigation />
      <div className={(server ?? invite) ? "hidden" : "flex min-h-0 flex-1 flex-col"}>
        <NewDm disabled={!ws} onOpen={(username) => ws && openDm(ws, username)} />
        <NewGroup
          disabled={!ws}
          onCreate={(name, usernames) => ws && createGroup(ws, name, usernames)}
        />
        <FriendsPanel onDm={(username) => ws && openDm(ws, username)} />
        <ConversationList />
      </div>
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
