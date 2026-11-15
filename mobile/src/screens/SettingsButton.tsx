import { Alert, Pressable, StyleSheet, Text } from 'react-native';
import { useConnection } from '@shared/stores/connection';
import { logout } from '../session/actions';
import { colors } from '../ui/theme';

const dot = { online: colors.ok, connecting: colors.warn, offline: colors.danger };

// Header-left: who I am + connection dot. Tap → log out.
export function SettingsButton() {
  const status = useConnection(s => s.status);
  const me = useConnection(s => s.user);
  return (
    <Pressable
      style={styles.root}
      onPress={() =>
        Alert.alert(`@${me?.username ?? '…'}`, `Connection: ${status}`, [
          { text: 'Close', style: 'cancel' },
          { text: 'Log out', style: 'destructive', onPress: () => void logout() },
        ])
      }
    >
      <Text style={[styles.dot, { color: dot[status] }]}>●</Text>
      <Text style={styles.name}>{me?.username ?? '…'}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 12 },
  dot: { fontSize: 10 },
  name: { color: colors.text, fontWeight: '600' },
});
