import { useLayoutEffect, useRef, useState } from "react";

import { useBannerUrl, useLoadProfile } from "../../api/profile";
import { Avatar } from "../../components/Avatar";
import { StatusDot } from "../../components/StatusDot";
import { Skeleton } from "../../components/ui";
import { useProfileCard } from "../../stores/profileCard";
import { nameOf, type Profile, useProfile } from "../../stores/profiles";
import { placeCard } from "./position";
import { TRIGGER_ATTR } from "./ProfileTrigger";

const CARD_WIDTH = 300;

export function ProfileCardHost() {
  const shown = useProfileCard((s) => s.shown);
  const close = useProfileCard((s) => s.close);
  if (!shown) return null;
  return <FloatingCard key={shown.userId} {...shown} onClose={close} />;
}

function FloatingCard({
  userId,
  anchor,
  onClose,
}: {
  userId: string;
  anchor: { top: number; left: number; right: number; bottom: number };
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const profile = useProfile(userId);
  const load = useLoadProfile(userId, !!profile);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const place = () =>
      setPos(placeCard(anchor, CARD_WIDTH, el.offsetHeight, window.innerWidth, window.innerHeight));
    place();
    const ro = new ResizeObserver(place);
    ro.observe(el);
    return () => ro.disconnect();
  }, [anchor]);

  useLayoutEffect(() => {
    ref.current?.focus();
    const onDown = (e: MouseEvent) => {
      const t = e.target as Element;
      if (ref.current?.contains(t) || t.closest(`[${TRIGGER_ATTR}]`)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", onClose);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onClose);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label={`Profile of ${nameOf(profile)}`}
      tabIndex={-1}
      style={{ width: CARD_WIDTH, top: pos?.top ?? anchor.top, left: pos?.left ?? anchor.right }}
      className={`fixed z-50 outline-none ${pos ? "" : "invisible"}`}
    >
      {profile ? (
        <ProfileCardBody profile={profile} />
      ) : (
        <div className="space-y-3 rounded-panel border border-line bg-surface-1 p-4 shadow-pop">
          {load.isError ? (
            <p className="text-sm text-fg-muted">Couldn't load this profile.</p>
          ) : (
            <>
              <Skeleton className="h-24 w-full" />
              <Skeleton className="h-4 w-1/2" />
            </>
          )}
        </div>
      )}
    </div>
  );
}

export function ProfileCardBody({
  profile,
  bannerPreview,
}: {
  profile: Profile;
  bannerPreview?: string | null;
}) {
  const { data: bannerUrl } = useBannerUrl(profile.id, profile.bannerHash);
  const banner = bannerPreview ?? bannerUrl ?? null;
  const accent = profile.accentColor;

  return (
    <article
      className="overflow-hidden rounded-panel border bg-surface-1 shadow-pop"
      style={{ borderColor: accent ?? "var(--color-line)" }}
    >
      <div
        className="aspect-[5/2] w-full bg-surface-3 bg-cover bg-center"
        style={{
          backgroundColor: accent ?? undefined,
          backgroundImage: banner ? `url("${banner}")` : undefined,
        }}
      />
      <div className="relative px-4 pb-4">
        <span className="relative -mt-12 inline-flex rounded-full bg-surface-1 p-1">
          <Avatar userId={profile.id} size="lg" />
          <StatusDot
            userId={profile.id}
            className="absolute bottom-1.5 right-1.5 size-5! border-4 border-surface-1"
          />
        </span>
        <h2 className="mt-1 break-words text-lg font-bold leading-tight text-fg">
          {nameOf(profile)}
        </h2>
        <p className="text-sm text-fg-muted">
          {profile.username && <span>@{profile.username}</span>}
          {profile.username && profile.pronouns && <span aria-hidden> · </span>}
          {profile.pronouns && <span>{profile.pronouns}</span>}
        </p>
        {profile.customStatus && (
          <p className="mt-2 break-words text-sm text-fg">{profile.customStatus}</p>
        )}
        {profile.bio && (
          <section className="mt-3 border-t border-line pt-3">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-fg-subtle">
              About me
            </h3>
            <p className="mt-1 whitespace-pre-wrap break-words text-sm text-fg-muted">
              {profile.bio}
            </p>
          </section>
        )}
      </div>
    </article>
  );
}
