/**
 * 2D 図面（DXF / SXF など）の共通表現と、図面から面を見つける処理。
 */

export interface DrawingPath {
  layer: string;
  /** 図面座標 [x, y]（x=右, y=上） */
  points: [number, number][];
  closed: boolean;
}

export interface DrawingText {
  layer: string;
  x: number;
  y: number;
  height: number;
  text: string;
}

export interface DrawingLayer {
  name: string;
  color: string;
  /** 図形の数 */
  count: number;
}

export interface Drawing2D {
  paths: DrawingPath[];
  texts: DrawingText[];
  layers: DrawingLayer[];
  min: [number, number];
  max: [number, number];
  /** 図面に書かれていた単位（分かれば） */
  unitHint?: 'mm' | 'cm' | 'm';
  source: string;
  warnings: string[];
}

export function finalizeDrawing(
  paths: DrawingPath[],
  texts: DrawingText[],
  layerColors: Map<string, string>,
  source: string,
  warnings: string[] = [],
  unitHint?: Drawing2D['unitHint'],
): Drawing2D {
  const min: [number, number] = [Infinity, Infinity];
  const max: [number, number] = [-Infinity, -Infinity];
  const counts = new Map<string, number>();
  for (const p of paths) {
    counts.set(p.layer, (counts.get(p.layer) ?? 0) + 1);
    for (const [x, y] of p.points) {
      if (x < min[0]) min[0] = x;
      if (y < min[1]) min[1] = y;
      if (x > max[0]) max[0] = x;
      if (y > max[1]) max[1] = y;
    }
  }
  for (const t of texts) counts.set(t.layer, counts.get(t.layer) ?? 0);
  const layers = [...counts.entries()]
    .map(([name, count]) => ({ name, count, color: layerColors.get(name) ?? '#333333' }))
    .sort((a, b) => a.name.localeCompare(b.name, 'ja'));
  if (!paths.length) warnings.push('線分が見つかりませんでした');
  return { paths, texts, layers, min, max, source, warnings, unitHint };
}

/** 円弧を折れ線に（角度はラジアン、反時計回り） */
export function arcToPoints(
  cx: number,
  cy: number,
  r: number,
  start: number,
  end: number,
  segPerCircle = 48,
): [number, number][] {
  let sweep = end - start;
  while (sweep <= 0) sweep += Math.PI * 2;
  const n = Math.max(2, Math.ceil((sweep / (Math.PI * 2)) * segPerCircle));
  const pts: [number, number][] = [];
  for (let i = 0; i <= n; i++) {
    const a = start + (sweep * i) / n;
    pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
  }
  return pts;
}

/** ふくらみ（bulge）付きポリライン区間を折れ線に */
export function bulgeToPoints(p1: [number, number], p2: [number, number], bulge: number): [number, number][] {
  if (Math.abs(bulge) < 1e-9) return [p2];
  const theta = 4 * Math.atan(bulge);
  const dx = p2[0] - p1[0];
  const dy = p2[1] - p1[1];
  const chord = Math.hypot(dx, dy);
  if (chord < 1e-12) return [p2];
  const r = chord / (2 * Math.sin(theta / 2));
  const mx = (p1[0] + p2[0]) / 2;
  const my = (p1[1] + p2[1]) / 2;
  const h = r * Math.cos(theta / 2);
  // 弦の左側（bulge>0 なら反時計回り）に中心がある
  const cx = mx - (dy / chord) * h;
  const cy = my + (dx / chord) * h;
  const a1 = Math.atan2(p1[1] - cy, p1[0] - cx);
  const n = Math.max(2, Math.ceil((Math.abs(theta) / (Math.PI * 2)) * 48));
  const pts: [number, number][] = [];
  for (let i = 1; i <= n; i++) {
    const a = a1 + (theta * i) / n;
    pts.push([cx + Math.cos(a) * Math.abs(r), cy + Math.sin(a) * Math.abs(r)]);
  }
  pts[pts.length - 1] = p2;
  return pts;
}

