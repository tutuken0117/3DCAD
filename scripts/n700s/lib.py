"""
N700S 見本モデルの車内を組み立てるための道具。
.3dcad（JSON）の model に、グループごとに頂点・辺・面を足していく。

座標: x = 車両の長さ方向（先頭の鼻先が -x）、y = 上、z = 幅方向。単位 m。
面の頂点の並びは右ねじの向きが表（法線）。
"""
import gzip
import json
import math
import os

HIDDEN_EDGE_LAYER = '屋根の作図線'  # 曲面の細かい線を隠すための既存の非表示レイヤー


def load(path):
    raw = open(path, 'rb').read()
    if raw[:2] == b'\x1f\x8b':
        raw = gzip.decompress(raw)
    return json.loads(raw.decode('utf-8'))


def save(data, path):
    text = json.dumps(data, ensure_ascii=False, separators=(',', ':'))
    if path.endswith('z'):
        with gzip.open(path, 'wb', compresslevel=9) as f:
            f.write(text.encode('utf-8'))
    else:
        open(path, 'w', encoding='utf-8').write(text)


# ---------------------------------------------------------------------------
# ベクトル
# ---------------------------------------------------------------------------
def add(a, b):
    return (a[0] + b[0], a[1] + b[1], a[2] + b[2])


def sub(a, b):
    return (a[0] - b[0], a[1] - b[1], a[2] - b[2])


def mul(a, s):
    return (a[0] * s, a[1] * s, a[2] * s)


def dot(a, b):
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]


def cross(a, b):
    return (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])


def norm(a):
    l = math.sqrt(dot(a, a))
    return (a[0] / l, a[1] / l, a[2] / l) if l > 1e-12 else (0.0, 0.0, 0.0)


def lerp(a, b, t):
    return (a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t)


class Frame:
    """局所座標: 原点 o、横 u、縦 v、表向き n = u × v"""

    def __init__(self, o, u, v):
        self.o = tuple(o)
        self.u = norm(u)
        v = norm(v)
        # v を u に直交させる
        v = norm(sub(v, mul(self.u, dot(v, self.u))))
        self.v = v
        self.n = cross(self.u, self.v)

    def p(self, a, b, c=0.0):
        return add(add(add(self.o, mul(self.u, a)), mul(self.v, b)), mul(self.n, c))

    def shifted(self, a=0.0, b=0.0, c=0.0):
        return Frame(self.p(a, b, c), self.u, self.v)

    def rotated(self, deg):
        """n の周りに u・v を回す"""
        r = math.radians(deg)
        u = add(mul(self.u, math.cos(r)), mul(self.v, math.sin(r)))
        v = add(mul(self.u, -math.sin(r)), mul(self.v, math.cos(r)))
        return Frame(self.o, u, v)

    def tilted(self, deg):
        """u の周りに倒す（v が n の向きへ傾く）"""
        r = math.radians(deg)
        v = add(mul(self.v, math.cos(r)), mul(self.n, math.sin(r)))
        return Frame(self.o, self.u, v)


def facing(o, normal, up=(0, 1, 0)):
    """表向きが normal、縦が up に近い向きの Frame"""
    n = norm(normal)
    u = norm(cross(up, n))
    if dot(u, u) < 1e-9:
        u = norm(cross((1, 0, 0), n))
    v = cross(n, u)
    return Frame(o, u, v)


# ---------------------------------------------------------------------------
# 2D の形
# ---------------------------------------------------------------------------
def rect2(a0, a1, b0, b1):
    return [(a0, b0), (a1, b0), (a1, b1), (a0, b1)]


def rrect2(a0, a1, b0, b1, r, seg=4):
    r = min(r, (a1 - a0) / 2 - 1e-6, (b1 - b0) / 2 - 1e-6)
    if r <= 1e-5:
        return rect2(a0, a1, b0, b1)
    pts = []
    for (cx, cy, t0) in ((a1 - r, b0 + r, -90), (a1 - r, b1 - r, 0), (a0 + r, b1 - r, 90), (a0 + r, b0 + r, 180)):
        for k in range(seg + 1):
            t = math.radians(t0 + 90 * k / seg)
            pts.append((cx + r * math.cos(t), cy + r * math.sin(t)))
    return pts


def circle2(cx, cy, r, n=24):
    return [(cx + r * math.cos(2 * math.pi * k / n), cy + r * math.sin(2 * math.pi * k / n)) for k in range(n)]


