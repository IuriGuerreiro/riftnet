import { useState } from 'react';
import { Pressable, ScrollView, Text } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useChat } from '@shared/stores/chat';
import { useConnection } from '@shared/stores/connection';
import { useFriends } from '@shared/stores/friends';
import type { RootStackParamList } from '../navigation/types';
import { Button, ErrorText, Input, Muted, Screen, SectionTitle, styles as ui } from '../ui/components';
import { colors } from '../ui/theme';

type Props = NativeStackScreenProps<RootStackParamList, 'NewGroup'>;

// Name + pick friends → create_group, then open it.
export function NewGroupScreen({ navigation }: Props) {
  const ws = useConnection(s => s.ws);
  const friends = useFriends(s => s.list.friends);
  const error = useChat(s => s.error);
  const [name, setName] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const toggle = (u: string) => setPicked(p => (p.includes(u) ? p.filter(x => x !== u) : [...p, u]));

  async function create() {
    if (!ws || !name.trim() || picked.length === 0) return;
    setBusy(true);
    await useChat.getState().createGroup(ws, name.trim(), picked);
    setBusy(false);
    const id = useChat.getState().selected;
    const created = useChat.getState().conversations.find(c => c.id === id && c.name === name.trim());
    if (created) navigation.replace('Chat', { conversationId: created.id.toString(), title: `# ${created.name}` });
  }

  return (
    <Screen>
      <Input placeholder="Group name" value={name} onChangeText={setName} />
      <SectionTitle>Add friends</SectionTitle>
      <ScrollView>
        {friends.map(f =>
          f.user.username ? (
            <Pressable key={f.user.id} style={ui.row} onPress={() => toggle(f.user.username!)}>
              <Text style={ui.rowText}>@{f.user.username}</Text>
              <Text style={{ color: picked.includes(f.user.username) ? colors.brand : colors.muted }}>
                {picked.includes(f.user.username) ? '✓ added' : 'add'}
              </Text>
            </Pressable>
          ) : null,
        )}
        {friends.length === 0 ? <Muted>Add some friends first.</Muted> : null}
      </ScrollView>
      <ErrorText error={error} />
      <Button title="Create group" onPress={create} busy={busy} disabled={!ws || !name.trim() || picked.length === 0} />
    </Screen>
  );
}
