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
    xt, yt = -8.90, 2.008
    top0, bot0 = 1.964, 1.793

    L = math.hypot(xb - xt, 1.878 - yt)

    def center(x):
        # 扉の前で一度少し上がり、そこから先は水平（写真のとおり）
        t = min(1, max(0, (-5.30 - x) / 1.10))
        return 1.878 + 0.13 * t * t * (3 - 2 * t)

    def thick(x):
        dist = max(0.0, x - xt)
        return 0.171 * min(1.0, dist / 1.6) ** 0.75

    def top1(x):
        return center(x) + thick(x) / 2

    def bot1(x):
        return center(x) - thick(x) / 2

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


def ws_front(z):
    """前面窓の前の端（x）。ほぼまっすぐで、両端だけ少し後ろへ"""
    t = min(1.0, abs(z) / 0.80)
    return -8.30 + 0.15 * t * t


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
        if cx > ws_cut(cz) or cx < ws_front(cz):
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

    b.begin('前面窓の前後の縁（黒い縁取り）', 'Glazing')
    n = 44
    w = 0.028
    for edge, zmax in ((ws_cut, 0.74), (ws_front, 0.76)):
        for off, flip in ((0.006, False), (-0.006, True)):
            prev = None
            for k in range(n + 1):
                z = -zmax + 2 * zmax * k / n
                x0 = edge(z) - w / 2
                x1 = edge(z) + w / 2
                y0, y1 = gy(x0, z), gy(x1, z)
                cur = None if (y0 is None or y1 is None) else ((x0, y0 + off, z), (x1, y1 + off, z))
                if prev and cur:
                    q = [prev[0], cur[0], cur[1], prev[1]]
                    b.face(list(reversed(q)) if flip else q, '#18262d', True)
                prev = cur
    # ワイパーを窓の下の縁へ（前を切り詰めた分だけ後ろへずらし、斜面に合わせて上げる）
    for v in m['vertices']:
        if len(v) > 4 and v[4] in (900008, 900009):
            v[1] = round(v[1] + 0.42, 6)
            v[2] = round(v[2] + 0.12, 6)
    b.vkey = {}


RIDGE_ON = Curve([(0.0, 0.0), (0.35, 0.0), (1.2, 1.0), (4.3, 1.0), (5.0, 0.0), (99, 0.0)])


def nose_ridge(b):
    """鼻先の上面に、運転席の窓の下の中央から先端へ通る稜線と、その左右の浅いくぼみを付ける（上下に数 cm 動かすだけ）"""
    groups = EXTERIOR | {900004, 900005}
    for v in b.m['vertices']:
        if len(v) < 5 or v[4] not in groups or v[1] > -8.6:
            continue
        x, y, z = v[1], v[2], v[3]
        g = RIDGE_ON(x - X_TIP)
        if g <= 0:
            continue
        t, bt = TOP(x), BOT(x)
        h = (y - bt) / max(0.05, t - bt)
        wh = min(1.0, max(0.0, (h - 0.45) / 0.25))
        wh = wh * wh * (3 - 2 * wh)
        if wh <= 0:
            continue
        az = abs(z)
        dy = 0.10 * math.exp(-(az / 0.075) ** 2) - 0.13 * math.exp(-((az - 0.36) / 0.19) ** 2) + 0.05 * math.exp(-((az - 0.85) / 0.18) ** 2)
        v[2] = round(y + g * wh * dy, 6)
    b.vkey = {}


BLUNT = Curve([(0.0, 0.45), (0.5, 0.38), (1.0, 0.30), (1.5, 0.23), (2.5, 0.14), (3.5, 0.08), (4.5, 0.04), (5.5, 0.015), (6.5, 0.0), (99, 0.0)])


def blunt_nose(b):
    """上から見た鼻先のとがりを丸くする（断面の形はそのまま、横幅だけを先端ほど広げる）"""
    groups = EXTERIOR | {900004, 900005}
    for v in b.m['vertices']:
        if len(v) > 4 and v[4] in groups and v[1] < X_LIMIT:
            v[3] = round(v[3] * (1 + BLUNT(v[1] - X_TIP)), 6)
    b.vkey = {}


def ws_front_v(z):
    """前面窓の前の縁（x）: 先が丸くすぼまる涙のような形"""
    t = min(1.0, abs(z) / 0.86)
    return -8.62 + 1.22 * t * t


def ws_rear(z):
    """前面窓の上（後ろ）の縁（x）: 真ん中が前へへこみ、左右へ行くほど後ろへ流れる弧"""
    t = min(1.0, abs(z) / 0.84)
    return -7.12 + 0.50 * t ** 2.2


