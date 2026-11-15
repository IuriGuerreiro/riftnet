import { Button } from 'react-native';
import { useSession } from '../stores/session';
import { Placeholder } from './Placeholder';

export function FriendsScreen() {
  const setLoggedIn = useSession(s => s.setLoggedIn);
  return (
    <Placeholder title="Friends">
      <Button title="Log out" onPress={() => setLoggedIn(false)} />
    </Placeholder>
  );
}
