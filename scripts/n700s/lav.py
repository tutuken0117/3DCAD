"""
1 号車の後ろ（2 号車寄り）: デッキ、化粧室（男女共用・女性用・男性用）、洗面所、貫通扉。
あわせて前のデッキ（運転室の後ろ）も整える。

配置（上から見て、x は 2 号車へ向かって増える）
  x 10.13〜11.15 デッキ（両側に乗降ドア x 10.23〜10.98）
  x 11.15〜13.50 化粧室まわり。中央に幅 0.80 m の通路（z −0.40〜0.40）
    +z 側: 男女共用の洋式（おむつ交換台）・女性用の洋式（ベビーチェア）
    −z 側: 洗面所（カーテン）・男性用（小便器・折戸）・業務用室
  x 13.46 貫通扉（2 号車へ）
"""
import math
from lib import Frame, rect2, rrect2, circle2, ellipse2, arcband2, norm, sub, add, mul

L = '化粧室・洗面所'
LD = 'デッキ'
FLOOR = 1.05
CEIL = 3.02
DECK_CEIL = 3.08

C_FRP = '#d9d5cb'      # 化粧室の内壁（FRP）
C_PART = '#d3d0c7'     # 通路に面した間仕切り
C_DECKWALL = '#cfd0cb'
C_DOOR = '#c3c1b9'
C_FLOOR_DECK = '#7b7d80'
C_FLOOR_WC = '#6f747a'
C_STAIN = 'mat:stainless'
C_CERAMIC = 'mat:ceramic'
C_WHITE = 'mat:plastic-white'
C_SIGN = '#2d3a4a'
C_MIRROR = '#a9b7be'  # 鏡（室内を映した明るい灰青）

OLD = [
    900216, 900221, 900229, 900307, 900308, 900309, 900310, 900315, 900322, 900323, 900324,
    900325, 900326, 900327, 900328, 900329, 900330, 900331, 900332, 900333,
]


# ---------------------------------------------------------------------------
# 小物
# ---------------------------------------------------------------------------
def wall_face(x, z, normal_sign_x=0, normal_sign_z=0, y=0.0):
    """壁の面に貼る Frame。法線が ±x か ±z。u は見る人の右、v は上"""
    if normal_sign_x:
        n = (normal_sign_x, 0, 0)
        u = (0, 0, -normal_sign_x)  # 法線 +x の面を -x 側から見る… 見る人の右
        u = (0, 0, normal_sign_x)
    else:
        n = (0, 0, normal_sign_z)
        u = (-normal_sign_z, 0, 0)
    fr = Frame((x, y, z), u, (0, 1, 0))
    if (fr.n[0] - n[0]) ** 2 + (fr.n[2] - n[2]) ** 2 > 0.1:
        fr = Frame((x, y, z), mul(u, -1), (0, 1, 0))
    return fr


def loft(b, levels, color, n=28, cap_top=True, cap_bottom=True, soft=True):
    """楕円を重ねた立体。levels = [(y, cx, cz, rx, rz)] を下から"""
    rings = []
    for (y, cx, cz, rx, rz) in levels:
        rings.append([(cx + rx * math.cos(2 * math.pi * k / n), y, cz + rz * math.sin(2 * math.pi * k / n)) for k in range(n)])
    for i in range(len(rings) - 1):
        for k in range(n):
            k2 = (k + 1) % n
            # 外向き: k→k2 は x→z 回り（上から見て反時計 = -y 回り）なので、下→上の順で外向きになるよう並べる
            b.face([rings[i][k], rings[i + 1][k], rings[i + 1][k2], rings[i][k2]], color, soft)
    if cap_bottom:
        b.face(list(rings[0]), color, soft)
    if cap_top:
        b.face(list(reversed(rings[-1])), color, soft)


def ring_plate(b, y0, y1, cx, cz, rxo, rzo, rxi, rzi, color, n=32):
    """楕円の輪（便座）"""
    out0 = [(cx + rxo * math.cos(2 * math.pi * k / n), y0, cz + rzo * math.sin(2 * math.pi * k / n)) for k in range(n)]
    out1 = [(p[0], y1, p[2]) for p in out0]
    in0 = [(cx + rxi * math.cos(2 * math.pi * k / n), y0, cz + rzi * math.sin(2 * math.pi * k / n)) for k in range(n)]
    in1 = [(p[0], y1, p[2]) for p in in0]
    for k in range(n):
        k2 = (k + 1) % n
        b.face([out1[k], out1[k2], in1[k2], in1[k]], color, True)
        b.face([out0[k], in0[k], in0[k2], out0[k2]], color, True)
        b.face([out0[k], out0[k2], out1[k2], out1[k]], color, True)
        b.face([in0[k], in1[k], in1[k2], in0[k2]], color, True)


def sign_plate(b, fr, a, bb, w, h, lines, bg=C_SIGN, fg='#f4f4f0', lift=0.004):
    """案内板（紺地に白文字）"""
    b.obox(fr, a - w / 2, a + w / 2, bb, bb + h, 0.0, lift, '#20262e', top=bg)
    n = len(lines)
    for k, (t, size) in enumerate(lines):
        y = bb + h - (k + 1) * h / (n + 0.4) - size * 0.35
        b.text(fr, t, a, y, size, fg, lift + 0.0006, 'center')


def stainless_rail(b, pts, r=0.016):
    b.tube(pts, r, C_STAIN, 10)


def wall_box(b, x0, x1, y0, y1, z0, z1, color=C_PART, **kw):
    b.box(min(x0, x1), max(x0, x1), y0, y1, min(z0, z1), max(z0, z1), color, **kw)


