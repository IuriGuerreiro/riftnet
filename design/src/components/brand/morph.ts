// INVARIANT: geometry mirrors docs/brand/animation/render_adept_anim.py; keep both in sync.
type Pt = readonly [number, number];
type Poly = Pt[];
export type Rgb = readonly [number, number, number];
interface Shard {
  col: Rgb;
  subs: Poly[];
}

const N = 96;
const SUBS = [1, 1, 4, 2, 1];

export const WHITE: Rgb = [0.97, 0.97, 1];
export const VIOLET: Rgb = [0.486, 0.424, 0.949];
export const HOLE: Rgb = [0.075, 0.08, 0.11];

const TAU = Math.PI * 2;

function bez(p0: Pt, p1: Pt, p2: Pt, p3: Pt, n = 24): Poly {
  const out: Poly = [];
  for (let i = 0; i < n; i++) {
    const t = i / n;
    const u = 1 - t;
    out.push([
      u ** 3 * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t ** 3 * p3[0],
      u ** 3 * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t ** 3 * p3[1],
    ]);
  }
  return out;
}

function circle(cx: number, cy: number, r: number, n = 40): Poly {
  return Array.from({ length: n }, (_, i): Pt => {
    const a = (TAU * i) / n - Math.PI / 2;
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  });
}

function rrect(x0: number, y0: number, x1: number, y1: number, r: number, n = 8): Poly {
  const pts: Poly = [];
  const corners: [number, number, number][] = [
    [x1 - r, y0 + r, -90],
    [x1 - r, y1 - r, 0],
    [x0 + r, y1 - r, 90],
    [x0 + r, y0 + r, 180],
  ];
  for (const [cx, cy, a0] of corners) {
    for (let i = 0; i <= n; i++) {
      const a = ((a0 + (90 * i) / n) * Math.PI) / 180;
      pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
    }
  }
  return pts;
}

function plus(cx: number, cy: number, a: number, th: number): Poly {
  const t = th / 2;
  return [
    [cx - t, cy - a],
    [cx + t, cy - a],
    [cx + t, cy - t],
    [cx + a, cy - t],
    [cx + a, cy + t],
    [cx + t, cy + t],
    [cx + t, cy + a],
    [cx - t, cy + a],
    [cx - t, cy + t],
    [cx - a, cy + t],
    [cx - a, cy - t],
    [cx - t, cy - t],
  ];
}

const at = <T>(xs: readonly T[], i: number): T => xs[i] as T;

function area(p: Poly): number {
  let s = 0;
  for (let i = 0; i < p.length; i++) {
    const a = at(p, i);
    const b = at(p, (i + 1) % p.length);
    s += a[0] * b[1] - b[0] * a[1];
  }
  return s / 2;
}

function resample(input: Poly, n = N): Poly {
  let poly = area(input) < 0 ? [...input].reverse() : input;
  const cx = poly.reduce((s, p) => s + p[0], 0) / poly.length;
  const cy = poly.reduce((s, p) => s + p[1], 0) / poly.length;
  const angle = (p: Pt) => ((Math.atan2(p[0] - cx, -(p[1] - cy)) % TAU) + TAU) % TAU;
  let k = 0;
  for (let i = 1; i < poly.length; i++) if (angle(at(poly, i)) < angle(at(poly, k))) k = i;
  poly = [...poly.slice(k), ...poly.slice(0, k)];

  const lens = poly.map((a, i) => {
    const b = at(poly, (i + 1) % poly.length);
    return Math.hypot(b[0] - a[0], b[1] - a[1]);
  });
  const total = lens.reduce((s, l) => s + l, 0);
  const out: Poly = [];
  let si = 0;
  let acc = 0;
  for (let j = 0; j < n; j++) {
    const d = (total * j) / n;
    while (acc + at(lens, si) < d && si < lens.length - 1) {
      acc += at(lens, si);
      si += 1;
    }
    const a = at(poly, si);
    const b = at(poly, (si + 1) % poly.length);
    const len = at(lens, si);
    const t = len === 0 ? 0 : (d - acc) / len;
    out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
  }
  return out;
}

