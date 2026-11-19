import { z } from "zod";

const id = z.string().regex(/^\d+$/).optional().catch(undefined);
const workspaceSearch = z.object({
  invite: z.string().min(1).optional().catch(undefined),
  server: id,
  channel: id,
});

export function readWorkspaceSearch(search: unknown) {
  return workspaceSearch.parse(search);
}
