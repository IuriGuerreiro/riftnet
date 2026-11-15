import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

export function Placeholder({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <View style={styles.root}>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.note}>Placeholder screen</Text>
      {children}
    </View>
  );
}

export const styles = StyleSheet.create({
  root: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 16 },
  title: { fontSize: 22, fontWeight: '600' },
  note: { color: '#888' },
});
