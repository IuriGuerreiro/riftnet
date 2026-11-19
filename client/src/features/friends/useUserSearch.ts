import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { http } from "../../api/http";
import type { User } from "../../api/types";
import { useAuth } from "../../stores/auth";
import { useFriends } from "../../stores/friends";

const USERNAME = /^[a-z0-9_.]{1,32}$/;

export function useUserSearch(input: string, enabled: boolean) {
  const [debounced, setDebounced] = useState("");
  const userId = useAuth((s) => s.user?.id);
  const query = input.trim().toLowerCase();
  const valid = USERNAME.test(query);
  const ready = enabled && !!userId && valid && query === debounced;

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(query), 250);
    return () => window.clearTimeout(timer);
  }, [query]);

  const search = useQuery({
    queryKey: ["users", "search", userId, debounced],
    enabled: ready,
    queryFn: () => http<User[]>(`/users/search?${new URLSearchParams({ q: debounced })}`),
    retry: false,
    refetchOnWindowFocus: false,
  });

  return { query, valid, ready, search };
}

export function useAddFriend(setInput: (update: (current: string) => string) => void) {
  const sendRequest = useFriends((s) => s.sendRequest);
  return useMutation({
    mutationFn: ({ target }: { target: string; input: string }) => sendRequest(target),
    onSuccess: (sent, { input }) => {
      if (sent) setInput((current) => (current === input ? "" : current));
    },
  });
}
