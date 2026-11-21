import { useSearch } from "@tanstack/react-router";
import { useState } from "react";

import { AudioSettings } from "../call/AudioSettings";
import { IncomingCall, RemoteScreen } from "../call/CallBar";
import { ControlBanner } from "../call/SharePlay";
import { ProfilePanel } from "../components/ProfilePanel";
import { useFriendActivityWatch } from "../features/activity/activity";
import { ChatPane } from "../features/chat/ChatPane";
import { FriendsPage } from "../features/friends/FriendsPage";
import { ServerPanel } from "../features/servers/ServerView";
import { useKnownUsers, useNameFor, useRealtime } from "../features/session/useRealtime";
import {
  type NewConversation,
  NewConversationDialog,
} from "../features/sidebar/NewConversationDialogs";
import { ServerRail } from "../features/sidebar/ServerRail";
import { Sidebar } from "../features/sidebar/Sidebar";
import { readWorkspaceSearch } from "../schemas/workspace";
import { useConnection } from "../stores/connection";
import { useUi } from "../stores/ui";

export function HomePage() {
  const { server, invite } = useSearch({ from: "__root__", select: readWorkspaceSearch });
  useRealtime();
  useKnownUsers();
  useFriendActivityWatch();
  const { ws, user: me } = useConnection();
  const view = useUi((s) => s.view);
  const nameFor = useNameFor();
  const [editingProfile, setEditingProfile] = useState(false);
  const [editingAudio, setEditingAudio] = useState(false);
  const [creating, setCreating] = useState<NewConversation | null>(null);

  return (
    <div className="flex h-full w-full overflow-hidden bg-surface-0 text-fg">
      <RemoteScreen ws={ws} nameFor={(id) => nameFor(id)} />
      <IncomingCall ws={ws} callerName={(id) => nameFor(id)} />
      <ControlBanner ws={ws} nameFor={(id) => nameFor(id)} />
      {editingProfile && me && (
        <ProfilePanel
          myId={me.id.toString()}
          onClose={() => setEditingProfile(false)}
          onAudio={() => {
            setEditingProfile(false);
            setEditingAudio(true);
          }}
        />
      )}
      {editingAudio && <AudioSettings onClose={() => setEditingAudio(false)} />}
      {creating && <NewConversationDialog kind={creating} onClose={() => setCreating(null)} />}
      <ServerRail onCreateGroup={() => setCreating("group")} />
      <Sidebar onEditProfile={() => setEditingProfile(true)} onNew={setCreating} />
      {(server ?? invite) ? <ServerPanel /> : view === "friends" ? <FriendsPage /> : <ChatPane />}
    </div>
  );
}
