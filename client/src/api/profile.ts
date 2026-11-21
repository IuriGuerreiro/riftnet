import { useMutation, useQuery } from "@tanstack/react-query";

import { useAuth } from "../stores/auth";
import { fromJson, useProfiles } from "../stores/profiles";
import { http } from "./http";
import type { User } from "./types";

export type AvatarSize = 128 | 512;

export interface ProfileUpdate {
  display_name?: string;
  bio?: string;
  custom_status?: string;
  pronouns?: string;
  accent_color?: string;
}

function saveMe(me: User) {
  useAuth.getState().setUser(me);
  useProfiles.getState().put([fromJson(me)]);
}

export function useUpdateProfile() {
  return useMutation({
    mutationFn: (body: ProfileUpdate) => http<User>("/me", { method: "PATCH", body }),
    onSuccess: saveMe,
  });
}

export function useUploadAvatar() {
  return useMutation({
    mutationFn: (file: Blob) => http<User>("/me/avatar", { method: "PUT", raw: file }),
    onSuccess: saveMe,
  });
}

export function useRemoveAvatar() {
  return useMutation({
    mutationFn: () => http<User>("/me/avatar", { method: "DELETE" }),
    onSuccess: saveMe,
  });
}

export function useUploadBanner() {
  return useMutation({
    mutationFn: (file: Blob) => http<User>("/me/banner", { method: "PUT", raw: file }),
    onSuccess: saveMe,
  });
}

export function useRemoveBanner() {
  return useMutation({
    mutationFn: () => http<User>("/me/banner", { method: "DELETE" }),
    onSuccess: saveMe,
  });
}

export function useLoadProfile(userId: string) {
  return useQuery({
    queryKey: ["user", userId],
    enabled: !!userId,
    staleTime: 30_000,
    queryFn: async () => {
      const u = await http<User>(`/users/${userId}`);
      useProfiles.getState().put([fromJson(u)]);
      return u;
    },
  });
}

const LINK_FRESH_MS = 4 * 60 * 1000;

export function useAvatarUrl(userId: string, hash: string | null, size: AvatarSize) {
  return useQuery({
    queryKey: ["avatar", userId, hash, size],
    enabled: !!hash,
    staleTime: LINK_FRESH_MS,
    gcTime: LINK_FRESH_MS,
    queryFn: () =>
      http<{ url: string }>(`/users/${userId}/avatar/${hash}?size=${size}`).then((r) => r.url),
  });
}

export function useBannerUrl(userId: string, hash: string | null) {
  return useQuery({
    queryKey: ["banner", userId, hash],
    enabled: !!hash,
    staleTime: LINK_FRESH_MS,
    gcTime: LINK_FRESH_MS,
    queryFn: () => http<{ url: string }>(`/users/${userId}/banner/${hash}`).then((r) => r.url),
  });
}
