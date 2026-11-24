export interface PadStatus {
  supported: boolean;
  driver: boolean;
}

export function padState(status: PadStatus | undefined): "unsupported" | "missing" | "ready" {
  if (!status?.supported) return "unsupported";
  return status.driver ? "ready" : "missing";
}
