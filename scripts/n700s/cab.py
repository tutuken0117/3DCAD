"""
運転室（1 号車の先頭）。
新幹線は右手でマスコン（N700S は 13 ノッチ）、左手でブレーキハンドルを扱う 2 ハンドル。
運転士は中央に座り、正面の計器盤に速度計（ATC の許容速度を緑の丸で示す液晶）と、左右に車両の状態・運転情報の液晶モニター。
"""
import math
from lib import Frame, facing, rect2, rrect2, circle2, arcband2, seg7, arc_pts, norm, sub, add, mul, cross

FLOOR = 1.05
DESK_TOP = 1.84
DRIVER_X = -6.33  # 座面の中心

# 色
C_DESK_TOP = '#2e3338'
C_DESK_SIDE = '#5f666d'
C_DESK_LOW = '#4a5056'
C_PANEL = '#24282c'
C_DASH = '#2a2e32'
C_WALL = '#d7dadc'
C_PLATE = '#8d949b'
C_SILVER = 'mat:stainless'
C_BLACK = 'mat:plastic-black'
C_SCREEN = 'mat:screen'
C_GRIP = '#1c1d1f'
C_SEAT = '#3a4656'
C_SEAT_DARK = '#2c3541'
C_TICK = '#e8ecef'
LINING = '#d9dcde'

# 場面: 名古屋に着く直前（客室の案内表示「まもなく 名古屋です」に合わせる）
SPEED = 165  # いまの速度 km/h
ATC = 170    # ATC の許容速度


def lcd_frame(b, fr, a0, a1, b0, b1):
    """液晶のベゼル（黒い縁）と画面の地"""
    b.poly(fr, rrect2(a0 - 0.014, a1 + 0.014, b0 - 0.014, b1 + 0.014, 0.008), '#15171a', 0.002)
    b.rect(fr, a0, a1, b0, b1, 'mat:lcd-bg', 0.004)


def speedometer(b, fr, cx, cy, w, h):
    """速度計（液晶）: 0〜360 km/h の丸い目盛・針。名古屋に着く前の減速中（ATC 170・いまの速度 165・ブレーキ B3）"""
    lcd_frame(b, fr, cx - w / 2, cx + w / 2, cy - h / 2, cy + h / 2)
    L = 0.006
    gx, gy = cx - w * 0.12, cy - h * 0.04
    R = h * 0.40
    v2a = lambda v: 225 - 270 * v / 360
    # 目盛の弧
    b.poly(fr, arcband2(gx, gy, R * 0.97, R, -45, 225, 48), 'mat:lcd-gray', L)
    for v in range(0, 361, 10):
        t = math.radians(v2a(v))
        major = v % 30 == 0
        r0 = R * (0.80 if major else 0.88)
        ca, sa = math.cos(t), math.sin(t)
        hw = 0.0016 if major else 0.0009
        pts = [(gx + r0 * ca - hw * sa, gy + r0 * sa + hw * ca), (gx + R * ca - hw * sa, gy + R * sa + hw * ca),
               (gx + R * ca + hw * sa, gy + R * sa - hw * ca), (gx + r0 * ca + hw * sa, gy + r0 * sa - hw * ca)]
        b.poly(fr, pts, 'mat:lcd-white' if major else 'mat:lcd-gray', L + 0.0004)
    # 速度の数字（0・60・120…）を 7 セグで小さく
    for v in (0, 60, 120, 180, 240, 300, 360):
        t = math.radians(v2a(v))
        r = R * 0.64
        s = str(v)
        hh = R * 0.12
        wdt = len(s) * hh / 2 * 1.35
        x0 = gx + r * math.cos(t) - wdt / 2
        y0 = gy + r * math.sin(t) - hh / 2
        for p in seg7(s, x0, y0, hh):
            b.poly(fr, p, 'mat:lcd-white', L + 0.0004)
    # いまの速度までの帯（白）
    b.poly(fr, arcband2(gx, gy, R * 1.03, R * 1.09, v2a(SPEED), 225, 40), 'mat:lcd-white', L)
    # ATC 許容速度の印（緑の三角）と、緑の丸で囲んだ数字
    t = math.radians(v2a(ATC))
    ca, sa = math.cos(t), math.sin(t)
    tip = (gx + R * 1.03 * ca, gy + R * 1.03 * sa)
    base = (gx + R * 1.22 * ca, gy + R * 1.22 * sa)
    nx, ny = -sa * R * 0.08, ca * R * 0.08
    b.poly(fr, [tip, (base[0] + nx, base[1] + ny), (base[0] - nx, base[1] - ny)], 'mat:lcd-green', L + 0.0006)
    # 針（オレンジ）
    t = math.radians(v2a(SPEED))
    ca, sa = math.cos(t), math.sin(t)
    hw = 0.0022
    b.poly(fr, [(gx - hw * sa, gy + hw * ca), (gx + R * 0.95 * ca - hw * 0.4 * sa, gy + R * 0.95 * sa + hw * 0.4 * ca),
                (gx + R * 0.95 * ca + hw * 0.4 * sa, gy + R * 0.95 * sa - hw * 0.4 * ca), (gx + hw * sa, gy - hw * ca)], 'mat:lcd-orange', L + 0.0008)
    b.poly(fr, circle2(gx, gy, R * 0.07, 16), 'mat:lcd-gray', L + 0.001)
    # 中央下に今の速度（白い数字）と km/h
    hh = R * 0.30
    for p in seg7(str(SPEED), gx - 3 * hh / 2 * 1.35 / 2, gy - R * 0.62, hh):
        b.poly(fr, p, 'mat:lcd-white', L + 0.0006)
    b.text(fr, 'km/h', gx, gy - R * 0.85, R * 0.14, 'mat:lcd-gray', L + 0.0006, 'center')
    # 右側: ATC 信号（緑の丸に 285）
    ax, ay = cx + w * 0.30, cy + h * 0.16
    rr = h * 0.17
    b.poly(fr, arcband2(ax, ay, rr * 0.86, rr, 0, 360, 32)[:-1], 'mat:lcd-green', L)
    hh = rr * 0.75
    for p in seg7(str(ATC), ax - 3 * hh / 2 * 1.35 / 2 + hh * 0.08, ay - hh / 2, hh):
        b.poly(fr, p, 'mat:lcd-green', L + 0.0004)
    b.text(fr, 'ATC', ax, ay + rr * 1.15, rr * 0.45, 'mat:lcd-white', L, 'center')
    # その下: 定速（緑）・ノッチ表示
    b.rect(fr, ax - rr, ax + rr, cy - h * 0.20, cy - h * 0.10, 'mat:lcd-yellow', L)
    b.text(fr, 'ブレーキ', ax, cy - h * 0.193, h * 0.07, '#0b1a33', L + 0.0005, 'center')
    b.text(fr, 'B3', ax, cy - h * 0.38, h * 0.12, 'mat:lcd-yellow', L, 'center')


