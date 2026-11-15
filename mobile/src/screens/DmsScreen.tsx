import { useLayoutEffect } from 'react';
import { FlatList, Pressable, Text } from 'react-native';
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import type { CompositeScreenProps } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useChat } from '@shared/stores/chat';
import { useConnection } from '@shared/stores/connection';
import type { RootStackParamList, TabsParamList } from '../navigation/types';
import { conversationTitle, isGroup } from '../session/names';
import { Button, ErrorText, Muted, Screen, styles as ui } from '../ui/components';

type Props = CompositeScreenProps<
  BottomTabScreenProps<TabsParamList, 'DMs'>,
  NativeStackScreenProps<RootStackParamList>
>;

// DMs and group DMs, newest activity first (the server orders them).
export function DmsScreen({ navigation }: Props) {
  const conversations = useChat(s => s.conversations);
  const error = useChat(s => s.error);
  const me = useConnection(s => s.user);

  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => <Button small kind="secondary" title="New group" onPress={() => navigation.navigate('NewGroup')} />,
    });
  }, [navigation]);

  return (
    <Screen>
      <ErrorText error={error} />
      <FlatList
        data={conversations}
        keyExtractor={c => c.id.toString()}
        renderItem={({ item }) => {
          const title = conversationTitle(item, me?.id);
          return (
            <Pressable
              style={ui.row}
              onPress={() => navigation.navigate('Chat', { conversationId: item.id.toString(), title })}
            >
              <Text style={ui.rowText}>{isGroup(item) ? `# ${title}` : title}</Text>
              {isGroup(item) ? <Muted>{item.members.length} members</Muted> : null}
            </Pressable>
          );
        }}
        ListEmptyComponent={<Muted>No conversations yet. Message a friend to start one.</Muted>}
      />
    </Screen>
  );
}
