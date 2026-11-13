import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { platform } from "../platform";
import { useAuth } from "../stores/auth";
import type { Credentials } from "../schemas/auth";
import { http } from "./http";
import type { Session, User } from "./types";

const device = () => ({ name: platform.deviceName, platform: platform.kind });

export function useLogin() {
  return useMutation({
    mutationFn: (c: Credentials) =>
      http<Session>("/auth/login", { method: "POST", auth: false, body: { ...c, device: device() } }),
    onSuccess: (s) => useAuth.getState().setSession(s),
  });
}

export function useRegister() {
  return useMutation({
    mutationFn: (c: Credentials) =>
      http<Session>("/auth/register", { method: "POST", auth: false, body: { ...c, device: device() } }),
    onSuccess: (s) => useAuth.getState().setSession(s),
  });
}

export function useLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => http<void>("/auth/logout", { method: "POST" }),
    onSettled: () => {
      useAuth.getState().clear();
      qc.clear();
    },
  });
}

export function useMe() {
  return useQuery({
    queryKey: ["me"],
    queryFn: async () => {
      const me = await http<User>("/me");
      useAuth.getState().setUser(me);
      return me;
    },
  });
}

export function useSetUsername() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (username: string) => http<User>("/me/username", { method: "PUT", body: { username } }),
    onSuccess: (me) => {
      useAuth.getState().setUser(me);
      qc.setQueryData(["me"], me);
    },
  });
}
