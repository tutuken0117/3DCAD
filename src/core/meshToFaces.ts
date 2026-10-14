import { Vector3 } from 'three';

export interface PolyFace {
  /** 外周（頂点インデックス、法線の向きに反時計回り） */
  outer: number[];
  holes: number[][];
  /** もとの三角形（輪郭がうまく作れなかったときに、三角形ごとの面にして取りこぼさないため） */
  tris?: [number, number, number][];
}

/**
 * 三角形メッシュを、同一平面でつながった三角形ごとにまとめて多角形の面にする。
 * ブーリアン演算の結果を SketchUp 風の面（プッシュ/プルできる面）に戻すために使う。
 */
export function meshToFaces(points: Vector3[], tris: [number, number, number][], tol = 1e-5): PolyFace[] {
  const n = tris.length;
  const normals: Vector3[] = [];
  const dists: number[] = [];
  for (const [a, b, c] of tris) {
    const nrm = new Vector3().subVectors(points[b], points[a]).cross(new Vector3().subVectors(points[c], points[a]));
    const len = nrm.length();
    if (len > 0) nrm.divideScalar(len);
    normals.push(nrm);
    dists.push(nrm.dot(points[a]));
  }

  // 辺 → 三角形
  const key = (a: number, b: number) => (a < b ? a * 4294967296 + b : b * 4294967296 + a);
  const edgeTris = new Map<number, number[]>();
  tris.forEach(([a, b, c], t) => {
    for (const [p, q] of [
      [a, b],
      [b, c],
      [c, a],
    ]) {
      const k = key(p, q);
      const arr = edgeTris.get(k);
      if (arr) arr.push(t);
      else edgeTris.set(k, [t]);
    }
  });

  // 同一平面で辺を共有する三角形をまとめる（Union-Find）
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) i = parent[i] = parent[parent[i]];
    return i;
  };
  const coplanar = (s: number, t: number) =>
    normals[s].dot(normals[t]) > 1 - 1e-6 && Math.abs(dists[s] - dists[t]) < tol * 10;
  for (const ts of edgeTris.values()) {
    for (let i = 0; i < ts.length; i++)
      for (let j = i + 1; j < ts.length; j++) {
        if (coplanar(ts[i], ts[j])) parent[find(ts[i])] = find(ts[j]);
      }
  }
  const groups = new Map<number, number[]>();
  for (let t = 0; t < n; t++) {
    if (normals[t].lengthSq() === 0) continue;
    const r = find(t);
    const arr = groups.get(r);
    if (arr) arr.push(t);
    else groups.set(r, [t]);
  }

  const faces: PolyFace[] = [];
  for (const ts of groups.values()) {
    const normal = normals[ts[0]];
    // 有向辺のうち、逆向きの辺がグループ内に無いもの = 境界
    const directed = new Set<string>();
    for (const t of ts) {
      const [a, b, c] = tris[t];
      directed.add(`${a}>${b}`).add(`${b}>${c}`).add(`${c}>${a}`);
    }
    const next = new Map<number, number[]>();
    for (const d of directed) {
      const [a, b] = d.split('>').map(Number);
      if (directed.has(`${b}>${a}`)) continue;
      const arr = next.get(a);
      if (arr) arr.push(b);
      else next.set(a, [b]);
    }
    // 境界をたどってループにする
    const loops: number[][] = [];
    for (const start of [...next.keys()]) {
      while (next.get(start)?.length) {
        const loop = [start];
        let cur = next.get(start)!.pop()!;
        let guard = 0;
        while (cur !== start && guard++ < 1e6) {
          loop.push(cur);
          const outs = next.get(cur);
          if (!outs?.length) break;
          cur = outs.pop()!;
        }
        // 一直線上の途中の頂点も残す（隣の面の角になっていることがあり、消すと面どうしのつながりが切れる）
        if (cur === start && loop.length >= 3) loops.push(loop);
      }
    }
    if (!loops.length) continue;
    // 法線に対して反時計回り（面積が正）のうち最大が外周、残りは穴
    const signed = loops.map((L) => signedArea(L, points, normal));
    let outerIdx = 0;
    for (let i = 1; i < loops.length; i++) if (signed[i] > signed[outerIdx]) outerIdx = i;
    faces.push({ outer: loops[outerIdx], holes: loops.filter((_, i) => i !== outerIdx && loops[i].length >= 3), tris: ts.map((t) => tris[t]) });
  }
  return faces;
}

function signedArea(loop: number[], points: Vector3[], normal: Vector3): number {
  const s = new Vector3();
  for (let i = 0; i < loop.length; i++) {
    s.add(new Vector3().crossVectors(points[loop[i]], points[loop[(i + 1) % loop.length]]));
  }
  return s.dot(normal) / 2;
}