def ellipse2(cx, cy, rx, ry, n=28):
    return [(cx + rx * math.cos(2 * math.pi * k / n), cy + ry * math.sin(2 * math.pi * k / n)) for k in range(n)]


def arcband2(cx, cy, r0, r1, t0, t1, n=24):
    """角度 t0→t1（度・反時計回り）の帯"""
    outer = [(cx + r1 * math.cos(math.radians(t0 + (t1 - t0) * k / n)), cy + r1 * math.sin(math.radians(t0 + (t1 - t0) * k / n))) for k in range(n + 1)]
    inner = [(cx + r0 * math.cos(math.radians(t1 - (t1 - t0) * k / n)), cy + r0 * math.sin(math.radians(t1 - (t1 - t0) * k / n))) for k in range(n + 1)]
    return outer + inner


def area2(poly):
    s = 0.0
    for i in range(len(poly)):
        x0, y0 = poly[i]
        x1, y1 = poly[(i + 1) % len(poly)]
        s += x0 * y1 - x1 * y0
    return s / 2


def ccw(poly):
    return poly if area2(poly) > 0 else list(reversed(poly))


def offset_poly(poly, d):
    """凸に近い多角形を d だけ外へ（簡易）"""
    poly = ccw(poly)
    n = len(poly)
    out = []
    for i in range(n):
        p0, p1, p2 = poly[i - 1], poly[i], poly[(i + 1) % n]
        e0 = norm((p1[0] - p0[0], p1[1] - p0[1], 0))
        e1 = norm((p2[0] - p1[0], p2[1] - p1[1], 0))
        n0 = (e0[1], -e0[0])
        n1 = (e1[1], -e1[0])
        b = (n0[0] + n1[0], n0[1] + n1[1])
        bl = math.hypot(*b)
        if bl < 1e-9:
            out.append(p1)
            continue
        b = (b[0] / bl, b[1] / bl)
        c = max(0.3, b[0] * n0[0] + b[1] * n0[1])
        out.append((p1[0] + b[0] * d / c, p1[1] + b[1] * d / c))
    return out


# 7 セグメントの数字（幅 1・高さ 2 の箱に対する各セグメント）
_SEG = {
    'a': (0.12, 0.88, 1.84, 2.0), 'd': (0.12, 0.88, 0.0, 0.16), 'g': (0.12, 0.88, 0.92, 1.08),
    'f': (0.0, 0.16, 1.0, 1.9), 'b': (0.84, 1.0, 1.0, 1.9), 'e': (0.0, 0.16, 0.1, 1.0), 'c': (0.84, 1.0, 0.1, 1.0),
}
_DIGITS = {
    '0': 'abcdef', '1': 'bc', '2': 'abged', '3': 'abgcd', '4': 'fgbc', '5': 'afgcd', '6': 'afgedc', '7': 'abc',
    '8': 'abcdefg', '9': 'abcdfg', '-': 'g', ' ': '',
}


def seg7(text, x, y, h, gap=0.35):
    """7 セグメントの数字の多角形（左下 x,y・高さ h）"""
    w = h / 2
    out = []
    for ch in text:
        if ch == '.':
            out.append(rect2(x - w * 0.15, x + w * 0.05, y, y + w * 0.2))
            x += w * 0.3
            continue
        if ch == ':':
            out.append(rect2(x + w * 0.2, x + w * 0.4, y + h * 0.25, y + h * 0.35))
            out.append(rect2(x + w * 0.2, x + w * 0.4, y + h * 0.65, y + h * 0.75))
            x += w * 0.6
            continue
        for s in _DIGITS.get(ch, ''):
            a0, a1, b0, b1 = _SEG[s]
            out.append(rect2(x + a0 * w, x + a1 * w, y + b0 * w, y + b1 * w))
        x += w * (1 + gap)
    return out


# ---------------------------------------------------------------------------
# 文字（IPA ゴシックの輪郭）
# ---------------------------------------------------------------------------
_FONT = None


def _font():
    global _FONT
    if _FONT is None:
        from fontTools.ttLib import TTFont
        for p in ('/usr/share/fonts/opentype/ipafont-gothic/ipag.ttf', '/usr/share/fonts/truetype/fonts-japanese-gothic.ttf'):
            if os.path.exists(p):
                _FONT = TTFont(p)
                break
    return _FONT


