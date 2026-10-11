import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Model } from '../src/core/Model';
import { GeoReference } from '../src/geo/GeoReference';
import { decodeDxf, parseDxf } from '../src/io/dxf';
import { importDrawing, extrudeLayer } from '../src/io/drawingImport';
import { parseSfc, splitArgs } from '../src/io/sxf';
import { parseTextPoints, parseLas, parsePly } from '../src/io/pointcloud';

const sample = (name: string) => readFileSync(new URL(`../samples/${name}`, import.meta.url));
const toArrayBuffer = (b: Buffer) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;

describe('DXF', () => {
  it('Shift_JIS の画層名を読み、公共座標で取り込める', () => {
    const d = parseDxf(decodeDxf(toArrayBuffer(sample('sample_plan_jgd2011_9kei.dxf'))));
    expect(d.layers.map((l) => l.name)).toEqual(expect.arrayContaining(['建物外形', '擁壁', '寸法線']));
    expect(d.texts.some((t) => t.text === '事務所棟')).toBe(true);

    const m = new Model();
    const geo = new GeoReference();
    const res = importDrawing(m, geo, d, {
      unitToMeters: 1,
      georeferenced: true,
      elevation: 12,
      layers: new Set(['建物外形', '擁壁', '寸法線']),
      faceLayers: new Set(['建物外形', '擁壁']),
    });
    // 事務所棟は間仕切りで 3 部屋 + 倉庫 1 + 擁壁 1
    expect(res.faces).toBe(5);
    expect(geo.originSet).toBe(true);
    // 建物の角 (E0, N0) が公共座標で一致する
    const corner = [...m.vertices.values()].find((p) => {
      const q = geo.toPublic(p);
      return Math.abs(q.Y - -5980) < 1e-6 && Math.abs(q.X - -35370) < 1e-6;
    });
    expect(corner).toBeDefined();
    expect(geo.toPublic(corner!).H).toBeCloseTo(12);

    expect(extrudeLayer(m, '建物外形', 6)).toBe(4);
    const box = m.boundingBox();
    expect(box.max.y - box.min.y).toBeCloseTo(6);
  });
});

describe('SXF', () => {
  it('引数を分割できる', () => {
    expect(splitArgs("'a,b','1','(1.0,2.0)',3")).toEqual(['a,b', '1', '(1.0,2.0)', '3']);
  });

  it('SFC の基本図形を読める', () => {
    const sfc = [
      "/*SXF",
      "#10 = layer_feature('外形','1')",
      "SXF*/",
      "/*SXF",
      "#20 = polyline_feature('1','2','1','1','5','(0.0,100.0,100.0,0.0,0.0)','(0.0,0.0,50.0,50.0,0.0)')",
      "SXF*/",
      "/*SXF",
      "#30 = circle_feature('1','2','1','1','50.0','25.0','10.0')",
      "SXF*/",
    ].join('\n');
    const d = parseSfc(sfc, 100);
    expect(d.layers[0].name).toBe('外形');
    expect(d.paths.length).toBe(2);
    expect(d.paths[0].closed).toBe(true);
    expect(d.max[0]).toBeCloseTo(10000); // 100mm × 1/100 → 10000mm
  });
});

describe('点群', () => {
  it('XYZ + RGB を読める', () => {
    const pc = parseTextPoints('# header\n1 2 3 255 0 0\n4 5 6 0 255 0\n', {});
    expect(pc.count).toBe(2);
    expect(pc.colors![0]).toBeCloseTo(1);
    expect(pc.max).toEqual([4, 5, 6]);
  });

  it('PTS（先頭に点数、7 列）を読める', () => {
    const pc = parseTextPoints('2\n1 2 3 100 10 20 30\n4 5 6 200 40 50 60\n');
    expect(pc.count).toBe(2);
    expect(pc.colors![1]).toBeCloseTo(20 / 255);
  });

  it('LAS 1.2（形式 2, RGB）を読める', () => {
    const n = 3;
    const recLen = 26;
    const offset = 227;
    const buf = new ArrayBuffer(offset + n * recLen);
    const dv = new DataView(buf);
    'LASF'.split('').forEach((c, i) => dv.setUint8(i, c.charCodeAt(0)));
    dv.setUint8(24, 1);
    dv.setUint8(25, 2);
    dv.setUint16(94, 227, true);
    dv.setUint32(96, offset, true);
    dv.setUint8(104, 2);
    dv.setUint16(105, recLen, true);
    dv.setUint32(107, n, true);
    [0.001, 0.001, 0.001].forEach((s, i) => dv.setFloat64(131 + i * 8, s, true));
    [-6000, -35000, 0].forEach((o, i) => dv.setFloat64(155 + i * 8, o, true));
    for (let i = 0; i < n; i++) {
      const o = offset + i * recLen;
      dv.setInt32(o, 1000 * i, true);
      dv.setInt32(o + 4, 2000 * i, true);
      dv.setInt32(o + 8, 12345, true);
      dv.setUint16(o + 20, 65535, true);
    }
    const pc = parseLas(buf);
    expect(pc.count).toBe(3);
    expect(pc.positions[3]).toBeCloseTo(-5999);
    expect(pc.positions[4]).toBeCloseTo(-34998);
    expect(pc.positions[5]).toBeCloseTo(12.345);
    expect(pc.colors![0]).toBeCloseTo(1);
  });

  it('PLY（ascii）を読める', () => {
    const text = 'ply\nformat ascii 1.0\nelement vertex 2\nproperty double x\nproperty double y\nproperty double z\nproperty uchar red\nproperty uchar green\nproperty uchar blue\nend_header\n-6000.5 -35000.25 10 255 128 0\n1 2 3 0 0 0\n';
    const pc = parsePly(new TextEncoder().encode(text).buffer as ArrayBuffer);
    expect(pc.count).toBe(2);
    expect(pc.positions[0]).toBe(-6000.5);
    expect(pc.colors![1]).toBeCloseTo(128 / 255);
  });

  it('サンプル点群を読める', () => {
    const pc = parseTextPoints(sample('sample_ground_jgd2011_9kei.xyz').toString('utf8'));
    expect(pc.count).toBe(25000);
    expect(pc.colors).toBeDefined();
  });
});