def windshield_shape(b):
    """前面窓の輪郭を、前は丸くすぼまり上（後ろ）は弧を描くなめらかな曲線にする。輪郭の外は白いボディ"""
    m = b.m
    V = {v[0]: v for v in m['vertices']}
    tris = []
    for f in m['faces']:
        if V[f['loop'][0]][4] != 900007:
            continue
        p = [V[i] for i in f['loop']]
        cx = sum(q[1] for q in p) / len(p)
        cz = sum(q[3] for q in p) / len(p)
        if cx < ws_front_v(cz) or cx > ws_rear(cz):
            f['color'] = '#f5f7f7'
        elif f['color'] == '#20353c' or (f['color'] == '#18262d' and abs(cz) < 0.40):
            f['color'] = 'mat:glass-clear'   # 窓の中を横切る桟は外す（左右の窓との仕切りは残す）
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

    # 窓の後ろの真ん中は外板に穴が空いていた（灰色に見えていたのは中の枠）。屋根と同じ白い面でふさぐ
    shell_tris = []
    for f in m['faces']:
        p = [V[i] for i in f['loop']]
        if p[0][4] != 900001 or max(q[1] for q in p) < -7.4 or min(q[1] for q in p) > -6.0:
            continue
        for k in range(1, len(p) - 1):
            shell_tris.append((p[0], p[k], p[k + 1]))

    def sy(x, z):
        best = None
        for a_, b_, c_ in shell_tris:
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
            if y > 2.9:
                best = y if best is None else max(best, y)
        return best

    b.begin('前面窓の後ろの屋根（穴をふさぐ白い面）', 'N700S body')
    nz = 32
    cols = []
    for j in range(nz + 1):
        z = -0.70 + 1.40 * j / nz
        xr = ws_rear(z) - 0.02
        yf = gy(xr, z)
        xs = xr
        while yf is None and xs > xr - 0.3:   # その真上にガラスがなければ、少し前のガラスの高さから
            xs -= 0.01
            yf = gy(xs, z)
        if yf is not None and xs < xr:
            xr = xs
        xb, yb = None, None
        for xt in (-6.30, -6.20, -6.10, -6.00, -5.9, -5.8, -5.7, -5.6):
            y = sy(xt, z)
            if y is not None:
                xb, yb = xt, y
                break
        if yf is None or xb is None:
            cols.append(None)
            continue
        cols.append([(xr + (xb - xr) * t / 12, max(yf + (yb - yf) * t / 12, (sy(xr + (xb - xr) * t / 12, z) or 0)) + 0.004, z) for t in range(13)])
    for j in range(nz):
        a_, c_ = cols[j], cols[j + 1]
        if a_ is None or c_ is None:
            continue
        for t in range(12):
            q = [a_[t], c_[t], c_[t + 1], a_[t + 1]]
            b.face(q, '#f5f7f7', True)

    b.begin('前面窓の縁取り（なめらかな輪郭）', 'Glazing')
    n = 70
    w = 0.03
    for edge, zmax in ((ws_front_v, 0.85), (ws_rear, 0.83)):
        for off, flip in ((0.006, False), (-0.006, True)):
            prev = None
            for k in range(n + 1):
                z = -zmax + 2 * zmax * k / n
                x0 = edge(z) - w / 2
                x1 = edge(z) + w / 2
                y0, y1 = gy(x0, z), gy(x1, z)
                cur = None if (y0 is None or y1 is None) else ((x0, y0 + off, z), (x1, y1 + off, z))
                if prev and cur:
                    q = [prev[0], cur[0], cur[1], prev[1]]
                    b.face(list(reversed(q)) if flip else q, '#18262d', True)
                prev = cur


def tongue_edge(z):
    """窓の左右の脚の間に入り込む白い屋根の先（x）。前へ丸くふくらむ"""
    return -7.38 + 1.7 * z * z


TONGUE_W = 0.50


