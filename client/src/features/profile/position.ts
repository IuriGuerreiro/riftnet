import type { CardAnchor } from "../../stores/profileCard";

const GAP = 8;
const MARGIN = 8;

export function placeCard(
  anchor: CardAnchor,
  w: number,
  h: number,
  vw: number,
  vh: number,
): { top: number; left: number } {
  let left: number;
  let top: number;
  if (anchor.right + GAP + w <= vw - MARGIN) {
    left = anchor.right + GAP;
    top = anchor.top;
  } else if (anchor.left - GAP - w >= MARGIN) {
    left = anchor.left - GAP - w;
    top = anchor.top;
  } else {
    left = anchor.left;
    top = anchor.bottom + GAP;
  }
  const clamp = (v: number, max: number) => Math.max(MARGIN, Math.min(v, max - MARGIN));
  return { left: clamp(left, vw - w), top: clamp(top, vh - h) };
}
