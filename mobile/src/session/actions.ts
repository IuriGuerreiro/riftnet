import { http } from '@shared/api/http';
import type { Credentials } from '@shared/schemas/auth';
import type { Session, User } from '@shared/api/types';
import { platform } from '@shared/platform/current';
import { useAuth } from '@shared/stores/auth';
import { useCalls } from '@shared/stores/calls';
import { useChat } from '@shared/stores/chat';
import { useConnection } from '@shared/stores/connection';
import { useFriends } from '@shared/stores/friends';

// Same HTTP calls as client/src/api/auth.ts, without react-query.
const device = () => ({ name: platform.deviceName, platform: platform.kind });

export async function login(mode: 'login' | 'register', c: Credentials) {
  const s = await http<Session>(`/auth/${mode}`, { method: 'POST', auth: false, body: { ...c, device: device() } });
  useAuth.getState().setSession(s);
  return s;
}

export async function setUsername(username: string) {
  const me = await http<User>('/me/username', { method: 'PUT', body: { username } });
  useAuth.getState().setUser(me);
  return me;
}

// Revoke this device, then forget everything from this account.
export async function logout() {
  const ws = useConnection.getState().ws;
  const call = useCalls.getState();
  if (ws && call.current) await call.leave(ws).catch(() => {});
  await http<void>('/auth/logout', { method: 'POST' }).catch(() => {});
  useConnection.getState().disconnect();
  useChat.setState({ conversations: [], messages: {}, lastSeq: {}, selected: null, error: null });
  useFriends.setState({ list: { friends: [], incoming: [], outgoing: [] }, error: null });
  useAuth.getState().clear();
}
