const MIN_LUMINANCE = 0.22;

function channels(hex: string): [number, number, number] | null {
  if (!/^#[0-9a-f]{6}$/i.test(hex)) return null;
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function luminance([r, g, b]: [number, number, number]): number {
  const lin = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function toHex(rgb: [number, number, number]): string {
  return `#${rgb.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`;
}

export function readableNameColor(hex: string | null | undefined): string | undefined {
  if (!hex) return undefined;
  const rgb = channels(hex);
  if (!rgb) return undefined;
  for (let t = 0; t <= 1; t += 0.05) {
    const mixed = rgb.map((v) => v + (255 - v) * t) as [number, number, number];
    if (luminance(mixed) >= MIN_LUMINANCE) return toHex(mixed);
  }
  return "#ffffff";
}
