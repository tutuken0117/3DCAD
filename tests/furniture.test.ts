import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { Model } from '../src/core/Model';
import { FURNITURE, placeFurniture } from '../src/core/furniture';
import { getMaterial, MAT_PREFIX } from '../src/core/materials';

describe('家具', () => {
  it('すべての家具が置け、材料はすべて存在し、大きさは表示どおり', () => {
    for (const def of FURNITURE) {
      const m = new Model();
      const gid = placeFurniture(m, def, new Vector3(5, 0, 5), 0);
      expect(gid, def.id).toBeDefined();
      for (const f of m.faces.values()) expect(getMaterial(f.color!.slice(MAT_PREFIX.length)), `${def.id} ${f.color}`).toBeDefined();
      const box = m.boundingBox();
      const size = box.getSize(new Vector3());
      expect(size.x, def.id).toBeLessThanOrEqual(def.size[0] + 0.011);
      expect(size.z, def.id).toBeLessThanOrEqual(def.size[1] + 0.011);
      expect(size.y, def.id).toBeLessThanOrEqual(def.size[2] + 0.011);
    }
  });
  it('100 種類以上・id は重複しない', () => {
    expect(FURNITURE.length).toBeGreaterThanOrEqual(100);
    expect(new Set(FURNITURE.map((f) => f.id)).size).toBe(FURNITURE.length);
  });
  it('壁付けは背面が置いた位置に来る', () => {
    const m = new Model();
    placeFurniture(m, FURNITURE.find((f) => f.id === 'panel-board')!, new Vector3(0, 0, 0), 0);
    // 回転 0 は正面が南（+z）、背面は北（-z）側 → 背面が z=0
    expect(m.boundingBox().min.z).toBeCloseTo(0, 3);
  });
  it('床置きは足元が置いた高さ、天井付けは上面が置いた高さ', () => {
    const m = new Model();
    placeFurniture(m, FURNITURE.find((f) => f.id === 'desk')!, new Vector3(0, 1, 0), 0);
    expect(m.boundingBox().min.y).toBeCloseTo(1);
    const m2 = new Model();
    placeFurniture(m2, FURNITURE.find((f) => f.id === 'downlight')!, new Vector3(0, 2.5, 0), 0);
    expect(m2.boundingBox().max.y).toBeCloseTo(2.5);
  });
  it('90° 回すと幅と奥行きが入れ替わる', () => {
    const m = new Model();
    placeFurniture(m, FURNITURE.find((f) => f.id === 'counter')!, new Vector3(0, 0, 0), Math.PI / 2);
    const s = m.boundingBox().getSize(new Vector3());
    expect(s.z).toBeCloseTo(1.84, 1);
    expect(s.x).toBeCloseTo(0.64, 1);
  });
});
