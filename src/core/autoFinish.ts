import type { Model } from './Model';
import { MAT_PREFIX, type FinishPreset } from './materials';

/**
 * おまかせ仕上げ: 面の向きと位置から、外壁・屋根・開口（窓）・地面の材料を自動で割り当てる。
 *  - 鉛直の面 → 外壁
 *  - 傾いた上向きの面 → 屋根
 *  - 水平な上向きの面: 地面の高さなら地面、それより上なら陸屋根
 *  - 面に刻み込んで押し込んだ奥の面（窓・開口） → ガラス
 *  - 下向きの面（建物の底）はそのまま
 * 返り値は材料を割り当てた面の数
 */
export function autoFinish(model: Model, preset: FinishPreset, faceIds?: Iterable<number>): number {
  const ids = faceIds ? [...faceIds] : [...model.faces.keys()];
  if (!ids.length) return 0;

  // 地面の高さ = 対象の面のうち一番低い位置
  let minY = Infinity;
  for (const id of ids) for (const p of model.facePoints(id)) minY = Math.min(minY, p.y);

  // 穴（刻み込み）の頂点: 押し込んだ開口の側面（見込み）はこの頂点を含む
  const holeVerts = new Set<number>();
  for (const f of model.faces.values()) for (const h of f.holes ?? []) for (const v of h) holeVerts.add(v);

  let n = 0;
  for (const id of ids) {
    const f = model.faces.get(id);
    if (!f) continue;
    const nrm = model.faceNormal(f);
    const pts = model.facePoints(f);
    const lowY = Math.min(...pts.map((p) => p.y));
    let mat: string | null = null;
    if (nrm.y < -0.5) continue; // 底面
    if (Math.abs(nrm.y) < 0.1) {
      // 鉛直: 開口の奥の面か判定
      const isOpening =
        !f.holes?.length &&
        !f.loop.some((v) => holeVerts.has(v)) &&
        model.neighborFaces(id).length > 0 &&
        model.neighborFaces(id).every((g) => g.loop.some((v) => holeVerts.has(v)));
      mat = isOpening ? preset.opening : preset.wall;
    } else if (nrm.y > 0.995) {
      mat = lowY <= minY + 0.05 ? preset.ground : preset.flatRoof;
    } else if (nrm.y > 0.1) {
      mat = preset.roof;
    } else {
      mat = preset.wall;
    }
    if (mat) {
      f.color = MAT_PREFIX + mat;
      n++;
    }
  }
  return n;
}
