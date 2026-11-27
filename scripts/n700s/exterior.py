"""
R23 までの外板（先頭形状）を土台に、実車の写真に合わせて手直しする。

- くちばし（前照灯の高さまでの先頭の下半分）を横に広げる。運転台の盛り上がりと前面窓は変えないので、
  実車のように「幅いっぱいのくちばし」の上に「幅の 6 割ほどの盛り上がり」が段になって立つ
- 外板に付いている部品（前面窓・ワイパー・前照灯・継ぎ目・台車まわりの覆い）も同じように動かす
- 青帯の先頭部: 太い帯は前面窓の前の端の下あたりで上へ跳ね上がってとがり、細い線はその手前で終わる
"""
import math
import collections
from shell import Curve

X_TIP = -13.675
X_LIMIT = -4.4      # これより前だけ変える

# 外装のグループ（R18 の番号）: 外板・前面窓・ワイパー・前照灯・継ぎ目・床下の覆いなど
EXTERIOR = set([900001] + list(range(900006, 900020)) + list(range(900054, 900103)) + [900228])

# 先端からの距離 d ごとの、くちばしを広げる割合
WIDEN = Curve([(0.0, 0.26), (1.0, 0.30), (2.0, 0.24), (3.0, 0.14), (4.5, 0.08), (6.0, 0.035), (7.5, 0.01), (8.5, 0.0), (99, 0.0)])


def wing_top(d):
    """広げる範囲の上の端（これより上の盛り上がりは変えない）"""
    return min(2.25, 1.18 + 0.13 * d)


def deform_point(x, y, z):
    if x >= X_LIMIT:
        return z
    d = x - X_TIP
    a = WIDEN(d)
    if a <= 0:
        return z
    yw = wing_top(d)
    if y <= yw:
        f = 1.0
    elif y >= yw + 0.28:
        f = 0.0
    else:
        t = (y - yw) / 0.28
        f = 1 - t * t * (3 - 2 * t)
    return z * (1 + a * f)


SQUARE_FADE = Curve([(0.0, 1.0), (6.0, 1.0), (7.5, 0.55), (9.0, 0.0), (99, 0.0)])
SQUARE_EXP = 3.0      # 断面を楕円（2）からこの超楕円へ寄せる


# R23 の外板の、x ごとの上端と下端（測った値をなめらかにつなぐ）
TOP = Curve([(-13.675, 1.08), (-13.5, 1.28), (-13.0, 1.44), (-12.5, 1.54), (-12.0, 1.66), (-11.5, 1.77), (-11.0, 1.90),
             (-10.5, 2.01), (-10.0, 2.12), (-9.5, 2.27), (-9.0, 2.46), (-8.5, 2.61), (-8.0, 2.72), (-7.0, 2.97),
             (-6.0, 3.29), (-5.0, 3.36), (-4.0, 3.42)])
BOT = Curve([(-13.675, 0.95), (-13.5, 0.72), (-13.0, 0.48), (-12.5, 0.42), (-12.0, 0.38), (-11.0, 0.36), (-4.0, 0.36)])


def square_factor(x, y):
    """断面を角ばった丸みにする倍率（上下の端に近いほど横に張り出す）"""
    d = x - X_TIP
    g = SQUARE_FADE(d)
    if g <= 0:
        return 1.0
    t, bt = TOP(x), BOT(x)
    h = min(1.0, max(0.0, (y - bt) / (t - bt)))
    u = min(0.97, abs(2 * h - 1))
    ell = math.sqrt(1 - u * u)
    # 下半分（くちばし・前照灯の高さまで）は強く、上半分（運転台の盛り上がり）は弱く角ばらせる
    e = SQUARE_EXP if h < 0.5 else 2.35
    sup = (1 - u ** e) ** (1 / e)
    f = min(1.30, sup / ell)
    return 1 + (f - 1) * g


