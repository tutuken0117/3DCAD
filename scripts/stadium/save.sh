#!/bin/bash
# 作業フォルダ（scratchpad）の球場スクリプト・データ・完成モデルを、リポジトリに写す。
#   bash scripts/stadium/save.sh <scratchpad のパス> <書き出し先フォルダ名（例: sr20）>
# 作業フォルダはコンテナの入れ替えで消えるので、球場を作り直すたびに実行してコミットする。
set -e
S="$1"; OUT="$2"
R="$(cd "$(dirname "$0")/../.." && pwd)"
# 組み立て本体（build.ts）はリポジトリの方を直接直すので、ここでは写さない
cp "$S/stadium2/prep.py" "$S/stadium2/run_all.sh" "$R/scripts/stadium/"
cp "$S/stadium2/local.json" "$S/stadium2/inside_local.json" "$R/scripts/stadium/data/"
cp "$S/e2e/stadium3.mjs" "$S/e2e/single.mjs" "$S/e2e/peekcam2.mjs" "$R/scripts/stadium/render/"
[ -n "$OUT" ] && gzip -9 -c "$S/$OUT/マツダスタジアム.3dcad" > "$R/samples/models/mazda-stadium.3dcadz"
echo saved
