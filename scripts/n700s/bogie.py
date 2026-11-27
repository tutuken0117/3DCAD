"""
台車（1 号車は付随台車 2 つ）。

- 軌間 1435 mm。レール頭の中心は z = ±0.7500（頭の幅 65 mm、内側の縁が ±0.7175）
- 車輪の直径 860 mm（踏面の中心で）。踏面は 1/40 の勾配、内側にフランジ（高さ約 30 mm）
- 左右の車輪の内側の間隔（バック ゲージ）1360 mm → 車輪の内面 z = ±0.680、外面 ±0.805
- 踏面の z = ±0.75 のところが、レールの頭の上面（y = 0）にちょうど接する
- 車軸・軸箱・軸ばね・台車枠（側はり・横はり）・空気ばね・ヨーダンパ・ブレーキディスク・ATC の受電器
"""
import math
from lib import Frame, rrect2

L = 'Bogie'
R = 0.430            # 踏面の半径（z = 0.75 のところ）
AXLE_Y = R           # 車軸の中心の高さ（レール面が 0）
CENTERS = [-7.0, 10.5]
WHEELBASE = 2.5

C_WHEEL = '#8a9095'
C_TREAD = 'mat:stainless'
C_FRAME = '#3b4146'
C_DISC = '#5d6368'
C_SPRING = '#2f3438'
C_RUBBER = '#26292c'


def wheel(b, xa, s):
    """1 枚の車輪。s = +1 は +z 側"""
    fr = Frame((xa, AXLE_Y, 0.0), (1, 0, 0), (0, 1, 0))  # n = +z（車軸の向き）
    if s < 0:
        fr = Frame((xa, AXLE_Y, 0.0), (-1, 0, 0), (0, 1, 0))  # n = -z
    cone = lambda z: R + (0.75 - z) / 40.0
    # 断面（半径, z）: 内面 → フランジ → 踏面 → 外面
    prof = [
        (0.395, 0.680), (0.452, 0.680), (0.462, 0.686), (0.463, 0.692), (0.457, 0.700),
        (0.445, 0.706), (cone(0.712), 0.712), (cone(0.75), 0.75), (cone(0.79), 0.79),
        (cone(0.805) - 0.004, 0.805), (0.395, 0.805),
    ]
    b.lathe(fr, prof, C_WHEEL, 40)
    # 踏面だけ光らせる（細い帯を重ねる）
    b.lathe(fr, [(cone(0.712) + 0.0006, 0.712), (cone(0.75) + 0.0006, 0.75), (cone(0.79) + 0.0006, 0.79)], C_TREAD, 40)
    # 板（ウェブ）とボス
    b.lathe(fr, [(0.395, 0.700), (0.20, 0.715), (0.12, 0.700), (0.12, 0.640)], C_WHEEL, 32)
    b.lathe(fr, [(0.395, 0.785), (0.20, 0.770), (0.12, 0.790), (0.12, 0.820)], C_WHEEL, 32)
    # 車輪に締めたブレーキディスク（両面）
    for z0, z1 in ((0.665, 0.680), (0.805, 0.820)):
        b.cyl(fr, 0.36, z0, z1, C_DISC, 32, cap=True)
        b.cyl(fr, 0.20, z0 - 0.001, z1 + 0.001, '#4a4f53', 24, cap=True)


