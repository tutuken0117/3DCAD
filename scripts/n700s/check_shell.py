"""室内などの部品が、新しい外板の内側に収まっているかを調べる（外板の式を使う）
  python3 check_shell.py <モデル>"""
import sys, os, collections
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lib import load
import shell
d = load(sys.argv[1]); m = d['model']
names = {g['id']: g['name'] for g in m['groups']}
skip_layers = {'線路', 'Bogie', 'N700S body', 'Underfloor equipment'}
gl = {}
for f in m['faces']:
    gl.setdefault(None, None)
vlayer = {}
V = {v[0]: v for v in m['vertices']}
for f in m['faces']:
    for i in f['loop']:
        vlayer[i] = f['layer']
bad = collections.Counter(); worst = {}
for v in m['vertices']:
    if vlayer.get(v[0]) in skip_layers or v[4] in (900002, 900003, 900052, 900053, 900103) or 900020 <= v[4] <= 900043:
        continue
    x, y, z = v[1], v[2], abs(v[3])
    dd = x - shell.X_TIP
    if dd < 0 or x > shell.X_END + 0.01:
        over = 1.0
    else:
        zs = shell.surf_z(dd, y)
        ys = shell.surf_y(dd, z)
        over = max((z - zs) if zs is not None else 0.0, y - ys)
        if zs is None and y > ys:
            over = y - ys
    if over > 0.003:
        bad[v[4]] += 1
        if over > worst.get(v[4], (0,))[0]:
            worst[v[4]] = (round(over, 3), (round(x, 3), round(y, 3), round(v[3], 3)))
for g, n in bad.most_common(40):
    print(names.get(g), n, worst[g])
print('done')
