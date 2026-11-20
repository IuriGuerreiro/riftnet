import { Gamepad2, ShieldAlert } from "lucide-react";

import type { WsClient } from "../api/ws";
import { Button } from "../components/ui";
import { myId, useCalls } from "../stores/calls";
import { REVOKE_HOTKEY_LABEL } from "./sharePlayWire";
import { controlView } from "./useControlInput";

type NameFor = (id: bigint) => string;

export function ControlBanner({ ws, nameFor }: { ws: WsClient | null; nameFor: NameFor }) {
  const current = useCalls((s) => s.current);
  const sharing = useCalls((s) => s.sharing);
  const { answerControl, revokeControl } = useCalls();
  const view = controlView(current, myId());
  if (!ws || view.role !== "host" || !sharing) return null;
  const name = nameFor(view.other);

  return (
    <div
      role="alert"
      className="fixed left-1/2 top-4 z-50 flex -translate-x-1/2 items-center gap-3 rounded-panel bg-surface-2 px-4 py-3 shadow-pop ring-2 ring-warning"
    >
      <ShieldAlert size={18} className="text-warning" />
      {view.granted ? (
        <>
          <span className="text-sm">
            <b>{name}</b> is controlling your screen · {REVOKE_HOTKEY_LABEL} to stop
          </span>
          <Button size="sm" variant="danger" onClick={() => void revokeControl(ws)}>
            Revoke
          </Button>
        </>
      ) : (
        <>
          <span className="text-sm">
            <b>{name}</b> wants to control your keyboard and mouse
          </span>
          <Button size="sm" onClick={() => void answerControl(ws, true)}>
            Approve
          </Button>
          <Button size="sm" variant="ghost" onClick={() => void answerControl(ws, false)}>
            Deny
          </Button>
        </>
      )}
    </div>
  );
}

export function ControlButton({
  ws,
  hostId,
  nameFor,
}: {
  ws: WsClient | null;
  hostId: bigint;
  nameFor: NameFor;
}) {
  const current = useCalls((s) => s.current);
  const { requestControl, revokeControl } = useCalls();
  // WARN: hosts on Wayland / web / window shares are never controllable (issue #56).
  const controllable = current?.controllableUserIds.includes(hostId) ?? false;
  const view = controlView(current, myId());
  if (!ws || (!controllable && view.role !== "viewer")) return null;

  if (view.role === "viewer") {
    return (
      <div className="flex items-center gap-2 text-xs text-white">
        <span>
          {view.granted
            ? `You're controlling ${nameFor(hostId)}'s screen`
            : "Waiting for approval…"}
        </span>
        <Button size="sm" variant="danger" onClick={() => void revokeControl(ws)}>
          {view.granted ? "Stop controlling" : "Cancel"}
        </Button>
      </div>
    );
  }
  return (
    <Button
      size="sm"
      variant="secondary"
      disabled={"busy" in view && view.busy}
      onClick={() => void requestControl(ws, hostId)}
    >
      <Gamepad2 size={16} />
      Request control
    </Button>
  );
}
