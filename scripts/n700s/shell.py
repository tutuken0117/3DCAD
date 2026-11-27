"""
車体の外板を数式で作り直す（先頭形状は N700S のデュアル スプリーム ウィング形を目標に）。

断面（右半分）は、下から
  床下の平らな底 → 下部の丸み（灰色）→ 平らな側面 → 肩の丸み（ドーム）→ 屋根の中心
の順につなぎ、先頭部では断面の大きさ・形を先端からの距離 d で少しずつ変える。
- 先頭長 10.7 m（N700 系と同じ）。先端は高さ約 1.0 m の一点にすぼまる
- 運転台の盛り上がり（キャノピー）を中央に重ね、その左右は低い「翼」の面になる
- 先頭部の肩は丸みを小さくして、側面のエッジ（稜線）を立てる
- 前面窓は盛り上がりの上の曲面の一部をガラスにし、黒い縁取りを重ねる
- 平らな側面（d ≥ 7 m）は 1 枚の平面に窓・ドア窓の穴を正確に空ける
- 台車のところは下部の丸みを途中で切って、台車が見える開口にする

座標: x = 長さ方向（先端 X_TIP、後ろの妻面 X_END）、y = 上（レール面 0）、z = 幅。
"""
import math
from lib import Frame, rect2, norm, cross, sub, add, mul, text_shapes, ccw

X_TIP = -13.675
X_END = 13.675
NOSE = 10.7           # 先頭長
FLAT_FROM = 7.0       # これより後ろは側面が平ら
LAYER = 'N700S body'

C_WHITE = '#f5f7f7'
C_GRAY = '#707a7f'
C_GLASS = 'mat:glass'
C_FRAME = '#15191c'
C_WELL = '#2b2f33'

BOGIES = [(-8.85, -5.15), (8.65, 12.35)]   # 台車の開口（x）
SKIRT_K = 7                                 # 下部の丸みの、この点より下を台車のところで切る


# ---------------------------------------------------------------------------
# なめらかな補間（Fritsch–Carlson の単調 3 次）
# ---------------------------------------------------------------------------
class Curve:
    def __init__(self, pts):
        self.x = [p[0] for p in pts]
        self.y = [p[1] for p in pts]
        n = len(pts)
        dl = [(self.y[i + 1] - self.y[i]) / (self.x[i + 1] - self.x[i]) for i in range(n - 1)]
        m = [0.0] * n
        m[0], m[-1] = dl[0], dl[-1]
        for i in range(1, n - 1):
            m[i] = 0.0 if dl[i - 1] * dl[i] <= 0 else (dl[i - 1] + dl[i]) / 2
        for i in range(n - 1):
            if dl[i] == 0:
                m[i] = m[i + 1] = 0.0
            else:
                a, b = m[i] / dl[i], m[i + 1] / dl[i]
                s = a * a + b * b
                if s > 9:
                    t = 3 / math.sqrt(s)
                    m[i], m[i + 1] = t * a * dl[i], t * b * dl[i]
        self.m = m

    def __call__(self, t):
        x, y, m = self.x, self.y, self.m
        if t <= x[0]:
            return y[0]
        if t >= x[-1]:
            return y[-1]
        lo, hi = 0, len(x) - 1
        while hi - lo > 1:
            mid = (lo + hi) // 2
            if x[mid] <= t:
                lo = mid
            else:
                hi = mid
        h = x[hi] - x[lo]
        s = (t - x[lo]) / h
        h00, h10, h01, h11 = 2 * s ** 3 - 3 * s ** 2 + 1, s ** 3 - 2 * s ** 2 + s, -2 * s ** 3 + 3 * s ** 2, s ** 3 - s ** 2
        return h00 * y[lo] + h10 * h * m[lo] + h01 * y[hi] + h11 * h * m[hi]


