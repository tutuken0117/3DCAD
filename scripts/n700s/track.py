"""
線路（東海道新幹線の複線のバラスト軌道）と盛土・架線。

- 軌間 1435 mm、60 kg レール（頭の上面 = 車輪の下端 y=0）
- PC まくらぎ（長さ 2.4 m・間隔 0.6 m）、砕石の道床
- 線路の中心の間隔 4.2 m。1 号車は西（-x）へ向かって左側（+z 側、z=0）の線路、隣は z=-4.2
- 高さ 1 m の盛土（のり面は草）、両側にケーブルのトラフ、架線柱と架線
"""
from lib import Frame

L = '線路'
X0, X1 = -40.0, 34.0         # 線路の長さ（74 m）
TRACKS = [0.0, -4.2]
RAIL_H = 0.174
SLEEPER_TOP = -RAIL_H - 0.012
SLEEPER_BOT = SLEEPER_TOP - 0.20
BALLAST_TOP = SLEEPER_TOP - 0.03
FORMATION = -0.62             # 路盤の上面
GROUND = -1.62                # 盛土の下（田畑の高さ）
ZC = -2.1                     # 複線の中心
HALF_TOP = 6.4                # 路盤の幅の半分
SLOPE = 1.5                   # のり面の勾配（1 : 1.5）

C_RAIL = '#6a5e55'
C_RAIL_HEAD = 'mat:stainless'
C_SLEEPER = '#a9a69e'
C_BALLAST = 'mat:gravel'
C_FORM = '#9c9a93'
C_TROUGH = '#b3b1aa'
C_POLE = '#8d9296'
C_WIRE = '#3b3530'


def rail(b, zc):
    """60 kg レールの断面を x 方向に押し出す"""
    fr = Frame((X0, 0, zc), (0, 0, 1), (0, 1, 0))  # n = -x
    hw, bw, ww = 0.0325, 0.0725, 0.009
    H = RAIL_H
    prof = [(-bw, -H), (bw, -H), (bw, -H + 0.012), (ww + 0.01, -H + 0.035), (ww, -H + 0.05), (ww, -0.05),
            (hw, -0.038), (hw, -0.004), (hw - 0.004, 0.0), (-hw + 0.004, 0.0), (-hw, -0.004), (-hw, -0.038),
            (-ww, -0.05), (-ww, -H + 0.05), (-ww - 0.01, -H + 0.035), (-bw, -H + 0.012)]
    b.prism(fr, prof, -(X1 - X0), 0.0, C_RAIL, soft_sides=False)
    # 頭の上面（車輪が当たって光る）
    b.box(X0, X1, -0.0005, 0.0005, zc - hw + 0.004, zc + hw - 0.004, C_RAIL_HEAD)