# ---------------------------------------------------------------------------
# 洋式便器（便器・便座・ふた・温水洗浄の操作部・紙巻器など）
# ---------------------------------------------------------------------------
def western_toilet(b, xc, z_wall, side, name):
    """z_wall: 背中側の壁（車体側）の z。side=+1 で便器は -z 向き（通路側を向く）"""
    s = side
    b.begin(f'{name}・洋式便器（温水洗浄便座）', L)
    # 背面の配管カバー（低い棚）
    zb = z_wall - s * 0.20
    wall_box(b, xc - 0.30, xc + 0.30, FLOOR, 1.82, z_wall, zb, '#d6d2c9', top='#cfcac0')
    # 便器（陶器）: 台座から鉢へ広がる
    cz = z_wall - s * 0.47
    loft(b, [
        (FLOOR, xc, cz + s * 0.06, 0.13, 0.16),
        (FLOOR + 0.20, xc, cz + s * 0.04, 0.15, 0.20),
        (FLOOR + 0.33, xc, cz + s * 0.02, 0.185, 0.25),
        (FLOOR + 0.39, xc, cz, 0.195, 0.265),
    ], C_CERAMIC, 28, cap_top=False)
    # 鉢の内側（少し濃い陶器）と水たまり
    loft(b, [
        (FLOOR + 0.26, xc, cz - s * 0.02, 0.07, 0.09),
        (FLOOR + 0.39, xc, cz, 0.165, 0.225),
    ], '#e9ecee', 28, cap_top=False, cap_bottom=False)
    b.face([(xc + 0.07 * math.cos(2 * math.pi * k / 20), FLOOR + 0.262, cz - s * 0.02 + 0.09 * math.sin(2 * math.pi * k / 20)) for k in reversed(range(20))], '#b9d3dc', True)
    # 便座（白い樹脂）
    ring_plate(b, FLOOR + 0.39, FLOOR + 0.415, xc, cz, 0.20, 0.27, 0.125, 0.17, C_WHITE)
    # 温水洗浄便座の本体（後ろ）
    wall_box(b, xc - 0.21, xc + 0.21, FLOOR + 0.38, FLOOR + 0.47, zb, zb - s * 0.17, C_WHITE)
    # ふた（上げた状態・背面に立てかけ）
    lf = Frame((xc, FLOOR + 0.47, zb - s * 0.17), (1, 0, 0), (0, 1, 0))
    if lf.n[2] * s > 0:
        lf = Frame((xc, FLOOR + 0.47, zb - s * 0.17), (-1, 0, 0), (0, 1, 0))
    lf = lf.tilted(-8)
    b.prism(lf, ellipse2(0.0, 0.25, 0.19, 0.25, 24), 0.0, 0.025, C_WHITE)


def wall_controls(b, fr, a, bb):
    """温水洗浄便座の操作部（壁付け）: 止・おしり・ビデ・流す"""
    b.obox(fr, a - 0.11, a + 0.11, bb, bb + 0.16, 0.0, 0.02, '#c9c5bc', top='#f2f1ec')
    btns = [('止', '#e46a2b'), ('おしり', '#2f7dd0'), ('ビデ', '#d86aa0'), ('乾燥', '#9aa2a8')]
    for k, (t, c) in enumerate(btns):
        x = a - 0.075 + k * 0.05
        b.obox(fr, x - 0.018, x + 0.018, bb + 0.07, bb + 0.106, 0.02, 0.028, '#c9c5bc', top=c)
        b.text(fr, t, x, bb + 0.05, 0.011, '#333333', 0.0205, 'center')
    b.obox(fr, a - 0.08, a + 0.08, bb + 0.115, bb + 0.145, 0.02, 0.026, '#c9c5bc', top='#3a8fd8')
    b.text(fr, '流す', a, bb + 0.123, 0.016, '#ffffff', 0.0265, 'center')


def paper_holder(b, fr, a, bb):
    for k in (0, 1):
        x = a + (k - 0.5) * 0.17
        b.obox(fr, x - 0.075, x + 0.075, bb, bb + 0.11, 0.0, 0.09, C_STAIN)
        # ロール（白）
        rf = Frame(fr.p(x, bb + 0.03, 0.06), fr.u, fr.n)
        b.cyl(rf, 0.055, -0.055, 0.055, '#fafaf7', 20)


def emergency_button(b, fr, a, bb, label='非常ボタン'):
    b.obox(fr, a - 0.05, a + 0.05, bb, bb + 0.10, 0.0, 0.012, '#d9d6cf', top='#f3f1ea')
    cf = Frame(fr.p(a, bb + 0.06, 0.012), fr.u, fr.v)
    b.cyl(cf, 0.022, 0.0, 0.012, '#b51f1a', 16)
    b.text(fr, label, a, bb + 0.012, 0.012, '#b51f1a', 0.0125, 'center')


def counter_with_bowl(b, x0, x1, z0, z1, y, cx, cz, rx, rz, depth=0.12, thick=0.04, top='#f3f1ec', side='#e7e4dd'):
    """天板（人工大理石）にボウルの穴をあけ、下にボウルを付ける"""
    xa, xb, za, zb = min(x0, x1), max(x0, x1), min(z0, z1), max(z0, z1)
    tf = Frame((0, y, 0), (1, 0, 0), (0, 0, -1))  # n=+y、(a,b)=(x,-z)
    hole = [(cx + rx * math.cos(2 * math.pi * k / 28), -(cz + rz * math.sin(2 * math.pi * k / 28))) for k in range(28)]
    b.poly(tf, rect2(xa, xb, -zb, -za), top, 0.0, None, [hole])
    b.box(xa, xb, y - thick, y - thick + 0.001, za, zb, side, top='none')
    for (p, q) in (((xa, za), (xb, za)), ((xb, za), (xb, zb)), ((xb, zb), (xa, zb)), ((xa, zb), (xa, za))):
        b.face([(p[0], y - thick, p[1]), (q[0], y - thick, q[1]), (q[0], y, q[1]), (p[0], y, p[1])], side)
    loft(b, [(y - depth, cx, cz, rx * 0.45, rz * 0.45), (y - depth * 0.55, cx, cz, rx * 0.85, rz * 0.85), (y - 0.0005, cx, cz, rx, rz)], '#ffffff', 28, cap_top=False)
    b.face([(cx + 0.018 * math.cos(2 * math.pi * k / 12), y - depth + 0.001, cz + 0.018 * math.sin(2 * math.pi * k / 12)) for k in reversed(range(12))], C_STAIN, True)