# 先端からの距離 d [m] ごとの寸法
W = Curve([(0, 0.0), (0.12, 0.30), (0.35, 0.58), (0.8, 0.90), (1.5, 1.18), (2.5, 1.40), (3.5, 1.53), (4.5, 1.61), (5.5, 1.655), (6.5, 1.676), (7.0, 1.68), (99, 1.68)])
TW = Curve([(0, 1.00), (0.12, 1.12), (0.35, 1.27), (0.8, 1.45), (1.5, 1.66), (2.5, 1.90), (3.5, 2.10), (4.5, 2.27), (5.5, 2.45), (6.5, 2.66), (7.2, 2.85), (8.0, 3.06), (9.0, 3.30), (10.0, 3.50), (10.7, 3.60), (99, 3.60)])
HUMP = Curve([(0, 0.0), (3.0, 0.0), (4.0, 0.08), (5.0, 0.19), (6.0, 0.28), (7.2, 0.33), (8.0, 0.30), (9.0, 0.18), (10.0, 0.06), (10.7, 0.0), (99, 0.0)])
HUMP_W = 1.05
YS = Curve([(0, 1.00), (0.35, 1.05), (1.0, 1.18), (2.0, 1.38), (3.0, 1.58), (4.0, 1.78), (5.0, 1.98), (6.0, 2.21), (7.0, 2.45), (8.0, 2.72), (9.0, 2.86), (10.0, 2.93), (10.7, 2.95), (99, 2.95)])
EXP = Curve([(0, 2.2), (1.5, 3.0), (5.0, 3.4), (8.0, 3.0), (10.7, 2.4), (99, 2.4)])
BOT = Curve([(0, 0.98), (0.15, 0.80), (0.5, 0.62), (1.2, 0.52), (2.5, 0.47), (4.0, 0.45), (99, 0.45)])
WB = Curve([(0, 0.0), (1.0, 0.55), (3.0, 1.05), (6.0, 1.25), (8.0, 1.30), (99, 1.30)])
LOW_EXP = 2.2

NB = 3      # 底の点の数
NL = 10     # 下部の丸み
NS = 5      # 側面（先頭部だけ）
NT = 34     # 肩〜屋根の中心


def gray_line(d):
    """白と灰色の塗り分けの高さ（先頭部では下回りだけ灰色）"""
    t = min(1.0, max(0.0, d / 8.0))
    return 0.78 + (1.04 - 0.78) * t * t * (3 - 2 * t)


def spow(x, p):
    return math.copysign(abs(x) ** p, x)


def params(d):
    w = W(d)
    ys = YS(d)
    yw = min(1.0, ys - 0.02)
    return dict(w=w, tw=max(TW(d), ys), hump=HUMP(d), ys=ys, a=EXP(d), b=min(BOT(d), yw - 0.01), wb=min(WB(d), w), yw=yw)


def ring(d):
    """右半分の断面の点 [(z, y)]。底の中心 → 屋根の中心。区切りの番号も返す"""
    p = params(d)
    w, ys, yw, b, wb = p['w'], p['ys'], p['yw'], p['b'], p['wb']
    pts = []
    for k in range(NB):
        pts.append((wb * k / (NB - 1), b))
    for k in range(1, NL + 1):
        phi = math.pi / 2 * k / NL
        z = wb + (w - wb) * spow(math.sin(phi), 2 / LOW_EXP)
        y = yw - (yw - b) * spow(math.cos(phi), 2 / LOW_EXP)
        pts.append((z, y))
    i_waist = len(pts) - 1
    for k in range(1, NS + 1):
        pts.append((w, yw + (ys - yw) * k / NS))
    i_side = len(pts) - 1
    a = p['a']
    for k in range(1, NT + 1):
        psi = math.pi / 2 * k / NT
        z = w * spow(math.cos(psi), 2 / a)
        y = ys + (p['tw'] - ys) * spow(math.sin(psi), 2 / a)
        u = z / HUMP_W
        if u < 1:
            y += p['hump'] * (1 - u * u) ** 2
        pts.append((z, y))
    return pts, i_waist, i_side


