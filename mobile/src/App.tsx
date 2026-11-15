import { DarkTheme, NavigationContainer } from '@react-navigation/native';
import { StatusBar } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useAuth } from '@shared/stores/auth';
import { navigationRef } from './navigation/ref';
import { RootNavigator } from './navigation/RootNavigator';
import { IncomingCall } from './session/IncomingCall';
import { LiveSession } from './session/LiveSession';
import { colors } from './ui/theme';

const theme = { ...DarkTheme, colors: { ...DarkTheme.colors, background: colors.bg, primary: colors.brand } };

export default function App() {
  // The socket runs only once logged in with a username.
  const ready = useAuth(s => !!s.refreshToken && !!s.user?.username);
  return (
    <SafeAreaProvider>
      <StatusBar barStyle="light-content" />
      <NavigationContainer ref={navigationRef} theme={theme}>
        <RootNavigator />
        {ready ? (
          <>
            <LiveSession />
            <IncomingCall />
          </>
        ) : null}
      </NavigationContainer>
    </SafeAreaProvider>
  );
}