const mix = (a: Rgb, b: Rgb, t: number): Rgb => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];

function stateA(): Shard[] {
  return [
    {
      col: WHITE,
      subs: [
        [
          [57, 14],
          [57, 46],
          [35.5, 59],
          [46.2, 36.5],
        ],
      ],
    },
    {
      col: WHITE,
      subs: [
        [
          [53.9, 54],
          [30, 104],
          [14, 104],
          [31.9, 66.5],
        ],
      ],
    },
    {
      col: WHITE,
      subs: [
        [
          [53.2, 67],
          [66.8, 67],
          [71.6, 77],
          [44.6, 85],
        ],
      ],
    },
    {
      col: VIOLET,
      subs: [
        [
          [63, 14],
          [73.5, 36],
          [84, 58],
          [63, 58],
        ],
      ],
    },
    {
      col: VIOLET,
      subs: [
        [
          [71.4, 65],
          [87.4, 65],
          [106, 104],
          [90, 104],
        ],
      ],
    },
  ];
}

const VOICE_X = [24, 42, 60, 78, 96];
const VOICE_H = [22, 46, 70, 46, 22];

function stateVoice(t: number): Shard[] {
  const hs = VOICE_H.map((h, i) => {
    const wob = 0.5 + 0.5 * Math.sin(t * TAU * 1.6 + i * 1.3);
    return Math.max(12, h * (0.65 + 0.45 * wob));
  });
  const cols = [WHITE, WHITE, WHITE, VIOLET, VIOLET];
  const order = [1, 0, 2, 3, 4];
  return order.map((bi, s) => {
    const x = at(VOICE_X, bi);
    const h = at(hs, bi);
    return { col: at(cols, s), subs: [rrect(x - 6, 60 - h / 2, x + 6, 60 + h / 2, 6)] };
  });
}

function stateScreen(t: number): Shard[] {
  const pulse = 0.5 + 0.5 * Math.sin(t * TAU * 1.2);
  return [
    { col: WHITE, subs: [rrect(18, 24, 102, 82, 7)] },
    { col: VIOLET, subs: [rrect(24, 30, 96, 76, 3)] },
    {
      col: WHITE,
      subs: [
        [
          [52, 82],
          [68, 82],
          [71, 95],
          [49, 95],
        ],
      ],
    },
    { col: WHITE, subs: [rrect(38, 94, 82, 100, 3)] },
    {
      col: mix(WHITE, [1, 1, 1], pulse),
      subs: [
        [
          [53, 41],
          [53, 65],
          [73, 53],
        ],
      ],
    },
  ];
}

function controllerBody(): Poly {
  const r: Poly = [
    ...bez([60, 36], [72, 36], [82, 33], [90, 34]),
    ...bez([90, 34], [98, 35], [104, 40], [106, 50]),
    ...bez([106, 50], [109, 64], [112, 84], [106, 94]),
    ...bez([106, 94], [100, 102], [89, 98], [84, 88]),
    ...bez([84, 88], [80, 80], [74, 75], [60, 75]),
  ];
  const left = r
    .slice(1)
    .reverse()
    .map(([x, y]): Pt => [120 - x, y]);
  return [...r, ...left];
}

function stateController(t: number, hole: Rgb): Shard[] {
  const press = Math.floor(t * 4) % 4;
  const pr = (i: number) => (i === press ? 3 : 3.6);
  const fx = 86;
  const fy = 53;
  const dx = 1.5 * Math.sin(t * TAU * 0.9);
  return [
    { col: WHITE, subs: [controllerBody()] },
    { col: VIOLET, subs: [plus(34, 53, 8, 5.2)] },
    {
      col: VIOLET,
      subs: [
        circle(fx, fy - 7, pr(0)),
        circle(fx + 7, fy, pr(1)),
        circle(fx, fy + 7, pr(2)),
        circle(fx - 7, fy, pr(3)),
      ],
    },
    { col: hole, subs: [circle(47 + dx, 66, 6.5), circle(73 - dx, 66, 6.5)] },
    { col: VIOLET, subs: [rrect(51, 41, 69, 45, 2)] },
  ];
}