def surf_z(d, y):
    """右側で高さ y のところの外板の z（側面〜肩〜屋根の範囲）。屋根より上なら None"""
    pts, iw, isd = ring(d)
    if y <= pts[iw][1]:
        seg = pts[NB - 1:iw + 1]
    else:
        seg = pts[iw:]
    for i in range(len(seg) - 1):
        (z0, y0), (z1, y1) = seg[i], seg[i + 1]
        if (y0 - y) * (y1 - y) <= 0 and y1 != y0:
            t = (y - y0) / (y1 - y0)
            return z0 + (z1 - z0) * t
    return None


def surf_y(d, z):
    """右側で幅 z のところの上面の高さ"""
    pts, iw, isd = ring(d)
    top = pts[isd:]
    for i in range(len(top) - 1):
        (z0, y0), (z1, y1) = top[i], top[i + 1]
        if (z0 - z) * (z1 - z) <= 0 and z1 != z0:
            t = (z - z0) / (z1 - z0)
            return y0 + (y1 - y0) * t
    return top[-1][1]


def side_point(x, y, off=0.004, s=1):
    """側面〜肩の点 (x, y) を外板に載せ、外向きに off だけ浮かせた点"""
    d = x - X_TIP
    z = surf_z(d, y)
    if z is None:
        return None
    # 法線（断面内）: 近くの点から
    e = 0.004
    z1 = surf_z(d, y + e)
    z0 = surf_z(d, y - e)
    if z1 is None or z0 is None:
        nz, ny = 1.0, 0.0
    else:
        dz, dy = z1 - z0, 2 * e
        l = math.hypot(dz, dy)
        nz, ny = dy / l, -dz / l
    # 長さ方向の傾き
    za = surf_z(d + 0.01, y)
    nx = 0.0
    if za is not None:
        nx = -(za - z) / 0.01 * nz
    l = math.sqrt(nx * nx + ny * ny + nz * nz)
    nx, ny, nz = nx / l, ny / l, nz / l
    return (x + nx * off, y + ny * off, s * (z + nz * off))


def top_point(x, z, off=0.004):
    """上面（屋根・キャノピー）の点 (x, z) を外板に載せ、上へ off だけ浮かせた点"""
    d = x - X_TIP
    y = surf_y(d, abs(z))
    e = 0.004
    gx = (surf_y(d + e, abs(z)) - surf_y(d - e, abs(z))) / (2 * e)
    gz = (surf_y(d, abs(z) + e) - surf_y(d, max(0.0, abs(z) - e))) / (2 * e) * (1 if z >= 0 else -1)
    n = norm((-gx, 1.0, -gz))
    return (x + n[0] * off, y + n[1] * off, z + n[2] * off)


# ---------------------------------------------------------------------------
# 前面窓の形（上から見た d・z）
# ---------------------------------------------------------------------------
WS_D0, WS_D1 = 4.95, 7.22


def ws_halfwidth(d):
    if d <= WS_D0 or d >= WS_D1:
        return 0.0
    dc = (WS_D0 + WS_D1) / 2
    hl = (WS_D1 - WS_D0) / 2
    t = abs(d - dc) / hl
    base = (1 - t ** 2.6) ** (1 / 2.6)
    taper = 0.70 + 0.30 * (d - WS_D0) / (WS_D1 - WS_D0)
    return 0.88 * base * taper


def in_windshield(d, z, grow=0.0):
    hw = ws_halfwidth(d - grow * 0.5 if d < (WS_D0 + WS_D1) / 2 else d + grow * 0.5)
    return abs(z) < hw + grow


def ws_outline(scale_off=0.0, n=120):
    """前面窓の輪郭（右回り・上から見た x, z）。scale_off だけ外へ広げる"""
    pts = []
    dc = (WS_D0 + WS_D1) / 2
    hl = (WS_D1 - WS_D0) / 2 + scale_off
    for k in range(n):
        t = 2 * math.pi * k / n
        dd = dc + hl * spow(math.cos(t), 2 / 2.6)
        taper = 0.70 + 0.30 * min(1, max(0, (dd - WS_D0) / (WS_D1 - WS_D0)))
        zz = (0.88 * taper + scale_off) * spow(math.sin(t), 2 / 2.6)
        pts.append((X_TIP + dd, zz))
    return pts