def bogie(b, xc, name, front):
    b.begin(f'{name}・車輪と車軸', L)
    axles = [xc - WHEELBASE / 2, xc + WHEELBASE / 2]
    for xa in axles:
        for s in (1, -1):
            wheel(b, xa, s)
        ax = Frame((xa, AXLE_Y, 0.0), (1, 0, 0), (0, 1, 0))
        b.cyl(ax, 0.085, -0.95, 0.95, '#6d7378', 20)
        # 軸箱（車輪の外）と軸ばね
        for s in (1, -1):
            b.cyl(ax, 0.13, s * 0.86 if s > 0 else -1.02, s * 1.02 if s > 0 else -0.86, '#2e3337', 20)
            b.box(xa - 0.20, xa + 0.20, AXLE_Y + 0.08, AXLE_Y + 0.16, s * 0.86 if s > 0 else -1.04, s * 1.04 if s > 0 else -0.86, C_FRAME)
            for dx in (-0.14, 0.14):
                sp = Frame((xa + dx, AXLE_Y + 0.16, s * 0.95), (1, 0, 0), (0, 0, -1))  # n = +y
                b.cyl(sp, 0.075, 0.0, 0.14, C_SPRING, 16)
                for k in range(5):
                    b.cyl(sp, 0.082, 0.015 + k * 0.026, 0.025 + k * 0.026, '#454b50', 16)
    b.begin(f'{name}・台車枠', L)
    # 側はり（軸ばねの上・中央で下がる）
    for s in (1, -1):
        z0, z1 = (0.88, 1.04) if s > 0 else (-1.04, -0.88)
        y_end, y_mid = AXLE_Y + 0.30, AXLE_Y + 0.16
        xa, xb = axles[0] - 0.40, axles[1] + 0.40
        fr = Frame((0, 0, z1), (1, 0, 0), (0, 1, 0))  # n = +z
        prof = [(xa, y_end - 0.12), (axles[0] + 0.25, y_end - 0.12), (xc - 0.45, y_mid - 0.06), (xc + 0.45, y_mid - 0.06),
                (axles[1] - 0.25, y_end - 0.12), (xb, y_end - 0.12), (xb, y_end + 0.02), (axles[1] - 0.25, y_end + 0.02),
                (xc + 0.45, y_mid + 0.12), (xc - 0.45, y_mid + 0.12), (axles[0] + 0.25, y_end + 0.02), (xa, y_end + 0.02)]
        b.prism(fr, prof, -(z1 - z0), 0.0, C_FRAME, soft_sides=False)
    # 横はり（2 本）
    for dx in (-0.22, 0.22):
        b.box(xc + dx - 0.09, xc + dx + 0.09, AXLE_Y + 0.08, AXLE_Y + 0.24, -0.88, 0.88, C_FRAME)
    # 空気ばね（車体との間）と、まくらばりの台
    for s in (1, -1):
        af = Frame((xc, AXLE_Y + 0.28, s * 1.02), (1, 0, 0), (0, 0, -1))  # n = +y
        b.lathe(af, [(0.0, 0.0), (0.20, 0.0), (0.25, 0.06), (0.27, 0.13), (0.25, 0.20), (0.21, 0.25), (0.0, 0.25)], C_RUBBER, 28)
        b.cyl(af, 0.26, 0.25, 0.27, C_FRAME, 28)
        # ヨーダンパ（前後に寝かせた筒）
        yf = Frame((xc + 0.30, AXLE_Y + 0.33, s * 1.22), (0, 1, 0), (0, 0, 1))  # n = +x
        b.cyl(yf, 0.045, 0.0, 0.95, '#1e2124', 16)
        b.cyl(yf, 0.06, 0.95, 1.05, '#7b8186', 16)
    # ブレーキのキャリパ（ディスクをはさむ）
    b.begin(f'{name}・ブレーキ装置', L)
    for xa in axles:
        for s in (1, -1):
            for side_x in (-1,):
                x = xa + side_x * 0.30
                z0, z1 = (0.62, 0.86) if s > 0 else (-0.86, -0.62)
                b.box(x - 0.07, x + 0.07, AXLE_Y + 0.05, AXLE_Y + 0.25, z0, z1, '#2a2e32')
    if front:
        # ATC の受電器（先頭の車軸の前・2 本のレールの間の低いところ）
        b.begin('ATC 受電器（先頭の台車の前）', L)
        xr = axles[0] - 0.72
        for zc in (-0.75, 0.75):
            b.box(xr - 0.12, xr + 0.12, 0.10, 0.18, zc - 0.10, zc + 0.10, '#1f2326')
            b.box(xr - 0.03, xr + 0.03, 0.18, AXLE_Y + 0.12, zc - 0.03, zc + 0.03, '#2f3438')
        b.box(xr - 0.04, xr + 0.04, AXLE_Y + 0.08, AXLE_Y + 0.14, -0.80, 0.80, '#2f3438')


def build(b):
    bogie(b, CENTERS[0], '前の台車', True)
    bogie(b, CENTERS[1], '後ろの台車', False)