function prep(state: Shard[]): Shard[] {
  return state.map((shard, s) => {
    const rs = shard.subs.map((p) => resample(p));
    while (rs.length < at(SUBS, s)) rs.push(at(rs, rs.length % shard.subs.length));
    return { col: shard.col, subs: rs };
  });
}

export const HOLD = 1.15;
export const MORPH = 0.6;
export const STATE_COUNT = 4;
export const CYCLE = STATE_COUNT * (HOLD + MORPH);

function ease(x: number): number {
  const t = Math.min(1, Math.max(0, x));
  const c2 = 0.8 * 1.525;
  if (t < 0.5) return ((2 * t) ** 2 * ((c2 + 1) * 2 * t - c2)) / 2;
  return ((2 * t - 2) ** 2 * ((c2 + 1) * (2 * t - 2) + c2) + 2) / 2;
}

function stateAt(i: number, t: number, hole: Rgb): Shard[] {
  switch (i) {
    case 1:
      return stateVoice(t);
    case 2:
      return stateScreen(t);
    case 3:
      return stateController(t, hole);
    default:
      return stateA();
  }
}

export interface Frame {
  shapes: Shard[];
  seg: number;
  m: number;
}

export function frameAt(time: number, hole: Rgb = HOLE): Frame {
  const tc = ((time % CYCLE) + CYCLE) % CYCLE;
  const seg = Math.floor(tc / (HOLD + MORPH));
  const local = tc - seg * (HOLD + MORPH);
  const cur = prep(stateAt(seg, local, hole));
  if (local < HOLD) return { shapes: cur, seg, m: 0 };

  const nxt = prep(stateAt((seg + 1) % STATE_COUNT, 0, hole));
  const m = (local - HOLD) / MORPH;
  const shapes = cur.map((c, s): Shard => {
    const n = at(nxt, s);
    const tt = ease((m - 0.06 * s) / (1 - 0.24));
    return {
      col: mix(c.col, n.col, Math.min(1, Math.max(0, tt))),
      subs: c.subs.map((a, k) => {
        const b = at(n.subs, k);
        return a.map((pa, j): Pt => {
          const pb = at(b, j);
          return [pa[0] + (pb[0] - pa[0]) * tt, pa[1] + (pb[1] - pa[1]) * tt];
        });
      }),
    };
  });
  return { shapes, seg, m };
}

export function drawFrame(ctx: CanvasRenderingContext2D, size: number, frame: Frame) {
  const { m } = frame;
  const squash = m > 0 && m < 1 ? 1 - 0.07 * Math.sin(Math.PI * m) : 1;
  const s = (size / 120) * squash;
  ctx.clearRect(0, 0, size, size);
  ctx.save();
  ctx.translate(size / 2 - 60 * s, size / 2 - 60 * s);
  ctx.scale(s, s);
  const ordered = [...frame.shapes].sort(
    (a, b) => Math.abs(area(at(b.subs, 0))) - Math.abs(area(at(a.subs, 0))),
  );
  for (const { col, subs } of ordered) {
    ctx.fillStyle = `rgb(${col.map((c) => Math.round(c * 255)).join(",")})`;
    ctx.beginPath();
    for (const p of subs) {
      const [first, ...rest] = p;
      if (!first) continue;
      ctx.moveTo(first[0], first[1]);
      for (const q of rest) ctx.lineTo(q[0], q[1]);
      ctx.closePath();
    }
    ctx.fill();
  }
  ctx.restore();
}

export function activeState(frame: Frame): number {
  return frame.m < 0.5 ? frame.seg : (frame.seg + 1) % STATE_COUNT;
}
