import type { CSSProperties, MouseEventHandler } from "react";

export function MediaImage({
  src,
  alt,
  className,
  style,
  onClick,
  onMouseMove,
  draggable,
  loading,
}: {
  src: string;
  alt: string;
  className?: string;
  style?: CSSProperties;
  onClick?: MouseEventHandler<HTMLElement>;
  onMouseMove?: MouseEventHandler<HTMLElement>;
  draggable?: boolean;
  loading?: "lazy" | "eager";
}) {
  return src.endsWith(".mp4") ? (
    <video
      src={src}
      aria-label={alt}
      className={className}
      style={style}
      onClick={onClick}
      onMouseMove={onMouseMove}
      autoPlay
      loop
      muted
      playsInline
      preload="metadata"
    />
  ) : (
    <img
      src={src}
      alt={alt}
      className={className}
      style={style}
      onClick={onClick}
      onMouseMove={onMouseMove}
      draggable={draggable}
      loading={loading}
    />
  );
}
