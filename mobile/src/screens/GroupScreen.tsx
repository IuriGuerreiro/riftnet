import { useState } from 'react';
import { Alert, ScrollView, Text } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useChat } from '@shared/stores/chat';
import { useConnection } from '@shared/stores/connection';
import type { RootStackParamList } from '../navigation/types';
import { Button, ErrorText, Input, Screen, SectionTitle, styles as ui } from '../ui/components';

type Props = NativeStackScreenProps<RootStackParamList, 'Group'>;

// Group settings: members, rename, add someone, leave.
export function GroupScreen({ route, navigation }: Props) {
  const conversationId = BigInt(route.params.conversationId);
  const ws = useConnection(s => s.ws);
  const group = useChat(s => s.conversations.find(c => c.id === conversationId));
  const error = useChat(s => s.error);
  const [name, setName] = useState(group?.name ?? '');
  const [username, setUsername] = useState('');

  // The store's group actions work on the selected conversation.
  const selectThis = () => useChat.setState({ selected: conversationId });

  if (!group || !ws) return <Screen />;

  function leave() {
    Alert.alert('Leave group?', `You'll stop getting messages from ${group!.name}.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Leave',
        style: 'destructive',
        onPress: async () => {
          selectThis();
          await useChat.getState().leaveGroup(ws!);
          navigation.popToTop();
        },
      },
    ]);
  }

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ gap: 12 }}>
        <SectionTitle>Name</SectionTitle>
        <Input value={name} onChangeText={setName} />
        <Button
          small
          kind="secondary"
          title="Rename"
          disabled={!name.trim() || name.trim() === group.name}
          onPress={() => {
            selectThis();
            void useChat.getState().renameGroup(ws, name.trim());
          }}
        />
        <SectionTitle>Members · {group.members.length}</SectionTitle>
        {group.members.map(m => (
          <Text key={m.id.toString()} style={[ui.rowText, ui.row]}>
            @{m.username}
          </Text>
        ))}
        <Input placeholder="Add by username" autoCapitalize="none" autoCorrect={false} value={username} onChangeText={setUsername} />
        <Button
          small
          title="Add member"
          disabled={!username.trim()}
          onPress={async () => {
            selectThis();
            await useChat.getState().addMember(ws, username.trim().toLowerCase());
            setUsername('');
          }}
        />
        <ErrorText error={error} />
        <Button kind="danger" title="Leave group" onPress={leave} />
      </ScrollView>
    </Screen>
  );
}
