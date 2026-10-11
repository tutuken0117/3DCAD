import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { Model } from '../src/core/Model';

const rect = (w: number, d: number, y = 0) => [
  new Vector3(0, y, 0),
  new Vector3(w, y, 0),
  new Vector3(w, y, -d),
  new Vector3(0, y, -d),
];

function volumeOf(m: Model): number {
  // 発散定理で閉じた立体の体積を求める
  let v = 0;
  for (const f of m.faces.values()) {
    const { points: p, tris } = m.faceTriangles(f);
    for (const [a, b, c] of tris) v += p[a].dot(p[b].clone().cross(p[c])) / 6;
  }
  return v;
}

describe('Model', () => {
  it('merges coincident vertices', () => {
    const m = new Model();
    const a = m.addVertex(new Vector3(1, 2, 3));
    const b = m.addVertex(new Vector3(1, 2, 3.00001));
    expect(a).toBe(b);
  });

  it('creates an upward face on the ground from a rectangle', () => {
    const m = new Model();
    const id = m.addFace(rect(2, 1))!;
    expect(m.faceNormal(id).y).toBeCloseTo(1);
    expect(m.edges.size).toBe(4);
  });

  it('push/pull turns a free face into a closed box', () => {
    const m = new Model();
    const id = m.addFace(rect(2, 1))!;
    const top = m.pushPull(id, 3)!;
    expect(m.faces.size).toBe(6);
    expect(m.edges.size).toBe(12);
    expect(m.vertices.size).toBe(8);
    expect(m.faceNormal(top).y).toBeCloseTo(1);
    expect(volumeOf(m)).toBeCloseTo(6);
  });

  it('push/pull downward also produces outward-facing box', () => {
    const m = new Model();
    const id = m.addFace(rect(2, 1))!;
    m.pushPull(id, -3);
    expect(m.faces.size).toBe(6);
    expect(volumeOf(m)).toBeCloseTo(6);
  });

  it('push/pull on the top of a box stretches it', () => {
    const m = new Model();
    const id = m.addFace(rect(1, 1))!;
    const top = m.pushPull(id, 1)!;
    const again = m.pushPull(top, 2);
    expect(again).toBe(top);
    expect(m.faces.size).toBe(6);
    expect(volumeOf(m)).toBeCloseTo(3);
  });

  it('draws lines that close a loop and auto-creates a face', () => {
    const m = new Model();
    const p = rect(1, 1).map((q) => m.addVertex(q));
    expect(m.drawLine(p[0], p[1])).toEqual([]);
    expect(m.drawLine(p[1], p[2])).toEqual([]);
    expect(m.drawLine(p[2], p[3])).toEqual([]);
    const created = m.drawLine(p[3], p[0]);
    expect(created.length).toBe(1);
    expect(m.faceNormal(created[0]).y).toBeCloseTo(1);
  });

  it('splits a face with a line between two boundary vertices', () => {
    const m = new Model();
    const f = m.addFace(rect(2, 1))!;
    const e1 = m.findEdge(m.faces.get(f)!.loop[0], m.faces.get(f)!.loop[1])!;
    const e2 = m.findEdge(m.faces.get(f)!.loop[2], m.faces.get(f)!.loop[3])!;
    const a = m.splitEdge(e1, new Vector3(1, 0, 0));
    const b = m.splitEdge(e2, new Vector3(1, 0, -1));
    const parts = m.drawLine(a, b);
    expect(parts.length).toBe(2);
    expect(m.faces.size).toBe(2);
    for (const id of parts) expect(m.faceArea(id)).toBeCloseTo(1);
    // 片側だけ押し上げると L 字の立体になる
    m.pushPull(parts[0], 1);
    expect(volumeOf(m)).toBeCloseTo(1);
  });

  it('erasing an edge removes faces that use it', () => {
    const m = new Model();
    const f = m.addFace(rect(1, 1))!;
    const loop = m.faces.get(f)!.loop;
    m.removeEdge(m.findEdge(loop[0], loop[1])!);
    expect(m.faces.size).toBe(0);
    expect(m.edges.size).toBe(3);
  });

  it('serializes and restores', () => {
    const m = new Model();
    const id = m.addFace(rect(2, 1))!;
    m.pushPull(id, 1);
    const m2 = new Model();
    m2.load(JSON.parse(JSON.stringify(m.toJSON())));
    expect(m2.faces.size).toBe(6);
    expect(volumeOf(m2)).toBeCloseTo(2);
    // 復元後も ID が衝突しない
    const nid = m2.addVertex(new Vector3(10, 10, 10));
    expect(m2.vertices.size).toBe(9);
    expect([...m.vertices.keys()].includes(nid)).toBe(false);
  });
});

