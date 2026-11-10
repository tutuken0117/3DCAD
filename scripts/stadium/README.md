# マツダスタジアム（見本モデル）の組み立て

OpenStreetMap の 3D 建物データ（building:part）から、MAZDA Zoom-Zoom スタジアム広島のモデルを組み立てるスクリプトです。
アプリ本体の動作には関係しません。

- `build.ts` … 組み立て本体（manifold-3d で立体を作り、`.3dcad` を書き出す）
- `prep.py` … Overpass API の JSON を、球場中心を原点にしたメートル座標の多角形に直す
- `data/local.json`・`data/inside_local.json` … 変換済みの地図データ
- `render/` … 画像の書き出し・1 ファイル版の確認に使ったスクリプト
- `run_all.sh <作業フォルダ>` … 組み立て → 座席の色 → 画像・資料の書き出し → `samples/models/` への保存 → 1 ファイル版 を続けて行う

完成したモデルは `samples/models/mazda-stadium.3dcadz` にあり、アプリの「読み込み ▾ → 見本: マツダスタジアム」か、
URL の末尾に `?model=mazda-stadium` を付けると開けます。

## 作り方

```
npx esbuild scripts/stadium/build.ts --bundle --platform=node --format=esm --external:manifold-3d --external:three --outfile=.build-tmp.mjs
node .build-tmp.mjs scripts/stadium/data/local.json scripts/stadium/data/inside_local.json out.3dcad
```

## データの出どころ

- 形状・高さ: © OpenStreetMap contributors（ODbL）。`data/` の JSON は OpenStreetMap のデータを加工したものです。
- 位置合わせ・細部の参考: 国土地理院の空中写真、広島東洋カープ公式サイトの座席図・コンコースマップ、Wikipedia、
  環境デザイン研究所・AND BUILD HIROSHIMA の写真（参考にしただけで、写真や図は収録していません）。
- 座席・フェンス・ベンチなどの細部には、推定で作った部分があります。
