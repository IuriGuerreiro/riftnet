import {
  Download,
  Maximize,
  Minimize,
  Pause,
  PictureInPicture2,
  Play,
  RotateCcw,
  Volume1,
  Volume2,
  VolumeX,
} from "lucide-react";
import { type PointerEvent, useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

import { formatBytes, formatTime } from "./format";

const SPEEDS = [1, 1.5, 2, 0.5];

function ControlButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className="grid size-8 shrink-0 place-items-center rounded-md text-white/85 transition-colors hover:bg-white/10 hover:text-white"
    >
      {children}
    </button>
  );
}

function Track({
  value,
  buffered = 0,
  onSeek,
  className,
  hoverLabel,
}: {
  value: number;
  buffered?: number;
  onSeek: (ratio: number) => void;
  className?: string;
  hoverLabel?: (ratio: number) => string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const ratioAt = (clientX: number) => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return 0;
    return Math.min(1, Math.max(0, (clientX - r.left) / r.width));
  };
  const onDown = (e: PointerEvent) => {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    onSeek(ratioAt(e.clientX));
  };
  return (
    <div
      ref={ref}
      role="slider"
      aria-valuenow={Math.round(value * 100)}
      aria-valuemin={0}
      aria-valuemax={100}
      tabIndex={-1}
      onPointerDown={onDown}
      onPointerMove={(e) => {
        setHover(ratioAt(e.clientX));
        if (e.buttons === 1) onSeek(ratioAt(e.clientX));
      }}
      onPointerLeave={() => setHover(null)}
      onClick={(e) => e.stopPropagation()}
      className={cn("group/track relative flex h-4 cursor-pointer items-center", className)}
    >
      <div className="relative h-1 w-full overflow-hidden rounded-full bg-white/20 transition-[height] group-hover/track:h-1.5">
        <div
          className="absolute inset-y-0 left-0 bg-white/30"
          style={{ width: `${buffered * 100}%` }}
        />
        <div className="absolute inset-y-0 left-0 bg-brand" style={{ width: `${value * 100}%` }} />
      </div>
      <span
        className="pointer-events-none absolute size-3 -translate-x-1/2 scale-0 rounded-full bg-white shadow transition-transform group-hover/track:scale-100"
        style={{ left: `${value * 100}%` }}
      />
      {hover !== null && hoverLabel && (
        <span
          className="pointer-events-none absolute bottom-5 -translate-x-1/2 rounded bg-black/80 px-1.5 py-0.5 text-[11px] text-white tabular-nums"
          style={{ left: `${hover * 100}%` }}
        >
          {hoverLabel(hover)}
        </span>
      )}
    </div>
  );
}

