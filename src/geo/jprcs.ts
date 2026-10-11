/**
 * 平面直角座標系（JGD2011 / JGD2000, GRS80 楕円体）の順変換・逆変換。
 *
 * ガウス・クリューゲル図法を Krüger 級数（n の 5 次まで）で計算する。
 * 国土地理院の計算式（河瀬 2011）と同じ方式で、系内ではサブミリの精度。
 *
 * 座標の向きは測量の慣例に従う:
 *   X = 北方向（m）, Y = 東方向（m）
 */

const A_GRS80 = 6378137.0;
const F_GRS80 = 1 / 298.257222101;
const M0 = 0.9999;

const DEG = Math.PI / 180;

export interface ZoneOrigin {
  zone: number;
  /** 原点緯度（度） */
  lat: number;
  /** 原点経度（度） */
  lon: number;
  /** 適用区域の概要 */
  area: string;
  /** JGD2011 の EPSG コード */
  epsg: number;
}

const dms = (d: number, m = 0, s = 0) => d + m / 60 + s / 3600;

/** 平面直角座標系 第1〜19系の原点 */
export const ZONES: ZoneOrigin[] = [
  { zone: 1, lat: 33, lon: dms(129, 30), area: '長崎県、鹿児島県の一部', epsg: 6669 },
  { zone: 2, lat: 33, lon: 131, area: '福岡県、佐賀県、熊本県、大分県、宮崎県、鹿児島県の一部', epsg: 6670 },
  { zone: 3, lat: 36, lon: dms(132, 10), area: '山口県、島根県、広島県', epsg: 6671 },
  { zone: 4, lat: 33, lon: dms(133, 30), area: '香川県、愛媛県、徳島県、高知県', epsg: 6672 },
  { zone: 5, lat: 36, lon: dms(134, 20), area: '兵庫県、鳥取県、岡山県', epsg: 6673 },
  { zone: 6, lat: 36, lon: 136, area: '京都府、大阪府、福井県、滋賀県、三重県、奈良県、和歌山県', epsg: 6674 },
  { zone: 7, lat: 36, lon: dms(137, 10), area: '石川県、富山県、岐阜県、愛知県', epsg: 6675 },
  { zone: 8, lat: 36, lon: dms(138, 30), area: '新潟県、長野県、山梨県、静岡県', epsg: 6676 },
  { zone: 9, lat: 36, lon: dms(139, 50), area: '東京都（島嶼部除く）、福島県、栃木県、茨城県、埼玉県、千葉県、群馬県、神奈川県', epsg: 6677 },
  { zone: 10, lat: 40, lon: dms(140, 50), area: '青森県、秋田県、山形県、岩手県、宮城県', epsg: 6678 },
  { zone: 11, lat: 44, lon: dms(140, 15), area: '北海道（西部）', epsg: 6679 },
  { zone: 12, lat: 44, lon: dms(142, 15), area: '北海道（中部）', epsg: 6680 },
  { zone: 13, lat: 44, lon: dms(144, 15), area: '北海道（東部）', epsg: 6681 },
  { zone: 14, lat: 26, lon: 142, area: '東京都（小笠原）', epsg: 6682 },
  { zone: 15, lat: 26, lon: dms(127, 30), area: '沖縄県（沖縄本島周辺）', epsg: 6683 },
  { zone: 16, lat: 26, lon: 124, area: '沖縄県（先島諸島）', epsg: 6684 },
  { zone: 17, lat: 26, lon: 131, area: '沖縄県（大東島）', epsg: 6685 },
  { zone: 18, lat: 20, lon: 136, area: '東京都（沖ノ鳥島）', epsg: 6686 },
  { zone: 19, lat: 26, lon: 154, area: '東京都（南鳥島）', epsg: 6687 },
];

export function getZone(zone: number): ZoneOrigin {
  const z = ZONES.find((o) => o.zone === zone);
  if (!z) throw new Error(`平面直角座標系の系番号が不正です: ${zone}`);
  return z;
}

// ---- Krüger 級数の係数 ----
const n = F_GRS80 / (2 - F_GRS80);
const n2 = n * n;
const n3 = n2 * n;
const n4 = n3 * n;
const n5 = n4 * n;

/** 子午線弧長の係数 Ā (m0 を掛ける前) */
const A_BAR = (A_GRS80 / (1 + n)) * (1 + n2 / 4 + n4 / 64);

