import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useSession } from '../stores/session';
import { CallScreen } from '../screens/CallScreen';
import { ChatScreen } from '../screens/ChatScreen';
import { DmsScreen } from '../screens/DmsScreen';
import { FriendsScreen } from '../screens/FriendsScreen';
import { LoginScreen } from '../screens/LoginScreen';
import type { RootStackParamList, TabsParamList } from './types';

const Stack = createNativeStackNavigator<RootStackParamList>();
const Tabs = createBottomTabNavigator<TabsParamList>();

function HomeTabs() {
  return (
    <Tabs.Navigator>
      <Tabs.Screen name="Friends" component={FriendsScreen} />
      <Tabs.Screen name="DMs" component={DmsScreen} />
    </Tabs.Navigator>
  );
}

// Logged out → Login only. Logged in → tabs + Chat/Call on top.
export function RootNavigator() {
  const loggedIn = useSession(s => s.loggedIn);
  return (
    <Stack.Navigator>
      {loggedIn ? (
        <>
          <Stack.Screen name="Home" component={HomeTabs} options={{ headerShown: false }} />
          <Stack.Screen name="Chat" component={ChatScreen} options={({ route }) => ({ title: route.params.title })} />
          <Stack.Screen name="Call" component={CallScreen} options={{ presentation: 'fullScreenModal' }} />
        </>
      ) : (
        <Stack.Screen name="Login" component={LoginScreen} options={{ headerShown: false }} />
      )}
    </Stack.Navigator>
  );
}
