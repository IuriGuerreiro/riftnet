import { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { CallState, useCalls } from '@shared/stores/calls';
import { useChat } from '@shared/stores/chat';
import { useConnection } from '@shared/stores/connection';
import type { RootStackParamList } from '../navigation/types';
import { conversationTitle, usernameOf } from '../session/names';
import { Button, ErrorText, Muted } from '../ui/components';
import { colors } from '../ui/theme';

type Props = NativeStackScreenProps<RootStackParamList, 'Call'>;

// The call this device is in (1-on-1 or group). Audio goes to our SFU;
// signaling is the shared calls store. Closes itself when the call ends.
export function CallScreen({ navigation }: Props) {
  const { current, joined, muted, error, toggleMute, leave } = useCalls();
  const ws = useConnection(s => s.ws);
  const me = useConnection(s => s.user);
  const conversation = useChat(s => s.conversations.find(c => c.id === current?.conversationId));

  // Call over (hung up, ended remotely, failed): close after showing any error.
  useEffect(() => {
    if (current) return;
    const t = setTimeout(() => navigation.canGoBack() && navigation.goBack(), error ? 2500 : 0);
    return () => clearTimeout(t);
  }, [current, error, navigation]);

  const status = !current
    ? 'Call ended'
    : current.state === CallState.RINGING
      ? 'Ringing…'
      : joined
        ? 'Connected'
        : 'Connecting…';
  const others = (current?.participantIds ?? []).filter(id => id !== me?.id);

  return (
    <View style={styles.root}>
      <View style={styles.top}>
        <Text style={styles.title}>{conversation ? conversationTitle(conversation, me?.id) : 'Call'}</Text>
        <Text style={[styles.status, joined && { color: colors.ok }]}>{status}</Text>
        {others.length > 0 ? <Muted>In call: {others.map(usernameOf).join(', ')}</Muted> : null}
        <ErrorText error={error} />
      </View>
      <View style={styles.controls}>
        <Button kind="secondary" title={muted ? 'Unmute' : 'Mute'} onPress={toggleMute} disabled={!current} />
        <Button
          kind="danger"
          title="Hang up"
          onPress={() => {
            if (ws) void leave(ws);
            else navigation.goBack();
          }}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg, padding: 24, justifyContent: 'space-between' },
  top: { marginTop: 80, alignItems: 'center', gap: 8 },
  title: { color: colors.text, fontSize: 28, fontWeight: '700' },
  status: { color: colors.muted, fontSize: 16 },
  controls: { gap: 12, marginBottom: 40 },
});