# ---------------------------------------------------------------------------
# 外板
# ---------------------------------------------------------------------------
def stations():
    ds = set()
    N = 150
    for k in range(N + 1):
        ds.add(round(NOSE * (k / N) ** 1.55, 4))
    d = 4.6
    while d < 7.6:
        ds.add(round(d, 4))
        d += 0.035
    for (xa, xb) in BOGIES:
        ds.add(round(xa - X_TIP, 4))
        ds.add(round(xb - X_TIP, 4))
    ds.add(FLAT_FROM)
    ds.add(round(X_END - X_TIP, 4))
    return sorted(x for x in ds if 0 <= x <= X_END - X_TIP)


def in_bogie(x):
    return any(a - 1e-6 <= x <= b + 1e-6 for a, b in BOGIES)


def build_shell(b, holes):
    """holes: 側面の平面に空ける穴 [(x,y) の多角形]"""
    b.begin('車体の外板（先頭形状 R24）', LAYER)
    b.soft = True
    ds = stations()
    rings = []
    for d in ds:
        pts, iw, isd = ring(d)
        rings.append((d, pts, iw, isd))
    NP = len(rings[0][1])

    def P(i, k, s):
        d, pts, iw, isd = rings[i]
        z, y = pts[k]
        return (X_TIP + d, y, s * z)

    def color(d, y, z):
        if y < gray_line(d):
            return C_GRAY
        return C_WHITE

    for i in range(len(rings) - 1):
        d0, d1 = rings[i][0], rings[i + 1][0]
        dm = (d0 + d1) / 2
        xm = X_TIP + dm
        body = d0 >= NOSE - 1e-6
        for k in range(NP - 1):
            # 平らな側面（d ≥ FLAT_FROM）の部分は、あとで穴あきの平面で作る
            iw, isd = rings[i][2], rings[i][3]
            if d0 >= FLAT_FROM - 1e-6 and iw <= k < isd:
                continue
            # 台車のところは、下部の丸みの SKIRT_K より下を作らない
            if in_bogie(xm) and k < NB - 1 + SKIRT_K:
                continue
            # 胴体の一定の断面は 1 本の長い帯で（途中の台車の境目だけ分ける）
            for s in (1, -1):
                q = [P(i, k, s), P(i + 1, k, s), P(i + 1, k + 1, s), P(i, k + 1, s)]
                if s < 0:
                    q = list(reversed(q))
                cz = sum(p[2] for p in q) / 4
                cy = sum(p[1] for p in q) / 4
                # 塗り分けは外板の点の列に沿わせる（ギザギザにしない）。先頭部は下回りだけ灰色
                kg = (NB - 1 + 6) if dm < 6.5 else iw
                col = C_GRAY if k < kg else C_WHITE
                if k >= isd and in_windshield(dm, abs(cz)):
                    col = C_GLASS
                b.face(q, col)
    # 先端の一点（d=0 の輪は一点にすぼむので、上の面で閉じている）
    # 平らな側面（穴あき）
    b.soft = False
    for s in (1, -1):
        top = []
        bot = []
        for (d, pts, iw, isd) in rings:
            if d < FLAT_FROM - 1e-6:
                continue
            top.append((X_TIP + d, pts[isd][1]))
            bot.append((X_TIP + d, pts[iw][1]))
        outline = bot + list(reversed(top))
        fr = Frame((0, 0, s * W(99)), (1, 0, 0), (0, 1, 0))  # n = +z
        if s < 0:
            fr = Frame((0, 0, s * W(99)), (-1, 0, 0), (0, 1, 0))
        f = (lambda p: p) if s > 0 else (lambda p: (-p[0], p[1]))
        outer = [f(p) for p in outline]
        hs = [[f(p) for p in h] for h in holes]
        b.poly(fr, outer, C_WHITE, 0.0, False, hs)
    # 後ろの妻面
    b.begin('後ろの妻面', LAYER)
    d, pts, iw, isd = rings[-1]
    loop = [(X_END, y, z) for (z, y) in pts] + [(X_END, y, -z) for (z, y) in reversed(pts[1:-1])]
    b.face(list(reversed(loop)), '#e8ebec')
    # 台車の開口（天井と前後の壁）
    b.begin('台車の開口（外板の内側）', LAYER)
    for (xa, xb) in BOGIES:
        da = xa - X_TIP
        pts, iw, isd = ring(da)
        kc = NB - 1 + SKIRT_K
        zc, yc = pts[kc]
        b.box(xa, xb, 0.97, 0.98, -zc, zc, C_WELL)
        for x in (xa, xb):
            low = pts[:kc + 1]
            poly = [(x, y, z) for (z, y) in reversed(low)] + [(x, y, -z) for (z, y) in low[1:]]
            poly = [(x, 0.98, -zc)] + poly[::-1] + [(x, 0.98, zc)]
            b.face(poly, C_WELL)
    b.soft = False


