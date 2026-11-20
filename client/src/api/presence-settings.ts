import type { QueryClient } from "@tanstack/react-query";

import { usePresence } from "../stores/presence";

export function watchOwnPresence(queryClient: QueryClient, userId: string | undefined) {
  return usePresence.subscribe((state, previous) => {
    if (userId && state.revisions[userId] !== previous.revisions[userId]) {
      void queryClient.invalidateQueries({ queryKey: ["presence-settings", userId] });
    }
  });
}