def monitor(b, fr, a0, a1, b0, b1, kind):
    """車両の状態・運転情報のモニター（液晶）"""
    lcd_frame(b, fr, a0, a1, b0, b1)
    L = 0.006
    W = a1 - a0
    H = b1 - b0
    # 上の帯
    b.rect(fr, a0, a1, b1 - H * 0.12, b1, 'mat:lcd-blue', L)
    title = '車両状態' if kind == 'car' else '運転情報'
    b.text(fr, title, a0 + W * 0.03, b1 - H * 0.10, H * 0.08, 'mat:lcd-white', L + 0.0005)
    for p in seg7('14:23', a1 - W * 0.30, b1 - H * 0.105, H * 0.08):
        b.poly(fr, p, 'mat:lcd-white', L + 0.0005)
    # 下の操作ボタンの並び
    n = 6
    for k in range(n):
        x0 = a0 + W * (0.02 + k * 0.163)
        b.rect(fr, x0, x0 + W * 0.15, b0 + H * 0.02, b0 + H * 0.11, 'mat:lcd-gray', L)
    labels = ['戻る', '車両', '空調', 'ドア', '運転', 'メニュー'] if kind == 'car' else ['戻る', '時刻', '線路', '定速', '連絡', 'メニュー']
    for k, t in enumerate(labels):
        x0 = a0 + W * (0.02 + k * 0.163)
        b.text(fr, t, x0 + W * 0.075, b0 + H * 0.045, H * 0.045, '#0b1a33', L + 0.0005, 'center')
    if kind == 'car':
        # 編成（16 両）: 上段に号車の箱、下に機器の状態の升目
        for k in range(16):
            x0 = a0 + W * (0.03 + k * 0.059)
            x1 = x0 + W * 0.052
            yb = b0 + H * 0.66
            col = 'mat:lcd-green'
            b.rect(fr, x0, x1, yb, yb + H * 0.10, col, L)
            for r in range(4):
                c = 'mat:lcd-green' if (k * 7 + r * 3) % 23 else 'mat:lcd-yellow'
                if r == 3:
                    c = 'mat:lcd-gray'
                b.rect(fr, x0 + W * 0.008, x1 - W * 0.008, yb - H * (0.09 + r * 0.095), yb - H * (0.02 + r * 0.095), c, L)
        # 先頭（1 号車）を示す三角
        b.poly(fr, [(a0 + W * 0.005, b0 + H * 0.71), (a0 + W * 0.025, b0 + H * 0.74), (a0 + W * 0.025, b0 + H * 0.68)], 'mat:lcd-white', L)
        b.text(fr, '主変換装置', a0 + W * 0.03, b0 + H * 0.17, H * 0.05, 'mat:lcd-white', L)
        b.text(fr, 'ブレーキ', a0 + W * 0.40, b0 + H * 0.17, H * 0.05, 'mat:lcd-white', L)
        b.text(fr, '空調', a0 + W * 0.72, b0 + H * 0.17, H * 0.05, 'mat:lcd-white', L)
    else:
        # 路線図（駅と現在位置）
        yl = b0 + H * 0.62
        b.rect(fr, a0 + W * 0.05, a1 - W * 0.05, yl - 0.0012, yl + 0.0012, 'mat:lcd-white', L)
        names = ['浜松', '豊橋', '三河安城', '名古屋', '岐阜羽島']
        for k, nm in enumerate(names):
            x = a0 + W * (0.08 + k * 0.21)
            b.poly(fr, circle2(x, yl, H * 0.025, 12), 'mat:lcd-white', L + 0.0004)
            b.text(fr, nm, x, yl + H * 0.06, H * 0.05, 'mat:lcd-white', L, 'center')
        xp = a0 + W * 0.64
        b.poly(fr, [(xp, yl - H * 0.03), (xp - H * 0.03, yl - H * 0.09), (xp + H * 0.03, yl - H * 0.09)], 'mat:lcd-yellow', L + 0.0006)
        b.text(fr, '次 名古屋 停車', a0 + W * 0.05, b0 + H * 0.36, H * 0.065, 'mat:lcd-yellow', L)
        b.text(fr, '名古屋 着 14:25', a0 + W * 0.05, b0 + H * 0.24, H * 0.065, 'mat:lcd-white', L)
        for p in seg7('362.4', a1 - W * 0.36, b0 + H * 0.24, H * 0.075):
            b.poly(fr, p, 'mat:lcd-green', L)
        b.text(fr, 'km', a1 - W * 0.06, b0 + H * 0.24, H * 0.05, 'mat:lcd-gray', L, 'right')


