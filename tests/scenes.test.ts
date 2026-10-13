import { describe, expect, it } from 'vitest';
import { Box3, Vector3 } from 'three';
import { recommendedViews } from '../src/view/Scenes';

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
  it('モデルが無ければ視点も無い', () => {
    expect(recommendedViews(new Box3())).toEqual([]);
  });
});
