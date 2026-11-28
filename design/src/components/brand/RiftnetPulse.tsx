import { useEffect, useRef } from "react";

import { cn } from "@/lib/utils";

import { RiftnetMark } from "./RiftnetMark";

const LOOP_MS = 7000;

function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function RiftnetPulse({
  size = 160,
  steps = 4,
  onStateChange,
  className,
}: {
  size?: number;
  steps?: number;
  onStateChange?: (state: number) => void;
  className?: string;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const onStateRef = useRef(onStateChange);
  useEffect(() => {
    onStateRef.current = onStateChange;
  });
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    let last = -1;
    const tick = () => {
      const t = ((video.currentTime * 1000) % LOOP_MS) / LOOP_MS;
      const state = Math.floor(t * steps) % steps;
      if (state !== last) {
        last = state;
        onStateRef.current?.(state);
      }
    };
    video.addEventListener("timeupdate", tick);
    return () => video.removeEventListener("timeupdate", tick);
  }, [steps]);

  if (typeof window !== "undefined" && prefersReducedMotion())
    return <RiftnetMark className={className} />;

  return (
    <div
      aria-hidden
      style={{ width: size, height: size * 0.62 }}
      className={cn("shrink-0 overflow-hidden", className)}
    >
      <video
        ref={videoRef}
        src="/riftnet-loop.mp4"
        autoPlay
        muted
        loop
        playsInline
        style={{ width: size, height: size }}
        className="max-w-none object-cover mix-blend-lighten"
      />
    </div>
  );
}
