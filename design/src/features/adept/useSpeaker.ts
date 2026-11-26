import { useSyncExternalStore } from "react";

const listeners = new Set<() => void>();
let tick = 0;
let timer: ReturnType<typeof setInterval> | undefined;

function subscribe(listener: () => void) {
  listeners.add(listener);
  timer ??= setInterval(() => {
    tick += 1;
    for (const l of listeners) l();
  }, 1500);
  return () => {
    listeners.delete(listener);
    if (listeners.size > 0) return;
    clearInterval(timer);
    timer = undefined;
  };
}

export function useSpeaker(people: string[]) {
  const n = useSyncExternalStore(subscribe, () => tick);
  return people.length > 0 ? people[n % people.length] : undefined;
}