def windshield_horseshoe(b):
    """前面窓を真上から見て「∩」の形に: 窓の前は R23 の丸いまま、左右の窓が後ろへ伸び、その間に白い屋根が丸い先で入り込む"""
    m = b.m
    V = {v[0]: v for v in m['vertices']}
    tris = []
    gl = []
    for f in m['faces']:
        if V[f['loop'][0]][4] != 900007:
            continue
        p = [V[i] for i in f['loop']]
        for k in range(1, len(p) - 1):
            gl.append((p[0], p[k], p[k + 1]))

    def gy0(x, z):
        best = None
        for a_, b_, c_ in gl:
            x1, z1, x2, z2, x3, z3 = a_[1], a_[3], b_[1], b_[3], c_[1], c_[3]
            if x < min(x1, x2, x3) or x > max(x1, x2, x3) or z < min(z1, z2, z3) or z > max(z1, z2, z3):
                continue
            det = (z2 - z3) * (x1 - x3) + (x3 - x2) * (z1 - z3)
            if abs(det) < 1e-12:
                continue
            l1 = ((z2 - z3) * (x - x3) + (x3 - x2) * (z - z3)) / det
            l2 = ((z3 - z1) * (x - x3) + (x1 - x3) * (z - z3)) / det
            if min(l1, l2, 1 - l1 - l2) < -1e-6:
                continue
            y = l1 * a_[2] + l2 * b_[2] + (1 - l1 - l2) * c_[2]
            best = y if best is None else max(best, y)
        return best

    y0 = gy0(-7.38, 0.0)
    edge = {}
    for k in range(51):
        z = -TONGUE_W + 2 * TONGUE_W * k / 50
        x = -7.6
        while x < -6.6:
            y = gy0(x, z)
            if y is not None and y >= y0:
                break
            x += 0.005
        edge[round(z, 4)] = x
    zs = sorted(edge)

    def tongue_edge_c(z):
        z = max(-TONGUE_W, min(TONGUE_W, z))
        for i in range(len(zs) - 1):
            if zs[i] <= z <= zs[i + 1]:
                t = (z - zs[i]) / (zs[i + 1] - zs[i])
                return edge[zs[i]] * (1 - t) + edge[zs[i + 1]] * t
        return edge[zs[-1]]

    global tongue_edge
    tongue_edge = tongue_edge_c
    for f in m['faces']:
        if V[f['loop'][0]][4] != 900007:
            continue
        p = [V[i] for i in f['loop']]
        cx = sum(q[1] for q in p) / len(p)
        cz = sum(q[3] for q in p) / len(p)
        if abs(cz) < TONGUE_W and cx > tongue_edge(cz):
            f['color'] = '#f5f7f7'
        elif f['color'] == '#20353c':
            f['color'] = 'mat:glass-clear'   # 正面の窓の真ん中の柱は実車にない
        elif f['color'] == '#18262d' and abs(cz) < 0.42 and cx > -7.6:
            f['color'] = 'mat:glass-clear'   # 後ろ寄りの横の桟
        for k in range(1, len(p) - 1):
            tris.append((p[0], p[k], p[k + 1]))

    def tri_y(tl, x, z, ymin=-9):
        best = None
        for a_, b_, c_ in tl:
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
            if y > ymin:
                best = y if best is None else max(best, y)
        return best

    shell_tris = []
    for f in m['faces']:
        p = [V[i] for i in f['loop']]
        if p[0][4] != 900001 or max(q[1] for q in p) < -7.6 or min(q[1] for q in p) > -5.5:
            continue
        for k in range(1, len(p) - 1):
            shell_tris.append((p[0], p[k], p[k + 1]))

    # 白い屋根の舌（外板の穴もここでふさぐ）
    b.begin('前面窓の間の白い屋根（丸い先）', 'N700S body')
    nz, nx = 30, 14
    cols = []
    for j in range(nz + 1):
        z = -TONGUE_W + 2 * TONGUE_W * j / nz
        xf = tongue_edge(z)
        yf = tri_y(tris, xf, z)
        xs = xf
        while yf is None and xs > xf - 0.3:
            xs -= 0.01
            yf = tri_y(tris, xs, z)
        xb = yb = None
        for xt in (-6.30, -6.20, -6.10, -6.00, -5.9, -5.8, -5.7):
            yb = tri_y(shell_tris, xt, z, 2.9)
            if yb is not None:
                xb = xt
                break
        if yf is None or xb is None:
            cols.append(None)
            continue
        col = []
        for t in range(nx + 1):
            x = xf + (xb - xf) * t / nx
            y = yf + (yb - yf) * t / nx
            ys = tri_y(shell_tris, x, z, 2.9)
            yg = tri_y(tris, x, z)
            y = max([y] + [q for q in (ys, yg) if q is not None])
            col.append((x, y + 0.004, z))
        cols.append(col)
    for j in range(nz):
        a_, c_ = cols[j], cols[j + 1]
        if a_ is None or c_ is None:
            continue
        for t in range(nx):
            b.face([a_[t], c_[t], c_[t + 1], a_[t + 1]], '#f5f7f7', True)
    # 白い屋根の縁（黒い縁取り）: 丸い先と左右の脚との境
    b.begin('前面窓の間の白い屋根の縁取り', 'Glazing')
    pts = []
    for k in range(41):
        z = -TONGUE_W + 2 * TONGUE_W * k / 40
        pts.append((tongue_edge(z), z))
    line = []
    for (x, z) in pts:
        y = tri_y(tris, x, z)
        if y is None:
            y = tri_y(shell_tris, x, z, 2.9)
        line.append(None if y is None else (x, y + 0.008, z))
    for k in range(len(line) - 1):
        a_, c_ = line[k], line[k + 1]
        if a_ is None or c_ is None:
            continue
        b.tube([a_, c_], 0.012, '#18262d', 6, cap=False)


