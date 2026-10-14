import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { Model } from '../src/core/Model';
import { intersectProfiles, verticalNormal } from '../src/core/profileSolid';
import { meshToFaces } from '../src/core/meshToFaces';

function volumeOf(m: Model): number {
  let v = 0;
  for (const f of m.faces.values()) {
    const { points: p, tris } = m.faceTriangles(f);
    for (const [a, b, c] of tris) v += p[a].dot(p[b].clone().cross(p[c])) / 6;
  }
  return v;
}

// 平面図: 東西 10m × 南北 6m（ローカル座標は -z が北）
const plan = [new Vector3(0, 0, 0), new Vector3(10, 0, 0), new Vector3(10, 0, -6), new Vector3(0, 0, -6)];
// 南立面図: 軒高 3m・棟高 5m の切妻。建物の 2m 南に立てた図面
const gable = [
  new Vector3(0, 0, 2),
  new Vector3(10, 0, 2),
  new Vector3(10, 3, 2),
  new Vector3(5, 5, 2),
  new Vector3(0, 3, 2),
];

describe('図面の外形から立体を作る', () => {
  it('立面図の手前方向', () => {
    expect(verticalNormal(new Vector3(1, 0, 0)).distanceTo(new Vector3(0, 0, 1))).toBeLessThan(1e-12);
    expect(verticalNormal(new Vector3(0, 0, -1)).distanceTo(new Vector3(1, 0, 0))).toBeLessThan(1e-12);
  });

  it('平面図 × 南立面図 で切妻屋根の建物になる', async () => {
    const r = await intersectProfiles([
      { kind: 'plan', outline: plan },
      { kind: 'vertical', outline: gable, axis: new Vector3(1, 0, 0) },
    ]);
    expect(r).not.toBeNull();
    expect(r!.volume).toBeCloseTo(240, 3);
    // 底面・前後の壁・妻壁 2・屋根 2 = 7 面
    expect(r!.faces.length).toBe(7);
    const m = new Model();
    const gid = m.addPolyFacesAsGroup(r!.points, r!.faces, '建物')!;
    expect(m.groupEntities(gid).faces.length).toBe(7);
    expect(volumeOf(m)).toBeCloseTo(240, 3);
    // 棟の高さ
    expect(m.boundingBox().max.y).toBeCloseTo(5);
  });

  it('東立面図も加えると寄棟になる', async () => {
    // 東立面: 右 = 北。南北 6m、軒高 3m、棟高 5m（棟は東西方向なので東から見ると三角）
    const east = [
      new Vector3(12, 0, 0),
      new Vector3(12, 0, -6),
      new Vector3(12, 3, -6),
      new Vector3(12, 5, -3),
      new Vector3(12, 3, 0),
    ];
    // 南立面を台形（寄棟）にする
    const hip = [new Vector3(0, 0, 2), new Vector3(10, 0, 2), new Vector3(10, 3, 2), new Vector3(7, 5, 2), new Vector3(3, 5, 2), new Vector3(0, 3, 2)];
    const r = await intersectProfiles([
      { kind: 'plan', outline: plan },
      { kind: 'vertical', outline: hip, axis: new Vector3(1, 0, 0) },
      { kind: 'vertical', outline: east, axis: new Vector3(0, 0, -1) },
    ]);
    expect(r).not.toBeNull();
    // 壁 10×6×3 = 180 + 屋根部分
    expect(r!.volume).toBeGreaterThan(180);
    expect(r!.volume).toBeLessThan(240);
    const m = new Model();
    m.addPolyFacesAsGroup(r!.points, r!.faces, '寄棟');
    expect(volumeOf(m)).toBeCloseTo(r!.volume, 3);
  });

  it('単独の外形は指定した範囲で押し出す', async () => {
    const r = await intersectProfiles([{ kind: 'plan', outline: plan, range: [0, 2.5] }]);
    expect(r!.volume).toBeCloseTo(150, 3);
    expect(r!.faces.length).toBe(6);
  });

  it('同一平面の三角形をまとめ、穴も保つ', () => {
    // 4×4 の正方形から 2×2 の穴を抜いた面（8 三角形）
    const p = [
      [0, 0], [4, 0], [4, 4], [0, 4], [1, 1], [3, 1], [3, 3], [1, 3],
    ].map(([x, z]) => new Vector3(x, 0, -z));
    const tris: [number, number, number][] = [
      [0, 1, 5], [0, 5, 4], [1, 2, 6], [1, 6, 5], [2, 3, 7], [2, 7, 6], [3, 0, 4], [3, 4, 7],
    ];
    const faces = meshToFaces(p, tris);
    expect(faces.length).toBe(1);
    expect(faces[0].outer.length).toBe(4);
    expect(faces[0].holes.length).toBe(1);
  });
});

describe('ブーリアン結果の面を取りこぼさない', () => {
  it('傾いた妻壁と箱を合わせた外壁でも、外側の面の面積が欠けない', async () => {
    const { default: Module } = await import('manifold-3d');
    const { meshToFaces } = await import('../src/core/meshToFaces');
    const { Model } = await import('../src/core/Model');
    const { Vector3 } = await import('three');
    const M = await Module();
    M.setup();
    const { Manifold, CrossSection } = M;
    const box = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number) => Manifold.cube([x1 - x0, y1 - y0, z1 - z0]).translate([x0, y0, z0]);
    const h = 0.1;
    const W = 0.04;
    const ru = (y: number) => 6.3 - 0.1 * (y + h);
    const side = (x0: number, x1: number) =>
      new CrossSection([[[-h - W, 3.1], [8 + h + W, 3.1], [8 + h + W, ru(8 + h + W)], [-h - W, ru(-h - W)]]], 'Positive')
        .extrude(x1 - x0)
        .transform([0, 1, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, x0, 0, 0, 1]);
    const solid = box(-h - W, 24.5 + h + W, -h - W, -h, 3.1, ru(-h)).add(box(-h - W, 24.5 + h + W, 8 + h, 8 + h + W, 3.1, ru(8 + h + W))).add(side(24.5 + h, 24.5 + h + W));
    const mesh = solid.getMesh();
    const pts = [];
    for (let i = 0; i < mesh.vertProperties.length; i += mesh.numProp) pts.push(new Vector3(mesh.vertProperties[i], mesh.vertProperties[i + 2], -mesh.vertProperties[i + 1]));
    const tris: [number, number, number][] = [];
    for (let i = 0; i < mesh.triVerts.length; i += 3) tris.push([mesh.triVerts[i], mesh.triVerts[i + 1], mesh.triVerts[i + 2]]);
    const m = new Model();
    m.addPolyFacesAsGroup(pts, meshToFaces(pts, tris), '外壁');
    let area = 0;
    for (const f of m.faces.values()) {
      const n = m.faceNormal(f);
      if (n.x > 0.99 && m.facePoints(f).every((p) => Math.abs(p.x - (24.5 + h + W)) < 1e-6)) area += m.faceArea(f);
    }
    // 台形（高さ 3.204 〜 2.376、幅 8.28）
    const expected = ((ru(-h - W) - 3.1 + (ru(8 + h + W) - 3.1)) / 2) * (8 + 2 * h + 2 * W);
    expect(area).toBeGreaterThan(expected * 0.98);
  });
});
