"""Adept logo morph: A -> Voice -> Screen -> Controller -> A.

Five shards. Each shard has a fixed number of sub-polygons so shapes can
split apart (e.g. one bar -> four face buttons). Rendered with cairo.
"""
import math, os, sys
import cairo

OUT = sys.argv[1]
SIZE = int(sys.argv[2]) if len(sys.argv) > 2 else 600
FPS = 25
N = 96  # points per sub-polygon after resampling

WHITE = (0.97, 0.97, 1.0)
VIOLET = (0.486, 0.424, 0.949)  # #7c6cf2
BG = (0.043, 0.051, 0.071)      # #0b0d12
HOLE = (0.075, 0.08, 0.11)

# ---------- geometry helpers ----------
def bez(p0, p1, p2, p3, n=24):
    out = []
    for i in range(n):
        t = i / n
        u = 1 - t
        out.append((u**3*p0[0] + 3*u*u*t*p1[0] + 3*u*t*t*p2[0] + t**3*p3[0],
                    u**3*p0[1] + 3*u*u*t*p1[1] + 3*u*t*t*p2[1] + t**3*p3[1]))
    return out

def circle(cx, cy, r, n=40):
    return [(cx + r*math.cos(2*math.pi*i/n - math.pi/2), cy + r*math.sin(2*math.pi*i/n - math.pi/2)) for i in range(n)]

def rrect(x0, y0, x1, y1, r, n=8):
    pts = []
    for cx, cy, a0 in ((x1-r, y0+r, -90), (x1-r, y1-r, 0), (x0+r, y1-r, 90), (x0+r, y0+r, 180)):
        for i in range(n + 1):
            a = math.radians(a0 + 90*i/n)
            pts.append((cx + r*math.cos(a), cy + r*math.sin(a)))
    return pts

def plus(cx, cy, arm, th):
    a, t = arm, th/2
    return [(cx-t, cy-a), (cx+t, cy-a), (cx+t, cy-t), (cx+a, cy-t), (cx+a, cy+t), (cx+t, cy+t),
            (cx+t, cy+a), (cx-t, cy+a), (cx-t, cy+t), (cx-a, cy+t), (cx-a, cy-t), (cx-t, cy-t)]

def area(p):
    return sum(p[i][0]*p[(i+1) % len(p)][1] - p[(i+1) % len(p)][0]*p[i][1] for i in range(len(p))) / 2

def resample(poly, n=N):
    if area(poly) < 0:
        poly = poly[::-1]
    # start at vertex nearest top of centroid direction (consistent seam)
    cx = sum(p[0] for p in poly)/len(poly); cy = sum(p[1] for p in poly)/len(poly)
    k = min(range(len(poly)), key=lambda i: math.atan2(poly[i][0]-cx, -(poly[i][1]-cy)) % (2*math.pi))
    poly = poly[k:] + poly[:k]
    segs = [(poly[i], poly[(i+1) % len(poly)]) for i in range(len(poly))]
    lens = [math.dist(a, b) for a, b in segs]
    total = sum(lens)
    out, si, acc = [], 0, 0.0
    for j in range(n):
        d = total*j/n
        while acc + lens[si] < d and si < len(segs)-1:
            acc += lens[si]; si += 1
        a, b = segs[si]
        t = 0 if lens[si] == 0 else (d-acc)/lens[si]
        out.append((a[0]+(b[0]-a[0])*t, a[1]+(b[1]-a[1])*t))
    return out

# ---------- states (120x120 design space) ----------
# Each shard: (color, [sub-polygons]). Sub counts per shard: 1,1,4,2,1
SUBS = [1, 1, 4, 2, 1]

def state_A():
    return [
        (WHITE,  [[(57,14), (57,46), (35.5,59), (46.2,36.5)]]),
        (WHITE,  [[(53.9,54), (30,104), (14,104), (31.9,66.5)]]),
        (WHITE,  [[(53.2,67), (66.8,67), (71.6,77), (44.6,85)]]),
        (VIOLET, [[(63,14), (73.5,36), (84,58), (63,58)]]),
        (VIOLET, [[(71.4,65), (87.4,65), (106,104), (90,104)]]),
    ]