def widen_nose(b):
    for v in b.m['vertices']:
        if len(v) > 4 and v[4] in EXTERIOR and v[1] < X_LIMIT:
            z = deform_point(v[1], v[2], v[3])
            v[3] = round(z * square_factor(v[1], v[2]), 6)
    # 頂点の位置が変わったので、同じ位置の頂点をまとめる表も作り直す
    b.vkey = {}


# ---------------------------------------------------------------------------
# 外板の表面に模様を貼る（横から光線を当てて表面を探す）
# ---------------------------------------------------------------------------
class SideSurface:
    def __init__(self, m, gid=900001):
        V = {v[0]: v for v in m['vertices']}
        self.bins = collections.defaultdict(list)
        for f in m['faces']:
            if V[f['loop'][0]][4] != gid:
                continue
            p = [V[i] for i in f['loop']]
            for k in range(1, len(p) - 1):
                tri = (p[0][1:4], p[k][1:4], p[k + 1][1:4])
                if max(t[2] for t in tri) <= 0.05:
                    continue  # +z 側だけ（左右対称）
                x0 = min(t[0] for t in tri)
                x1 = max(t[0] for t in tri)
                for bx in range(int(math.floor(x0 / 0.1)), int(math.floor(x1 / 0.1)) + 1):
                    self.bins[bx].append(tri)

    def z_at(self, x, y):
        """+z 側で (x, y) の外板の z（いちばん外）"""
        best = None
        for (a, b, c) in self.bins.get(int(math.floor(x / 0.1)), ()):
            x1, y1, x2, y2, x3, y3 = a[0], a[1], b[0], b[1], c[0], c[1]
            if x < min(x1, x2, x3) or x > max(x1, x2, x3) or y < min(y1, y2, y3) or y > max(y1, y2, y3):
                continue
            det = (y2 - y3) * (x1 - x3) + (x3 - x2) * (y1 - y3)
            if abs(det) < 1e-14:
                continue
            l1 = ((y2 - y3) * (x - x3) + (x3 - x2) * (y - y3)) / det
            l2 = ((y3 - y1) * (x - x3) + (x1 - x3) * (y - y3)) / det
            l3 = 1 - l1 - l2
            if min(l1, l2, l3) < -1e-7:
                continue
            z = l1 * a[2] + l2 * b[2] + l3 * c[2]
            best = z if best is None else max(best, z)
        return best

    def point(self, x, y, off, s):
        z = self.z_at(x, y)
        if z is None:
            return None
        # 外向きの法線（近くの点から）
        e = 0.01
        zx0, zx1 = self.z_at(x - e, y), self.z_at(x + e, y)
        zy0, zy1 = self.z_at(x, y - e), self.z_at(x, y + e)
        gx = 0.0 if zx0 is None or zx1 is None else (zx1 - zx0) / (2 * e)
        gy = 0.0 if zy0 is None or zy1 is None else (zy1 - zy0) / (2 * e)
        n = (-gx, -gy, 1.0)
        l = math.sqrt(n[0] ** 2 + n[1] ** 2 + 1)
        return (x + n[0] / l * off, y + n[1] / l * off, s * (z + off / l))


def band(b, surf, x0, x1, ylo, yhi, color, n, off=0.009):
    for s in (1, -1):
        prev = None
        for k in range(n + 1):
            x = x0 + (x1 - x0) * k / n
            lo, hi = ylo(x), yhi(x)
            cur = None
            if hi - lo > 1e-4:
                cur = [surf.point(x, lo + (hi - lo) * j / 3, off, s) for j in range(4)]
                if any(p is None for p in cur):
                    cur = None
            if prev is not None and cur is not None:
                for j in range(3):
                    q = [prev[j], cur[j], cur[j + 1], prev[j + 1]]
                    b.face(q if s < 0 else list(reversed(q)), color, True)
            prev = cur


