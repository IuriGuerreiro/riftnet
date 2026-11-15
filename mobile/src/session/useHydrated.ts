import { useEffect, useState } from 'react';
import { useAuth } from '@shared/stores/auth';

// The keychain is async: wait until the saved tokens are loaded before
// choosing between the login and home screens.
export function useAuthHydrated() {
  const [done, setDone] = useState(useAuth.persist.hasHydrated());
  useEffect(() => {
    const stop = useAuth.persist.onFinishHydration(() => setDone(true));
    setDone(useAuth.persist.hasHydrated());
    return stop;
  }, []);
  return done;
}