// ---------------------------------------------------------------------------
// 平面グラフの面検出
// ---------------------------------------------------------------------------

type P = [number, number];

/**
 * 線分の集まりから、閉じた領域（面）を見つける。
 *  1. 交差・T 字の位置で線分を分割
 *  2. 行き止まりの線を除去
 *  3. 各有向辺から「いちばん左に曲がる」方向にたどって閉路を得る
 * regions: 反時計回りの多角形のリスト（外周の無限領域は除く）
 * segments: 交点で分割した後の線分（エッジ作成用）
 */
export function findClosedRegions(
  segments: [P, P][],
  tol = 1e-4,
  maxFaces = 20000,
): { regions: P[][]; segments: [P, P][] } {
  if (!segments.length) return { regions: [], segments: [] };
  const key = (p: P) => `${Math.round(p[0] / tol)},${Math.round(p[1] / tol)}`;

  // --- 1. 交差分割（グリッドで候補を絞る） ---
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [a, b] of segments) {
    minX = Math.min(minX, a[0], b[0]);
    minY = Math.min(minY, a[1], b[1]);
    maxX = Math.max(maxX, a[0], b[0]);
    maxY = Math.max(maxY, a[1], b[1]);
  }
  const cells = Math.max(1, Math.floor(Math.sqrt(segments.length)));
  const cw = (maxX - minX) / cells || 1;
  const ch = (maxY - minY) / cells || 1;
  const grid = new Map<number, number[]>();
  const cellRange = (a: P, b: P) => [
    Math.floor((Math.min(a[0], b[0]) - minX) / cw),
    Math.floor((Math.max(a[0], b[0]) - minX) / cw),
    Math.floor((Math.min(a[1], b[1]) - minY) / ch),
    Math.floor((Math.max(a[1], b[1]) - minY) / ch),
  ];
  segments.forEach(([a, b], i) => {
    const [x0, x1, y0, y1] = cellRange(a, b);
    for (let x = x0; x <= x1; x++)
      for (let y = y0; y <= y1; y++) {
        const k = x * 100003 + y;
        const arr = grid.get(k);
        if (arr) arr.push(i);
        else grid.set(k, [i]);
      }
  });
  const splits: number[][] = segments.map(() => [0, 1]);
  const checked = new Set<string>();
  for (const ids of grid.values()) {
    for (let ii = 0; ii < ids.length; ii++)
      for (let jj = ii + 1; jj < ids.length; jj++) {
        const i = ids[ii];
        const j = ids[jj];
        const pk = i < j ? `${i}:${j}` : `${j}:${i}`;
        if (checked.has(pk)) continue;
        checked.add(pk);
        const [a, b] = segments[i];
        const [c, d] = segments[j];
        const r: P = [b[0] - a[0], b[1] - a[1]];
        const s: P = [d[0] - c[0], d[1] - c[1]];
        const den = r[0] * s[1] - r[1] * s[0];
        const lr = Math.hypot(r[0], r[1]);
        const ls = Math.hypot(s[0], s[1]);
        if (lr < tol || ls < tol) continue;
        if (Math.abs(den) < 1e-12 * lr * ls) {
          // 平行: 重なっている場合は端点で分割
          const cross = (c[0] - a[0]) * r[1] - (c[1] - a[1]) * r[0];
          if (Math.abs(cross) / lr > tol) continue;
          const proj = (p: P, o: P, v: P, l: number) => ((p[0] - o[0]) * v[0] + (p[1] - o[1]) * v[1]) / (l * l);
          for (const p of [c, d]) {
            const t = proj(p, a, r, lr);
            if (t > tol / lr && t < 1 - tol / lr) splits[i].push(t);
          }
          for (const p of [a, b]) {
            const t = proj(p, c, s, ls);
            if (t > tol / ls && t < 1 - tol / ls) splits[j].push(t);
          }
          continue;
        }
        const qp: P = [c[0] - a[0], c[1] - a[1]];
        const t = (qp[0] * s[1] - qp[1] * s[0]) / den;
        const u = (qp[0] * r[1] - qp[1] * r[0]) / den;
        const et = tol / lr;
        const eu = tol / ls;
        if (t < -et || t > 1 + et || u < -eu || u > 1 + eu) continue;
        if (t > et && t < 1 - et) splits[i].push(t);
        if (u > eu && u < 1 - eu) splits[j].push(u);
      }
  }

  // --- 2. グラフ構築 ---
  const pts = new Map<string, P>();
  const adj = new Map<string, Set<string>>();
  const noded: [P, P][] = [];
  const addEdge = (p: P, q: P) => {
    const kp = key(p);
    const kq = key(q);
    if (kp === kq) return;
    if (!adj.get(kp)?.has(kq)) noded.push([p, q]);
    if (!pts.has(kp)) pts.set(kp, p);
    if (!pts.has(kq)) pts.set(kq, q);
    if (!adj.has(kp)) adj.set(kp, new Set());
    if (!adj.has(kq)) adj.set(kq, new Set());
    adj.get(kp)!.add(kq);
    adj.get(kq)!.add(kp);
  };
  segments.forEach(([a, b], i) => {
    const ts = [...new Set(splits[i])].sort((x, y) => x - y);
    for (let k = 0; k < ts.length - 1; k++) {
      const p: P = [a[0] + (b[0] - a[0]) * ts[k], a[1] + (b[1] - a[1]) * ts[k]];
      const q: P = [a[0] + (b[0] - a[0]) * ts[k + 1], a[1] + (b[1] - a[1]) * ts[k + 1]];
      addEdge(p, q);
    }
  });

  // --- 3. 行き止まりを除去 ---
  const stack = [...adj.keys()].filter((k) => adj.get(k)!.size < 2);
  while (stack.length) {
    const k = stack.pop()!;
    const nb = adj.get(k);
    if (!nb) continue;
    for (const o of nb) {
      const on = adj.get(o)!;
      on.delete(k);
      if (on.size === 1) stack.push(o);
    }
    adj.delete(k);
  }

  // 各頂点の隣接点を角度順に並べる
  const sorted = new Map<string, string[]>();
  for (const [k, nb] of adj) {
    const p = pts.get(k)!;
    sorted.set(
      k,
      [...nb].sort((x, y) => {
        const px = pts.get(x)!;
        const py = pts.get(y)!;
        return Math.atan2(px[1] - p[1], px[0] - p[0]) - Math.atan2(py[1] - p[1], py[0] - p[0]);
      }),
    );
  }

  // --- 4. 面をたどる ---
  const visited = new Set<string>();
  const faces: P[][] = [];
  for (const [u, nbs] of sorted) {
    for (const v0 of nbs) {
      if (visited.has(`${u}>${v0}`)) continue;
      const loop: string[] = [];
      let a = u;
      let b = v0;
      let guard = 0;
      while (!visited.has(`${a}>${b}`) && guard++ < 100000) {
        visited.add(`${a}>${b}`);
        loop.push(a);
        // b での次の辺: a から見て時計回りに 1 つ前（＝最も左へ曲がる）
        const list = sorted.get(b)!;
        const idx = list.indexOf(a);
        const next = list[(idx - 1 + list.length) % list.length];
        a = b;
        b = next;
      }
      if (a !== u || loop.length < 3) continue;
      const poly = loop.map((k) => pts.get(k)!);
      let area = 0;
      for (let i = 0; i < poly.length; i++) {
        const p = poly[i];
        const q = poly[(i + 1) % poly.length];
        area += p[0] * q[1] - q[0] * p[1];
      }
      if (area / 2 > tol * tol * 10) {
        faces.push(poly);
        if (faces.length >= maxFaces) return { regions: faces, segments: noded };
      }
    }
  }
  return { regions: faces, segments: noded };
}
