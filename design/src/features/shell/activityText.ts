import type { Activity } from "@/mock/data";

const VERB: Record<Activity["kind"], string> = {
  playing: "Playing",
  listening: "Listening to",
  streaming: "Streaming",
  voice: "In",
};

export function activityText(a: Activity) {
  return `${VERB[a.kind]} ${a.label}`;
}