HL_X, HL_Y = -11.00, 1.67    # 前照灯の中心（正面から見て下から約半分の高さ・前を向いた斜めの面）


def headlights_front(b):
    """前照灯: 肩の面に沿った、後ろへ流れる涙形のレンズ。前の端に LED が 2 つ（前を向いて光る）"""
    from lib import Frame, ellipse2, circle2
    surf = SideSurface(b.m)
    b.begin('前照灯（左右・LED 2 灯）', 'N700S body')
    for s in (1, -1):
        c = surf.point(HL_X, HL_Y, 0.010, s)
        c1 = surf.point(HL_X + 0.02, HL_Y, 0.010, s)
        c2 = surf.point(HL_X, HL_Y + 0.02, 0.010, s)
        if c is None or c1 is None or c2 is None:
            continue
        tx = (c1[0] - c[0], c1[1] - c[1], c1[2] - c[2])
        ty = (c2[0] - c[0], c2[1] - c[1], c2[2] - c[2])
        fr = Frame(c, tx, ty)
        out = (0.0, 0.0, s)
        if fr.n[2] * s < 0:
            fr = Frame(c, (-tx[0], -tx[1], -tx[2]), ty)
        # 涙形（前が丸く、後ろへ細く流れる）。長さ 0.56 m・高さ 0.20 m
        u0 = 1 if fr.u[0] > 0 else -1
        shape = []
        for k in range(48):
            t = 2 * math.pi * k / 48
            a = 0.36 * math.cos(t)
            front = (1 - a * u0 / 0.36) / 2   # 前の端で 1、後ろの端で 0
            r = 0.05 + 0.085 * front ** 0.6
            shape.append((a, r * math.sin(t)))
        b.poly(fr, shape, '#c3c9cd', 0.0)
        b.poly(fr, [(a * 0.94, bb * 0.84) for (a, bb) in shape], '#5f6c75', 0.004)
        for ax in (-0.22, -0.06):
            b.poly(fr, circle2(ax * u0, 0.0, 0.088, 28), '#d5dbde', 0.006)
            b.poly(fr, circle2(ax * u0, 0.0, 0.074, 28), 'mat:light', 0.008)


GROOVE_X = Curve([(-12.2, 0.0), (-11.0, 0.45), (-9.8, 0.9), (-8.6, 1.0), (-6.6, 1.0), (-5.9, 0.55), (-5.45, 0.0), (99, 0.0)])
GROOVE_DEPTH = 0.085
GROOVE_Y, GROOVE_S = 2.05, 0.21


def side_groove(b):
    """青帯の通る側面の浅いくぼみ（前照灯の後ろから扉の前まで。上の盛り上がりと下のふくらみの間の溝）"""
    groups = EXTERIOR
    for v in b.m['vertices']:
        if len(v) < 5 or v[4] not in groups or v[1] > -5.4:
            continue
        x, y, z = v[1], v[2], v[3]
        if abs(z) < 0.45:
            continue
        g = GROOVE_X(x)
        if g <= 0:
            continue
        w = math.exp(-((y - GROOVE_Y) / GROOVE_S) ** 2)
        if w < 1e-3:
            continue
        v[3] = round(z - math.copysign(GROOVE_DEPTH * g * w, z), 6)
    b.vkey = {}


def build(b):
    # 外板は R23 を土台に（実車の写真と同じ角度で比べて合わせた）:
    # ・前面窓は真上から見て「∩」形（前は丸いまま、左右の窓の間に白い屋根が丸い先で入り込む）
    # ・上から見た鼻先のとがりを丸く、鼻先の上面に中央の稜線
    # ・前照灯は正面から見える高さ・向きへ、青帯の先は正面から見て車体の高さの約 55% へ
    windshield_horseshoe(b)
    blunt_nose(b)
    nose_ridge(b)
    side_groove(b)
    b.remove_groups(HEADLIGHTS + [900004, 900005])
    headlights_front(b)
    blue_band_front(b)


def build_r26(b):
    """（使わない）R26 で試した手直し: くちばしを広げる・前照灯・青帯"""
    b.remove_groups([900004, 900005])   # 鼻先まで伸びていた青帯
    widen_nose(b)
    b.remove_groups(HEADLIGHTS)        # 前の前照灯（側面向き）は作り直す
    new_headlights(b)
    blue_band_front(b)