def corner_basin(b, x0, x1, z0, z1, y, mirror_fr=None):
    """個室内の小さな手洗い（人工大理石の台・自動水栓）"""
    cx, cz = (x0 + x1) / 2, (z0 + z1) / 2
    counter_with_bowl(b, x0, x1, z0, z1, y, cx + (x1 - x0) * 0.06, cz, abs(x1 - x0) * 0.30, abs(z1 - z0) * 0.30, 0.09)


def faucet(b, x, y, z, toward):
    """自動水栓（ステンレスの吐水口）。toward は吐水口の向き (dx,dz)"""
    dx, dz = toward
    b.tube([(x, y, z), (x, y + 0.11, z), (x + dx * 0.10, y + 0.13, z + dz * 0.10), (x + dx * 0.13, y + 0.11, z + dz * 0.13)], 0.011, C_STAIN, 10)
    b.box(x - 0.02, x + 0.02, y, y + 0.01, z - 0.02, z + 0.02, C_STAIN)


# ---------------------------------------------------------------------------
# 化粧室（個室）
# ---------------------------------------------------------------------------
def toilet_room(b, x0, x1, kind):
    """+z 側の個室。x0〜x1、通路の壁 z=0.44、車体側 z=1.46"""
    zc, zo = 0.44, 1.46
    name = '化粧室（男女共用）' if kind == 'shared' else '化粧室（女性用）'
    b.begin(f'{name}・床と天井と内壁', L)
    b.box(x0, x1, FLOOR, FLOOR + 0.012, zc, zo, C_FLOOR_WC)
    b.box(x0, x1, CEIL - 0.02, CEIL, zc, zo, '#e3e2de')
    b.box((x0 + x1) / 2 - 0.25, (x0 + x1) / 2 + 0.25, CEIL - 0.024, CEIL - 0.02, 0.85, 1.05, 'mat:light')
    # 車体側の内壁（窓なし）
    b.box(x0, x1, FLOOR, CEIL, zo, zo + 0.03, C_FRP)
    # 幅木
    b.box(x0, x1, FLOOR, FLOOR + 0.08, zo - 0.01, zo, '#a7a9aa')
    xc = (x0 + x1) / 2 + (0.08 if kind == 'shared' else 0.0)
    western_toilet(b, xc, zo, 1, name)
    b.begin(f'{name}・備品', L)
    # 左右の壁（x0 側の壁の面: 法線 +x）
    fr_x0 = Frame((x0 + 0.001, 0, 0), (0, 0, -1), (0, 1, 0))
    if fr_x0.n[0] < 0:
        fr_x0 = Frame((x0 + 0.001, 0, 0), (0, 0, 1), (0, 1, 0))
    fr_x1 = Frame((x1 - 0.001, 0, 0), (0, 0, 1), (0, 1, 0))
    if fr_x1.n[0] > 0:
        fr_x1 = Frame((x1 - 0.001, 0, 0), (0, 0, -1), (0, 1, 0))
    # x1 側: 操作部・紙巻器・手すり・非常ボタン
    zz = lambda z: (z if fr_x1.u[2] > 0 else -z)
    wall_controls(b, fr_x1, zz(1.02), 1.70)
    paper_holder(b, fr_x1, zz(1.02), 1.50)
    emergency_button(b, fr_x1, zz(0.72), 1.62)
    # L 字の手すり
    xr = x1 - 0.06
    stainless_rail(b, [(xr, 1.68, 1.30), (xr, 1.68, 0.80), (xr, 2.25, 0.80)])
    b.tube([(x1, 1.68, 1.30), (xr, 1.68, 1.30)], 0.012, C_STAIN, 8)
    b.tube([(x1, 2.25, 0.80), (xr, 2.25, 0.80)], 0.012, C_STAIN, 8)
    # x0 側: 手洗い（隅）・鏡・荷物掛け・おむつ交換台／ベビーチェア
    zz0 = lambda z: (z if fr_x0.u[2] > 0 else -z)
    corner_basin(b, x0, x0 + 0.30, zc + 0.02, zc + 0.36, 1.86)
    faucet(b, x0 + 0.035, 1.86, zc + 0.19, (1, 0))
    b.box(x0, x0 + 0.004, 2.00, 2.42, zc + 0.04, zc + 0.34, C_MIRROR)
    b.box(x0, x0 + 0.06, 2.44, 2.47, zc + 0.04, zc + 0.34, '#f3f1ec')  # 鏡の上の小棚
    if kind == 'shared':
        # おむつ交換台（たたんだ状態・壁付け）
        b.box(x0, x0 + 0.12, 1.72, 2.30, 0.86, 1.42, '#f0eee8', side='#e2dfd6')
        f = Frame((x0 + 0.1205, 0, 0), fr_x0.u, (0, 1, 0))
        b.rect(f, -zz0(1.36) if False else min(zz0(0.90), zz0(1.38)), max(zz0(0.90), zz0(1.38)), 1.76, 2.26, '#f7f5f0', 0.0)
        b.rect(f, min(zz0(1.05), zz0(1.23)), max(zz0(1.05), zz0(1.23)), 2.02, 2.20, '#f29fae', 0.0008)
        b.text(f, 'おむつ交換台', zz0(1.14), 1.86, 0.035, '#555a5e', 0.0012, 'center')
        b.box(x0 + 0.04, x0 + 0.13, 2.20, 2.26, 1.08, 1.20, '#9aa1a7')
        # 介助用の手すり（縦）
        stainless_rail(b, [(x0 + 0.06, 1.55, 1.40), (x0 + 0.06, 2.35, 1.40)])
    else:
        # ベビーチェア（たたんだ状態）
        b.box(x0, x0 + 0.10, 1.70, 2.12, 0.90, 1.24, '#f0eee8', side='#e2dfd6')
        f = Frame((x0 + 0.1005, 0, 0), fr_x0.u, (0, 1, 0))
        b.rect(f, min(zz0(0.95), zz0(1.19)), max(zz0(0.95), zz0(1.19)), 1.95, 2.07, '#9cc7e8', 0.0)
        b.text(f, 'ベビーチェア', zz0(1.07), 1.78, 0.03, '#555a5e', 0.0012, 'center')
    # 荷物掛けフック
    b.box(x0, x0 + 0.06, 2.40, 2.44, 1.30, 1.33, C_STAIN)
    # 中の開閉ボタン（扉の横）
    pf = Frame((0, 0, zc + 0.031), (1, 0, 0), (0, 1, 0))
    if pf.n[2] < 0:
        pf = Frame((0, 0, zc + 0.031), (-1, 0, 0), (0, 1, 0))
    xa = x1 - 0.12
    a = xa if pf.u[0] > 0 else -xa
    b.obox(pf, a - 0.05, a + 0.05, 1.85, 2.13, 0.0, 0.012, '#d9d6cf', top='#f3f1ea')
    for k, (t, c) in enumerate([('開', '#3fae5c'), ('閉', '#d9d6cf'), ('鍵', '#e46a2b')]):
        cf = Frame(pf.p(a, 2.08 - k * 0.08, 0.012), pf.u, pf.v)
        b.cyl(cf, 0.022, 0.0, 0.008, '#9aa1a7', 16, cap_color=c)
        b.text(pf, t, a, 2.07 - k * 0.08, 0.018, '#222222', 0.0215, 'center')