describe('drawing import helpers', () => {
  it('finds closed regions in crossing lines', async () => {
    const { findClosedRegions } = await import('../src/io/drawing2d');
    // 田の字: 外枠 + 十字
    const segs: [[number, number], [number, number]][] = [
      [[0, 0], [2, 0]],
      [[2, 0], [2, 2]],
      [[2, 2], [0, 2]],
      [[0, 2], [0, 0]],
      [[1, 0], [1, 2]],
      [[0, 1], [2, 1]],
      [[2, 2], [3, 3]], // 行き止まりの線（無視される）
    ];
    const { regions } = findClosedRegions(segs, 1e-6);
    expect(regions.length).toBe(4);
  });

  it('extrudes adjacent drawing faces as separate solids', async () => {
    const { extrudeLayer } = await import('../src/io/drawingImport');
    const m = new Model();
    m.addFace(rect(1, 1));
    m.addFace([new Vector3(1, 0, 0), new Vector3(2, 0, 0), new Vector3(2, 0, -1), new Vector3(1, 0, -1)]);
    expect(extrudeLayer(m, '0', 2)).toBe(2);
    expect(volumeOf(m)).toBeCloseTo(4);
  });
});

const sq = (x0: number, z0: number, w: number, y = 0) => [
  new Vector3(x0, y, z0),
  new Vector3(x0 + w, y, z0),
  new Vector3(x0 + w, y, z0 - w),
  new Vector3(x0, y, z0 - w),
];

describe('面の穴あけ', () => {
  it('面の内側に描いた長方形は刻み込まれて穴になる', () => {
    const m = new Model();
    const host = m.addFace(rect(4, 4))!;
    const inner = m.addFace(sq(1, -1, 1))!;
    expect(m.faces.get(host)!.holes!.length).toBe(1);
    expect(m.faceArea(host)).toBeCloseTo(15);
    expect(m.faceNormal(inner).y).toBeCloseTo(1);
    // 穴の内側をクリックしても外側の面ではない
    expect(m.pointInFace(new Vector3(1.5, 0, -1.5), host)).toBe(false);
    expect(m.pointInFace(new Vector3(1.5, 0, -1.5), inner)).toBe(true);
  });

  it('線で囲んでも刻み込まれる', () => {
    const m = new Model();
    const host = m.addFace(rect(4, 4))!;
    const p = sq(1, -1, 1).map((q) => m.addVertex(q));
    m.drawLine(p[0], p[1]);
    m.drawLine(p[1], p[2]);
    m.drawLine(p[2], p[3]);
    expect(m.drawLine(p[3], p[0]).length).toBe(1);
    expect(m.faces.get(host)!.holes!.length).toBe(1);
  });

  it('刻み込んだ面を引き出すと出っ張り、押し込むと凹む', () => {
    const m = new Model();
    const base = m.addFace(rect(4, 4))!;
    const top = m.pushPull(base, 1)!;
    const inner = m.addFace(sq(1, -1, 1, 1))!;
    expect(m.faces.get(top)!.holes!.length).toBe(1);
    m.pushPull(inner, 1);
    expect(volumeOf(m)).toBeCloseTo(17);

    const m2 = new Model();
    const top2 = m2.pushPull(m2.addFace(rect(4, 4))!, 1)!;
    expect(top2).toBeDefined();
    const inner2 = m2.addFace(sq(1, -1, 1, 1))!;
    m2.pushPull(inner2, -0.5);
    expect(volumeOf(m2)).toBeCloseTo(15.5);
  });

  it('反対側の面まで押し込むと貫通して開口になる', () => {
    const m = new Model();
    m.pushPull(m.addFace(rect(4, 4))!, 1);
    const inner = m.addFace(sq(1, -1, 1, 1))!;
    expect(m.pushPull(inner, -1)).toBeUndefined();
    expect(volumeOf(m)).toBeCloseTo(15);
    const holed = [...m.faces.values()].filter((f) => f.holes?.length);
    expect(holed.length).toBe(2); // 上面と底面の両方に穴
  });

  it('穴あきの単独の面を押し出すと中空の立体になる', () => {
    const m = new Model();
    const host = m.addFace(rect(4, 4))!;
    const inner = m.addFace(sq(1, -1, 2))!;
    m.removeFace(inner);
    m.pushPull(host, 2);
    expect(volumeOf(m)).toBeCloseTo((16 - 4) * 2);
  });

  it('穴のエッジを消すと穴がふさがる', () => {
    const m = new Model();
    const host = m.addFace(rect(4, 4))!;
    const inner = m.addFace(sq(1, -1, 1))!;
    const L = m.faces.get(inner)!.loop;
    m.removeEdge(m.findEdge(L[0], L[1])!);
    expect(m.faces.has(inner)).toBe(false);
    expect(m.faces.get(host)!.holes).toBeUndefined();
  });

  it('穴は保存・復元される', () => {
    const m = new Model();
    m.addFace(rect(4, 4));
    m.addFace(sq(1, -1, 1));
    const m2 = new Model();
    m2.load(JSON.parse(JSON.stringify(m.toJSON())));
    expect([...m2.faces.values()].some((f) => f.holes?.length === 1)).toBe(true);
  });
});

