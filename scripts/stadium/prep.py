"""OSM (Overpass JSON) → 原点 = 球場中心のローカル座標 (m) の多角形 JSON"""
import json, math, sys
src, dst = sys.argv[1], sys.argv[2]
d = json.load(open(src))
LAT0, LON0 = 34.3919, 132.4846
KX = math.cos(math.radians(LAT0)) * 111320.0
KY = 110574.0
def xy(p): return [round((p['lon'] - LON0) * KX, 3), round((p['lat'] - LAT0) * KY, 3)]

def rings_from_members(members, role):
    segs = [[xy(p) for p in m['geometry']] for m in members if m.get('role', '') in (role,) and m.get('geometry')]
    rings = []
    segs = [s for s in segs if len(s) >= 2]
    while segs:
        cur = segs.pop(0)
        changed = True
        while changed and cur[0] != cur[-1]:
            changed = False
            for i, s in enumerate(segs):
                if s[0] == cur[-1]: cur = cur + s[1:]
                elif s[-1] == cur[-1]: cur = cur + s[::-1][1:]
                elif s[-1] == cur[0]: cur = s + cur[1:]
                elif s[0] == cur[0]: cur = s[::-1] + cur[1:]
                else: continue
                segs.pop(i); changed = True; break
        if cur[0] == cur[-1] and len(cur) >= 4: rings.append(cur[:-1])
    return rings

out = []
for e in d['elements']:
    t = e.get('tags', {})
    item = {'id': e['type'][0] + str(e['id']), 'tags': t}
    if e['type'] == 'way' and e.get('geometry'):
        g = [xy(p) for p in e['geometry']]
        closed = g[0] == g[-1]
        item['outer'] = [g[:-1]] if closed else []
        item['line'] = None if closed else g
        item['inner'] = []
    elif e['type'] == 'relation' and e.get('members'):
        item['outer'] = rings_from_members(e['members'], 'outer') or rings_from_members(e['members'], '')
        item['inner'] = rings_from_members(e['members'], 'inner')
        item['line'] = None
    elif e['type'] == 'node':
        item['point'] = xy(e)
    else:
        continue
    out.append(item)
json.dump(out, open(dst, 'w'), ensure_ascii=False)
print(len(out))