def wash_room(b, x0, x1):
    """洗面所（−z 側・通路に向いて開き、カーテンで仕切る）"""
    zc, zo = -0.44, -1.46
    b.begin('洗面所・床と天井と内壁', L)
    b.box(x0, x1, FLOOR, FLOOR + 0.012, zo, zc, C_FLOOR_WC)
    b.box(x0, x1, CEIL - 0.02, CEIL, zo, zc, '#e3e2de')
    b.box(x0, x1, FLOOR, CEIL, zo - 0.03, zo, C_FRP)
    b.begin('洗面所・一体成形カウンターと洗面ボウル', L)
    xm = (x0 + x1) / 2
    zf = zo + 0.52  # カウンターの前
    b.box(x0, x1, FLOOR, 1.82, zo, zf - 0.03, '#e3dfd7', top='none')  # 下の収納
    counter_with_bowl(b, x0, x1, zo, zf, 1.88, xm, zo + 0.29, 0.23, 0.16, 0.15, 0.06, '#f5f3ee', '#ece9e2')  # 一体成形カウンター
    b.box(x0, x1, 1.88, 1.98, zo, zo + 0.02, '#f5f3ee')  # 立ち上がり
    faucet(b, xm, 1.88, zo + 0.06, (0, 1))
    # 泡せっけん（左）と手指乾燥（右・吹き出し口）
    b.box(xm - 0.30, xm - 0.25, 1.88, 2.00, zo + 0.04, zo + 0.09, C_STAIN)
    b.box(xm - 0.285, xm - 0.265, 1.99, 2.03, zo + 0.07, zo + 0.12, C_STAIN)
    b.box(xm + 0.24, xm + 0.33, 1.88, 2.06, zo + 0.02, zo + 0.11, '#e9e8e3')
    b.box(xm + 0.25, xm + 0.32, 1.881, 1.95, zo + 0.11, zo + 0.115, '#2b2f33')
    # カウンター前のくず入れの口と、前板
    fr = Frame((0, 0, zf - 0.03 + 0.001), (1, 0, 0), (0, 1, 0))
    if fr.n[2] < 0:
        fr = Frame((0, 0, zf - 0.03 + 0.001), (-1, 0, 0), (0, 1, 0))
    aa = lambda x: x if fr.u[0] > 0 else -x
    b.rect(fr, min(aa(xm - 0.12), aa(xm + 0.12)), max(aa(xm - 0.12), aa(xm + 0.12)), 1.62, 1.67, '#2b2f33', 0.0)
    b.text(fr, 'くず入れ', aa(xm), 1.56, 0.03, '#6f7478', 0.0005, 'center')
    b.rect(fr, min(aa(x0 + 0.02), aa(x1 - 0.02)), max(aa(x0 + 0.02), aa(x1 - 0.02)), 1.10, 1.12, '#cfcbc2', 0.0)
    b.begin('洗面所・鏡と両脇の明かり（人感センサー）', L)
    b.box(xm - 0.27, xm + 0.27, 2.02, 2.80, zo, zo + 0.006, C_MIRROR)
    for s in (-1, 1):
        xl = xm + s * 0.31
        b.box(xl - 0.025, xl + 0.025, 2.02, 2.80, zo, zo + 0.025, '#e9e8e3')
        b.box(xl - 0.018, xl + 0.018, 2.05, 2.77, zo + 0.025, zo + 0.028, 'mat:light')
    b.box(xm - 0.30, xm + 0.30, 2.80, 2.86, zo, zo + 0.10, '#f3f1ec')
    # センサーの小窓
    b.box(xm - 0.02, xm + 0.02, 2.82, 2.84, zo + 0.10, zo + 0.103, '#1b1d1f')
    b.begin('洗面所・カーテン（引き寄せた状態）とレール', L)
    b.box(x0, x1, CEIL - 0.06, CEIL - 0.03, zc - 0.03, zc - 0.01, C_STAIN)
    # ひだのあるカーテンを x0 側に寄せる
    n = 9
    pts = []
    for k in range(n + 1):
        t = k / n
        pts.append((x0 + 0.02 + 0.22 * t, zc - 0.02 + 0.025 * math.sin(t * math.pi * 6)))
    for i in range(n):
        (xa, za), (xb, zb) = pts[i], pts[i + 1]
        b.face([(xa, 1.18, za), (xb, 1.18, zb), (xb, CEIL - 0.06, zb), (xa, CEIL - 0.06, za)], '#4d6d74', True)
    # 入口の案内（上）
    b.begin('洗面所・案内表示', L)
    sfr = Frame((0, 0, zc + 0.001), (1, 0, 0), (0, 1, 0))
    if sfr.n[2] < 0:
        sfr = Frame((0, 0, zc + 0.001), (-1, 0, 0), (0, 1, 0))


