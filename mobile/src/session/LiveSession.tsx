import { useEffect } from 'react';
import { AppState } from 'react-native';
import { useAuth } from '@shared/stores/auth';
import { useCalls } from '@shared/stores/calls';
import { useChat } from '@shared/stores/chat';
import { useConnection } from '@shared/stores/connection';
import { useFriends } from '@shared/stores/friends';
import { logout } from './actions';

// Mounted while logged in. Owns the WebSocket (same flow as desktop's home page):
// connect, and on every (re)connect attach the shared stores so they reload
// and catch up on what was missed.
export function LiveSession() {
  const ws = useConnection(s => s.ws);
  const me = useConnection(s => s.user);
  const unauthorized = useConnection(s => s.error === 'unauthorized');

  useEffect(() => {
    const { connect, disconnect } = useConnection.getState();
    void connect();
    // Back from the background: the OS may have killed the socket; reconnect now.
    const sub = AppState.addEventListener('change', state => {
      if (state === 'active') void useConnection.getState().connect();
    });
    return () => {
      sub.remove();
      disconnect();
    };
  }, []);

  useEffect(() => {
    if (!ws) return;
    if (me) void useChat.getState().attach(ws, me.id);
    useCalls.getState().attach(ws, me?.id); // after chat: it chains onto chat's push handler
    void useFriends.getState().attach(ws);
  }, [ws, me]);

  // Server rejected our token for good, or the refresh failed: back to login.
  const loggedOut = useAuth(s => !s.refreshToken);
  useEffect(() => {
    if (unauthorized && !loggedOut) void logout();
  }, [unauthorized, loggedOut]);

  return null;
}