def buttons_row(b, fr, a0, a1, b0, n, size, colors, lift=0.004):
    gap = (a1 - a0 - n * size) / max(1, n - 1)
    for k in range(n):
        x = a0 + k * (size + gap)
        c = colors[k % len(colors)]
        b.obox(fr, x, x + size, b0, b0 + size, lift, lift + 0.006, '#30343a', top=c)


def rd(x, y, z):
    """机の上で運転士から読める向きの Frame（a: 運転士の右 = -z、b: 前 = -x、n = +y）"""
    return Frame((x, y, z), (0, 0, -1), (-1, 0, 0))


def handle_base(b, hx0, hx1, zc):
    """ハンドルの台（銀の板と溝）"""
    b.box(hx0, hx1, DESK_TOP, DESK_TOP + 0.05, zc - 0.085, zc + 0.085, '#34383d', top=C_PLATE)
    b.box(hx0 + 0.03, hx1 - 0.03, DESK_TOP + 0.05, DESK_TOP + 0.052, zc - 0.012, zc + 0.012, '#0e0f10')


def handle_scale(b, x_near, x_far, zc, side, labels, red_last=False):
    """溝の横の段の目盛と文字。side=1 は運転士の右側（-z）に並べる"""
    n = len(labels)
    for k, lab in enumerate(labels):
        x = x_near + (x_far - x_near) * k / (n - 1)
        c = 'mat:lcd-red' if (red_last and k == n - 1) else C_TICK
        fr = rd(x, DESK_TOP + 0.0505, zc)
        a0 = 0.02 * side
        a1 = (0.032 if lab else 0.027) * side
        b.rect(fr, min(a0, a1), max(a0, a1), -0.0013, 0.0013, c, 0.0005)
        if lab:
            b.text(fr, lab, 0.056 * side, -0.006, 0.015, c, 0.0005, 'center')


