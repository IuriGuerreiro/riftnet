import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { z } from "zod";

import { http } from "../api/http";
import { watchOwnPresence } from "../api/presence-settings";
import { useAuth } from "../stores/auth";
import { ErrorText } from "./ui";

const presenceSettings = z.object({
  presence: z.enum(["online", "idle", "do_not_disturb", "invisible"]),
});
type Settings = z.infer<typeof presenceSettings>;

export function PresenceSettings() {
  const userId = useAuth((s) => s.user?.id);
  const queryClient = useQueryClient();
  const queryKey = ["presence-settings", userId];
  const query = useQuery({
    queryKey,
    refetchOnMount: "always",
    queryFn: async () => presenceSettings.parse(await http<unknown>("/me/settings/presence")),
  });
  useEffect(() => watchOwnPresence(queryClient, userId), [queryClient, userId]);

  const update = useMutation({
    mutationFn: async (settings: Settings) =>
      presenceSettings.parse(
        await http<unknown>("/me/settings/presence", { method: "PUT", body: settings }),
      ),
    onSuccess: async (settings) => {
      queryClient.setQueryData(queryKey, settings);
      await queryClient.invalidateQueries({ queryKey });
    },
  });

  return (
    <label className="block space-y-1 text-xs text-zinc-400">
      Presence
      <select
        className="w-full rounded-lg bg-zinc-800 px-3 py-2 text-sm text-zinc-100"
        value={query.data?.presence ?? "online"}
        disabled={!query.data || update.isPending}
        onChange={(e) => {
          const result = presenceSettings.safeParse({ presence: e.target.value });
          if (result.success) update.mutate(result.data);
        }}
      >
        <option value="online">Online</option>
        <option value="idle">Idle</option>
        <option value="do_not_disturb">Do not disturb</option>
        <option value="invisible">Invisible</option>
      </select>
      <ErrorText error={query.error ?? update.error} />
    </label>
  );
}
