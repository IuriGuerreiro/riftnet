import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useCalls } from '@shared/stores/calls';
import { useChat } from '@shared/stores/chat';
import { useConnection } from '@shared/stores/connection';
import { navigationRef } from '../navigation/ref';
import { Button } from '../ui/components';
import { colors } from '../ui/theme';
import { isGroup, usernameOf } from './names';

// Banner on top of any screen while someone calls us (app in foreground).
export function IncomingCall() {
  const incoming = useCalls(s => s.incoming);
  const ws = useConnection(s => s.ws);
  const conversation = useChat(s => s.conversations.find(c => c.id === incoming?.conversationId));
  const insets = useSafeAreaInsets();
  if (!incoming || !ws) return null;

  const who = usernameOf(incoming.callerId);
  const label = conversation && isGroup(conversation) ? `@${who} is calling # ${conversation.name}` : `@${who} is calling`;

  return (
    <View style={[styles.banner, { top: insets.top + 8 }]}>
      <Text style={styles.text}>📞 {label}</Text>
      <View style={styles.row}>
        <Button
          small
          title="Accept"
          onPress={() => {
            void useCalls.getState().accept(ws);
            if (navigationRef.isReady()) navigationRef.navigate('Call');
          }}
        />
        <Button small kind="danger" title="Decline" onPress={() => void useCalls.getState().decline(ws)} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    position: 'absolute',
    left: 12,
    right: 12,
    backgroundColor: colors.surface,
    borderColor: colors.brand,
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    gap: 8,
    elevation: 8,
  },
  text: { color: colors.text, fontSize: 15, fontWeight: '600' },
  row: { flexDirection: 'row', gap: 8 },
});
