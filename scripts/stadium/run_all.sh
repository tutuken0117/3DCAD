#!/bin/bash
# 組み立て → 座席の色 → 場面の書き出し → 1 ファイル版 まで続けて行う
S=/tmp/claude-0/-home-user-3DCAD/a8de98c2-9a56-596d-a145-9a957c088792/scratchpad
OUT=$S/$1
mkdir -p "$OUT"
cd /home/user/3DCAD || exit 1
node .build-tmp.mjs $S/stadium2/local.json $S/stadium2/inside_local.json $S/stadium2/stadium3.3dcad > $S/stadium2/build3.log 2>&1
grep -E "LF stand|booths|^faces|Error" $S/stadium2/build3.log | tail -4
python3 -I - "$S/stadium2" <<'EOF'
import json, sys
d = sys.argv[1]
p = json.load(open(d + '/stadium3.3dcad'))
for f in p['model']['faces']:
    if f.get('color') == 'mat:paint-red':
        f['color'] = '#8a2b3a'
json.dump(p, open(d + '/stadium3c.3dcad', 'w'), ensure_ascii=False, separators=(',', ':'))
EOF
curl -s localhost:4173 > /dev/null || { (nohup npx vite preview --port 4173 --strictPort > /dev/null 2>&1 &); sleep 6; }
cd $S/e2e && timeout 3000 node stadium3.mjs ../stadium2/stadium3c.3dcad "$OUT" export > "$OUT/log.txt" 2>&1
tail -1 "$OUT/log.txt"
python3 -I - "$OUT" <<'EOF'
import json, sys
p = sys.argv[1] + '/マツダスタジアム.3dcad'
d = json.load(open(p))
for l in d['model']['layers']:
    l['visible'] = True
d['camera'] = {'position': d['scenes'][0]['position'], 'target': d['scenes'][0]['target']}
json.dump(d, open(p, 'w'), ensure_ascii=False, separators=(',', ':'))
EOF
cd /home/user/3DCAD && SINGLE=1 npx vite build 2>&1 | tail -1
node scripts/make-single.mjs "$S/single/3DCAD_スタジアム.html" "$OUT/マツダスタジアム.3dcad" "3DCAD — MAZDA Zoom-Zoom スタジアム広島"
python3 -I - "$S/single" <<'EOF'
import re, sys, os
d = sys.argv[1]
s = open(os.path.join(d, '3DCAD_スタジアム.html'), encoding='utf-8').read()
s = re.sub(r'^\s*<!doctype html>\s*', '', s, flags=re.I)
s = re.sub(r'<html[^>]*>', '', s, count=1); s = s.replace('</html>', '')
s = s.replace('<head>', '', 1).replace('</head>', '', 1)
s = re.sub(r'<body[^>]*>', '', s, count=1); s = s.replace('</body>', '')
s = re.sub(r'<meta charset="UTF-8" />\s*', '', s, count=1)
s = re.sub(r'<meta name="viewport"[^>]*>\s*', '', s, count=1)
s = re.sub(r'<title>[^<]*</title>', '', s, count=1)
s = '<title>球場 3D</title>\n' + s
open(os.path.join(d, 'スタジアム3D.html'), 'w', encoding='utf-8').write(s)
print('artifact MB', len(s.encode()) / 1e6)
EOF
cd $S/e2e && timeout 400 node single.mjs "$S/single/3DCAD_スタジアム.html" $S/single project 2>&1 | grep -v errors-early | tail -2
cd /home/user/3DCAD && npm run build > /dev/null 2>&1
echo ALLDONE