def build(b):
    L = '運転室'
    # ------------------------------------------------------------------
    # 運転台（机）: 運転士を囲む馬蹄形
    # ------------------------------------------------------------------
    b.begin('運転台・机（馬蹄形）', L)
    top_fr = Frame((0, 0, 0), (1, 0, 0), (0, 0, -1))  # n=+y, p(a,b,c)=(a,c,-b)
    R = 0.47
    inner = [(DRIVER_X - R * math.cos(math.radians(t)), R * math.sin(math.radians(t))) for t in range(70, -71, -10)]
    # xz の点 → (a,b)=(x,-z)
    ab = lambda pts: [(x, -z) for (x, z) in pts]
    outline = [(-7.85, 1.12), (-6.16, 1.12), (-6.16, 0.442)] + inner + [(-6.16, -0.442), (-6.16, -1.12), (-7.85, -1.12)]
    b.prism(top_fr, ab(outline), DESK_TOP - 0.04, DESK_TOP, C_DESK_TOP, side='#3d4349', bottom=C_DESK_LOW)
    # 縁の銀色の見切り（運転士側）
    b.tube([(x, DESK_TOP - 0.005, z) for (x, z) in [(-6.16, 0.45)] + inner + [(-6.16, -0.45)]], 0.006, '#9aa1a7', 6)
    # 袖（ハンドルの下の脚）
    for s in (1, -1):
        wing = [(-7.30, 0.44 * s), (-6.62, 0.44 * s), (-6.18, 0.46 * s), (-6.18, 1.10 * s), (-7.30, 1.10 * s)]
        b.prism(top_fr, ab(wing), FLOOR, DESK_TOP - 0.04, C_DESK_SIDE)
        # 足元の黒い幅木
        b.box(-6.20, -6.17, FLOOR, FLOOR + 0.08, min(0.47 * s, 1.09 * s), max(0.47 * s, 1.09 * s), '#25282b')
    # ひざ前の板と足置き
    b.box(-7.32, -7.28, FLOOR, DESK_TOP - 0.04, -0.44, 0.44, C_DESK_LOW)
    foot = Frame((-7.28, FLOOR + 0.20, 0), (0, 0, 1), (1, -0.55, 0))
    b.obox(foot, -0.40, 0.40, 0.0, 0.34, -0.015, 0.0, '#3b4045', top='#2a2d30')
    # 警笛ペダル（2 つ）
    for zc in (-0.16, 0.16):
        b.obox(foot.shifted(0, 0.10, 0), zc - 0.055, zc + 0.055, 0.0, 0.13, 0.0, 0.025, '#1f2124', top='#6d7378')
    # 床のマット
    b.box(-7.30, -5.70, FLOOR, FLOOR + 0.008, -0.44, 0.44, '#3a3e42')

    # ------------------------------------------------------------------
    # 計器盤（3 面）と庇・ダッシュボード
    # ------------------------------------------------------------------
    b.begin('運転台・計器盤（3 面）', L)
    tilt = 24
    hgt = (2.42 - DESK_TOP) / math.cos(math.radians(tilt))
    # 正面
    xc = -7.30
    facets = []
    fr_c = Frame((xc, DESK_TOP, 0.0), (0, 0, 1), (0, 1, 0)).tilted(-tilt)  # n は運転士側（+x）へ
    # Frame((x,y,z),(0,0,1),(0,1,0)): n = u×v = (0,0,1)×(0,1,0) = (-1,0,0) → 鼻先向き。運転士側にするため u を -z に
    fr_c = Frame((xc, DESK_TOP, 0.0), (0, 0, -1), (0, 1, 0))
    fr_c = fr_c.tilted(-tilt)
    facets.append((fr_c, -0.40, 0.40))
    for s in (1, -1):
        # 端は運転士の方へ回り込む（30 度）
        p0 = (xc, DESK_TOP, 0.40 * s)
        ang = math.radians(32)
        p1 = (xc + 0.58 * math.sin(ang), DESK_TOP, s * (0.40 + 0.58 * math.cos(ang)))
        mid = ((p0[0] + p1[0]) / 2, DESK_TOP, (p0[2] + p1[2]) / 2)
        u = norm(sub(p1, p0)) if s < 0 else norm(sub(p0, p1))
        fr = Frame(mid, u, (0, 1, 0))
        if fr.n[0] < 0:
            fr = Frame(mid, mul(u, -1), (0, 1, 0))
        fr = fr.tilted(-tilt)
        facets.append((fr, -0.29, 0.29))
    for fr, a0, a1 in facets:
        b.obox(fr, a0, a1, 0.0, hgt, -0.07, 0.0, C_PANEL, side='#33373c')
    # 庇（ひさし）: 上辺を運転士側へ張り出す
    for fr, a0, a1 in facets:
        b.obox(fr, a0 - 0.005, a1 + 0.005, hgt - 0.008, hgt + 0.012, -0.07, 0.10, '#1e2124')
    # ダッシュボード（計器盤の上から前面窓の下まで）
    # 前の縁は 3 面の計器盤の上端の裏に沿わせる（計器盤が隠れないように）
    edge = []
    for fr, a0, a1 in facets:
        for a in (a0, a1):
            p = fr.p(a, hgt, -0.07)
            edge.append((p[0], p[2]))
    edge.sort(key=lambda q: -q[1])
    dash = edge + [(-8.55, -0.70), (-8.55, 0.70)]
    b.prism(top_fr, ab(dash), DESK_TOP + 0.3, 2.43, C_DASH, side='#2f3337')
    # 窓の下の見切り（斜め）
    sl = Frame((-8.55, 2.43, 0), (0, 0, -1), (-1, 0.75, 0))
    b.obox(sl, -0.66, 0.66, 0.0, 0.10, 0.0, 0.01, '#202326')
    # 正面の画面: 速度計（中央）、時計・表示灯（左右の小窓）
    fr_c, _, _ = facets[0]
    speedometer(b, fr_c, 0.0, 0.285, 0.54, 0.33)
    # 上の一列: 表示灯（ATC・戸閉・定速・非常・故障・EB）
    lamps = [('ATC', 'mat:lcd-green'), ('戸閉', 'mat:lcd-yellow'), ('定速', '#1d3a22'), ('非常', '#4a1a18'),
             ('故障', '#4a3a12'), ('EB', '#4a3a12'), ('ATS', '#1d3a22'), ('保安', '#1d3a22')]
    for k, (t, c) in enumerate(lamps):
        a = -0.36 + k * 0.091
        bb = 0.485
        b.rect(fr_c, a, a + 0.082, bb, bb + 0.045, '#101215', 0.002)
        b.rect(fr_c, a + 0.004, a + 0.078, bb + 0.004, bb + 0.041, c, 0.004)
        b.text(fr_c, t, a + 0.041, bb + 0.014, 0.018, '#111' if c.startswith('mat:') else '#c9b9a0', 0.0045, 'center')
    # 下のボタン列（正面）
    buttons_row(b, fr_c, -0.36, 0.36, 0.05, 14, 0.026, ['#d9d6cf', '#d9d6cf', '#3fae5c', '#d9d6cf', '#e0b030', '#d9d6cf', '#c23b30'])
    # 左右のモニター
    for k, (fr, a0, a1) in enumerate(facets[1:]):
        # facets[1] は z+（右）、facets[2] は z-（左）
        kind = 'car' if k == 0 else 'run'  # 左（+z）に車両状態、右に運転情報
        monitor(b, fr, -0.21, 0.21, 0.14, 0.47, kind)
        buttons_row(b, fr, -0.24, 0.24, 0.045, 9, 0.024, ['#d9d6cf', '#3a3f45', '#d9d6cf'])

    # ------------------------------------------------------------------
    # マスコン（右手・13 ノッチ）と逆転ハンドル  ※運転士から見て右は -z
    # ------------------------------------------------------------------
    hx0, hx1 = -6.96, -6.44
    b.begin('マスコン（右手・切〜13 ノッチ）', L)
    zc = -0.66
    handle_base(b, hx0, hx1, zc)
    labels = ['切'] + [str(k) if k in (1, 4, 7, 10, 13) else '' for k in range(1, 14)]
    handle_scale(b, hx1 - 0.04, hx0 + 0.04, zc, 1, labels)
    # レバー: 「切」の位置（手前）に立てた軸と横向きの握り（T 字）
    pivot = (hx1 - 0.05, DESK_TOP + 0.03, zc)
    tip = (hx1 - 0.01, DESK_TOP + 0.20, zc)
    b.tube([pivot, tip], 0.011, '#2b2d30', 10)
    b.box(pivot[0] - 0.03, pivot[0] + 0.03, DESK_TOP + 0.05, DESK_TOP + 0.065, zc - 0.03, zc + 0.03, '#1b1c1e')
    gfr = Frame(tip, (0, 1, 0), (1, 0, 0))  # n = z 方向
    b.cyl(gfr, 0.016, -0.055, 0.055, C_GRIP, 16)
    b.cyl(gfr, 0.018, -0.058, -0.053, '#4c5157', 16)
    b.cyl(gfr, 0.018, 0.053, 0.058, '#4c5157', 16)
    # 定速のボタン（緑）・解除・抑速
    for k, (c, t) in enumerate([('#3fae5c', '定速'), ('#d9d6cf', '解除'), ('#e0b030', '抑速')]):
        x = -6.90 + k * 0.10
        cf = Frame((x, DESK_TOP + 0.001, -0.94), (1, 0, 0), (0, 0, -1))
        b.cyl(cf, 0.022, 0.0, 0.018, '#2a2d31', 16, cap_color=c)
        b.text(rd(x - 0.04, DESK_TOP + 0.0015, -0.94), t, 0.0, -0.008, 0.016, '#e6e6e6', 0.0, 'center')
    b.begin('逆転ハンドル（前・切・後）', L)
    zr = -0.86
    b.box(-6.72, -6.48, DESK_TOP, DESK_TOP + 0.035, zr - 0.05, zr + 0.05, '#34383d', top=C_PLATE)
    for k, t in enumerate(['後', '切', '前']):
        b.text(rd(-6.52 - k * 0.08, DESK_TOP + 0.0355, zr), t, 0.022, -0.008, 0.016, '#f1f1f1', 0.0, 'center')
    b.box(-6.62, -6.58, DESK_TOP + 0.035, DESK_TOP + 0.05, zr - 0.012, zr + 0.012, '#121314')
    b.tube([(-6.60, DESK_TOP + 0.04, zr), (-6.64, DESK_TOP + 0.10, zr)], 0.008, '#1c1d1f', 8)
    b.cyl(Frame((-6.64, DESK_TOP + 0.10, zr), (1, 0, 0), (0, 1, 0)), 0.014, -0.012, 0.012, C_GRIP, 12)

    # ------------------------------------------------------------------
    # ブレーキハンドル（左手・+z）
    # ------------------------------------------------------------------
    b.begin('ブレーキハンドル（左手・運転〜7 段〜非常）', L)
    zc = 0.66
    handle_base(b, hx0, hx1, zc)
    labels = ['運転', '1', '', '', '4', '', '', '7', '非常']
    handle_scale(b, hx1 - 0.04, hx0 + 0.04, zc, -1, labels, True)
    # ブレーキは 3 段（B3）に入れた位置
    xn = (hx1 - 0.04) + ((hx0 + 0.04) - (hx1 - 0.04)) * 3 / 8
    pivot = (xn, DESK_TOP + 0.03, zc)
    tip = (xn + 0.01, DESK_TOP + 0.17, zc)
    b.tube([pivot, tip], 0.012, '#8e959b', 10)
    b.box(pivot[0] - 0.03, pivot[0] + 0.03, DESK_TOP + 0.05, DESK_TOP + 0.065, zc - 0.03, zc + 0.03, '#1b1c1e')
    kfr = Frame(tip, (1, 0, 0), (0, 0, -1))  # n = +y
    b.lathe(kfr, [(0.0, 0.0), (0.020, 0.0), (0.026, 0.02), (0.027, 0.055), (0.022, 0.075), (0.012, 0.085), (0.0, 0.087)], C_GRIP, 16)
    # EB リセット（黄）・非常ブレーキ（赤いきのこ形）
    cf = Frame((-6.88, DESK_TOP, 0.92), (1, 0, 0), (0, 0, -1))
    b.cyl(cf, 0.024, 0.0, 0.015, '#2a2d31', 16, cap_color='#e0b030')
    b.text(rd(-6.92, DESK_TOP + 0.0005, 0.92), 'EB', 0, -0.008, 0.016, '#e6e6e6', 0.0, 'center')
    cf = Frame((-6.74, DESK_TOP, 0.95), (1, 0, 0), (0, 0, -1))
    b.cyl(cf, 0.020, 0.0, 0.03, '#2a2d31', 12)
    b.lathe(cf.shifted(0, 0, 0.03), [(0.0, 0.0), (0.035, 0.0), (0.036, 0.012), (0.028, 0.022), (0.0, 0.026)], '#c0281f', 16)
    # 列車無線の送受話器（左の袖の奥）
    b.begin('列車無線・送受話器', L)
    b.box(-7.22, -7.02, DESK_TOP, DESK_TOP + 0.04, 0.90, 1.04, '#26292c')
    b.box(-7.20, -7.04, DESK_TOP + 0.04, DESK_TOP + 0.075, 0.92, 1.02, C_BLACK)
    # 行路表（時刻表）を挟む板（左の袖）
    b.begin('行路表ホルダー', L)
    hf = Frame((-7.55, DESK_TOP + 0.02, 0.86), (0, 0, -1), (-0.6, 1, 0))
    b.obox(hf, -0.10, 0.10, 0.0, 0.24, -0.012, 0.0, '#3a3f44')
    b.rect(hf, -0.09, 0.09, 0.012, 0.225, '#f3f1ea', 0.001)
    for k in range(9):
        b.rect(hf, -0.08, 0.08, 0.03 + k * 0.021, 0.0315 + k * 0.021, '#7b7f84', 0.0015)
    b.rect(hf, -0.03, 0.03, 0.218, 0.236, '#9aa1a7', 0.002)

    # ------------------------------------------------------------------
    # 左右の壁ぎわの機器箱（スイッチ盤）
    # ------------------------------------------------------------------
    b.begin('運転室・左右の機器箱とスイッチ盤', L)
    for s in (1, -1):
        z0, z1 = sorted((1.14 * s, 1.44 * s))
        b.box(-7.35, -5.62, FLOOR, 1.72, z0, z1, '#c9cdd0', top='#9aa0a5')
        # 上面のスイッチ盤（黒い板と白いスイッチ）
        pf = Frame((-6.48, 1.7205, (z0 + z1) / 2), (1, 0, 0), (0, 0, -1))
        b.rect(pf, -0.80, 0.80, -0.12, 0.12, '#2a2e32', 0.0)
        for r in range(3):
            for k in range(14):
                x = -0.74 + k * 0.11
                y = -0.08 + r * 0.075
                b.obox(pf, x, x + 0.03, y, y + 0.03, 0.0, 0.012, '#1a1c1e', top='#e8e6df' if (k + r) % 5 else '#d8a62a')
                b.rect(pf, x - 0.005, x + 0.035, y + 0.036, y + 0.044, '#e9e9e9', 0.0006)
        # 正面の点検扉の線と取っ手
        side = 1.14 * s - 0.001 * s
        df = Frame((-6.48, 1.38, side), (1, 0, 0) if s < 0 else (-1, 0, 0), (0, 1, 0))
        for a0, a1 in ((-0.80, -0.02), (0.02, 0.80)):
            b.rect(df, a0, a1, -0.30, 0.28, '#bfc4c7', 0.001)
            b.rect(df, a1 - 0.10, a1 - 0.04, 0.10, 0.12, '#6e7479', 0.002)
    # 右の機器箱の上: 車内電話（白い受話器）
    b.begin('車内電話（車掌との連絡）', L)
    b.box(-5.95, -5.72, 1.72, 1.78, -1.40, -1.18, '#e9e8e3')
    b.box(-5.93, -5.74, 1.78, 1.81, -1.27, -1.21, '#f4f3ef')

    # ------------------------------------------------------------------
    # 運転士の椅子
    # ------------------------------------------------------------------
    b.begin('運転士椅子（中央）', L)
    base = Frame((DRIVER_X, FLOOR, 0), (1, 0, 0), (0, 0, -1))
    b.cyl(base, 0.25, 0.0, 0.02, '#2c2f33', 24)
    b.cyl(base, 0.055, 0.02, 0.36, '#7e858b', 16)
    b.cyl(base, 0.075, 0.30, 0.40, '#2c2f33', 16)
    b.prism(base, rrect2(-0.22, 0.20, -0.22, 0.22, 0.04), 0.40, 0.44, '#2c2f33')
    # 座面
    b.prism(base, rrect2(-0.26, 0.24, -0.25, 0.25, 0.07, 5), 0.44, 0.53, C_SEAT, side=C_SEAT_DARK)
    # 背もたれ（後ろへ 14 度）
    bk = Frame((DRIVER_X + 0.23, FLOOR + 0.50, 0), (0, 0, -1), (0, 1, 0)).tilted(14)  # n=+x（後ろ）へ傾ける
    b.prism(bk, rrect2(-0.25, 0.25, 0.0, 0.66, 0.08, 5), -0.11, 0.0, C_SEAT, side=C_SEAT_DARK)
    b.prism(bk, rrect2(-0.17, 0.17, 0.70, 0.88, 0.06, 4), -0.10, -0.01, C_SEAT, side=C_SEAT_DARK)
    for s in (1, -1):
        b.tube([bk.p(0.12 * s, 0.64, -0.055), bk.p(0.12 * s, 0.72, -0.055)], 0.008, '#8e959b', 6)
    # ひじ掛け
    for s in (1, -1):
        b.box(DRIVER_X - 0.20, DRIVER_X + 0.16, FLOOR + 0.70, FLOOR + 0.74, 0.27 * s - 0.035, 0.27 * s + 0.035, '#25292d')
        b.box(DRIVER_X + 0.10, DRIVER_X + 0.15, FLOOR + 0.50, FLOOR + 0.70, 0.27 * s - 0.015, 0.27 * s + 0.015, '#3a3e42')

    # ------------------------------------------------------------------
    # 天井・日よけ・後ろの壁まわり
    # ------------------------------------------------------------------
    b.begin('運転室・天井と照明', L)
    b.box(-6.42, -4.95, 3.10, 3.13, -0.72, 0.72, C_WALL, bottom='#e2e4e5')
    b.box(-5.95, -5.25, 3.085, 3.10, -0.10, 0.10, 'mat:light')
    # 前面窓の後ろ寄り（運転士の頭の上）: 平らな板ではなく、ガラスの曲面のすぐ内側に沿った内張り
    b.begin('運転室・前面窓の上の天井（ガラスに沿った内張り）', L)
    m = b.m
    V = {v[0]: v for v in m['vertices']}
    X_FROM = -7.30
    # ガラスの三角形（上から見た xz で、その点の高さを測る）
    tris = []
    for f in m['faces']:
        if V[f['loop'][0]][4] != 900007:
            continue
        p = [V[i] for i in f['loop']]
        for k in range(1, len(p) - 1):
            tris.append((p[0], p[k], p[k + 1]))

    def glass_y(x, z):
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

    nx, nz = 14, 36
    x_to = max(v[1] for v in m['vertices'] if v[4] == 900007) - 0.01
    grid = []
    for i in range(nx + 1):
        x = X_FROM + (x_to - X_FROM) * i / nx
        row = []
        for j in range(nz + 1):
            z = -0.95 + 1.9 * j / nz
            y = glass_y(x, z)
            row.append(None if y is None else (x, y - 0.035, z))
        # ガラスの面がない真ん中（四角い空き）は、左右の高さから補う
        idx = [j for j, p_ in enumerate(row) if p_ is not None]
        if len(idx) >= 2:
            for j in range(idx[0], idx[-1] + 1):
                if row[j] is None:
                    jl = max(k for k in idx if k < j)
                    jr = min(k for k in idx if k > j)
                    t = (j - jl) / (jr - jl)
                    yl, yr = row[jl][1], row[jr][1]
                    z = -0.95 + 1.9 * j / nz
                    # 真ん中は少し高く（屋根の丸み）
                    row[j] = (x, yl + (yr - yl) * t + 0.04 * math.sin(math.pi * t), z)
        grid.append(row)
    for i in range(nx):
        for j in range(nz):
            q = [grid[i][j], grid[i + 1][j], grid[i + 1][j + 1], grid[i][j + 1]]
            if any(p_ is None for p_ in q):
                continue
            b.face(q, LINING, True)
    # 内張りの前の縁の見切りと、日よけの巻取り箱（縁のすぐ後ろ）
    zs = [abs(v[3]) for v in m['vertices'] if v[4] == 900007 and abs(v[1] - X_FROM) < 0.03 and v[2] > 2.85]
    wf = (max(zs) * 0.98) if zs else 0.8
    ys = [v[2] for v in m['vertices'] if v[4] == 900007 and abs(v[1] - X_FROM) < 0.03]
    yf = (min(max(ys), 3.2) - 0.04) if ys else 3.0
    b.box(X_FROM - 0.015, X_FROM + 0.015, yf - 0.04, yf + 0.005, -wf * 0.9, wf * 0.9, '#24272a')
    b.begin('前面窓の日よけ（巻取り）', L)
    b.box(X_FROM + 0.02, X_FROM + 0.09, yf - 0.09, yf - 0.035, -0.62, 0.62, '#2b2f33')
    b.box(X_FROM + 0.03, X_FROM + 0.08, yf - 0.105, yf - 0.09, -0.10, 0.10, '#1b1d1f')  # 引き手
    b.begin('運転室・乗務員扉の手すりと消火器', L)
    for s in (1, -1):
        for x in (-5.60, -4.98):
            b.tube([(x, 1.55, 1.40 * s), (x, 2.45, 1.40 * s)], 0.016, C_SILVER, 10)
    ef = Frame((-5.05, FLOOR + 0.02, -1.05), (1, 0, 0), (0, 0, -1))
    b.cyl(ef, 0.07, 0.0, 0.46, '#c4231c', 16, cap_color='#b01f19')
    b.lathe(ef.shifted(0, 0, 0.46), [(0.0, 0.0), (0.07, 0.0), (0.05, 0.04), (0.02, 0.06), (0.0, 0.06)], '#c4231c', 16)
    b.box(-5.08, -5.02, FLOOR + 0.52, FLOOR + 0.58, -1.08, -1.02, '#1c1d1f')
    b.rect(Frame((-5.05 + 0.0705, FLOOR + 0.25, -1.05), (0, 0, -1), (0, 1, 0)), -0.04, 0.04, -0.05, 0.05, '#f3f1ea', 0.0)

    # ------------------------------------------------------------------
    # 前のデッキから見た乗務員室扉（運転室の後ろの壁）
    # ------------------------------------------------------------------
    b.begin('乗務員室扉（デッキ側）', L)
    xw = -4.87 + 0.001
    fr = Frame((xw, 0, 0), (0, 0, -1), (0, 1, 0))  # n = +x（デッキ側）
    if fr.n[0] < 0:
        fr = Frame((xw, 0, 0), (0, 0, 1), (0, 1, 0))
    aa = lambda z: -z if fr.u[2] < 0 else z
    lo, hi = sorted((aa(-0.52), aa(0.12)))
    b.poly(fr, rect2(lo - 0.02, hi + 0.02, FLOOR, 2.93), '#8f9293', 0.003, holes2=[rect2(lo, hi, FLOOR + 0.01, 2.91)])
    b.rect(fr, lo, hi, FLOOR + 0.01, 2.91, '#c4c3bd', 0.003)
    b.rect(fr, lo + 0.18, hi - 0.18, 2.05, 2.55, '#b5b4ae', 0.004)
    hx = hi - 0.07
    b.obox(fr, hx - 0.015, hx + 0.015, 1.88, 2.06, 0.003, 0.03, 'mat:stainless')
    b.rect(fr, hx - 0.01, hx + 0.01, 2.10, 2.13, '#2b2f33', 0.004)
    b.obox(fr, (lo + hi) / 2 - 0.13, (lo + hi) / 2 + 0.13, 2.62, 2.72, 0.0005, 0.004, '#20262e', top='#2d3a4a')
    b.text(fr, '乗務員室', (lo + hi) / 2, 2.645, 0.045, '#f4f4f0', 0.005, 'center')
    b.text(fr, '関係者以外立入禁止', (lo + hi) / 2, 2.40, 0.025, '#b51f1a', 0.0045, 'center')
