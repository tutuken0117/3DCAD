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

# 作り直すために消す、もとのモデルのグループ
OLD_CAB = [
    900207,  # 運転士椅子
    900305,  # 運転台・湾曲計器盤
    900306,  # 運転室・側壁と机側面
    900319,  # 運転台・主表示器と監視画面
]


def main(src, dst, parts):
    data = load(src)
    b = Builder(data)
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
    data['name'] = 'N700S 1号車 R19'
    save(data, dst)
    m = data['model']
    print('vertices', len(m['vertices']), 'edges', len(m['edges']), 'faces', len(m['faces']), 'groups', len(m['groups']))


if __name__ == '__main__':
    parts = set((sys.argv[3] if len(sys.argv) > 3 else 'cab,lav').split(','))
    main(sys.argv[1], sys.argv[2], parts)
