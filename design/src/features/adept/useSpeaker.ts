import { useEffect, useState } from "react";

export function useSpeaker(people: string[]) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 1500);
    return () => clearInterval(id);
  }, []);
  return people.length > 0 ? people[tick % people.length] : undefined;
}
