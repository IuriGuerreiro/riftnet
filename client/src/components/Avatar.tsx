import { useState } from "react";

import { type AvatarSize, useAvatarUrl } from "../api/profile";
import { nameOf, useProfile } from "../stores/profiles";

const px = {
  xs: "size-6 text-[10px]",
  sm: "size-8 text-xs",
  md: "size-10 text-sm",
  lg: "size-24 text-3xl",
} as const;
const colors = ["bg-sky-600", "bg-emerald-600", "bg-violet-600", "bg-amber-600", "bg-rose-600"];

export function Avatar({
  userId,
  size = "sm",
}: {
  userId: string | bigint | undefined;
  size?: keyof typeof px;
}) {
  const id = userId?.toString() ?? "";
  const profile = useProfile(id);
  const hash = profile?.avatarHash ?? null;
  const fetchSize: AvatarSize = size === "lg" ? 512 : 128;
  const { data: url, refetch } = useAvatarUrl(id, hash, fetchSize);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const [retriedHash, setRetriedHash] = useState<string | null>(null);

  function onImageError(bad: string) {
    setFailedUrl(bad);
    if (hash && retriedHash !== hash) {
      setRetriedHash(hash);
      void refetch();
    }
  }

  const label = nameOf(profile);
  const base = `${px[size]} shrink-0 rounded-full`;
  if (url && failedUrl !== url) {
    return (
      <img
        src={url}
        alt={label}
        title={label}
        onError={() => onImageError(url)}
        className={`${base} bg-surface-2 object-cover`}
      />
    );
  }
  const initial = (profile?.displayName ?? profile?.username ?? "?").charAt(0).toUpperCase();
  const color = colors[Number(BigInt(id || "0") % BigInt(colors.length))];
  return (
    <span
      title={label}
      className={`${base} ${color} flex items-center justify-center font-bold text-white`}
    >
      {initial}
    </span>
  );
}