def blue_band_front(b):
    """青帯の先頭部（写真に合わせた形）"""
    surf = SideSurface(b.m)
    ss = lambda t: t * t * (3 - 2 * t)
    xb = -5.05                     # 直線の帯の前の端
    # 太い帯: 上の縁はゆるく、下の縁は急に上がって、前面窓の前の端の下でとがる
    xt, yt = -8.50, 2.22
    top0, bot0 = 1.964, 1.793

    def top1(x):
        t = min(1, max(0, (xb - x) / (xb - xt)))
        return top0 + (yt - top0) * t ** 1.6

    def bot1(x):
        t = min(1, max(0, (xb - x) / (xb - xt)))
        return bot0 + (yt - bot0) * t ** 1.8 + 0.0 * t

    b.begin('青帯の先頭部（太い帯・跳ね上がり）', 'N700S blue')
    band(b, surf, xb + 0.002, xt, bot1, top1, '#0054a6', 120)
    # 細い線: 少し上がりながら細くなって、乗務員扉の前で終わる
    xt2 = -5.75
    c0, h0 = 1.691, 0.029

    def c2(x):
        t = min(1, max(0, (xb - x) / (xb - xt2)))
        return c0 + 0.02 * t

    def h2(x):
        t = min(1, max(0, (xb - x) / (xb - xt2)))
        return h0 * (1 - t ** 2.2)

    b.begin('青帯の先頭部（細い線）', 'N700S blue')
    band(b, surf, xb + 0.002, xt2, lambda x: c2(x) - h2(x), lambda x: c2(x) + h2(x), '#0054a6', 90)


HEADLIGHTS = [900010, 900011, 900012, 900013, 900014, 900015]
HEADLIGHT_SHIFT = -0.80    # 前照灯を前（先端の頬）へ動かす量 [m]


def move_headlights(b):
    """前照灯を先端の頬へ移し、外板の曲面に沿わせる（外板からの浮きはそのまま）"""
    surf = SideSurface(b.m)
    for v in b.m['vertices']:
        if len(v) > 4 and v[4] in HEADLIGHTS:
            x, y, z = v[1], v[2], v[3]
            s = 1 if z > 0 else -1
            z_old = surf.z_at(x, y)
            x_new = x + HEADLIGHT_SHIFT
            z_new = surf.z_at(x_new, y)
            if z_old is None or z_new is None:
                continue
            off = abs(z) - z_old
            v[1] = round(x_new, 6)
            v[3] = round(s * (z_new + off), 6)
    b.vkey = {}


def new_headlights(b):
    """前照灯（先端の頬・横長の枠に丸い LED が 2 つ）。面の向きに合わせて置く"""
    from lib import Frame, ellipse2, circle2
    surf = SideSurface(b.m)
    xc, yc = X_TIP + 1.10, 1.37
    b.begin('前照灯（左右・LED 2 灯）', 'N700S body')
    for s in (1, -1):
        c = surf.point(xc, yc, 0.012, s)
        c1 = surf.point(xc + 0.02, yc, 0.012, s)
        c2 = surf.point(xc, yc + 0.02, 0.012, s)
        if c is None or c1 is None or c2 is None:
            continue
        tx = (c1[0] - c[0], c1[1] - c[1], c1[2] - c[2])
        ty = (c2[0] - c[0], c2[1] - c[1], c2[2] - c[2])
        fr = Frame(c, tx, ty)
        # 外向きにそろえる（z の符号）
        out = (c[0] - (xc + 0.8), c[1] - yc, c[2])   # 車体の内側の点から外へ
        if fr.n[0] * out[0] + fr.n[1] * out[1] + fr.n[2] * out[2] < 0:
            fr = Frame(c, (-tx[0], -tx[1], -tx[2]), ty)
        # 枠（銀）・レンズ（黒っぽい）・LED 2 つ（光る）
        b.poly(fr, ellipse2(0.0, 0.0, 0.31, 0.135, 36), '#c3c9cd', 0.0)
        b.poly(fr, ellipse2(0.0, 0.0, 0.29, 0.118, 36), '#1d2730', 0.004)
        for ax in (-0.13, 0.13):
            b.poly(fr, circle2(ax, 0.0, 0.095, 28), '#e9eef0', 0.006)
            b.poly(fr, circle2(ax, 0.0, 0.075, 28), 'mat:light', 0.008)