VOICE_X = [24, 42, 60, 78, 96]
VOICE_H = [22, 46, 70, 46, 22]
def bar(i, h):
    x = VOICE_X[i]
    return rrect(x-6, 60-h/2, x+6, 60+h/2, 6)

def state_voice(t=0.0):
    hs = []
    for i in range(5):
        wob = 0.5 + 0.5*math.sin(t*2*math.pi*1.6 + i*1.3)
        hs.append(max(12, VOICE_H[i]*(0.65 + 0.45*wob)))
    # map shards so each travels a short distance from the A
    cols = [WHITE, WHITE, WHITE, VIOLET, VIOLET]
    order = [1, 0, 2, 3, 4]  # shard -> bar index
    return [(cols[s], [bar(order[s], hs[order[s]])]) for s in range(5)]

def state_screen(t=0.0):
    pulse = 0.5 + 0.5*math.sin(t*2*math.pi*1.2)
    return [
        (WHITE,  [rrect(18, 24, 102, 82, 7)]),                                  # bezel
        (VIOLET, [rrect(24, 30, 96, 76, 3)]),                                   # panel
        (WHITE,  [[(52,82), (68,82), (71,95), (49,95)]]),                       # neck
        (WHITE,  [rrect(38, 94, 82, 100, 3)]),                                  # foot
        (lerp_col(WHITE, (1, 1, 1), pulse), [[(53, 41), (53, 65), (73, 53)]]),  # play / live
    ]

def controller_body():
    # Right half then mirrored: DualSense-ish silhouette, 16..104 x 34..98
    r = []
    r += bez((60, 36), (72, 36), (82, 33), (90, 34))
    r += bez((90, 34), (98, 35), (104, 40), (106, 50))
    r += bez((106, 50), (109, 64), (112, 84), (106, 94))
    r += bez((106, 94), (100, 102), (89, 98), (84, 88))
    r += bez((84, 88), (80, 80), (74, 75), (60, 75))
    left = [(120 - x, y) for x, y in reversed(r[1:])]
    return r + left

def state_controller(t=0.0):
    # little button-press beat: one face button dips at a time
    press = int(t*4) % 4
    pr = lambda i: 3.0 if i == press else 3.6
    fb = (86, 53)
    stick_dx = 1.5*math.sin(t*2*math.pi*0.9)
    return [
        (WHITE,  [controller_body()]),
        (VIOLET, [plus(34, 53, 8, 5.2)]),
        (VIOLET, [circle(fb[0], fb[1]-7, pr(0)), circle(fb[0]+7, fb[1], pr(1)),
                  circle(fb[0], fb[1]+7, pr(2)), circle(fb[0]-7, fb[1], pr(3))]),
        (HOLE,   [circle(47 + stick_dx, 66, 6.5), circle(73 - stick_dx, 66, 6.5)]),
        (VIOLET, [rrect(51, 41, 69, 45, 2)]),  # light bar
    ]

def lerp_col(a, b, t):
    return tuple(a[i] + (b[i]-a[i])*t for i in range(3))

def prep(state):
    out = []
    for s, (col, subs) in enumerate(state):
        rs = [resample(p) for p in subs]
        while len(rs) < SUBS[s]:
            rs.append(rs[len(rs) % len(subs)])  # duplicates sit on top of each other
        out.append((col, rs))
    return out

# ---------- timeline ----------
HOLD, MORPH = 1.15, 0.6
STATES = [lambda t: state_A(), state_voice, state_screen, state_controller]
CYCLE = len(STATES)*(HOLD+MORPH)

def ease(t):
    t = min(1, max(0, t))
    c2 = 0.8 * 1.525
    if t < 0.5:
        return ((2*t)**2 * ((c2+1)*2*t - c2)) / 2
    return ((2*t-2)**2 * ((c2+1)*(2*t-2) + c2) + 2) / 2

