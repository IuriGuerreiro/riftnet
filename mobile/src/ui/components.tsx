import type { ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';
import { colors } from './theme';

export function Screen({ children, style }: { children?: ReactNode; style?: ViewStyle }) {
  return <View style={[styles.screen, style]}>{children}</View>;
}

type Kind = 'primary' | 'secondary' | 'danger';

export function Button({
  title,
  onPress,
  disabled,
  busy,
  kind = 'primary',
  small,
}: {
  title: string;
  onPress: () => void;
  disabled?: boolean;
  busy?: boolean;
  kind?: Kind;
  small?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={disabled || busy}
      style={({ pressed }) => [
        styles.button,
        styles[kind],
        small && styles.small,
        (disabled || busy) && styles.disabled,
        pressed && styles.pressed,
      ]}
    >
      {busy ? (
        <ActivityIndicator color={colors.text} />
      ) : (
        <Text style={[styles.buttonText, kind === 'primary' && styles.primaryText]}>{title}</Text>
      )}
    </Pressable>
  );
}

export function Input({ error, ...props }: TextInputProps & { error?: string }) {
  return (
    <View style={styles.field}>
      <TextInput placeholderTextColor={colors.muted} {...props} style={[styles.input, props.style]} />
      {error ? <ErrorText error={error} /> : null}
    </View>
  );
}

export function ErrorText({ error }: { error: unknown }) {
  if (!error) return null;
  const message = error instanceof Error ? error.message : String(error);
  return <Text style={styles.error}>{message}</Text>;
}

export function Muted({ children }: { children: ReactNode }) {
  return <Text style={styles.muted}>{children}</Text>;
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return <Text style={styles.section}>{children}</Text>;
}

export const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg, padding: 16, gap: 12 },
  button: {
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  small: { paddingVertical: 6, paddingHorizontal: 10 },
  primary: { backgroundColor: colors.brand },
  secondary: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  danger: { backgroundColor: '#7f1d1d' },
  disabled: { opacity: 0.5 },
  pressed: { opacity: 0.8 },
  buttonText: { color: colors.text, fontWeight: '600' },
  primaryText: { color: colors.bg },
  field: { gap: 4 },
  input: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    color: colors.text,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  error: { color: colors.danger, fontSize: 13 },
  muted: { color: colors.muted, fontSize: 13 },
  section: { color: colors.muted, fontSize: 12, fontWeight: '700', textTransform: 'uppercase', marginTop: 8 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  rowText: { color: colors.text, fontSize: 16, flex: 1 },
  h1: { color: colors.text, fontSize: 26, fontWeight: '700' },
});
