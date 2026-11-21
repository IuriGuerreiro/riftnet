import { Gamepad2, ShieldAlert } from "lucide-react";
import { useEffect, useState } from "react";

import type { WsClient } from "../api/ws";
import { Button } from "../components/ui";
import { listMonitors, myId, useCalls } from "../stores/calls";
import { type MonitorInfo, type Rect, REVOKE_HOTKEY_LABEL } from "./sharePlayWire";
import { controlView } from "./useControlInput";

type NameFor = (id: bigint) => string;

export function ControlBanner({ ws, nameFor }: { ws: WsClient | null; nameFor: NameFor }) {
  const current = useCalls((s) => s.current);
  const sharing = useCalls((s) => s.sharing);
  const armedFor = useCalls((s) => s.hostArmedFor);
  const { answerControl, revokeControl } = useCalls();
  const view = controlView(current, myId());
  const pending = view.role === "host" && !view.granted && sharing;
  const requestId = current?.control?.requestId;
  if (!ws || (armedFor === null && !pending)) return null;

  return (
    <div
      role="alert"
      className="fixed left-1/2 top-4 z-50 flex -translate-x-1/2 items-center gap-3 rounded-panel bg-surface-2 px-4 py-3 shadow-pop ring-2 ring-warning"
    >
      <ShieldAlert size={18} className="text-warning" />
      {armedFor !== null ? (
        <>
          <span className="text-sm">
            <b>{nameFor(armedFor)}</b> is controlling your screen · {REVOKE_HOTKEY_LABEL} to stop
          </span>
          <Button size="sm" variant="danger" onClick={() => void revokeControl(ws)}>
            Revoke
          </Button>
        </>
      ) : (
        view.role === "host" &&
        requestId !== undefined && (
          <ApproveRequest
            key={requestId.toString()}
            name={nameFor(view.other)}
            onAnswer={(approve, monitor) => void answerControl(ws, requestId, approve, monitor)}
          />
        )
      )}
    </div>
  );
}

function ApproveRequest({
  name,
  onAnswer,
}: {
  name: string;
  onAnswer: (approve: boolean, monitor?: Rect) => void;
}) {
  const [monitors, setMonitors] = useState<MonitorInfo[]>([]);
  const [picked, setPicked] = useState<number | null>(null);
  useEffect(() => {
    let live = true;
    void listMonitors().then(({ monitors, suggested }) => {
      if (!live) return;
      setMonitors(monitors);
      setPicked(suggested);
    });
    return () => {
      live = false;
    };
  }, []);
  const monitor = picked === null ? undefined : monitors[picked]?.rect;

  return (
    <>
      <span className="text-sm">
        <b>{name}</b> wants to control your keyboard and mouse on
      </span>
      <select
        aria-label="Shared screen"
        className="rounded bg-surface-3 px-2 py-1 text-sm"
        value={picked ?? ""}
        onChange={(e) => setPicked(e.target.value === "" ? null : Number(e.target.value))}
      >
        <option value="">Pick the shared screen…</option>
        {monitors.map((m, i) => (
          <option key={`${m.name}-${m.rect.x}-${m.rect.y}`} value={i}>
            {m.name} ({m.rect.width}×{m.rect.height})
          </option>
        ))}
      </select>
      <Button size="sm" disabled={!monitor} onClick={() => onAnswer(true, monitor)}>
        Approve
      </Button>
      <Button size="sm" variant="ghost" onClick={() => onAnswer(false)}>
        Deny
      </Button>
    </>
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