def frame_shapes(time):
    tc = time % CYCLE
    seg = int(tc // (HOLD+MORPH))
    local = tc - seg*(HOLD+MORPH)
    cur = prep(STATES[seg](local))
    if local < HOLD:
        return cur, seg, 0.0
    nxt_i = (seg+1) % len(STATES)
    nxt = prep(STATES[nxt_i](0.0))
    m = (local - HOLD)/MORPH
    shapes = []
    for s in range(5):
        tt = ease((m - 0.06*s)/(1 - 0.24))
        col = lerp_col(cur[s][0], nxt[s][0], min(1, max(0, tt)))
        subs = []
        for a, b in zip(cur[s][1], nxt[s][1]):
            subs.append([(pa[0]+(pb[0]-pa[0])*tt, pa[1]+(pb[1]-pa[1])*tt) for pa, pb in zip(a, b)])
        shapes.append((col, subs))
    return shapes, seg, m

# ---------- render ----------
def draw(ctx, time):
    W = H = SIZE
    ctx.set_source_rgb(*BG); ctx.paint()
    shapes, seg, m = frame_shapes(time)

    # soft violet glow behind icon, breathing
    g = cairo.RadialGradient(W/2, H*0.42, 0, W/2, H*0.42, W*0.48)
    a = 0.18
    g.add_color_stop_rgba(0, VIOLET[0], VIOLET[1], VIOLET[2], a)
    g.add_color_stop_rgba(1, VIOLET[0], VIOLET[1], VIOLET[2], 0)
    ctx.set_source(g); ctx.paint()

    # icon
    ctx.save()
    s = W*0.62/120 * (1 - 0.07*math.sin(math.pi*m) if 0 < m < 1 else 1)
    ctx.translate(W/2 - 60*s, H*0.42 - 60*s)
    ctx.scale(s, s)
    # tiny squash on morph for life
    shapes = sorted(shapes, key=lambda cs: -sum(abs(area(q)) for q in cs[1][:1]))
    for col, subs in shapes:
        ctx.set_source_rgb(*col)
        for p in subs:
            ctx.move_to(*p[0])
            for q in p[1:]:
                ctx.line_to(*q)
            ctx.close_path()
        ctx.fill()
    ctx.restore()

    # wordmark
    ctx.select_font_face("URW Gothic", cairo.FONT_SLANT_NORMAL, cairo.FONT_WEIGHT_BOLD)
    ctx.set_font_size(W*0.085)
    text = "ADEPT"
    track = W*0.035
    widths = [ctx.text_extents(c).x_advance for c in text]
    total = sum(widths) + track*(len(text)-1)
    x = W/2 - total/2
    y = H*0.86
    for i, c in enumerate(text):
        ctx.set_source_rgb(*(VIOLET if i == 0 else WHITE))
        ctx.move_to(x, y); ctx.show_text(c)
        x += widths[i] + track

    # state dots
    labels = 4
    cur = seg if m < 0.5 else (seg+1) % 4
    for i in range(labels):
        cx = W/2 + (i-1.5)*W*0.035
        ctx.arc(cx, H*0.93, W*0.006 if i != cur else W*0.009, 0, 2*math.pi)
        ctx.set_source_rgba(*(VIOLET if i == cur else (1, 1, 1)), 1 if i == cur else 0.25)
        ctx.fill()

os.makedirs(OUT, exist_ok=True)
frames = int(round(CYCLE*FPS))
for f in range(frames):
    surf = cairo.ImageSurface(cairo.FORMAT_RGB24, SIZE, SIZE)
    ctx = cairo.Context(surf)
    ctx.set_antialias(cairo.ANTIALIAS_BEST)
    draw(ctx, f/FPS)
    surf.write_to_png(os.path.join(OUT, f"f_{f:04d}.png"))
print(frames, "frames")

# static check: each state at hold
for i, name in enumerate(["a", "voice", "screen", "controller"]):
    surf = cairo.ImageSurface(cairo.FORMAT_RGB24, SIZE, SIZE)
    ctx = cairo.Context(surf)
    draw(ctx, i*(HOLD+MORPH) + 0.3)
    surf.write_to_png(os.path.join(OUT, f"state_{name}.png"))
