export interface LoadingSearch {
  state?: "error" | "hold";
}

export function readLoadingSearch(raw: unknown): LoadingSearch {
  const s = (raw ?? {}) as Record<string, unknown>;
  return {
    state: s.state === "error" || s.state === "hold" ? s.state : undefined,
  };
}
