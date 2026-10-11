import { ShapeUtils, Vector2, Vector3 } from 'three';

export const EPS = 1e-6;
/** 同一点とみなす距離 (m) = 0.1mm */
export const MERGE_TOL = 1e-4;
/** 同一平面とみなす距離 (m) */
export const PLANE_TOL = 1e-4;

/** Newell 法による多角形の法線（正規化済み）。退化している場合は (0,0,0) */
export function polygonNormal(pts: Vector3[], target = new Vector3()): Vector3 {
  target.set(0, 0, 0);
  for (let i = 0; i < pts.length; i++) {
    const c = pts[i];
    const nx = pts[(i + 1) % pts.length];
    target.x += (c.y - nx.y) * (c.z + nx.z);
    target.y += (c.z - nx.z) * (c.x + nx.x);
    target.z += (c.x - nx.x) * (c.y + nx.y);
  }
  const len = target.length();
  if (len < EPS) return target.set(0, 0, 0);
  return target.divideScalar(len);
}

/** 多角形の面積（3D） */
export function polygonArea(pts: Vector3[]): number {
  const s = new Vector3();
  for (let i = 0; i < pts.length; i++) {
    const c = pts[i];
    const nx = pts[(i + 1) % pts.length];
    s.x += (c.y - nx.y) * (c.z + nx.z);
    s.y += (c.z - nx.z) * (c.x + nx.x);
    s.z += (c.x - nx.x) * (c.y + nx.y);
  }
  return s.length() / 2;
}

export function centroid(pts: Vector3[], target = new Vector3()): Vector3 {
  target.set(0, 0, 0);
  for (const p of pts) target.add(p);
  return pts.length ? target.divideScalar(pts.length) : target;
}

export function isPlanar(pts: Vector3[], tol = PLANE_TOL): boolean {
  if (pts.length < 4) return true;
  const n = polygonNormal(pts);
  if (n.lengthSq() === 0) return false;
  const d = n.dot(pts[0]);
  return pts.every((p) => Math.abs(n.dot(p) - d) < tol);
}

/** 法線 n の平面上の直交基底 (u, v) を返す。水平面では u=+X になる */
export function planeBasis(n: Vector3): { u: Vector3; v: Vector3 } {
  const up = new Vector3(0, 1, 0);
  let u: Vector3;
  if (Math.abs(n.dot(up)) > 0.999) {
    u = new Vector3(1, 0, 0);
  } else {
    u = new Vector3().crossVectors(up, n).normalize();
  }
  const v = new Vector3().crossVectors(n, u).normalize();
  return { u, v };
}

/**
 * 平面多角形を三角形分割する（穴あり可）。
 * 返り値のインデックスは [...pts, ...holes[0], ...holes[1], ...] の通し番号
 */
export function triangulate(pts: Vector3[], normal?: Vector3, holes: Vector3[][] = []): number[][] {
  if (pts.length < 3) return [];
  if (pts.length === 3 && holes.length === 0) return [[0, 1, 2]];
  const n = normal ?? polygonNormal(pts);
  const { u, v } = planeBasis(n);
  const to2 = (p: Vector3) => new Vector2(p.dot(u), p.dot(v));
  const all = [...pts, ...holes.flat()];
  const tris = ShapeUtils.triangulateShape(pts.map(to2), holes.map((h) => h.map(to2)));
  // 元の向き（法線 n）と一致させる
  return tris.map(([a, b, c]) => {
    const ab = new Vector3().subVectors(all[b], all[a]);
    const ac = new Vector3().subVectors(all[c], all[a]);
    return ab.cross(ac).dot(n) >= 0 ? [a, b, c] : [a, c, b];
  });
}

/** 点 p が平面多角形 pts の内部にあるか（境界上は false 寄り） */
export function pointInPolygon(p: Vector3, pts: Vector3[], normal?: Vector3): boolean {
  const n = normal ?? polygonNormal(pts);
  const { u, v } = planeBasis(n);
  const px = p.dot(u);
  const py = p.dot(v);
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const xi = pts[i].dot(u);
    const yi = pts[i].dot(v);
    const xj = pts[j].dot(u);
    const yj = pts[j].dot(v);
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** 線分 ab 上で p に最も近い点のパラメータ t (0..1) */
export function closestParamOnSegment(p: Vector3, a: Vector3, b: Vector3): number {
  const ab = new Vector3().subVectors(b, a);
  const len2 = ab.lengthSq();
  if (len2 < EPS * EPS) return 0;
  return Math.min(1, Math.max(0, new Vector3().subVectors(p, a).dot(ab) / len2));
}

export function distanceToSegment(p: Vector3, a: Vector3, b: Vector3): number {
  const t = closestParamOnSegment(p, a, b);
  return new Vector3().lerpVectors(a, b, t).distanceTo(p);
}

/** 円弧（または円）を折れ線に分割した点列 */
export function arcPoints(
  center: Vector3,
  radius: number,
  u: Vector3,
  v: Vector3,
  start: number,
  end: number,
  segments: number,
): Vector3[] {
  const pts: Vector3[] = [];
  for (let i = 0; i <= segments; i++) {
    const a = start + ((end - start) * i) / segments;
    pts.push(
      center
        .clone()
        .addScaledVector(u, Math.cos(a) * radius)
        .addScaledVector(v, Math.sin(a) * radius),
    );
  }
  return pts;
}
