export interface PadStatus {
  supported: boolean;
  driver: boolean;
  helper: boolean;
}

export function padState(status: PadStatus | undefined): "unsupported" | "missing" | "ready" {
  if (!status?.supported) return "unsupported";
  return status.driver && status.helper ? "ready" : "missing";
}
