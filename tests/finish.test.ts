import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { Model } from '../src/core/Model';
import { autoFinish } from '../src/core/autoFinish';
import { FINISH_PRESETS, baseColorOf, materialOf, MATERIALS } from '../src/core/materials';
import { intersectProfiles } from '../src/core/profileSolid';

const preset = FINISH_PRESETS[0];

describe('材料', () => {
  it('ID は重複しない', () => {
    expect(new Set(MATERIALS.map((m) => m.id)).size).toBe(MATERIALS.length);
  });
  it('おまかせ仕上げの材料はすべて存在する', () => {
    for (const p of FINISH_PRESETS) for (const id of [p.wall, p.roof, p.flatRoof, p.opening, p.ground]) expect(materialOf('mat:' + id)).toBeDefined();
  });
  it('表示色', () => {
    expect(baseColorOf('mat:brick-red', '#000')).toBe('#a5583c');
    expect(baseColorOf('#123456', '#000')).toBe('#123456');
    expect(baseColorOf(undefined, '#000')).toBe('#000');
  });
});

describe('おまかせ仕上げ', () => {
  it('切妻の家: 壁・屋根に割り当て、底面はそのまま', async () => {
    const plan = [new Vector3(0, 0, 0), new Vector3(10, 0, 0), new Vector3(10, 0, -6), new Vector3(0, 0, -6)];
    const gable = [new Vector3(-1, 0, 2), new Vector3(-1, 0, -8), new Vector3(-1, 3, -8), new Vector3(-1, 5, -3), new Vector3(-1, 3, 2)];
    const r = (await intersectProfiles([
      { kind: 'plan', outline: plan },
      { kind: 'vertical', outline: gable, axis: new Vector3(0, 0, -1) },
    ]))!;
    const m = new Model();
    m.addPolyFacesAsGroup(r.points, r.faces, '家');
    expect(autoFinish(m, preset)).toBe(6);
    const kinds = [...m.faces.values()].map((f) => f.color);
    expect(kinds.filter((c) => c === 'mat:' + preset.wall).length).toBe(4);
    expect(kinds.filter((c) => c === 'mat:' + preset.roof).length).toBe(2);
    expect(kinds.filter((c) => c === undefined).length).toBe(1); // 底面
  });

  it('壁に押し込んだ窓の奥の面はガラスになる', () => {
    const m = new Model();
    // 壁: 4m × 0.3m × 3m
    const base = m.addFace([new Vector3(0, 0, 0), new Vector3(4, 0, 0), new Vector3(4, 0, -0.3), new Vector3(0, 0, -0.3)])!;
    m.pushPull(base, 3);
    // 南面（z=0）に窓を刻み込んで 0.1m 押し込む
    const win = m.addFace([new Vector3(1, 1, 0), new Vector3(2, 1, 0), new Vector3(2, 2, 0), new Vector3(1, 2, 0)])!;
    expect(m.faceNormal(win).z).toBeCloseTo(1);
    const back = m.pushPull(win, -0.1)!;
    autoFinish(m, preset);
    expect(m.faces.get(back)!.color).toBe('mat:' + preset.opening);
    // 壁の正面は外壁
    const front = [...m.faces.values()].find((f) => f.holes?.length)!;
    expect(front.color).toBe('mat:' + preset.wall);
  });
});

describe('材料の設定', () => {
  it('色を変える・戻す・自分の材料を作る・保存して読み直す', async () => {
    const mat = await import('../src/core/materials');
    mat.loadMaterialSettings(undefined);
    const before = mat.getMaterial('siding-white')!.color;
    mat.setMaterialOverride('siding-white', { color: '#123456', tile: 2.4 });
    expect(mat.getMaterial('siding-white')!.color).toBe('#123456');
    expect(mat.materialOf('mat:siding-white')!.tile).toBe(2.4);
    expect(mat.isMaterialModified('siding-white')).toBe(true);
    const c = mat.addCustomMaterial(mat.getMaterial('brick-red')!, 'うちのレンガ', '#884422');
    expect(mat.allMaterials().some((m) => m.id === c.id && m.custom)).toBe(true);
    const saved = JSON.parse(JSON.stringify(mat.materialSettings()));
    mat.loadMaterialSettings(undefined);
    expect(mat.getMaterial('siding-white')!.color).toBe(before);
    expect(mat.getMaterial(c.id)).toBeUndefined();
    mat.loadMaterialSettings(saved);
    expect(mat.getMaterial('siding-white')!.color).toBe('#123456');
    expect(mat.getMaterial(c.id)!.name).toBe('うちのレンガ');
    mat.resetMaterial('siding-white');
    expect(mat.getMaterial('siding-white')!.color).toBe(before);
    mat.loadMaterialSettings(undefined);
  });
  it('材料は 50 種類以上・分類はすべて決まった名前', async () => {
    const mat = await import('../src/core/materials');
    expect(mat.MATERIALS.length).toBeGreaterThanOrEqual(50);
    for (const m of mat.MATERIALS) expect(mat.MATERIAL_CATEGORIES).toContain(m.category);
  });
});