def urinal_room(b, x0, x1):
    """男性用（−z 側）: 壁掛け小便器・手洗い・折戸"""
    zc, zo = -0.44, -1.46
    b.begin('化粧室（男性用）・床と天井と内壁', L)
    b.box(x0, x1, FLOOR, FLOOR + 0.012, zo, zc, C_FLOOR_WC)
    b.box(x0, x1, CEIL - 0.02, CEIL, zo, zc, '#e3e2de')
    b.box((x0 + x1) / 2 - 0.2, (x0 + x1) / 2 + 0.2, CEIL - 0.024, CEIL - 0.02, -1.05, -0.85, 'mat:light')
    b.box(x0, x1, FLOOR, CEIL, zo - 0.03, zo, C_FRP)
    b.begin('化粧室（男性用）・壁掛け小便器と手洗い', L)
    xm = (x0 + x1) / 2
    # 背面の点検板
    b.box(xm - 0.25, xm + 0.25, FLOOR, 2.40, zo, zo + 0.10, '#d6d2c9', top='#cfcac0')
    zb = zo + 0.10
    # 小便器: 下がすぼまった縦長の器
    loft(b, [
        (1.48, xm, zb + 0.12, 0.10, 0.08),
        (1.60, xm, zb + 0.17, 0.17, 0.15),
        (1.95, xm, zb + 0.18, 0.18, 0.17),
        (2.10, xm, zb + 0.15, 0.17, 0.14),
    ], C_CERAMIC, 24)
    # 器の内側（手前を開けた形を、暗めの面で表す）
    fr = Frame((0, 0, zb + 0.345), (1, 0, 0), (0, 1, 0))
    if fr.n[2] < 0:
        fr = Frame((0, 0, zb + 0.345), (-1, 0, 0), (0, 1, 0))
    aa = lambda x: x if fr.u[0] > 0 else -x
    b.poly(fr, ellipse2(aa(xm), 1.82, 0.125, 0.22, 24), '#c9d3d8', 0.002)
    # 上の自動洗浄センサー
    b.box(xm - 0.06, xm + 0.06, 2.14, 2.22, zb, zb + 0.06, '#e9e8e3')
    b.box(xm - 0.025, xm + 0.025, 2.165, 2.195, zb + 0.06, zb + 0.062, '#202326')
    # 手すり（両側）
    for s in (-1, 1):
        stainless_rail(b, [(xm + s * 0.32, 1.75, zb + 0.02), (xm + s * 0.32, 1.75, zb + 0.20), (xm + s * 0.32, 2.20, zb + 0.20), (xm + s * 0.32, 2.20, zb + 0.02)], 0.014)
    # 手洗い（扉の横の隅）
    corner_basin(b, x1 - 0.26, x1, zc - 0.30, zc - 0.02, 1.86)
    faucet(b, x1 - 0.03, 1.86, zc - 0.16, (-1, 0))
    b.box(x1 - 0.004, x1, 2.00, 2.40, zc - 0.30, zc - 0.04, C_MIRROR)
    b.begin('化粧室（男性用）・備品', L)
    fr0 = Frame((x0 + 0.001, 0, 0), (0, 0, 1), (0, 1, 0))
    if fr0.n[0] < 0:
        fr0 = Frame((x0 + 0.001, 0, 0), (0, 0, -1), (0, 1, 0))
    zz = lambda z: z if fr0.u[2] > 0 else -z
    emergency_button(b, fr0, zz(-0.80), 1.62)
    b.box(x0, x0 + 0.06, 2.40, 2.44, -0.75, -0.72, C_STAIN)


def corridor_walls(b):
    """通路の両側の間仕切り（扉の開口つき）・端の壁"""
    b.begin('化粧室まわり・間仕切り', L)
    T = 0.04
    # +z 側の通路の壁 z 0.40〜0.44: 開口 11.32〜12.17（共用）・12.62〜13.27（女性用）
    segs = [(11.15, 11.32), (12.17, 12.62), (13.27, 13.50)]
    for xa, xb in segs:
        wall_box(b, xa, xb, FLOOR, CEIL, 0.40, 0.40 + T)
    for xa, xb in ((11.32, 12.17), (12.62, 13.27)):
        wall_box(b, xa, xb, 2.95, CEIL, 0.40, 0.40 + T)
        # 扉枠（ステンレス）
        for x in (xa, xb):
            wall_box(b, x - 0.015, x + 0.015, FLOOR, 2.95, 0.39, 0.45, C_STAIN)
        wall_box(b, xa - 0.015, xb + 0.015, 2.93, 2.96, 0.39, 0.45, C_STAIN)
    # 個室の仕切り（+z）
    for x in (11.15, 12.44, 13.46):
        wall_box(b, x, x + T, FLOOR, CEIL, 0.44, 1.49)
    # −z 側の通路の壁 z -0.44〜-0.40: 洗面所は開放（11.19〜12.09）、男性用の開口 12.24〜12.84、業務用室 13.08〜13.40
    segs = [(11.15, 11.19), (12.09, 12.24), (12.84, 13.08), (13.40, 13.50)]
    for xa, xb in segs:
        wall_box(b, xa, xb, FLOOR, CEIL, -0.44, -0.40)
    wall_box(b, 11.19, 12.09, 2.90, CEIL, -0.44, -0.40)
    for xa, xb in ((12.24, 12.84), (13.08, 13.40)):
        wall_box(b, xa, xb, 2.95, CEIL, -0.44, -0.40)
        for x in (xa, xb):
            wall_box(b, x - 0.015, x + 0.015, FLOOR, 2.95, -0.45, -0.39, C_STAIN)
        wall_box(b, xa - 0.015, xb + 0.015, 2.93, 2.96, -0.45, -0.39, C_STAIN)
    for x in (11.15, 12.09, 12.88, 13.46):
        wall_box(b, x, x + T, FLOOR, CEIL, -1.49, -0.44)
    # 通路の床・天井
    b.begin('化粧室まわり・通路の床と天井', L)
    b.box(11.15, 13.46, FLOOR, FLOOR + 0.012, -0.40, 0.40, C_FLOOR_DECK)
    b.box(11.15, 13.46, CEIL - 0.02, CEIL, -0.40, 0.40, '#e1e0dc')
    for x in (11.6, 12.5, 13.2):
        b.box(x - 0.18, x + 0.18, CEIL - 0.024, CEIL - 0.02, -0.12, 0.12, 'mat:light')
    # 業務用室の扉（閉）
    b.begin('業務用室の扉', L)
    wall_box(b, 13.10, 13.38, FLOOR + 0.01, 2.92, -0.40, -0.385, C_DOOR)
    fr = Frame((13.24, 0, -0.384), (1, 0, 0), (0, 1, 0))
    if fr.n[2] < 0:
        fr = Frame((13.24, 0, -0.384), (-1, 0, 0), (0, 1, 0))
    b.obox(fr, -0.08, 0.08, 2.45, 2.53, 0.0, 0.003, '#2d3a4a')
    b.text(fr, '業務用室', 0, 2.475, 0.03, '#f4f4f0', 0.0035, 'center')
    b.box(13.12, 13.14, 1.90, 2.10, -0.38, -0.365, C_STAIN)


