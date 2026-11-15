import { useNavigation } from '@react-navigation/native';
import { Button } from 'react-native';
import { Placeholder } from './Placeholder';

export function DmsScreen() {
  const nav = useNavigation();
  return (
    <Placeholder title="Direct messages">
      <Button title="Open a fake DM" onPress={() => nav.navigate('Chat', { conversationId: 'demo', title: 'Demo DM' })} />
    </Placeholder>
  );
}
