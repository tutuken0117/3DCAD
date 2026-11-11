#!/bin/bash
# 球場の組み立て → 座席の色 → 場面の画像・プレゼン資料の書き出し → 1 ファイル版 → リポジトリへ保存 まで続けて行う。
#   bash scripts/stadium/run_all.sh <作業フォルダ>
# 作業フォルダには途中のファイルと書き出し結果が入る（コンテナが入れ替わると消えてよい場所）。
# 画像の書き出しには playwright-core（作業フォルダ/e2e に入れる）と、起動中のアプリ（vite preview :4173）を使う。
set -u
W="$1"
R="$(cd "$(dirname "$0")/../.." && pwd)"
OUT="$W/out"
mkdir -p "$OUT" "$W/e2e" "$W/single"
cd "$R" || exit 1
# 1. 組み立て
npx esbuild scripts/stadium/build.ts --bundle --platform=node --format=esm --external:manifold-3d --external:three --outfile=.build-tmp.mjs --log-level=error || exit 1
node .build-tmp.mjs scripts/stadium/data/local.json scripts/stadium/data/inside_local.json "$W/stadium.3dcad" > "$W/build.log" 2>&1
grep -E "LF stand|booths|dugout|^faces|Error" "$W/build.log" | tail -6
[ -s "$W/stadium.3dcad" ] || { echo BUILD-FAILED; exit 1; }
# 2. 座席の色（濃いえんじ色）
python3 -I - "$W" <<'EOF'
import json, sys
d = sys.argv[1]
p = json.load(open(d + '/stadium.3dcad'))
for f in p['model']['faces']:
    if f.get('color') == 'mat:paint-red':
        f['color'] = '#8a2b3a'
json.dump(p, open(d + '/stadium_c.3dcad', 'w'), ensure_ascii=False, separators=(',', ':'))
EOF
# 3. 画像とプレゼン資料
[ -d "$W/e2e/node_modules/playwright-core" ] || (cd "$W/e2e" && echo '{"name":"e2e","private":true,"type":"module"}' > package.json && PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm i playwright-core@1.56 > /dev/null 2>&1)
cp scripts/stadium/render/*.mjs "$W/e2e/"
npm run build > /dev/null 2>&1 # 新しい材料などを画像に反映するため毎回作り直す
curl -s localhost:4173 > /dev/null || { (nohup npx vite preview --port 4173 --strictPort > /dev/null 2>&1 &); sleep 6; }
(cd "$W/e2e" && timeout 3000 node stadium3.mjs "$W/stadium_c.3dcad" "$OUT" export > "$OUT/log.txt" 2>&1)
tail -1 "$OUT/log.txt"
[ -s "$OUT/マツダスタジアム.3dcad" ] || { echo EXPORT-FAILED; exit 1; }
python3 -I - "$OUT" <<'EOF'
import json, sys
p = sys.argv[1] + '/マツダスタジアム.3dcad'
d = json.load(open(p))
for l in d['model']['layers']:
    l['visible'] = True
# 座標は 1mm に丸める（ファイルを小さく）
for v in d['model']['vertices']:
    v[1:4] = [round(c, 3) for c in v[1:4]]
d['camera'] = {'position': d['scenes'][0]['position'], 'target': d['scenes'][0]['target']}
json.dump(d, open(p, 'w'), ensure_ascii=False, separators=(',', ':'))
EOF
# 4. 見本モデルとしてリポジトリに置く
gzip -9 -c "$OUT/マツダスタジアム.3dcad" > samples/models/mazda-stadium.3dcadz
# 5. 1 ファイル版（claude.ai のページ用）
SINGLE=1 npx vite build 2>&1 | tail -1
node scripts/make-single.mjs "$W/single/3DCAD_スタジアム.html" "$OUT/マツダスタジアム.3dcad" "3DCAD — MAZDA Zoom-Zoom スタジアム広島"
python3 -I - "$W/single" <<'EOF'
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
(cd "$W/e2e" && timeout 400 node single.mjs "$W/single/3DCAD_スタジアム.html" 2>&1 | tail -2)
npm run build > /dev/null 2>&1
echo ALLDONE