def windshield_clean(b):
    """前面窓の中を横切る柱と、後ろ寄りの四角い枠を外して 1 枚のガラスにする（外周の黒い縁は残す）"""
    m = b.m
    V = {v[0]: v for v in m['vertices']}
    n = 0
    for f in m['faces']:
        if V[f['loop'][0]][4] != 900007:
            continue
        c = f['color']
        if c not in ('#18262d', '#20353c'):
            continue
        p = [V[i] for i in f['loop']]
        cx = sum(q[1] for q in p) / len(p)
        cz = abs(sum(q[3] for q in p) / len(p))
        strut = c == '#20353c' or (cx > -7.28 and cz < 0.56)
        if strut:
            f['color'] = 'mat:glass-clear'
            n += 1
    return n


def ws_cut(z):
    """前面窓の後ろの縁（x）。真ん中が後ろへふくらむ弧"""
    t = min(1.0, abs(z) / 0.88)
    return -7.30 - 0.0 + 0.30 * t * t


def windshield_shorten(b):
    """運転士の頭上（窓の後ろ寄り）のガラスを白い屋根にし、窓を前寄りだけにする。後ろの縁に黒い縁取り"""
    m = b.m
    V = {v[0]: v for v in m['vertices']}
    tris = []
    for f in m['faces']:
        if V[f['loop'][0]][4] != 900007:
            continue
        p = [V[i] for i in f['loop']]
        cx = sum(q[1] for q in p) / len(p)
        cz = sum(q[3] for q in p) / len(p)
        if cx > ws_cut(cz):
            f['color'] = '#f5f7f7'
        for k in range(1, len(p) - 1):
            tris.append((p[0], p[k], p[k + 1]))

    def gy(x, z):
        best = None
        for a_, b_, c_ in tris:
            x1, z1, x2, z2, x3, z3 = a_[1], a_[3], b_[1], b_[3], c_[1], c_[3]
            if x < min(x1, x2, x3) or x > max(x1, x2, x3) or z < min(z1, z2, z3) or z > max(z1, z2, z3):
                continue
            det = (z2 - z3) * (x1 - x3) + (x3 - x2) * (z1 - z3)
            if abs(det) < 1e-12:
                continue
            l1 = ((z2 - z3) * (x - x3) + (x3 - x2) * (z - z3)) / det
            l2 = ((z3 - z1) * (x - x3) + (x1 - x3) * (z - z3)) / det
            l3 = 1 - l1 - l2
            if min(l1, l2, l3) < -1e-6:
                continue
            y = l1 * a_[2] + l2 * b_[2] + l3 * c_[2]
            best = y if best is None else max(best, y)
        return best

    b.begin('前面窓の後ろの縁（黒い縁取り）', 'Glazing')
    n = 44
    w = 0.05
    for off, flip in ((0.006, False), (-0.006, True)):
        prev = None
        for k in range(n + 1):
            z = -0.86 + 1.72 * k / n
            x0 = ws_cut(z) - w / 2
            x1 = ws_cut(z) + w / 2
            y0, y1 = gy(x0, z), gy(x1, z)
            cur = None if (y0 is None or y1 is None) else ((x0, y0 + off, z), (x1, y1 + off, z))
            if prev and cur:
                q = [prev[0], cur[0], cur[1], prev[1]]
                b.face(list(reversed(q)) if flip else q, '#18262d', True)
            prev = cur


def build(b):
    # 外板・先頭形状・前面窓・前照灯・青帯はすべて R23 のまま（実車にいちばん近い）。
    # R26（くちばしを広げる）・R27（前面窓の柱を外し短くする）の手直しは使わない
    return


def build_r26(b):
    """（使わない）R26 で試した手直し: くちばしを広げる・前照灯・青帯"""
    b.remove_groups([900004, 900005])   # 鼻先まで伸びていた青帯
    widen_nose(b)
    b.remove_groups(HEADLIGHTS)        # 前の前照灯（側面向き）は作り直す
    new_headlights(b)
    blue_band_front(b)
