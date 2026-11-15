import { ActivityIndicator, View } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useAuth } from '@shared/stores/auth';
import { CallScreen } from '../screens/CallScreen';
import { ChatScreen } from '../screens/ChatScreen';
import { DmsScreen } from '../screens/DmsScreen';
import { FriendsScreen } from '../screens/FriendsScreen';
import { GroupScreen } from '../screens/GroupScreen';
import { LoginScreen } from '../screens/LoginScreen';
import { NewGroupScreen } from '../screens/NewGroupScreen';
import { SettingsButton } from '../screens/SettingsButton';
import { UsernameScreen } from '../screens/UsernameScreen';
import { useAuthHydrated } from '../session/useHydrated';
import { colors } from '../ui/theme';
import type { RootStackParamList, TabsParamList } from './types';

const Stack = createNativeStackNavigator<RootStackParamList>();
const Tabs = createBottomTabNavigator<TabsParamList>();

const dark = {
  headerStyle: { backgroundColor: colors.surface },
  headerTintColor: colors.text,
} as const;

function HomeTabs() {
  return (
    <Tabs.Navigator
      screenOptions={{
        ...dark,
        tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.border },
        tabBarActiveTintColor: colors.brand,
        tabBarInactiveTintColor: colors.muted,
        headerLeft: () => <SettingsButton />,
      }}
    >
      <Tabs.Screen name="DMs" component={DmsScreen} />
      <Tabs.Screen name="Friends" component={FriendsScreen} />
    </Tabs.Navigator>
  );
}

// Loading tokens → spinner. Logged out → Login. No username yet → Username.
// Otherwise tabs + Chat / Group / Call on top.
export function RootNavigator() {
  const hydrated = useAuthHydrated();
  const loggedIn = useAuth(s => !!s.refreshToken);
  const hasUsername = useAuth(s => !!s.user?.username);

  if (!hydrated) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, justifyContent: 'center' }}>
        <ActivityIndicator color={colors.brand} />
      </View>
    );
  }

  return (
    <Stack.Navigator screenOptions={{ ...dark, contentStyle: { backgroundColor: colors.bg } }}>
      {!loggedIn ? (
        <Stack.Screen name="Login" component={LoginScreen} options={{ headerShown: false }} />
      ) : !hasUsername ? (
        <Stack.Screen name="Username" component={UsernameScreen} options={{ headerShown: false }} />
      ) : (
        <>
          <Stack.Screen name="Home" component={HomeTabs} options={{ headerShown: false }} />
          <Stack.Screen name="Chat" component={ChatScreen} options={({ route }) => ({ title: route.params.title })} />
          <Stack.Screen name="Group" component={GroupScreen} options={{ title: 'Group' }} />
          <Stack.Screen name="NewGroup" component={NewGroupScreen} options={{ title: 'New group', presentation: 'modal' }} />
          <Stack.Screen
            name="Call"
            component={CallScreen}
            options={{ presentation: 'fullScreenModal', headerShown: false, gestureEnabled: false }}
          />
        </>
      )}
    </Stack.Navigator>
  );
}
