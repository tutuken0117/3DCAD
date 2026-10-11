import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { latLonToPlane, planeToLatLon, ZONES } from '../src/geo/jprcs';
import { GeoReference } from '../src/geo/GeoReference';

describe('平面直角座標系', () => {
  it('原点は (0, 0) になる', () => {
    for (const z of ZONES) {
      const p = latLonToPlane(z.lat, z.lon, z.zone);
      expect(Math.abs(p.x)).toBeLessThan(1e-6);
      expect(Math.abs(p.y)).toBeLessThan(1e-6);
    }
  });

  it('PROJ (EPSG:6668 → 6669〜6687) の結果と 1mm 以内で一致する', () => {
    // 参照値は pyproj 3 で計算したもの
    const cases = [
      [36 + 6 / 60 + 13.58 / 3600, 140 + 5 / 60 + 14.58 / 3600, 9, 11543.292172, 22873.773246],
      [35.681236, 139.767125, 9, -35363.237745, -5992.91957],
      [43.068661, 141.350755, 12, -103071.878681, -73236.492542],
      [26.212401, 127.680932, 15, 23542.082737, 18080.009465],
      [34.702485, 135.495951, 6, -143825.41402, -46175.230131],
    ] as const;
    for (const [lat, lon, zone, x, y] of cases) {
      const p = latLonToPlane(lat, lon, zone);
      expect(Math.abs(p.x - x)).toBeLessThan(0.001);
      expect(Math.abs(p.y - y)).toBeLessThan(0.001);
    }
  });

  it('順変換と逆変換が往復で一致する', () => {
    const cases = [
      [35.681236, 139.767125, 9],
      [43.068661, 141.350755, 12],
      [26.212401, 127.680932, 15],
      [34.702485, 135.495951, 6],
    ] as const;
    for (const [lat, lon, zone] of cases) {
      const p = latLonToPlane(lat, lon, zone);
      const back = planeToLatLon(p.x, p.y, zone);
      expect(back.lat).toBeCloseTo(lat, 9);
      expect(back.lon).toBeCloseTo(lon, 9);
    }
  });
});

describe('GeoReference', () => {
  it('公共座標 ⇔ ローカル座標', () => {
    const g = new GeoReference();
    g.setOrigin(-35000, 12000, 10);
    const local = g.toLocal({ X: -34990, Y: 12005, H: 12 });
    expect(local.toArray()).toEqual([5, 2, -10]);
    const pub = g.toPublic(new Vector3(5, 2, -10));
    expect(pub).toEqual({ X: -34990, Y: 12005, H: 12 });
  });

  it('未設定の原点はキリの良い値で自動設定される', () => {
    const g = new GeoReference();
    g.ensureOriginNear({ X: -35123.4, Y: 12049.9, H: 15.6 });
    expect([g.originX, g.originY, g.originH]).toEqual([-35100, 12000, 16]);
    g.ensureOriginNear({ X: 0, Y: 0, H: 0 });
    expect(g.originX).toBe(-35100);
  });
});