export function VideoPlayer({
  url,
  name,
  size,
  w,
  h,
  autoPlay = false,
}: {
  url: string;
  name: string;
  size: number;
  w: number;
  h: number;
  autoPlay?: boolean;
}) {
  const box = useRef<HTMLDivElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const [started, setStarted] = useState(autoPlay);
  const [playing, setPlaying] = useState(false);
  const [ended, setEnded] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [buffered, setBuffered] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [fullscreen, setFullscreen] = useState(false);
  const [idle, setIdle] = useState(false);
  const idleTimer = useRef<number | undefined>(undefined);

  useEffect(() => {
    const onFs = () => setFullscreen(document.fullscreenElement === box.current);
    document.addEventListener("fullscreenchange", onFs);
    return () => {
      document.removeEventListener("fullscreenchange", onFs);
      window.clearTimeout(idleTimer.current);
    };
  }, []);

  const toggle = () => {
    const v = video.current;
    if (!v) return;
    setStarted(true);
    if (v.paused || v.ended) void v.play();
    else v.pause();
  };
  const seek = (ratio: number) => {
    const v = video.current;
    if (v && duration) v.currentTime = ratio * duration;
  };
  const poke = () => {
    setIdle(false);
    window.clearTimeout(idleTimer.current);
    idleTimer.current = window.setTimeout(() => setIdle(true), 2200);
  };
  const setVol = (ratio: number) => {
    const v = video.current;
    if (!v) return;
    v.volume = ratio;
    v.muted = ratio === 0;
  };
  const toggleFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void box.current?.requestFullscreen();
  };

  const VolIcon = muted || volume === 0 ? VolumeX : volume < 0.5 ? Volume1 : Volume2;
  const showControls = started && (!playing || !idle);

  return (
    <div
      ref={box}
      tabIndex={0}
      onMouseMove={poke}
      onMouseLeave={() => setIdle(true)}
      onKeyDown={(e) => {
        const v = video.current;
        if (!v) return;
        if (e.key === " " || e.key === "k") {
          e.preventDefault();
          toggle();
        } else if (e.key === "ArrowRight") v.currentTime += 5;
        else if (e.key === "ArrowLeft") v.currentTime -= 5;
        else if (e.key === "m") v.muted = !v.muted;
        else if (e.key === "f") toggleFullscreen();
        poke();
      }}
      className={cn(
        "group/video relative overflow-hidden border border-white/5 bg-black outline-none focus-visible:ring-2 focus-visible:ring-brand",
        fullscreen ? "grid place-items-center rounded-none" : "w-[480px] max-w-full rounded-xl",
        playing && idle && "cursor-none",
      )}
      style={fullscreen ? undefined : { aspectRatio: `${w} / ${h}` }}
    >
      <video
        ref={video}
        src={url}
        preload="metadata"
        playsInline
        autoPlay={autoPlay}
        onClick={toggle}
        onDoubleClick={toggleFullscreen}
        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
        onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
        onProgress={(e) => {
          const v = e.currentTarget;
          if (v.buffered.length && v.duration)
            setBuffered(v.buffered.end(v.buffered.length - 1) / v.duration);
        }}
        onPlay={() => {
          setPlaying(true);
          setEnded(false);
          poke();
        }}
        onPause={() => setPlaying(false)}
        onEnded={() => setEnded(true)}
        onVolumeChange={(e) => {
          setVolume(e.currentTarget.volume);
          setMuted(e.currentTarget.muted);
        }}
        onRateChange={(e) => setSpeed(e.currentTarget.playbackRate)}
        className="size-full object-contain"
      />

      {(!started || ended) && (
        <button
          type="button"
          aria-label={ended ? "Replay" : "Play video"}
          onClick={toggle}
          className="absolute inset-0 grid place-items-center bg-gradient-to-t from-black/50 via-transparent to-transparent"
        >
          <span className="grid size-14 place-items-center rounded-full bg-black/55 text-white shadow-xl ring-1 ring-white/15 backdrop-blur-md transition-transform group-hover/video:scale-110">
            {ended ? (
              <RotateCcw className="size-6" />
            ) : (
              <Play className="ml-0.5 size-6 fill-white" />
            )}
          </span>
        </button>
      )}

      {!started && (
        <div className="pointer-events-none absolute inset-x-0 top-0 flex items-center justify-between gap-2 bg-gradient-to-b from-black/60 to-transparent p-3 text-xs text-white/90">
          <span className="truncate font-medium">{name}</span>
          <span className="shrink-0 text-white/70">
            {duration ? formatTime(duration) : ""} · {formatBytes(size)}
          </span>
        </div>
      )}

      <div
        className={cn(
          "absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/50 to-transparent px-3 pt-8 pb-2 transition-opacity duration-200",
          showControls ? "opacity-100" : "pointer-events-none opacity-0",
        )}
      >
        <Track
          value={duration ? time / duration : 0}
          buffered={buffered}
          onSeek={seek}
          hoverLabel={(r) => formatTime(r * duration)}
        />
        <div className="mt-1 flex items-center gap-0.5">
          <ControlButton label={playing ? "Pause" : "Play"} onClick={toggle}>
            {playing ? (
              <Pause className="size-[18px] fill-current" />
            ) : (
              <Play className="size-[18px] fill-current" />
            )}
          </ControlButton>
          <div className="group/vol flex items-center">
            <ControlButton
              label={muted ? "Unmute" : "Mute"}
              onClick={() => {
                const v = video.current;
                if (v) v.muted = !v.muted;
              }}
            >
              <VolIcon className="size-[18px]" />
            </ControlButton>
            <div className="w-0 overflow-hidden transition-[width] duration-200 group-hover/vol:w-20">
              <Track value={muted ? 0 : volume} onSeek={setVol} className="mx-2 w-16" />
            </div>
          </div>
          <span className="ml-1 text-xs text-white/85 tabular-nums">
            {formatTime(time)} / {formatTime(duration)}
          </span>
          <span className="flex-1" />
          <button
            type="button"
            title="Playback speed"
            onClick={(e) => {
              e.stopPropagation();
              const v = video.current;
              if (v) v.playbackRate = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length] ?? 1;
            }}
            className="h-6 min-w-9 rounded-md px-1.5 text-xs font-semibold text-white/85 hover:bg-white/10 hover:text-white"
          >
            {speed}x
          </button>
          <ControlButton
            label="Picture in picture"
            onClick={() => {
              const v = video.current;
              if (!v) return;
              if (document.pictureInPictureElement) void document.exitPictureInPicture();
              else if (document.pictureInPictureEnabled) void v.requestPictureInPicture();
            }}
          >
            <PictureInPicture2 className="size-[18px]" />
          </ControlButton>
          <a
            href={url}
            download={name}
            aria-label="Download"
            title="Download"
            onClick={(e) => e.stopPropagation()}
            className="grid size-8 place-items-center rounded-md text-white/85 hover:bg-white/10 hover:text-white"
          >
            <Download className="size-[18px]" />
          </a>
          <ControlButton
            label={fullscreen ? "Exit fullscreen" : "Fullscreen"}
            onClick={toggleFullscreen}
          >
            {fullscreen ? (
              <Minimize className="size-[18px]" />
            ) : (
              <Maximize className="size-[18px]" />
            )}
          </ControlButton>
        </div>
      </div>
    </div>
  );
}
