import { useEffect, useRef } from "react";

import { cn } from "@/lib/utils";

import { AdeptMark } from "./AdeptMark";
import { activeState, drawFrame, frameAt, type Rgb } from "./morph";

function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function AdeptMorph({
  size = 160,
  hole,
  onStateChange,
  className,
}: {
  size?: number;
  hole?: Rgb;
  onStateChange?: (state: number) => void;
  className?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const onStateRef = useRef(onStateChange);

  useEffect(() => {
    onStateRef.current = onStateChange;
  });

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx || prefersReducedMotion()) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    let raf = 0;
    let last = -1;
    const start = performance.now();
    const tick = (now: number) => {
      const frame = frameAt((now - start) / 1000, hole);
      drawFrame(ctx, size, frame);
      const state = activeState(frame);
      if (state !== last) {
        last = state;
        onStateRef.current?.(state);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [size, hole]);

  if (typeof window !== "undefined" && prefersReducedMotion()) {
    return <AdeptMark className={className} />;
  }

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      style={{ width: size, height: size }}
      className={cn("shrink-0", className)}
    />
  );
}
