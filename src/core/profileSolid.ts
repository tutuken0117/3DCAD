import { Vector3 } from 'three';
import Module from 'manifold-3d';
import type { Manifold, ManifoldToplevel, Mat4 } from 'manifold-3d';
import { meshToFaces, type PolyFace } from './meshToFaces';

/**
 * 図面の外形（平面図・立面図・断面図）を押し出した立体どうしの共通部分を求める。
 *
 * 例: 平面図の外形を上下に、立面図の外形を奥行き方向に押し出して重なった部分
 *     → 切妻屋根の建物などが 2 枚の図面だけで立体になる。
 *
 * 計算は manifold-3d（WebAssembly のソリッド演算ライブラリ）で行う。
 * manifold の座標系は Z が上なので、ローカル座標 (x, y=上, z=南) を
 * (x, -z, y) に置き換えて計算する。
 */

export interface PlanProfile {
  kind: 'plan';
  /** 水平面上の外形（ローカル座標。y は無視） */
  outline: Vector3[];
  holes?: Vector3[][];
  /** 単独で押し出すときの高さの範囲 [下端, 上端] */
  range?: [number, number];
}

export interface VerticalProfile {
  kind: 'vertical';
  /** 鉛直面上の外形（ローカル座標） */
  outline: Vector3[];
  holes?: Vector3[][];
  /** 図面の右方向（水平の単位ベクトル） */
  axis: Vector3;
  /** 単独で押し出すときの奥行きの範囲（図面の手前方向を正とした位置） [奥, 手前] */
  range?: [number, number];
}

export type Profile = PlanProfile | VerticalProfile;

let wasmUrl: string | undefined;
let modulePromise: Promise<ManifoldToplevel> | null = null;

/** ブラウザでは wasm ファイルの URL を先に渡しておく */
export function setManifoldWasmUrl(url: string): void {
  wasmUrl = url;
}

function manifold(): Promise<ManifoldToplevel> {
  if (!modulePromise) {
    modulePromise = Module(wasmUrl ? { locateFile: () => wasmUrl! } : undefined).then((m) => {
      m.setup();
      return m;
    });
  }
  return modulePromise;
}

/** ローカル座標 → manifold 座標 */
const toM = (p: Vector3): [number, number, number] => [p.x, -p.z, p.y];
/** manifold 座標 → ローカル座標 */
const fromM = (x: number, y: number, z: number) => new Vector3(x, z, -y);

export interface SolidResult {
  points: Vector3[];
  faces: PolyFace[];
  volume: number;
}

/** 外形を押し出した立体（プリズム）を作る */
function prism(M: ManifoldToplevel, prof: Profile, span: number): Manifold {
  const { CrossSection } = M;
  if (prof.kind === 'plan') {
    const loops = [prof.outline, ...(prof.holes ?? [])].map((L) => L.map((p) => [p.x, -p.z] as [number, number]));
    const cs = new CrossSection(loops, 'EvenOdd');
    const [y0, y1] = prof.range ?? [-span, span];
    const solid = cs.extrude(y1 - y0).translate(0, 0, y0);
    cs.delete();
    return solid;
  }
  // 鉛直面: 図面の (右, 上) を断面にし、手前方向 N に押し出す
  const [hx, hy] = toM(prof.axis.clone().setY(0).normalize());
  const H = [hx, hy, 0];
  const U = [0, 0, 1];
  const N = [hy, -hx, 0]; // H × U（図面の手前方向）
  const loops = [prof.outline, ...(prof.holes ?? [])].map((L) =>
    L.map((p) => {
      const m = toM(p);
      return [m[0] * H[0] + m[1] * H[1], m[2]] as [number, number];
    }),
  );
  const cs = new CrossSection(loops, 'EvenOdd');
  const [c0, c1] = prof.range ?? [-span, span];
  const local = cs.extrude(c1 - c0).translate(0, 0, c0);
  cs.delete();
  const mat: Mat4 = [H[0], H[1], H[2], 0, U[0], U[1], U[2], 0, N[0], N[1], N[2], 0, 0, 0, 0, 1];
  const solid = local.transform(mat);
  local.delete();
  return solid;
}

/** 鉛直の図面の、手前方向（ローカル座標） */
export function verticalNormal(axis: Vector3): Vector3 {
  // H × 上 （ローカル座標では x, z 平面で 90° 回したもの）
  return new Vector3(axis.z, 0, -axis.x).normalize().negate();
}

/** 外形を押し出して共通部分を求め、面のリストにする */
export async function intersectProfiles(profiles: Profile[]): Promise<SolidResult | null> {
  if (!profiles.length) return null;
  const M = await manifold();
  // 押し出しの長さ: 全外形を十分に貫く長さ
  let r = 10;
  for (const p of profiles) for (const q of p.outline) r = Math.max(r, Math.abs(q.x), Math.abs(q.y), Math.abs(q.z));
  const span = r * 4 + 100;
  const solids = profiles.map((p) => prism(M, p, span));
  let result = solids[0];
  for (let i = 1; i < solids.length; i++) {
    const next = result.intersect(solids[i]);
    if (result !== solids[0]) result.delete();
    result = next;
  }
  try {
    if (result.isEmpty()) return null;
    const mesh = result.getMesh();
    const np = mesh.numProp;
    const points: Vector3[] = [];
    for (let i = 0; i < mesh.vertProperties.length; i += np) {
      points.push(fromM(mesh.vertProperties[i], mesh.vertProperties[i + 1], mesh.vertProperties[i + 2]));
    }
    const tris: [number, number, number][] = [];
    for (let i = 0; i < mesh.triVerts.length; i += 3) {
      // 座標変換 (x,-z,y) は回転なので三角形の向きはそのまま
      tris.push([mesh.triVerts[i], mesh.triVerts[i + 1], mesh.triVerts[i + 2]]);
    }
    return { points, faces: meshToFaces(points, tris), volume: result.volume() };
  } finally {
    for (const s of solids) s.delete();
    if (!solids.includes(result)) result.delete();
  }
}
