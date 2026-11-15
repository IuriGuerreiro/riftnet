import { createNavigationContainerRef } from '@react-navigation/native';
import type { RootStackParamList } from './types';

// For code outside screens (e.g. the incoming-call banner).
export const navigationRef = createNavigationContainerRef<RootStackParamList>();