def sliding_door(b, xa, xb, open_frac, name, sign_lines, side=1):
    """通路側の引き戸（自動）。開口 xa〜xb、扉は通路側（z の小さい側）に重ねて引く"""
    w = xb - xa
    shift = w * open_frac
    zf = 0.40 - 0.035 if side > 0 else -0.40 + 0.005
    zb = zf + 0.03
    b.begin(f'{name}・自動扉', L)
    x0 = xa + shift
    b.box(x0, x0 + w, FLOOR + 0.01, 2.92, zf, zb, C_DOOR)
    # 取っ手のくぼみ（縦）と窓のない扉の縁
    fr = Frame((0, 0, zf - 0.001), (-1, 0, 0), (0, 1, 0))
    if fr.n[2] > 0:
        fr = Frame((0, 0, zf - 0.001), (1, 0, 0), (0, 1, 0))
    aa = lambda x: x if fr.u[0] > 0 else -x
    b.rect(fr, min(aa(x0 + 0.04), aa(x0 + 0.07)), max(aa(x0 + 0.04), aa(x0 + 0.07)), 1.75, 2.15, '#9a9a96', 0.0)
    # 開ボタン・使用中の表示（扉の横の壁）
    b.begin(f'{name}・開ボタンと使用表示', L)
    fw = Frame((0, 0, 0.40 - 0.001), (-1, 0, 0), (0, 1, 0))
    if fw.n[2] > 0:
        fw = Frame((0, 0, 0.40 - 0.001), (1, 0, 0), (0, 1, 0))
    a = (xa - 0.08) if fw.u[0] > 0 else -(xa - 0.08)
    b.obox(fw, a - 0.045, a + 0.045, 1.95, 2.13, 0.0, 0.01, '#d9d6cf', top='#f3f1ea')
    cf = Frame(fw.p(a, 2.07, 0.01), fw.u, fw.v)
    b.cyl(cf, 0.025, 0.0, 0.008, '#9aa1a7', 16, cap_color='#3fae5c')
    b.text(fw, '開', a, 1.975, 0.022, '#333333', 0.011, 'center')
    # 扉の上: 使用中表示（空き = 緑）と案内板
    am = ((xa + xb) / 2) if fw.u[0] > 0 else -((xa + xb) / 2)
    b.obox(fw, am - 0.14, am + 0.14, 2.97, 3.01, 0.0, 0.006, '#1b1d20')
    b.rect(fw, am - 0.13, am - 0.01, 2.975, 3.005, 'mat:lcd-green', 0.0065)
    b.text(fw, '空き', am - 0.07, 2.98, 0.02, '#0b1a33', 0.007, 'center')
    b.rect(fw, am + 0.01, am + 0.13, 2.975, 3.005, '#3a1614', 0.0065)
    b.text(fw, '使用中', am + 0.07, 2.98, 0.017, '#7a4440', 0.007, 'center')
    # 横の壁の案内板
    a2 = (xb + 0.12) if fw.u[0] > 0 else -(xb + 0.12)
    if xb + 0.24 < 13.46:
        sign_plate(b, fw, a2, 2.30, 0.17, 0.24, sign_lines)


