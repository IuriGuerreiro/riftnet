import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Button } from 'react-native';
import type { RootStackParamList } from '../navigation/types';
import { Placeholder } from './Placeholder';

type Props = NativeStackScreenProps<RootStackParamList, 'Call'>;

export function CallScreen({ navigation }: Props) {
  return (
    <Placeholder title="Call">
      <Button title="Hang up" onPress={() => navigation.goBack()} />
    </Placeholder>
  );
}
