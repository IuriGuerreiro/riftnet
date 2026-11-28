import type { Staged } from "@/features/media/StagedTray";

interface Draft {
  text: string;
  staged: Staged[];
}

const drafts = new Map<string, Draft>();

export function getDraft(id: string): Draft {
  return drafts.get(id) ?? { text: "", staged: [] };
}

export function saveDraft(id: string, patch: Partial<Draft>) {
  const next = { ...getDraft(id), ...patch };
  if (!next.text && next.staged.length === 0) drafts.delete(id);
  else drafts.set(id, next);
}
