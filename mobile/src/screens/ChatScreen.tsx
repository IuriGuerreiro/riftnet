import { useEffect, useLayoutEffect, useState } from 'react';
import { FlatList, KeyboardAvoidingView, Platform, StyleSheet, Text, TextInput, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCalls } from '@shared/stores/calls';
import { useChat, type ChatMessage } from '@shared/stores/chat';
import { useConnection } from '@shared/stores/connection';
import type { RootStackParamList } from '../navigation/types';
import { isGroup, usernameOf } from '../session/names';
import { Button, ErrorText } from '../ui/components';
import { colors } from '../ui/theme';

type Props = NativeStackScreenProps<RootStackParamList, 'Chat'>;

const EMPTY: ChatMessage[] = [];

// One DM or group. History comes from the shared chat store (get_history on
// first open, then sync + live pushes). No "seen" indicators, by design.
export function ChatScreen({ route, navigation }: Props) {
  const conversationId = BigInt(route.params.conversationId);
  const ws = useConnection(s => s.ws);
  const me = useConnection(s => s.user);
  const messages = useChat(s => s.messages[conversationId.toString()] ?? EMPTY);
  const conversation = useChat(s => s.conversations.find(c => c.id === conversationId));
  const error = useChat(s => s.error);
  const [text, setText] = useState('');
  const group = conversation ? isGroup(conversation) : false;

  // Open (and on reconnect, re-sync) this conversation.
  useEffect(() => {
    if (ws) void useChat.getState().select(ws, conversationId).catch(() => {});
  }, [ws, conversationId]);

  // Left the group (here or on another device): close the chat.
  const removed = useChat(s => s.conversations.length > 0 && !s.conversations.some(c => c.id === conversationId));
  useEffect(() => {
    if (removed) navigation.goBack();
  }, [removed, navigation]);

  useLayoutEffect(() => {
    navigation.setOptions({
      title: group && conversation ? `# ${conversation.name}` : route.params.title,
      headerRight: () => (
        <View style={styles.header}>
          <Button
            small
            title="Call"
            disabled={!ws}
            onPress={() => {
              if (!ws) return;
              void useCalls.getState().call(ws, conversationId);
              navigation.navigate('Call');
            }}
          />
          {group ? (
            <Button small kind="secondary" title="Group" onPress={() => navigation.navigate('Group', { conversationId: route.params.conversationId })} />
          ) : null}
        </View>
      ),
    });
  }, [navigation, ws, conversationId, group, conversation, route.params]);

  function send() {
    if (!ws || !me || !text.trim()) return;
    // send() uses the selected conversation; make sure it's this one.
    useChat.setState({ selected: conversationId });
    void useChat.getState().send(ws, me.id, text.trim());
    setText('');
  }

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={90}
    >
      <FlatList
        inverted
        data={[...messages].reverse()}
        keyExtractor={m => (m.id !== 0n ? m.id.toString() : `n:${m.nonce}`)}
        renderItem={({ item }) => <Bubble message={item} mine={item.authorId === me?.id} showAuthor={group} />}
        contentContainerStyle={styles.list}
      />
      <ErrorText error={error} />
      <View style={styles.composer}>
        <TextInput
          style={styles.input}
          placeholder="Message"
          placeholderTextColor={colors.muted}
          value={text}
          onChangeText={setText}
          onSubmitEditing={send}
          multiline
        />
        <Button small title="Send" onPress={send} disabled={!ws || !text.trim()} />
      </View>
    </KeyboardAvoidingView>
  );
}

function Bubble({ message, mine, showAuthor }: { message: ChatMessage; mine: boolean; showAuthor: boolean }) {
  return (
    <View style={[styles.bubble, mine ? styles.mine : styles.theirs, message.pending && styles.pending]}>
      {showAuthor && !mine ? <Text style={styles.author}>{usernameOf(message.authorId)}</Text> : null}
      <Text style={styles.text}>{message.text}</Text>
      {message.failed ? <Text style={styles.failed}>Not sent</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: 'row', gap: 6 },
  list: { padding: 12, gap: 6 },
  bubble: { maxWidth: '80%', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8 },
  mine: { alignSelf: 'flex-end', backgroundColor: '#4c1d95' },
  theirs: { alignSelf: 'flex-start', backgroundColor: colors.surface },
  pending: { opacity: 0.6 },
  author: { color: colors.brand, fontSize: 12, fontWeight: '700', marginBottom: 2 },
  text: { color: colors.text, fontSize: 15 },
  failed: { color: colors.danger, fontSize: 11, marginTop: 2 },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    padding: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  input: {
    flex: 1,
    maxHeight: 120,
    color: colors.text,
    backgroundColor: colors.surface,
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
});
