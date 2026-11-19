import { useSearch } from "@tanstack/react-router";
import { useState } from "react";

import { IncomingCall, RemoteScreen } from "../call/CallBar";
import { ProfilePanel } from "../components/ProfilePanel";
import { ServerPanel } from "../components/Servers";
import { ChatPane } from "../features/chat/ChatPane";
import { useKnownUsers, useNameFor, useRealtime } from "../features/session/useRealtime";
import { Sidebar } from "../features/sidebar/Sidebar";
import { readWorkspaceSearch } from "../schemas/workspace";
import { useConnection } from "../stores/connection";

export function HomePage() {
  const { server, invite } = useSearch({ from: "__root__", select: readWorkspaceSearch });
  useRealtime();
  useKnownUsers();
  const { ws, user: me } = useConnection();
  const nameFor = useNameFor();
  const [editingProfile, setEditingProfile] = useState(false);

  return (
    <div className="flex h-full w-full max-w-5xl overflow-hidden rounded-xl bg-zinc-900 shadow-lg">
      <RemoteScreen />
      <IncomingCall ws={ws} callerName={(id) => nameFor(id)} />
      {editingProfile && me && (
        <ProfilePanel myId={me.id.toString()} onClose={() => setEditingProfile(false)} />
      )}
      <Sidebar onEditProfile={() => setEditingProfile(true)} />
      {(server ?? invite) ? <ServerPanel /> : <ChatPane />}
    </div>
  );
}
