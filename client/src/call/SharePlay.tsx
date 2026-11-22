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
      className="fixed left-1/2 top-4 z-50 flex w-max max-w-[calc(100%-2rem)] -translate-x-1/2 items-start gap-3 rounded-panel bg-surface-2 px-4 py-3 shadow-pop ring-2 ring-warning"
    >
      <ShieldAlert size={18} className="shrink-0 text-warning" />
      {armedFor !== null ? (
        <>
          <span className="text-sm">
            <b>{nameFor(armedFor)}</b> is controlling your screen · {REVOKE_HOTKEY_LABEL} to stop
          </span>
          <Button size="sm" variant="danger" onClick={() => void revokeControl(ws)}>
            Stop control
          </Button>
        </>
      ) : (
        view.role === "host" &&
        requestId !== undefined && (
          <ApproveRequest
            key={requestId.toString()}
            name={nameFor(view.other)}
            onGrant={(monitor) =>
              void answerControl(ws, requestId, { monitor, warningAcknowledged: true })
            }
            onDeny={() => void answerControl(ws, requestId, null)}
          />
        )
      )}
    </div>
  );
}

function ApproveRequest({
  name,
  onGrant,
  onDeny,
}: {
  name: string;
  onGrant: (monitor: Rect) => void;
  onDeny: () => void;
}) {
  const [monitors, setMonitors] = useState<MonitorInfo[]>([]);
  const [acknowledged, setAcknowledged] = useState(false);
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
    <div className="flex max-w-sm flex-col gap-3 text-sm">
      <p>
        <b>{name}</b> wants to control your keyboard and mouse.
      </p>
      <p>
        Only give control of your PC to someone you trust. To end access at any time, click{" "}
        <b>Stop control</b> or press <b>{REVOKE_HOTKEY_LABEL}</b>.
      </p>
      <select
        aria-label="Shared screen"
        className="rounded bg-surface-3 px-2 py-1"
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
      <label className="flex items-start gap-2">
        <input
          type="checkbox"
          className="mt-1"
          checked={acknowledged}
          onChange={(e) => setAcknowledged(e.target.checked)}
        />
        <span>I’ve read this warning and understand how to stop control.</span>
      </label>
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={onDeny}>
          Deny
        </Button>
        <Button
          size="sm"
          disabled={!acknowledged || !monitor}
          onClick={() => {
            if (acknowledged && monitor) onGrant(monitor);
          }}
        >
          Grant control
        </Button>
      </div>
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
