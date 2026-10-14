import { describe, expect, it } from 'vitest';
import { Box3, Vector3 } from 'three';
import { PerspectiveCamera } from 'three';
import { fitDistance, recommendedViews, SceneManager } from '../src/view/Scenes';

describe('おすすめの視点', () => {
  const box = new Box3(new Vector3(0, 0, -6), new Vector3(10, 5, 0));
  const views = recommendedViews(box);
  it('4 つの視点ができる', () => {
    expect(views.map((v) => v.name)).toEqual(['鳥瞰（南東から）', '人の目線（南正面）', '鳥瞰（北西から）', '真上（配置）']);
  });
  it('鳥瞰は建物の外・上から中心を見る', () => {
    const [se] = views;
    expect(se.position[0]).toBeGreaterThan(10);
    expect(se.position[2]).toBeGreaterThan(0);
    expect(se.position[1]).toBeGreaterThan(5);
    expect(se.target).toEqual([5, 2.5, -3]);
  });
  it('人の目線は地面から 1.6m・建物の南側', () => {
    const eye = views[1];
    expect(eye.position[1]).toBeCloseTo(1.6);
    expect(eye.position[2]).toBeGreaterThan(0);
  });
  it('鳥瞰・真上では建物の隅がすべて画面に入り、大きく写る', () => {
    const long = new Box3(new Vector3(-24, 0, -8), new Vector3(24, 7, 8));
    for (const v of recommendedViews(long).filter((v) => v.name !== '人の目線（南正面）')) {
      const cam = new PerspectiveCamera(45, 16 / 9, 0.1, 1000);
      cam.position.set(...v.position);
      cam.lookAt(new Vector3(...v.target));
      cam.updateMatrixWorld();
      let maxX = 0;
      let maxY = 0;
      for (const x of [-24, 24]) for (const y of [0, 7]) for (const z of [-8, 8]) {
        const p = new Vector3(x, y, z).project(cam);
        maxX = Math.max(maxX, Math.abs(p.x));
        maxY = Math.max(maxY, Math.abs(p.y));
      }
      expect(Math.max(maxX, maxY)).toBeLessThanOrEqual(1);
      expect(Math.max(maxX, maxY)).toBeGreaterThan(0.8);
    }
  });
  it('fitDistance は箱が大きいほど遠い', () => {
    const d1 = fitDistance(new Box3(new Vector3(-1, 0, -1), new Vector3(1, 1, 1)), new Vector3(1, 1, 1), 45, 16 / 9);
    const d2 = fitDistance(new Box3(new Vector3(-10, 0, -10), new Vector3(10, 10, 10)), new Vector3(1, 1, 1), 45, 16 / 9);
    expect(d2).toBeGreaterThan(d1 * 5);
  });
  it('モデルが無ければ視点も無い', () => {
    expect(recommendedViews(new Box3())).toEqual([]);
  });
});

describe('視点ごとのレイヤー表示', () => {
  const fakeViewport = () => {
    const cam = { position: new Vector3(), }
    return {
      camera: cam,
      controls: { target: new Vector3(), update() {} },
      requestRender() {},
      onFrame() {},
    } as unknown as ConstructorParameters<typeof SceneManager>[0];
  };
  it('追加した時の非表示レイヤーを覚え、切り替えると戻す', async () => {
    let hidden: string[] = [];
    const m = new SceneManager(fakeViewport());
    m.layerState = { get: () => [...hidden], set: (h) => (hidden = [...h]) };
    const outside = m.add({ name: '外観', position: [10, 5, 10], target: [0, 0, 0] });
    hidden = ['屋根'];
    const inside = m.add({ name: '中', position: [10, 5, 10], target: [0, 0, 0] });
    expect(outside.hiddenLayers).toEqual([]);
    expect(inside.hiddenLayers).toEqual(['屋根']);
    await m.goTo(outside, false);
    expect(hidden).toEqual([]);
    await m.goTo(inside, false);
    expect(hidden).toEqual(['屋根']);
  });
});
