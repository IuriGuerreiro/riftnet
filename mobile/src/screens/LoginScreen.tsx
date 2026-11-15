import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text } from 'react-native';
import { credentialsSchema } from '@shared/schemas/auth';
import { login } from '../session/actions';
import { Button, ErrorText, Input, Screen, styles as ui } from '../ui/components';
import { colors } from '../ui/theme';

// Email + password, sent to our api (which checks them with Zitadel).
// Same rules as desktop: the shared Zod schema validates before sending.
export function LoginScreen() {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<{ email?: string; password?: string }>({});
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    const parsed = credentialsSchema.safeParse({ email, password });
    if (!parsed.success) {
      const first = (field: string) => parsed.error.issues.find(i => i.path[0] === field)?.message;
      setFieldErrors({ email: first('email'), password: first('password') });
      return;
    }
    setFieldErrors({});
    setError(null);
    setBusy(true);
    try {
      await login(mode, parsed.data); // navigation switches on the auth store
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Screen style={styles.center}>
        <Text style={ui.h1}>{mode === 'login' ? 'Welcome back 🐒' : 'Create account'}</Text>
        <Input
          placeholder="Email"
          autoCapitalize="none"
          autoComplete="email"
          keyboardType="email-address"
          textContentType="emailAddress"
          value={email}
          onChangeText={setEmail}
          error={fieldErrors.email}
        />
        <Input
          placeholder="Password"
          secureTextEntry
          autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
          textContentType={mode === 'login' ? 'password' : 'newPassword'}
          value={password}
          onChangeText={setPassword}
          onSubmitEditing={submit}
          error={fieldErrors.password}
        />
        <ErrorText error={error} />
        <Button title={mode === 'login' ? 'Log in' : 'Register'} onPress={submit} busy={busy} />
        <Pressable onPress={() => setMode(mode === 'login' ? 'register' : 'login')}>
          <Text style={styles.switch}>{mode === 'login' ? 'No account? Register' : 'Have an account? Log in'}</Text>
        </Pressable>
      </Screen>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  center: { justifyContent: 'center' },
  switch: { color: colors.muted, textAlign: 'center', padding: 8 },
});
