import { Button } from 'react-native';
import { credentialsSchema } from '@shared/schemas/auth';
import { config } from '../config';
import { core } from '../core';
import { useSession } from '../stores/session';
import { Placeholder } from './Placeholder';

export function LoginScreen() {
  const setLoggedIn = useSession(s => s.setLoggedIn);
  // Shared Zod schema from client/ — proves the shared import works. Real form next PR.
  const fieldCount = Object.keys(credentialsSchema.shape).length;
  return (
    <Placeholder title={`Login (${fieldCount} fields)`}>
      <Placeholder title={`API ${config.httpUrl} · core ${core.version()}`} />
      <Button title="Continue (fake login)" onPress={() => setLoggedIn(true)} />
    </Placeholder>
  );
}
