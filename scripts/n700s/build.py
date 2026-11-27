"""
N700S 1 号車の見本モデルの車内（運転室・デッキ・化粧室・洗面所）を作り直す。

  python3 scripts/n700s/build.py <もとの .3dcadz> <書き出す .3dcadz>

もとのモデル（R18）の古い運転台・化粧室などのグループを消し、このフォルダの各ファイルで作り直す。
"""
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lib import Builder, load, save  # noqa: E402
import cab  # noqa: E402
import saloon  # noqa: E402
import track  # noqa: E402
import shell  # noqa: E402
import bogie  # noqa: E402

# 作り直すために消す、もとのモデルのグループ
OLD_CAB = [
    900207,  # 運転士椅子
    900305,  # 運転台・湾曲計器盤
    900306,  # 運転室・側壁と机側面
    900319,  # 運転台・主表示器と監視画面
]


# 外板を作り直すときに消す、もとの外装のグループ（帯の直線部分・窓ガラス・エンブレム・屋根のひれは残す）
OLD_EXTERIOR = (
    [900001] + list(range(900004, 900020)) + list(range(900021, 900025)) + list(range(900039, 900043))
    + list(range(900044, 900052)) + list(range(900054, 900103)) + [900228, 900316, 900317, 900318]
)
WINDOW_GROUPS = [900020, 900025] + list(range(900026, 900039)) + [900043]


def window_holes(m):
    """窓ガラスの輪郭（+z 側・x, y）を、側面の平面に空ける穴に使う"""
    V = {v[0]: v for v in m['vertices']}
    holes = []
    for gid in WINDOW_GROUPS:
        best = None
        for f in m['faces']:
            if V[f['loop'][0]][4] != gid:
                continue
            zs = [V[i][3] for i in f['loop']]
            if min(zs) <= 0:
                continue
            if best is None or len(f['loop']) > len(best['loop']) or (len(f['loop']) == len(best['loop']) and sum(zs) > sum(V[i][3] for i in best['loop'])):
                best = f
        if best:
            pts = [(V[i][1], V[i][2]) for i in best['loop']]
            # 重なった点を除く
            out = []
            for p in pts:
                if not out or abs(p[0] - out[-1][0]) + abs(p[1] - out[-1][1]) > 1e-4:
                    out.append(p)
            holes.append(out)
    return holes


def main(src, dst, parts):
    data = load(src)
    b = Builder(data)
    if 'shell' in parts:
        holes = window_holes(b.m)
        b.remove_groups(OLD_EXTERIOR)
        shell.build_shell(b, holes)
        shell.windshield_frame(b)
        shell.headlights(b)
        shell.blue_lines(b)
        shell.seams_and_marks(b)
        shell.deflector(b)
        bogie.build(b)
    if 'cab' in parts:
        b.remove_groups(OLD_CAB)
        cab.build(b)
    try:
        import lav  # noqa: E402
        if 'lav' in parts:
            b.remove_groups(lav.OLD)
            lav.build(b)
    except ImportError:
        pass
    if 'saloon' in parts:
        b.remove_groups(saloon.OLD)
        saloon.build(b)
    if 'track' in parts:
        track.build(b)
    data['name'] = 'N700S 1号車 R24'
    save(data, dst)
    m = data['model']
    print('vertices', len(m['vertices']), 'edges', len(m['edges']), 'faces', len(m['faces']), 'groups', len(m['groups']))


if __name__ == '__main__':
    parts = set((sys.argv[3] if len(sys.argv) > 3 else 'shell,cab,lav,saloon,track').split(','))
    main(sys.argv[1], sys.argv[2], parts)