# ---------------------------------------------------------------------------
# 外板に貼る模様（帯・縁取り・前照灯・継ぎ目など）
# ---------------------------------------------------------------------------
def strip_side(b, x0, x1, ylo, yhi, color, n=None, off=0.004, both=True):
    """側面〜肩に貼る帯。ylo(x)・yhi(x) は x の関数"""
    n = n or max(4, int(abs(x1 - x0) / 0.05))
    for s in ((1, -1) if both else (1,)):
        prev = None
        for k in range(n + 1):
            x = x0 + (x1 - x0) * k / n
            lo, hi = ylo(x), yhi(x)
            if hi - lo < 1e-4:
                cur = None
            else:
                cur = [side_point(x, lo + (hi - lo) * j / 2, off, s) for j in range(3)]
                if any(p is None for p in cur):
                    cur = None
            if prev is not None and cur is not None:
                for j in range(2):
                    q = [prev[j], cur[j], cur[j + 1], prev[j + 1]]
                    if (s > 0) == (x1 > x0):
                        q = list(reversed(q))
                    b.face(q, color, True)
            elif prev is not None and cur is None and k > 0:
                # 先が細くなって消える
                pass
            prev = cur


def line_side(b, pts, half, color, off=0.005, both=True):
    """側面の (x, y) の折れ線に沿った細い線（継ぎ目）"""
    for s in ((1, -1) if both else (1,)):
        for i in range(len(pts) - 1):
            (xa, ya), (xb, yb) = pts[i], pts[i + 1]
            dx, dy = xb - xa, yb - ya
            l = math.hypot(dx, dy)
            if l < 1e-6:
                continue
            nx, ny = -dy / l * half, dx / l * half
            q = [side_point(xa - nx, ya - ny, off, s), side_point(xb - nx, yb - ny, off, s), side_point(xb + nx, yb + ny, off, s), side_point(xa + nx, ya + ny, off, s)]
            if any(p is None for p in q):
                continue
            if s < 0:
                q = list(reversed(q))
            b.face(q, color, True)


def rounded_rect_path(x0, x1, y0, y1, r, n=5):
    pts = []
    for (cx, cy, t0) in ((x1 - r, y0 + r, -90), (x1 - r, y1 - r, 0), (x0 + r, y1 - r, 90), (x0 + r, y0 + r, 180)):
        for k in range(n + 1):
            t = math.radians(t0 + 90 * k / n)
            pts.append((cx + r * math.cos(t), cy + r * math.sin(t)))
    pts.append(pts[0])
    return pts


def windshield_frame(b):
    """前面窓の黒い縁取り（外側と内側）とワイパー"""
    b.begin('前面窓の縁取り', LAYER)
    outer = ws_outline(0.075)
    inner = ws_outline(-0.005)
    n = len(outer)
    for off in (0.005, -0.012):
        for k in range(n):
            k2 = (k + 1) % n
            q = [top_point(outer[k][0], outer[k][1], off), top_point(outer[k2][0], outer[k2][1], off),
                 top_point(inner[k2][0], inner[k2][1], off), top_point(inner[k][0], inner[k][1], off)]
            b.face(q if off > 0 else list(reversed(q)), C_FRAME, True)
    b.begin('前面窓のワイパー（2 本）', LAYER)
    for zc, ang in ((-0.30, 14), (0.30, 14)):
        # 窓の下の縁に沿って寝かせた細い腕
        xs = X_TIP + WS_D0 + 0.12
        pts = [top_point(xs + 0.02 * j, zc + 0.27 * j * (1 if zc < 0 else -1) / 10, 0.012) for j in range(11)]
        b.tube(pts, 0.008, '#1a1c1e', 6, cap=True)