const ALPHA = [
  0,
  n / 2 - (2 / 3) * n2 + (5 / 16) * n3 + (41 / 180) * n4 - (127 / 288) * n5,
  (13 / 48) * n2 - (3 / 5) * n3 + (557 / 1440) * n4 + (281 / 630) * n5,
  (61 / 240) * n3 - (103 / 140) * n4 + (15061 / 26880) * n5,
  (49561 / 161280) * n4 - (179 / 168) * n5,
  (34729 / 80640) * n5,
];

const BETA = [
  0,
  n / 2 - (2 / 3) * n2 + (37 / 96) * n3 - (1 / 360) * n4 - (81 / 512) * n5,
  (1 / 48) * n2 + (1 / 15) * n3 - (437 / 1440) * n4 + (46 / 105) * n5,
  (17 / 480) * n3 - (37 / 840) * n4 - (209 / 4480) * n5,
  (4397 / 161280) * n4 - (11 / 504) * n5,
  (4583 / 161280) * n5,
];

const DELTA = [
  0,
  2 * n - (2 / 3) * n2 - 2 * n3 + (116 / 45) * n4 + (26 / 45) * n5,
  (7 / 3) * n2 - (8 / 5) * n3 - (227 / 45) * n4 + (2704 / 315) * n5,
  (56 / 15) * n3 - (136 / 35) * n4 - (1262 / 105) * n5,
  (4279 / 630) * n4 - (332 / 35) * n5,
  (4174 / 315) * n5,
];

const SQRT_N_TERM = (2 * Math.sqrt(n)) / (1 + n);

/** 等角緯度に相当する補助量 t を求める */
function conformalT(phi: number): number {
  const s = Math.sin(phi);
  return Math.sinh(Math.atanh(s) - SQRT_N_TERM * Math.atanh(SQRT_N_TERM * s));
}

/** 原点緯度 phi0 までの子午線弧長 × m0 */
function meridianArc(phi0: number): number {
  const xi = Math.atan(conformalT(phi0));
  let sum = xi;
  for (let j = 1; j <= 5; j++) sum += ALPHA[j] * Math.sin(2 * j * xi);
  return M0 * A_BAR * sum;
}

export interface PlaneXY {
  /** 北方向 (m) */
  x: number;
  /** 東方向 (m) */
  y: number;
}

export interface LatLon {
  /** 緯度（度） */
  lat: number;
  /** 経度（度） */
  lon: number;
}

/** 緯度経度 → 平面直角座標 */
export function latLonToPlane(lat: number, lon: number, zone: number): PlaneXY {
  const o = getZone(zone);
  const phi = lat * DEG;
  const dl = (lon - o.lon) * DEG;
  const t = conformalT(phi);
  const tb = Math.sqrt(1 + t * t);
  const xi = Math.atan(t / Math.cos(dl));
  const eta = Math.atanh(Math.sin(dl) / tb);

  let sx = xi;
  let sy = eta;
  for (let j = 1; j <= 5; j++) {
    sx += ALPHA[j] * Math.sin(2 * j * xi) * Math.cosh(2 * j * eta);
    sy += ALPHA[j] * Math.cos(2 * j * xi) * Math.sinh(2 * j * eta);
  }
  return {
    x: M0 * A_BAR * sx - meridianArc(o.lat * DEG),
    y: M0 * A_BAR * sy,
  };
}

/** 平面直角座標 → 緯度経度 */
export function planeToLatLon(x: number, y: number, zone: number): LatLon {
  const o = getZone(zone);
  const xi = (x + meridianArc(o.lat * DEG)) / (M0 * A_BAR);
  const eta = y / (M0 * A_BAR);

  let xi2 = xi;
  let eta2 = eta;
  for (let j = 1; j <= 5; j++) {
    xi2 -= BETA[j] * Math.sin(2 * j * xi) * Math.cosh(2 * j * eta);
    eta2 -= BETA[j] * Math.cos(2 * j * xi) * Math.sinh(2 * j * eta);
  }
  const chi = Math.asin(Math.sin(xi2) / Math.cosh(eta2));
  let phi = chi;
  for (let j = 1; j <= 5; j++) phi += DELTA[j] * Math.sin(2 * j * chi);
  const lambda = o.lon * DEG + Math.atan(Math.sinh(eta2) / Math.cos(xi2));
  return { lat: phi / DEG, lon: lambda / DEG };
}

/** 度 → 度分秒の文字列 */
export function formatDms(deg: number): string {
  const sign = deg < 0 ? '-' : '';
  let v = Math.abs(deg);
  const d = Math.floor(v);
  v = (v - d) * 60;
  const m = Math.floor(v);
  const s = (v - m) * 60;
  return `${sign}${d}°${String(m).padStart(2, '0')}′${s.toFixed(4).padStart(7, '0')}″`;
}
