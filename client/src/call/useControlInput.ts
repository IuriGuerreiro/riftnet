import { type RefObject, useEffect } from "react";

import type { Call } from "../gen/v1/calls_pb";
import { sendInput } from "../stores/calls";
import { type InputEvent, normalizePointer, PING_MS, sendable, wheelLines } from "./sharePlayWire";

export function controlView(call: Call | null, me: bigint | undefined) {
  const c = call?.control;
  if (!c || me === undefined) return { role: "none" as const };
  if (c.hostId === me) return { role: "host" as const, other: c.controllerId, granted: c.granted };
  if (c.controllerId === me)
    return { role: "viewer" as const, other: c.hostId, granted: c.granted };
  return { role: "none" as const, busy: true };
}

export function useControlInput(video: RefObject<HTMLVideoElement | null>, active: boolean) {
  useEffect(() => {
    const el = video.current;
    if (!active || !el) return;
    const keys = new Set<string>();
    const buttons = new Set<number>();
    let pending: InputEvent | null = null;
    let frame = 0;
    let last = { x: 0.5, y: 0.5 };
    const ping = setInterval(() => sendInput({ t: "ping" }), PING_MS);

    const releaseAll = () => {
      for (const code of keys) sendInput({ t: "key", code, down: false });
      for (const b of buttons) sendInput({ t: "button", b, down: false, ...last });
      keys.clear();
      buttons.clear();
    };
    const at = (e: MouseEvent) =>
      normalizePointer(
        e.clientX,
        e.clientY,
        el.getBoundingClientRect(),
        el.videoWidth,
        el.videoHeight,
      );
    const move = (e: PointerEvent) => {
      const p = at(e);
      if (!p) return;
      last = p;
      pending = { t: "move", ...p };
      frame ||= requestAnimationFrame(() => {
        frame = 0;
        if (pending) sendInput(pending);
        pending = null;
      });
    };
    const button = (down: boolean) => (e: PointerEvent) => {
      if (e.button > 2) return;
      e.preventDefault();
      const p = at(e);
      if (down) {
        el.focus();
        if (!p) return;
        last = p;
        buttons.add(e.button);
      } else if (!buttons.delete(e.button)) return;
      sendInput({ t: "button", b: e.button, down, ...(p ?? last) });
    };
    const key = (down: boolean) => (e: KeyboardEvent) => {
      if (!sendable(e.code)) return;
      e.preventDefault();
      if (down) keys.add(e.code);
      else if (!keys.delete(e.code)) return;
      sendInput({ t: "key", code: e.code, down });
    };
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const p = at(e);
      if (!p) return;
      sendInput({
        t: "wheel",
        ...p,
        dx: wheelLines(e.deltaX, e.deltaMode),
        dy: wheelLines(e.deltaY, e.deltaMode),
      });
    };
    const noMenu = (e: Event) => e.preventDefault();
    const down = button(true);
    const up = button(false);
    const keyDown = key(true);
    const keyUp = key(false);

    el.focus();
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerdown", down);
    window.addEventListener("pointerup", up);
    el.addEventListener("keydown", keyDown);
    el.addEventListener("keyup", keyUp);
    el.addEventListener("wheel", wheel, { passive: false });
    el.addEventListener("contextmenu", noMenu);
    el.addEventListener("blur", releaseAll);
    return () => {
      cancelAnimationFrame(frame);
      clearInterval(ping);
      releaseAll();
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerdown", down);
      window.removeEventListener("pointerup", up);
      el.removeEventListener("keydown", keyDown);
      el.removeEventListener("keyup", keyUp);
      el.removeEventListener("wheel", wheel);
      el.removeEventListener("contextmenu", noMenu);
      el.removeEventListener("blur", releaseAll);
    };
  }, [video, active]);
}