def headlights(b):
    """前照灯（先端の左右・肩の稜線の下に細長く）"""
    b.begin('前照灯（左右）', LAYER)
    x0, x1 = X_TIP + 0.85, X_TIP + 2.55

    def mid(x):
        t = (x - x0) / (x1 - x0)
        return 1.22 + 0.20 * t

    def half(x):
        t = (x - x0) / (x1 - x0)
        return 0.075 * math.sin(math.pi * min(1, max(0, t)) ** 0.8) + 0.001

    strip_side(b, x0, x1, lambda x: mid(x) - half(x) - 0.012, lambda x: mid(x) + half(x) + 0.012, '#c9ced1', 40, 0.003)
    strip_side(b, x0 + 0.03, x1 - 0.05, lambda x: mid(x) - half(x), lambda x: mid(x) + half(x), '#33434f', 40, 0.005)
    # LED（細長い光の帯 2 本と、後ろの小さな灯）
    strip_side(b, x0 + 0.25, x1 - 0.45, lambda x: mid(x) - 0.018, lambda x: mid(x) + 0.018, 'mat:light', 30, 0.007)
    strip_side(b, x0 + 0.45, x1 - 0.30, lambda x: mid(x) + 0.026, lambda x: mid(x) + 0.044, 'mat:light', 30, 0.007)
    strip_side(b, x1 - 0.28, x1 - 0.14, lambda x: mid(x) - 0.03, lambda x: mid(x) + 0.03, '#e8e3d6', 6, 0.007)


def blue_lines(b):
    """青帯の先頭部（太い帯は先へ細くなって消え、細い線は下でそろう）"""
    b.begin('青帯の先頭部（太い帯）', LAYER)
    xa, xb = X_TIP + 2.35, -5.05
    ss = lambda t: t * t * (3 - 2 * t)

    def c1(x):
        t = min(1, max(0, (x - xa) / (xb - xa)))
        return 1.585 + (1.878 - 1.585) * ss(t)

    def h1(x):
        t = min(1, max(0, (x - xa) / (6.0)))
        return 0.0858 * ss(t) ** 0.55

    strip_side(b, xa, xb, lambda x: c1(x) - h1(x), lambda x: c1(x) + h1(x), '#0054a6', 160, 0.009)
    b.begin('青帯の先頭部（細い線）', LAYER)
    xa2 = X_TIP + 2.7

    def c2(x):
        t = min(1, max(0, (x - xa2) / (xb - xa2)))
        return 1.43 + (1.692 - 1.43) * ss(t)

    def h2(x):
        t = min(1, max(0, (x - xa2) / 2.5))
        return 0.03 * ss(t) ** 0.6

    strip_side(b, xa2, xb, lambda x: c2(x) - h2(x), lambda x: c2(x) + h2(x), '#0054a6', 140, 0.009)