describe('グループ', () => {
  it('グループ化したジオメトリは他とくっつかない', () => {
    const m = new Model();
    const a = m.addFace(rect(1, 1))!;
    const gid = m.makeGroup([], [a])!;
    expect(m.groupOfFace(a)).toBe(gid);
    // 同じ辺を共有する位置に描いても頂点は共有されない
    m.addFace([new Vector3(1, 0, 0), new Vector3(2, 0, 0), new Vector3(2, 0, -1), new Vector3(1, 0, -1)]);
    expect(m.vertices.size).toBe(8);
    // グループの面を押し出しても、隣の面は変形しない
    m.activeGroup = gid;
    m.pushPull(a, 1);
    m.activeGroup = 0;
    expect(m.groupEntities(gid).faces.length).toBe(6);
    expect([...m.faces.values()].filter((f) => m.groupOfFace(f) === 0).length).toBe(1);
  });

  it('既存のジオメトリから切り離してグループにできる', () => {
    const m = new Model();
    const f = m.addFace(rect(2, 1))!;
    const L = m.faces.get(f)!.loop;
    const a = m.splitEdge(m.findEdge(L[0], L[1])!, new Vector3(1, 0, 0));
    const b = m.splitEdge(m.findEdge(L[3], L[4] ?? L[0])!, new Vector3(1, 0, -1));
    const [left] = m.drawLine(a, b);
    m.makeGroup([], [left]);
    // 共有していた頂点は複製され、残った面の境界も保たれる
    const loose = [...m.faces.values()].find((x) => m.groupOfFace(x) === 0)!;
    expect(m.faceEdgeIds(loose).length).toBe(loose.loop.length);
    m.moveVertices(m.groupEntities(m.groupOfFace(left)).faces.flatMap((id) => m.faces.get(id)!.loop), new Vector3(0, 1, 0));
    expect(m.facePoints(loose).every((p) => p.y === 0)).toBe(true);
  });

  it('コピーすると別のグループになり、分解すると周りとくっつく', () => {
    const m = new Model();
    const a = m.addFace(rect(1, 1))!;
    const gid = m.makeGroup([], [a])!;
    const ents = m.groupEntities(gid);
    const copy = m.copyEntities(ents.edges, ents.faces, new Vector3(1, 0, 0));
    const g2 = m.groupOfFace(copy.faces[0]);
    expect(g2).not.toBe(gid);
    expect(m.groups.size).toBe(2);
    m.explodeGroup(gid);
    m.explodeGroup(g2);
    expect(m.groups.size).toBe(0);
    expect(m.vertices.size).toBe(6); // 共有辺の 2 頂点が統合される
  });

  it('グループは保存・復元される', () => {
    const m = new Model();
    const gid = m.makeGroup([], [m.addFace(rect(1, 1))!], '倉庫')!;
    const m2 = new Model();
    m2.load(JSON.parse(JSON.stringify(m.toJSON())));
    expect(m2.groups.get(gid)?.name).toBe('倉庫');
    expect(m2.groupEntities(gid).faces.length).toBe(1);
  });
});
