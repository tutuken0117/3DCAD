"""
客室と後ろの妻面の手直し。
- 窓の日よけ（ロールカーテン）: すべての窓の上に巻取り箱を付け、いくつかは途中まで下ろす
- 床: 座席の下の床と通路のカーペットを落ち着いた青みの灰色に
- 後ろの妻面: 黒い四角だった貫通路を、ひだのある幌（ほろ）と幌枠に
"""
import math
from lib import Frame, rrect2

L = '客室・座席'
LX = 'Underfloor equipment'

OLD = [900104]  # Rear gangway diaphragm（黒い四角）

# 窓内枠のグループ（1〜13 番）
FRAMES = [900114 + 7 * k for k in range(13)]
# 下ろしておく窓（番号: 下ろした割合）。山側（+z）・海側（-z）
LOWERED = {(2, 1): 0.45, (5, 1): 1.0, (6, 1): 0.3, (9, -1): 0.6, (10, -1): 1.0, (12, 1): 0.5, (3, -1): 0.25}

C_BLIND = '#d9d3c4'      # 日よけ（明るいベージュ）
C_BLIND_EDGE = '#a9a294'
C_CASE = '#c9ccce'


def recolor(b):
    """床とカーペットの色"""
    m = b.m
    vg = {v[0]: v[4] for v in m['vertices']}
    for f in m['faces']:
        g = vg.get(f['loop'][0])
        if g == 900105:
            f['color'] = '#666b72'
        elif g == 900107:
            f['color'] = '#4f5866'


def blinds(b):
    m = b.m
    box = {}
    for v in m['vertices']:
        if v[4] in FRAMES:
            bb = box.setdefault(v[4], [9, -9, 9, -9, 9])
            bb[0] = min(bb[0], v[1]); bb[1] = max(bb[1], v[1])
            bb[2] = min(bb[2], v[2]); bb[3] = max(bb[3], v[2])
            if v[3] > 0:
                bb[4] = min(bb[4], v[3])
    for k, gid in enumerate(FRAMES):
        x0, x1, y0, y1, zin = box[gid]
        n = k + 1
        for s in (1, -1):
            b.begin(f'窓の日よけ {n}（{"山側" if s > 0 else "海側"}）', L)
            z = (zin - 0.004) * s
            xa, xb = x0 + 0.045, x1 - 0.045
            top = y1 - 0.05
            # 巻取り箱
            b.box(xa - 0.01, xb + 0.01, top - 0.035, top + 0.005, min(z, z - 0.045 * s), max(z, z - 0.045 * s), C_CASE)
            frac = LOWERED.get((n, s), 0.0)
            if frac > 0:
                h = (top - 0.035 - (y0 + 0.06)) * frac
                yb = top - 0.035 - h
                zz = z - 0.02 * s
                b.box(xa, xb, yb, top - 0.035, min(zz, zz - 0.004 * s), max(zz, zz - 0.004 * s), C_BLIND)
                # 下の握り（引き手）
                b.box(xa, xb, yb - 0.018, yb, min(zz + 0.004 * s, zz - 0.012 * s), max(zz + 0.004 * s, zz - 0.012 * s), C_BLIND_EDGE)
                b.box((xa + xb) / 2 - 0.04, (xa + xb) / 2 + 0.04, yb - 0.03, yb - 0.018, min(zz, zz - 0.012 * s), max(zz, zz - 0.012 * s), C_BLIND_EDGE)


def gangway(b):
    """後ろの妻面の幌（ひだ）と幌枠"""
    b.begin('後部・貫通幌（ひだ）と幌枠', LX)
    x0 = 13.675
    fr = Frame((x0, 0, 0), (0, 0, 1), (0, 1, 0))  # n = +x（車外）
    if fr.n[0] < 0:
        fr = Frame((x0, 0, 0), (0, 0, -1), (0, 1, 0))
    yc = 2.03
    # 幌枠（車体側・銀灰）
    outer = rrect2(-0.74, 0.74, yc - 1.04, yc + 1.04, 0.16, 5)
    inner = rrect2(-0.62, 0.62, yc - 0.96, yc + 0.96, 0.12, 5)
    b.poly(fr, outer, '#8d9398', 0.004, holes2=[inner])
    # ひだ（外へ少しずつ張り出す黒いゴム）
    folds = 6
    for k in range(folds):
        c0 = 0.004 + k * 0.022
        c1 = c0 + 0.022
        w_out = 0.62 - (0.012 if k % 2 else 0.0)
        w_in = 0.50
        o = rrect2(-w_out, w_out, yc - 0.96 + (0.012 if k % 2 else 0), yc + 0.96 - (0.012 if k % 2 else 0), 0.12, 5)
        b.prism(fr, o, c0, c1, '#25282b' if k % 2 else '#1b1d1f', top='none', bottom='none', soft_sides=True)
    # 先端の幌枠（受け）と中の通路（暗い）
    c = 0.004 + folds * 0.022
    o = rrect2(-0.62, 0.62, yc - 0.96, yc + 0.96, 0.12, 5)
    i = rrect2(-0.46, 0.46, yc - 0.90, yc + 0.86, 0.08, 4)
    b.poly(fr, o, '#3a3e42', c, holes2=[i])
    b.poly(fr, i, '#15171a', c - 0.06)
    # 床の渡り板
    b.box(x0 + 0.005, x0 + c, yc - 0.90, yc - 0.88, -0.44, 0.44, '#6e7378')


def build(b):
    recolor(b)
    blinds(b)
    gangway(b)