def seams_and_marks(b):
    """ドアの継ぎ目・連結器カバーの継ぎ目・塗り分けの線・号車表示・行先表示"""
    b.begin('乗務員扉・乗降ドアの継ぎ目', LAYER)
    for (x0, x1, y1) in ((-5.55, -5.02, 3.02), (-4.70, -3.95, 3.05), (10.24, 10.99, 3.05)):
        line_side(b, rounded_rect_path(x0, x1, 1.02, y1, 0.07), 0.004, '#8e979c', 0.005)
        # 取っ手のくぼみ
        line_side(b, [(x1 - 0.06, 1.72), (x1 - 0.06, 1.86)], 0.009, '#9aa3a8', 0.006)
    b.begin('連結器カバーの継ぎ目', LAYER)
    pts = [(X_TIP + 1.75, 0.80), (X_TIP + 1.75, 1.10), (X_TIP + 1.70, 1.15)]
    line_side(b, pts, 0.004, '#9aa3a8', 0.005)
    # 先端を回る継ぎ目（上面）
    ring_pts = []
    for k in range(25):
        z = -0.55 + 1.10 * k / 24
        ring_pts.append(top_point(X_TIP + 1.75 - 0.25 * (1 - (z / 0.55) ** 2), z, 0.005))
    for k in range(24):
        a, c = ring_pts[k], ring_pts[k + 1]
        b.face([a, c, (c[0], c[1] + 0.006, c[2]), (a[0], a[1] + 0.006, a[2])], '#9aa3a8', True)
    b.begin('塗り分けの見切り（白と灰の境）', LAYER)
    ygn = lambda x: ring(x - X_TIP)[0][NB - 1 + 6][1]
    strip_side(b, X_TIP + 0.9, BOGIES[0][0], lambda x: ygn(x) - 0.005, lambda x: ygn(x) + 0.005, '#4d5559', 160, 0.004)
    strip_side(b, BOGIES[0][1], X_END - 0.02, lambda x: 1.0, lambda x: 1.01, '#4d5559', 60, 0.004)
    # 号車表示（青い四角に白い 1）と行先表示（側面上部）
    for (xc, kind) in ((-3.52, 'front'), (9.82, 'rear')):
        b.begin(f'号車表示 1（{"前" if kind == "front" else "後"}）', LAYER)
        for s in (1, -1):
            c = side_point(xc, 2.87, 0.006, s)
            fr = Frame(c, (1, 0, 0) if s > 0 else (-1, 0, 0), (0, 1, 0))
            b.rect(fr, -0.10, 0.10, -0.11, 0.11, '#1f5fae', 0.0)
            b.text(fr, '1', 0, -0.075, 0.15, '#ffffff', 0.001, 'center')
        b.begin(f'行先表示（{"前" if kind == "front" else "後"}）', LAYER)
        xd = xc - 0.55 if kind == 'front' else xc - 0.55
        for s in (1, -1):
            c = side_point(xd, 2.87, 0.006, s)
            fr = Frame(c, (1, 0, 0) if s > 0 else (-1, 0, 0), (0, 1, 0))
            b.rect(fr, -0.27, 0.27, -0.075, 0.075, '#121416', 0.0)
            b.text(fr, 'のぞみ', -0.13, -0.03, 0.06, 'mat:lcd-orange', 0.001, 'center')
            b.text(fr, '博 多', 0.13, -0.03, 0.06, 'mat:lcd-white', 0.001, 'center')
    b.begin('床下の点検ふた', LAYER)
    for xc in (-11.0, -3.65, 0.25, 4.15, 6.85, -1.82):
        line_side(b, rounded_rect_path(xc - 0.35, xc + 0.35, 0.62, 0.90, 0.03), 0.004, '#5b6569', 0.004)


def deflector(b):
    """先端の下の排障器（スカート）: 鼻の下に収まる、前へとがった V 字の板"""
    b.begin('排障器', LAYER)
    xf = X_TIP + 1.55          # 先のとがり
    xr = X_TIP + 2.55          # 後ろの端
    zr = 0.80                  # 後ろの端の幅の半分
    ytop = 0.50
    yb = 0.14
    for s in (1, -1):
        q = [(xf, yb, 0.0), (xr, yb, s * zr), (xr, ytop, s * zr), (xf, ytop, 0.0)]
        b.face(q if s > 0 else list(reversed(q)), '#5b656c')
    b.face([(xf, yb, 0.0), (xr, yb, -zr), (xr, yb, zr)], '#3d4449')
    b.box(xr - 0.03, xr, yb, ytop, -zr, zr, '#3d4449')
    # 下の縁のゴム（黒）
    for s in (1, -1):
        q = [(xf - 0.01, yb - 0.02, 0.0), (xr, yb - 0.02, s * (zr + 0.01)), (xr, yb, s * (zr + 0.01)), (xf - 0.01, yb, 0.0)]
        b.face(q if s > 0 else list(reversed(q)), '#1c1e20')