def deck(b, x0, x1, door_x0, door_x1, name, ceil_y=DECK_CEIL, wall_z=1.50, door_z=1.60, door_top=2.98):
    """乗降ドアのあるデッキ（両側）"""
    b.begin(f'{name}・床と天井', LD)
    b.box(x0, x1, FLOOR, FLOOR + 0.012, -wall_z, wall_z, C_FLOOR_DECK)
    b.box(x0, x1, ceil_y - 0.02, ceil_y, -wall_z, wall_z, '#e1e0dc')
    b.box((x0 + x1) / 2 - 0.30, (x0 + x1) / 2 + 0.30, ceil_y - 0.024, ceil_y - 0.02, -0.15, 0.15, 'mat:light')
    # 防犯カメラ（天井の黒い半球）と非常通報の案内
    b.sphere(((x0 + x1) / 2 + 0.38, ceil_y - 0.02, 0.0), 0.05, '#1d1f22', 14, 6)
    b.box((x0 + x1) / 2 + 0.33, (x0 + x1) / 2 + 0.43, ceil_y - 0.025, ceil_y - 0.02, -0.05, 0.05, '#f3f1ec')
    for s in (1, -1):
        side = '山側' if s > 0 else '海側'
        b.begin(f'{name}・乗降ドアの内側（{side}）', LD)
        z_in = wall_z * s
        DT = door_top + 0.02
        DTL = door_top
        z_door = door_z * s
        # 壁（ドアの開口の前後と上）
        wall_box(b, x0, door_x0 - 0.03, FLOOR, ceil_y, z_in, z_in + 0.03 * s, C_DECKWALL)
        wall_box(b, door_x1 + 0.03, x1, FLOOR, ceil_y, z_in, z_in + 0.03 * s, C_DECKWALL)
        wall_box(b, door_x0 - 0.03, door_x1 + 0.03, DT, ceil_y, z_in, z_in + 0.03 * s, C_DECKWALL)
        # 開口の見込み（ステンレス）
        wall_box(b, door_x0 - 0.03, door_x0, FLOOR, DT, z_in, z_door, C_STAIN)
        wall_box(b, door_x1, door_x1 + 0.03, FLOOR, DT, z_in, z_door, C_STAIN)
        wall_box(b, door_x0 - 0.03, door_x1 + 0.03, DTL, DT, z_in, z_door, C_STAIN)
        # 足元のステップ（滑り止め・黄色の線）
        wall_box(b, door_x0, door_x1, FLOOR, FLOOR + 0.014, z_in, z_door, '#5f6366')
        wall_box(b, door_x0, door_x1, FLOOR + 0.014, FLOOR + 0.016, z_in + 0.01 * s, z_in + 0.05 * s, '#e0b030')
        # ドア（内側の面・窓つき）
        wx0, wx1, wy0, wy1 = door_x0 + 0.19, door_x1 - 0.18, 1.98, 2.71
        zd0, zd1 = z_door, z_door + 0.03 * s
        wall_box(b, door_x0, door_x1, FLOOR + 0.016, wy0, zd0, zd1, C_DOOR)
        wall_box(b, door_x0, door_x1, wy1, DTL, zd0, zd1, C_DOOR)
        wall_box(b, door_x0, wx0, wy0, wy1, zd0, zd1, C_DOOR)
        wall_box(b, wx1, door_x1, wy0, wy1, zd0, zd1, C_DOOR)
        wall_box(b, wx0, wx1, wy0, wy1, zd0 + 0.01 * s, zd0 + 0.015 * s, 'mat:glass-clear')
        # 窓の黒い枠
        fr = Frame((0, 0, zd0 - 0.001 * s), (1, 0, 0), (0, 1, 0))
        if fr.n[2] * s > 0:
            fr = Frame((0, 0, zd0 - 0.001 * s), (-1, 0, 0), (0, 1, 0))
        aa = lambda x: x if fr.u[0] > 0 else -x
        lo, hi = min(aa(wx0 - 0.02), aa(wx1 + 0.02)), max(aa(wx0 - 0.02), aa(wx1 + 0.02))
        lo2, hi2 = min(aa(wx0), aa(wx1)), max(aa(wx0), aa(wx1))
        b.poly(fr, rect2(lo, hi, wy0 - 0.02, wy1 + 0.02), '#2a2d30', 0.0, holes2=[rect2(lo2, hi2, wy0, wy1)])
        # 手すり（ドアの両脇・縦）
        for x in (door_x0 - 0.07, door_x1 + 0.07):
            stainless_rail(b, [(x, 1.80, z_in), (x, 1.80, z_in - 0.06 * s), (x, 2.70, z_in - 0.06 * s), (x, 2.70, z_in)], 0.015)
        # ドアの上: 号車の表示
        fw = Frame((0, 0, z_in - 0.001 * s), (1, 0, 0), (0, 1, 0))
        if fw.n[2] * s > 0:
            fw = Frame((0, 0, z_in - 0.001 * s), (-1, 0, 0), (0, 1, 0))
        a = ((door_x0 + door_x1) / 2) * (1 if fw.u[0] > 0 else -1)
        ys = door_top + 0.035
        b.obox(fw, a - 0.20, a + 0.20, ys, ys + 0.055, 0.0, 0.006, '#1d2530', top='#1d2530')
        b.text(fw, '1号車  自由席', a, ys + 0.012, 0.03, '#f4f4f0', 0.0066, 'center')


def deck_equipment(b):
    """後ろのデッキの設備: ごみ箱（ダストボックス）・消火器・非常通報器・案内"""
    x = 11.15 - 0.001
    fr = Frame((x, 0, 0), (0, 0, 1), (0, 1, 0))  # 法線 -x（デッキ側）
    if fr.n[0] > 0:
        fr = Frame((x, 0, 0), (0, 0, -1), (0, 1, 0))
    aa = lambda z: z if fr.u[2] > 0 else -z
    b.begin('デッキ・ダストボックス', LD)
    z0, z1 = -1.45, -0.47
    b.box(11.02, 11.15, FLOOR, 2.02, z0, z1, '#cfd1d2', top='#bfc2c4')
    f2 = Frame((11.02 - 0.001, 0, 0), fr.u, (0, 1, 0))
    cols = [('缶・びん・', 'ペットボトル', '#2f6fb3'), ('新聞・雑誌', '', '#3a8a4e'), ('その他の', 'ごみ', '#8a8f94')]
    for k, (t1, t2, c) in enumerate(cols):
        za = z0 + 0.04 + k * 0.33
        zb = za + 0.29
        lo, hi = min(aa(za), aa(zb)), max(aa(za), aa(zb))
        b.rect(f2, lo, hi, 1.62, 1.98, '#e4e6e7', 0.0)
        b.rect(f2, lo + 0.03, hi - 0.03, 1.70, 1.76 if k != 1 else 1.72, '#202326', 0.001)  # 投入口
        b.rect(f2, lo, hi, 1.92, 1.98, c, 0.0012)
        b.text(f2, t1, (lo + hi) / 2, 1.85, 0.028, '#333333', 0.0012, 'center')
        if t2:
            b.text(f2, t2, (lo + hi) / 2, 1.80, 0.028, '#333333', 0.0012, 'center')
        b.rect(f2, lo + 0.02, hi - 0.02, 1.08, 1.56, '#d7d9da', 0.0008)
        b.rect(f2, (lo + hi) / 2 - 0.04, (lo + hi) / 2 + 0.04, 1.50, 1.52, '#7e8387', 0.0012)
    b.begin('デッキ・消火器と非常通報器', LD)
    # 消火器の箱（+z 側の仕切りの面）
    b.box(11.07, 11.15, 1.08, 1.70, 1.02, 1.40, '#d9d9d4')
    f3 = Frame((11.07 - 0.001, 0, 0), fr.u, (0, 1, 0))
    lo, hi = min(aa(1.04), aa(1.38)), max(aa(1.04), aa(1.38))
    b.rect(f3, lo + 0.03, hi - 0.03, 1.12, 1.56, '#f4f4ef', 0.0)
    b.rect(f3, lo + 0.03, hi - 0.03, 1.58, 1.67, '#c4231c', 0.0008)
    b.text(f3, '消火器', (lo + hi) / 2, 1.60, 0.045, '#ffffff', 0.0012, 'center')
    # 非常通報器
    lo, hi = min(aa(0.55), aa(0.80)), max(aa(0.55), aa(0.80))
    b.obox(fr, lo, hi, 1.85, 2.15, 0.0, 0.02, '#d9d6cf', top='#f3f1ea')
    b.text(fr, '非常通報', (lo + hi) / 2, 2.10, 0.03, '#b51f1a', 0.0205, 'center')
    cf = Frame(fr.p((lo + hi) / 2, 1.98, 0.02), fr.u, fr.v)
    b.cyl(cf, 0.04, 0.0, 0.014, '#9aa1a7', 20, cap_color='#c0281f')
    b.text(fr, '押すと乗務員と話せます', (lo + hi) / 2, 1.88, 0.013, '#444444', 0.0205, 'center')
    # 通路の入口の上の案内
    b.begin('デッキ・化粧室の案内', LD)
    b.box(11.12, 11.15, 2.78, 3.0, -0.40, 0.40, '#1d2530')
    lo, hi = min(aa(-0.40), aa(0.40)), max(aa(-0.40), aa(0.40))
    f4 = Frame((11.12 - 0.001, 0, 0), fr.u, (0, 1, 0))
    b.text(f4, '化粧室・洗面所', 0, 2.86, 0.06, '#f4f4f0', 0.0, 'center')
    b.text(f4, 'Restrooms', 0, 2.80, 0.03, '#c9d3dd', 0.0, 'center')