def _pip(pt, poly):
    x, y = pt
    inside = False
    n = len(poly)
    for i in range(n):
        x0, y0 = poly[i]
        x1, y1 = poly[(i + 1) % n]
        if (y0 > y) != (y1 > y) and x < (x1 - x0) * (y - y0) / (y1 - y0) + x0:
            inside = not inside
    return inside


def text_shapes(text, x, y, h, align='left'):
    """文字の形を [(外周, [穴...]), ...] で返す（左下基準・字の高さ h ≒ 全角の大きさ）"""
    from fontTools.pens.recordingPen import RecordingPen
    font = _font()
    if font is None:
        return []
    gs = font.getGlyphSet()
    cmap = font.getBestCmap()
    upm = font['head'].unitsPerEm
    s = h / upm
    total = sum(gs[cmap.get(ord(c), '.notdef')].width for c in text) * s
    if align == 'center':
        x -= total / 2
    elif align == 'right':
        x -= total
    shapes = []
    pen_x = x
    for ch in text:
        gname = cmap.get(ord(ch), '.notdef')
        g = gs[gname]
        rp = RecordingPen()
        g.draw(rp)
        rings = []
        cur = []
        for op, args in rp.value:
            if op == 'moveTo':
                cur = [args[0]]
            elif op == 'lineTo':
                cur.append(args[0])
            elif op == 'qCurveTo':
                pts = list(args)
                start = cur[-1]
                # 暗黙の中間点を補う
                ctrl = pts[:-1]
                end = pts[-1]
                segs = []
                p0 = start
                for i, c in enumerate(ctrl):
                    nxt = end if i == len(ctrl) - 1 else ((c[0] + ctrl[i + 1][0]) / 2, (c[1] + ctrl[i + 1][1]) / 2)
                    segs.append((p0, c, nxt))
                    p0 = nxt
                for (a, c, b) in segs:
                    for k in (1, 2, 3):
                        t = k / 3
                        cur.append(((1 - t) ** 2 * a[0] + 2 * (1 - t) * t * c[0] + t * t * b[0], (1 - t) ** 2 * a[1] + 2 * (1 - t) * t * c[1] + t * t * b[1]))
            elif op == 'curveTo':
                a = cur[-1]
                c1, c2, b = args
                for k in (1, 2, 3, 4):
                    t = k / 4
                    mt = 1 - t
                    cur.append((mt ** 3 * a[0] + 3 * mt * mt * t * c1[0] + 3 * mt * t * t * c2[0] + t ** 3 * b[0], mt ** 3 * a[1] + 3 * mt * mt * t * c1[1] + 3 * mt * t * t * c2[1] + t ** 3 * b[1]))
            elif op in ('closePath', 'endPath'):
                if len(cur) > 2:
                    if cur[0] == cur[-1]:
                        cur = cur[:-1]
                    rings.append([(pen_x + px * s, y + py * s) for (px, py) in cur])
                cur = []
        # 外周と穴に分ける（他のどの輪にも含まれない・偶数段が外周）
        depth = []
        for i, r in enumerate(rings):
            d = sum(1 for j, o in enumerate(rings) if j != i and _pip(r[0], o))
            depth.append(d)
        for i, r in enumerate(rings):
            if depth[i] % 2 == 0:
                holes = [rings[j] for j in range(len(rings)) if depth[j] == depth[i] + 1 and _pip(rings[j][0], r)]
                shapes.append((r, holes))
        pen_x += g.width * s
    return shapes


