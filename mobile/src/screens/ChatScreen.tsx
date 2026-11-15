import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Button } from 'react-native';
import type { Message } from '@shared/gen/v1/messages_pb';
import type { RootStackParamList } from '../navigation/types';
import { Placeholder } from './Placeholder';

type Props = NativeStackScreenProps<RootStackParamList, 'Chat'>;

// Messages will use the generated proto type shared with client/.
const messages: Message[] = [];

export function ChatScreen({ route, navigation }: Props) {
  const { conversationId } = route.params;
  return (
    <Placeholder title={`Chat · ${messages.length} messages`}>
      <Button title="Start call" onPress={() => navigation.navigate('Call', { conversationId })} />
    </Placeholder>
  );
}