def build(b):
    b.begin('線路・盛土と路盤', L)
    zl, zr = ZC - HALF_TOP, ZC + HALF_TOP
    wb = (FORMATION - GROUND) * SLOPE
    # 路盤の上面（コンクリートの犬走り）
    b.box(X0, X1, FORMATION - 0.05, FORMATION, zl, zr, C_FORM, side=C_FORM)
    # のり面（草）と端の断面
    for s, ze in ((1, zr), (-1, zl)):
        zt, zb = ze, ze + s * wb
        p = [(X0, FORMATION - 0.05, zt), (X1, FORMATION - 0.05, zt), (X1, GROUND, zb), (X0, GROUND, zb)]
        b.face(p if s > 0 else list(reversed(p)), '#7c9c55')
    for x, s in ((X0, -1), (X1, 1)):
        p = [(x, GROUND, zl - wb), (x, GROUND, zr + wb), (x, FORMATION - 0.05, zr), (x, FORMATION - 0.05, zl)]
        b.face(p if s > 0 else list(reversed(p)), '#7d7468')
    # 下の面（地面の高さ）
    b.face([(X0, GROUND, zl - wb), (X0, GROUND, zr + wb), (X1, GROUND, zr + wb), (X1, GROUND, zl - wb)], '#6f8a52')

    b.begin('線路・ケーブルのトラフ', L)
    for z in (zl + 0.45, zr - 0.45):
        b.box(X0, X1, FORMATION, FORMATION + 0.22, z - 0.22, z + 0.22, C_TROUGH)
        for k in range(int((X1 - X0) / 1.0)):
            x = X0 + k * 1.0
            b.box(x, x + 0.008, FORMATION + 0.22, FORMATION + 0.222, z - 0.22, z + 0.22, '#8f8d87')

    for zc in TRACKS:
        name = '上り線' if zc < 0 else '下り線（1 号車）'
        b.begin(f'線路・道床（{name}）', L)
        # 砕石の道床: 上面は枕木の少し下、肩は広げて斜めに
        crest, toe = 1.65, 2.25
        y_top = BALLAST_TOP
        top = [(X0, y_top, zc - crest), (X0, y_top, zc + crest), (X1, y_top, zc + crest), (X1, y_top, zc - crest)]
        b.face(top, C_BALLAST)
        for s in (1, -1):
            p = [(X0, y_top, zc + s * crest), (X1, y_top, zc + s * crest), (X1, FORMATION, zc + s * toe), (X0, FORMATION, zc + s * toe)]
            b.face(p if s < 0 else list(reversed(p)), C_BALLAST)
        for x, s in ((X0, -1), (X1, 1)):
            p = [(x, FORMATION, zc - toe), (x, FORMATION, zc + toe), (x, y_top, zc + crest), (x, y_top, zc - crest)]
            b.face(p if s > 0 else list(reversed(p)), C_BALLAST)
        b.begin(f'線路・PC まくらぎ（{name}）', L)
        n = int((X1 - X0 - 0.3) / 0.6)
        for k in range(n):
            x = X0 + 0.3 + k * 0.6
            b.box(x - 0.12, x + 0.12, SLEEPER_BOT, SLEEPER_TOP, zc - 1.2, zc + 1.2, C_SLEEPER, bottom='none')
            # 締結装置（レールを留める黒い金具）
            for zr_ in (zc - 0.75, zc + 0.75):
                for d in (-1, 1):
                    zz = zr_ + d * 0.095
                    b.box(x - 0.05, x + 0.05, SLEEPER_TOP, SLEEPER_TOP + 0.035, zz - 0.022, zz + 0.022, '#2c2e30')
        b.begin(f'線路・レール（{name}）', L)
        b.box(X0, X1, SLEEPER_TOP, -RAIL_H, zc - 0.75 - 0.08, zc - 0.75 + 0.08, '#2a2b2c')  # 軌道パッド
        b.box(X0, X1, SLEEPER_TOP, -RAIL_H, zc + 0.75 - 0.08, zc + 0.75 + 0.08, '#2a2b2c')
        rail(b, zc - 0.75)
        rail(b, zc + 0.75)

    # 架線柱（両側の柱と、2 線をまたぐはり）と架線
    b.begin('架線柱とはり', L)
    zp1, zp2 = TRACKS[0] + 3.0, TRACKS[1] - 3.0
    for x in (-30.0, 20.0):
        for zp in (zp1, zp2):
            fr = Frame((x, FORMATION, zp), (1, 0, 0), (0, 0, -1))  # n = +y
            b.box(x - 0.45, x + 0.45, FORMATION - 0.05, FORMATION + 0.35, zp - 0.45, zp + 0.45, '#b9b7b0')
            b.cyl(fr, 0.17, 0.35, 8.6, C_POLE, 16)
        b.box(x - 0.15, x + 0.15, 8.0 + FORMATION, 8.45 + FORMATION, zp2 - 0.3, zp1 + 0.3, C_POLE)
        for zc in TRACKS:
            # はりから下げた吊り金具
            b.box(x - 0.03, x + 0.03, 6.0, 8.0 + FORMATION, zc - 0.03, zc + 0.03, C_POLE)
            b.box(x - 0.25, x + 0.25, 5.95, 6.0, zc - 0.06, zc + 0.06, '#9a9ea2')
    b.begin('架線（ちょう架線・トロリ線）', L)
    for zc in TRACKS:
        b.tube([(X0, 6.0, zc), (X1, 6.0, zc)], 0.009, C_WIRE, 6)
        b.tube([(X0, 5.0, zc), (X1, 5.0, zc)], 0.008, C_WIRE, 6)
        # ドロッパ（つり線）
        k = 0
        x = X0 + 2.5
        while x < X1:
            b.box(x - 0.004, x + 0.004, 5.0, 6.0, zc - 0.004, zc + 0.004, C_WIRE)
            x += 5.0
