import { useState } from 'react';
import { StyleSheet, Text } from 'react-native';
import { usernameSchema } from '@shared/schemas/auth';
import { logout, setUsername } from '../session/actions';
import { Button, ErrorText, Input, Muted, Screen, styles as ui } from '../ui/components';

// First login: pick a unique username (PUT /me/username).
export function UsernameScreen() {
  const [value, setValue] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    const parsed = usernameSchema.safeParse({ username: value });
    if (!parsed.success) return setError(parsed.error.issues[0]?.message);
    setError(null);
    setBusy(true);
    try {
      await setUsername(parsed.data.username); // navigation switches on the auth store
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  }

  return (
    <Screen style={styles.center}>
      <Text style={ui.h1}>Pick your username</Text>
      <Muted>3–32 characters: letters, numbers, _ and .</Muted>
      <Input placeholder="username" autoCapitalize="none" autoCorrect={false} value={value} onChangeText={setValue} onSubmitEditing={submit} />
      <ErrorText error={error} />
      <Button title="Continue" onPress={submit} busy={busy} />
      <Button title="Log out" kind="secondary" onPress={() => void logout()} />
    </Screen>
  );
}

const styles = StyleSheet.create({ center: { justifyContent: 'center' } });
