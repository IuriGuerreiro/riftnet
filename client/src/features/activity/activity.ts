import { useEffect } from "react";

import type { FriendActivity } from "../../gen/v1/presence_pb";
import { useActivity } from "../../stores/activity";
import { useConnection } from "../../stores/connection";
import { useFriends } from "../../stores/friends";

export function activityText(activity: FriendActivity | undefined): string | undefined {
  if (!activity?.label) return undefined;
  return `${activity.streaming ? "Streaming" : "Playing"} ${activity.label}`;
}

export function useFriendActivityWatch() {
  const ws = useConnection((s) => s.ws);
  const friendIds = useFriends((s) =>
    s.list.friends
      .map((f) => f.user.id)
      .sort()
      .join(","),
  );
  useEffect(() => {
    if (!ws) {
      useActivity.getState().clear();
      return;
    }
    return useActivity.getState().watch(ws, friendIds ? friendIds.split(",") : []);
  }, [ws, friendIds]);
}
