"""新しく作った部品が車体（外板）の外へはみ出していないかを調べる
  python3 check_inside.py <モデル> <新しい ID の始まり>"""
import sys, os, collections, bisect
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lib import load
d = load(sys.argv[1]); m = d['model']
first_new = int(sys.argv[2]) if len(sys.argv) > 2 else 0
shell = [v for v in m['vertices'] if v[4] == 900001]
st = collections.defaultdict(list)
for v in shell:
    st[round(v[1], 3)].append((v[2], abs(v[3])))
xs = sorted(x for x in st if len(st[x]) >= 8)
prof = {}
for x in xs:
    pts = st[x]
    # y の 2cm ごとの最大 |z|
    b = collections.defaultdict(float)
    for y, z in pts:
        b[round(y / 0.02)] = max(b[round(y / 0.02)], z)
    ks = sorted(b)
    prof[x] = (ks, [b[k] for k in ks])
def half_at(x, y):
    ks, ws = prof[x]
    k = y / 0.02
    i = bisect.bisect_left(ks, k)
    if i <= 0: return ws[0] if ks[0] - k < 2 else 0.0
    if i >= len(ks): return ws[-1] if k - ks[-1] < 2 else 0.0
    t = (k - ks[i - 1]) / (ks[i] - ks[i - 1])
    return ws[i - 1] + (ws[i] - ws[i - 1]) * t
def half(x, y):
    i = bisect.bisect_left(xs, x)
    i = min(max(i, 1), len(xs) - 1)
    x0, x1 = xs[i - 1], xs[i]
    t = 0 if x1 == x0 else min(1, max(0, (x - x0) / (x1 - x0)))
    return half_at(x0, y) * (1 - t) + half_at(x1, y) * t
names = {g['id']: g['name'] for g in m['groups']}
bad = collections.Counter(); worst = {}
for v in m['vertices']:
    if v[4] < first_new: continue
    over = abs(v[3]) - half(v[1], v[2])
    if over > 0.01:
        bad[v[4]] += 1
        if over > worst.get(v[4], (0,))[0]: worst[v[4]] = (round(over, 3), v[1:4])
for g, n in bad.most_common(40):
    print(names.get(g), n, 'worst', worst[g])
