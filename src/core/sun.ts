import { Vector3 } from 'three';

/**
 * 太陽の位置（簡略化した天文計算。精度は 0.1° 程度で、日影の検討には十分）。
 * azimuth: 真北から時計回り（度）、altitude: 地平線からの高さ（度）
 */
export function sunPosition(date: Date, lat: number, lon: number): { altitude: number; azimuth: number } {
  const rad = Math.PI / 180;
  const d = date.getTime() / 86400000 - 10957.5; // J2000.0 からの日数
  const g = (357.529 + 0.98560028 * d) * rad;
  const q = 280.459 + 0.98564736 * d;
  const L = (q + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * rad;
  const e = (23.439 - 0.00000036 * d) * rad;
  const ra = Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L));
  const dec = Math.asin(Math.sin(e) * Math.sin(L));
  const gmst = (18.697374558 + 24.06570982441908 * d) % 24;
  const H = (gmst * 15 + lon) * rad - ra;
  const phi = lat * rad;
  const alt = Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H));
  let az = Math.atan2(-Math.sin(H), Math.tan(dec) * Math.cos(phi) - Math.sin(phi) * Math.cos(H)) / rad;
  if (az < 0) az += 360;
  return { altitude: alt / rad, azimuth: az };
}

/** 日本時間の月日・時刻 → Date（年は今年） */
export function jstDate(month: number, day: number, hour: number, minute = 0, year = new Date().getFullYear()): Date {
  return new Date(Date.UTC(year, month - 1, day, hour - 9, minute));
}

/** 太陽の方向（ローカル座標: +x=東, +y=上, -z=北 の単位ベクトル。太陽に向かう向き） */
export function sunDirection(altitude: number, azimuth: number): Vector3 {
  const a = (altitude * Math.PI) / 180;
  const z = (azimuth * Math.PI) / 180;
  return new Vector3(Math.sin(z) * Math.cos(a), Math.sin(a), -Math.cos(z) * Math.cos(a));
}
