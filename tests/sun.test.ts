import { describe, expect, it } from 'vitest';
import { jstDate, sunDirection, sunPosition } from '../src/core/sun';

describe('太陽の位置', () => {
  const tokyo = { lat: 35.6812, lon: 139.7671 };
  it('夏至の正午ごろは南中して高い', () => {
    // 東京の南中は 11:40 ごろ
    const p = sunPosition(jstDate(6, 21, 11, 40, 2026), tokyo.lat, tokyo.lon);
    expect(p.altitude).toBeGreaterThan(76);
    expect(p.altitude).toBeLessThan(79);
    expect(Math.abs(p.azimuth - 180)).toBeLessThan(5);
  });
  it('冬至の正午は低い（約 31°）', () => {
    const p = sunPosition(jstDate(12, 21, 11, 40, 2026), tokyo.lat, tokyo.lon);
    expect(p.altitude).toBeGreaterThan(29.5);
    expect(p.altitude).toBeLessThan(32);
  });
  it('朝は東、夕方は西', () => {
    expect(sunPosition(jstDate(3, 20, 8, 0, 2026), tokyo.lat, tokyo.lon).azimuth).toBeLessThan(130);
    expect(sunPosition(jstDate(3, 20, 16, 0, 2026), tokyo.lat, tokyo.lon).azimuth).toBeGreaterThan(230);
  });
  it('方向ベクトル: 南の太陽は +z（南）側', () => {
    const v = sunDirection(30, 180);
    expect(v.z).toBeGreaterThan(0);
    expect(v.y).toBeCloseTo(0.5);
    expect(sunDirection(0, 90).x).toBeCloseTo(1); // 東
  });
});
