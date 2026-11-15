import type { NavigatorScreenParams } from '@react-navigation/native';

export type TabsParamList = {
  Friends: undefined;
  DMs: undefined;
};

export type RootStackParamList = {
  Login: undefined;
  Username: undefined;
  Home: NavigatorScreenParams<TabsParamList>;
  Chat: { conversationId: string; title: string };
  NewGroup: undefined;
  Group: { conversationId: string };
  Call: undefined;
};

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace ReactNavigation {
    // eslint-disable-next-line @typescript-eslint/no-empty-object-type
    interface RootParamList extends RootStackParamList {}
  }
}
