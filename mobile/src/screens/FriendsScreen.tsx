import { useEffect, useState } from 'react';
import { SectionList, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { http } from '@shared/api/http';
import type { Friend, User } from '@shared/api/types';
import { useChat } from '@shared/stores/chat';
import { useConnection } from '@shared/stores/connection';
import { useFriends } from '@shared/stores/friends';
import { Button, ErrorText, Input, Muted, Screen, SectionTitle, styles as ui } from '../ui/components';
import { colors } from '../ui/theme';

// Friends, requests I got / sent, and user search to add someone.
// Actions go over HTTP; the socket pushes `friendUpdated` so lists update live.
export function FriendsScreen() {
  const { list, error, sendRequest, accept, deleteRequest, removeFriend } = useFriends();
  const navigation = useNavigation();
  const ws = useConnection(s => s.ws);

  async function message(username: string | null) {
    if (!ws || !username) return;
    await useChat.getState().openDm(ws, username);
    const id = useChat.getState().selected;
    if (id) navigation.navigate('Chat', { conversationId: id.toString(), title: `@${username}` });
  }

  const sections = [
    { title: `Requests · ${list.incoming.length}`, key: 'incoming', data: list.incoming },
    { title: `Sent · ${list.outgoing.length}`, key: 'outgoing', data: list.outgoing },
    { title: `Friends · ${list.friends.length}`, key: 'friends', data: list.friends },
  ].filter(s => s.data.length > 0 || s.key === 'friends');

  return (
    <Screen>
      <UserSearch onAdd={sendRequest} />
      <ErrorText error={error} />
      <SectionList
        sections={sections}
        keyExtractor={f => f.user.id}
        renderSectionHeader={({ section }) => <SectionTitle>{section.title}</SectionTitle>}
        renderItem={({ item }) => (
          <FriendRow
            friend={item}
            onAccept={() => accept(item.user.id)}
            onDelete={() => deleteRequest(item.user.id)}
            onRemove={() => removeFriend(item.user.id)}
            onMessage={() => message(item.user.username)}
          />
        )}
        ListEmptyComponent={<Muted>No friends yet. Search for someone above.</Muted>}
        stickySectionHeadersEnabled={false}
      />
    </Screen>
  );
}

function FriendRow(props: {
  friend: Friend;
  onAccept: () => void;
  onDelete: () => void;
  onRemove: () => void;
  onMessage: () => void;
}) {
  const { friend } = props;
  const name = friend.user.username ?? friend.user.display_name ?? '?';
  return (
    <View style={ui.row}>
      <Text style={ui.rowText}>@{name}</Text>
      {friend.state === 'incoming' && (
        <>
          <Button small title="Accept" onPress={props.onAccept} />
          <Button small kind="secondary" title="Decline" onPress={props.onDelete} />
        </>
      )}
      {friend.state === 'outgoing' && <Button small kind="secondary" title="Cancel" onPress={props.onDelete} />}
      {friend.state === 'friend' && (
        <>
          <Button small title="Message" onPress={props.onMessage} />
          <Button small kind="secondary" title="Remove" onPress={props.onRemove} />
        </>
      )}
    </View>
  );
}

// Type a username prefix → GET /users/search → tap "Add" to send a request.
function UserSearch({ onAdd }: { onAdd: (username: string) => Promise<boolean> }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<User[]>([]);
  const [sent, setSent] = useState<string | null>(null);

  useEffect(() => {
    const query = q.trim().toLowerCase();
    if (query.length < 2) {
      setResults([]);
      return;
    }
    let cancelled = false;
    // Small debounce: the api rate limits search.
    const t = setTimeout(async () => {
      try {
        const found = await http<User[]>(`/users/search?q=${encodeURIComponent(query)}&limit=8`);
        if (!cancelled) setResults(found);
      } catch {
        if (!cancelled) setResults([]);
      }
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [q]);

  async function add(username: string) {
    if (await onAdd(username)) {
      setSent(username);
      setQ('');
    }
  }

  return (
    <View style={styles.search}>
      <Input placeholder="Add friend by username" autoCapitalize="none" autoCorrect={false} value={q} onChangeText={setQ} />
      {results.map(u => (
        <View key={u.id} style={ui.row}>
          <Text style={ui.rowText}>@{u.username}</Text>
          {u.username ? <Button small title="Add" onPress={() => add(u.username!)} /> : null}
        </View>
      ))}
      {sent ? <Text style={styles.sent}>Request sent to @{sent}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  search: { gap: 4 },
  sent: { color: colors.ok, fontSize: 13 },
});
