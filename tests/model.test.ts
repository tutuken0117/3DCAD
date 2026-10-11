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
    const p = m.facePoints(f);
    for (let i = 1; i < p.length - 1; i++) v += p[0].dot(p[i].clone().cross(p[i + 1])) / 6;
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