# ---------------------------------------------------------------------------
# 組み立て
# ---------------------------------------------------------------------------
class Builder:
    def __init__(self, data):
        self.data = data
        m = data['model']
        self.m = m
        ids = [v[0] for v in m['vertices']] + [e[0] for e in m['edges']] + [f['id'] for f in m['faces']] + [g['id'] for g in m.get('groups', [])]
        self.next = max(ids) + 1
        self.group = 0
        self.layer = m.get('currentLayer', '0')
        self.vkey = {}
        self.ekey = set()
        for e in m['edges']:
            self.ekey.add((min(e[1], e[2]), max(e[1], e[2])))
        self.soft = False

    def nid(self):
        i = self.next
        self.next += 1
        return i

    # --- 消す ---
    def remove_groups(self, gids):
        gids = set(gids)
        m = self.m
        dead = {v[0] for v in m['vertices'] if len(v) > 4 and v[4] in gids}
        m['vertices'] = [v for v in m['vertices'] if v[0] not in dead]
        m['edges'] = [e for e in m['edges'] if e[1] not in dead and e[2] not in dead]
        m['faces'] = [f for f in m['faces'] if not any(i in dead for i in f['loop'])]
        m['groups'] = [g for g in m['groups'] if g['id'] not in gids]
        self.ekey = {(min(e[1], e[2]), max(e[1], e[2])) for e in m['edges']}

    def ensure_layer(self, name, color='#d8d8d8', visible=True):
        if not any(l['name'] == name for l in self.m['layers']):
            self.m['layers'].append({'name': name, 'color': color, 'visible': visible})

    # --- グループ ---
    def begin(self, name, layer=None):
        gid = self.nid()
        self.m['groups'].append({'id': gid, 'name': name})
        self.group = gid
        if layer:
            self.ensure_layer(layer)
            self.layer = layer
        return gid

    def v(self, p):
        key = (self.group, round(p[0], 5), round(p[1], 5), round(p[2], 5))
        i = self.vkey.get(key)
        if i is None:
            i = self.nid()
            self.m['vertices'].append([i, round(p[0], 6), round(p[1], 6), round(p[2], 6), self.group])
            self.vkey[key] = i
        return i

    def _edge(self, a, b, soft):
        k = (min(a, b), max(a, b))
        if a == b or k in self.ekey:
            return
        self.ekey.add(k)
        self.m['edges'].append([self.nid(), a, b, HIDDEN_EDGE_LAYER if soft else self.layer])

    def face(self, pts, color, soft=None, holes=None):
        soft = self.soft if soft is None else soft
        ids = [self.v(p) for p in pts]
        loop = [i for k, i in enumerate(ids) if i != ids[k - 1]]
        if len(loop) < 3 or len(set(loop)) < 3:
            return None
        f = {'id': self.nid(), 'loop': loop, 'layer': self.layer, 'color': color}
        hl = []
        for h in holes or []:
            hid = [self.v(p) for p in h]
            hid = [i for k, i in enumerate(hid) if i != hid[k - 1]]
            if len(hid) >= 3:
                hl.append(hid)
        if hl:
            f['holes'] = hl
        self.m['faces'].append(f)
        for k in range(len(loop)):
            self._edge(loop[k - 1], loop[k], soft)
        for h in hl:
            for k in range(len(h)):
                self._edge(h[k - 1], h[k], soft)
        return f['id']

    # --- 平面の形（Frame 上） ---
    def poly(self, fr, poly2, color, lift=0.0, soft=None, holes2=None):
        poly2 = ccw(poly2)
        hs = [[fr.p(a, b, lift) for (a, b) in reversed(ccw(h))] for h in (holes2 or [])]
        return self.face([fr.p(a, b, lift) for (a, b) in poly2], color, soft, hs)

    def rect(self, fr, a0, a1, b0, b1, color, lift=0.0, soft=None):
        return self.poly(fr, rect2(a0, a1, b0, b1), color, lift, soft)

    def text(self, fr, text, a, b, h, color, lift=0.0005, align='left'):
        for outer, holes in text_shapes(text, a, b, h, align):
            self.poly(fr, outer, color, lift, True, holes)

    # --- 立体 ---
    def prism(self, fr, poly2, c0, c1, color, side=None, top=None, bottom=None, soft_sides=None):
        """Frame の n 方向に c0→c1 だけ押し出した柱"""
        poly2 = ccw(poly2)
        top = top or color
        bottom = bottom or color
        side = side or color
        if bottom != 'none':
            self.face([fr.p(a, b, c0) for (a, b) in reversed(poly2)], bottom)
        if top != 'none':
            self.face([fr.p(a, b, c1) for (a, b) in poly2], top)
        n = len(poly2)
        soft = (n > 8) if soft_sides is None else soft_sides
        for i in range(n):
            a0, b0 = poly2[i]
            a1, b1 = poly2[(i + 1) % n]
            self.face([fr.p(a0, b0, c0), fr.p(a1, b1, c0), fr.p(a1, b1, c1), fr.p(a0, b0, c1)], side, soft)

    def box(self, x0, x1, y0, y1, z0, z1, color, **kw):
        fr = Frame((0, 0, 0), (1, 0, 0), (0, 0, -1))  # n = +y
        return self.prism(fr, rect2(min(x0, x1), max(x0, x1), -max(z0, z1), -min(z0, z1)), min(y0, y1), max(y0, y1), color, **kw)

    def obox(self, fr, a0, a1, b0, b1, c0, c1, color, **kw):
        """Frame に沿った箱"""
        return self.prism(fr, rect2(a0, a1, b0, b1), c0, c1, color, **kw)

    def cyl(self, fr, r, c0, c1, color, n=16, cap=True, cap_color=None, a=0.0, b=0.0):
        pts = circle2(a, b, r, n)
        self.prism(fr, pts, c0, c1, color, top=(cap_color or color) if cap else 'none', bottom=(cap_color or color) if cap else 'none', soft_sides=True)

    def lathe(self, fr, prof, color, n=24, t0=0.0, t1=360.0, soft=True):
        """Frame の n 軸の周りに (半径, 高さ) の断面を回す。u 方向が 0 度"""
        full = abs(t1 - t0) >= 359.99
        steps = n
        angs = [math.radians(t0 + (t1 - t0) * k / steps) for k in range(steps + (0 if full else 1))]
        rings = []
        for (r, h) in prof:
            rings.append([fr.p(r * math.cos(t), r * math.sin(t), h) for t in angs])
        m = len(angs)
        for j in range(len(prof) - 1):
            for k in range(m if full else m - 1):
                k2 = (k + 1) % m
                p00, p01 = rings[j][k], rings[j][k2]
                p10, p11 = rings[j + 1][k], rings[j + 1][k2]
                if prof[j][0] < 1e-6:
                    self.face([p00, p11, p10], color, soft)
                elif prof[j + 1][0] < 1e-6:
                    self.face([p00, p01, p10], color, soft)
                else:
                    self.face([p00, p01, p11, p10], color, soft)

    def tube(self, pts, r, color, n=8, cap=True):
        """折れ線に沿った丸パイプ（手すり）"""
        pts = [tuple(p) for p in pts]
        rings = []
        prev_u = None
        for i, p in enumerate(pts):
            if i == 0:
                d = norm(sub(pts[1], p))
            elif i == len(pts) - 1:
                d = norm(sub(p, pts[i - 1]))
            else:
                d = norm(add(norm(sub(p, pts[i - 1])), norm(sub(pts[i + 1], p))))
            if prev_u is None:
                ref = (0, 1, 0) if abs(d[1]) < 0.9 else (1, 0, 0)
                u = norm(cross(ref, d))
            else:
                u = norm(sub(prev_u, mul(d, dot(prev_u, d))))
            w = cross(d, u)
            prev_u = u
            # 曲がり角で太さを保つ
            sc = 1.0
            if 0 < i < len(pts) - 1:
                a = norm(sub(p, pts[i - 1]))
                cosh = max(0.5, dot(a, d))
                sc = 1 / cosh
            ring = []
            for k in range(n):
                t = 2 * math.pi * k / n
                off = add(mul(u, r * math.cos(t)), mul(w, r * math.sin(t)))
                # 曲がりの外側方向だけ伸ばす（簡易）
                ring.append(add(p, mul(off, sc if 0 < i < len(pts) - 1 else 1.0)))
            rings.append(ring)
        for i in range(len(rings) - 1):
            for k in range(n):
                k2 = (k + 1) % n
                self.face([rings[i][k], rings[i][k2], rings[i + 1][k2]], color, True)
                self.face([rings[i][k], rings[i + 1][k2], rings[i + 1][k]], color, True)
        if cap:
            self.face(list(reversed(rings[0])), color, True)
            self.face(rings[-1], color, True)

    def sphere(self, c, r, color, n=12, m=8):
        fr = Frame(c, (1, 0, 0), (0, 0, -1))
        prof = [(r * math.sin(math.pi * k / m), -r * math.cos(math.pi * k / m)) for k in range(m + 1)]
        self.lathe(fr, prof, color, n)


def arc_pts(cx, cz, r, t0, t1, n):
    """xz 平面の円弧（度）"""
    return [(cx + r * math.cos(math.radians(t0 + (t1 - t0) * k / n)), cz + r * math.sin(math.radians(t0 + (t1 - t0) * k / n))) for k in range(n + 1)]