def gangway_door(b):
    """通路の突き当り: 2 号車への貫通扉（自動・窓つき）"""
    b.begin('貫通扉（2 号車へ）', LD)
    x = 13.46
    wall_box(b, x, x + 0.04, 2.86, CEIL, -0.40, 0.40, C_PART)
    wall_box(b, x - 0.01, x + 0.05, FLOOR, 2.86, -0.40, -0.36, C_STAIN)
    wall_box(b, x - 0.01, x + 0.05, FLOOR, 2.86, 0.36, 0.40, C_STAIN)
    wall_box(b, x - 0.01, x + 0.05, 2.84, 2.87, -0.40, 0.40, C_STAIN)
    # 扉（窓つき）
    zx0, zx1, wy0, wy1 = -0.20, 0.20, 1.95, 2.65
    xd0, xd1 = x + 0.005, x + 0.035
    wall_box(b, xd0, xd1, FLOOR + 0.01, wy0, -0.36, 0.36, C_DOOR)
    wall_box(b, xd0, xd1, wy1, 2.84, -0.36, 0.36, C_DOOR)
    wall_box(b, xd0, xd1, wy0, wy1, -0.36, zx0, C_DOOR)
    wall_box(b, xd0, xd1, wy0, wy1, zx1, 0.36, C_DOOR)
    wall_box(b, xd0 + 0.012, xd0 + 0.016, wy0, wy1, zx0, zx1, 'mat:glass-clear')
    fr = Frame((xd0 - 0.001, 0, 0), (0, 0, 1), (0, 1, 0))
    if fr.n[0] > 0:
        fr = Frame((xd0 - 0.001, 0, 0), (0, 0, -1), (0, 1, 0))
    b.poly(fr, rect2(-0.22, 0.22, wy0 - 0.02, wy1 + 0.02), '#2a2d30', 0.0, holes2=[rect2(-0.20, 0.20, wy0, wy1)])
    # 開閉のタッチセンサー（縦長）
    b.rect(fr, -0.30, -0.25, 1.75, 2.05, '#3a8fd8', 0.0)
    b.text(fr, '2号車', 0, 2.70, 0.035, '#333333', 0.0005, 'center')
    # 向こうの幌の中（暗い）
    wall_box(b, x + 0.10, x + 0.12, FLOOR, 2.84, -0.40, 0.40, '#2b2d30')


def build(b):
    corridor_walls(b)
    toilet_room(b, 11.19, 12.44, 'shared')
    toilet_room(b, 12.48, 13.46, 'women')
    sliding_door(b, 11.32, 12.17, 0.55, '化粧室（男女共用）', [('化粧室', 0.03), ('男女共用', 0.022), ('おむつ交換台', 0.017)])
    sliding_door(b, 12.62, 13.27, 0.0, '化粧室（女性用）', [('化粧室', 0.03), ('女性用', 0.022)])
    wash_room(b, 11.19, 12.09)
    urinal_room(b, 12.13, 12.88)
    # 男性用の折戸（たたんで開けた状態）
    b.begin('化粧室（男性用）・折戸', L)
    for k in range(2):
        za = -0.44 + 0.03
        x = 12.27 + k * 0.035
        wall_box(b, x, x + 0.025, FLOOR + 0.01, 2.92, -0.41, -0.10 - k * 0.0, C_DOOR)
    fw = Frame((0, 0, -0.40 + 0.001), (1, 0, 0), (0, 1, 0))
    if fw.n[2] < 0:
        fw = Frame((0, 0, -0.40 + 0.001), (-1, 0, 0), (0, 1, 0))
    a = (12.96) if fw.u[0] > 0 else -12.96
    sign_plate(b, fw, (12.16 if fw.u[0] > 0 else -12.16) , 2.30, 0.12, 0.22, [('男性用', 0.022)])
    gangway_door(b)
    deck(b, 10.13, 11.15, 10.23, 10.98, '後部デッキ')
    deck_equipment(b)
    # 前のデッキ（運転室の後ろ）
    deck(b, -4.87, -3.73, -4.70, -3.96, '前部デッキ', 2.92, 1.42, 1.52, 2.80)
