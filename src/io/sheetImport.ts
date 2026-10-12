import type { GeoReference } from '../geo/GeoReference';
import type { SheetData, SheetView } from '../view/SheetManager';
import { VIEW_ANGLE } from '../view/SheetManager';
import type { Drawing2D } from './drawing2d';
import type { RasterResult } from './underlayLoader';

export interface SheetLineOptions {
  /** 図面単位 → m */
  unitToMeters: number;
  /** 読み込む画層 */
  layers: Set<string>;
  /** 平面図を公共座標（x=東, y=北）として配置する */
  georeferenced: boolean;
  /** 平面図を置く高さ（m） */
  elevation: number;
}

/**
 * 線の図面（DXF / SXF）を図面シートのデータにする。
 * 座標は図面の左下が 0 になるよう正規化し、その分を origin に持たせる
 * （公共座標の大きな値をそのまま GPU に送ると精度が落ちるため）。
 */
export function sheetFromDrawing(
  name: string,
  view: SheetView,
  d: Drawing2D,
  opt: SheetLineOptions,
  geo: GeoReference,
): SheetData {
  const u = opt.unitToMeters;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const paths = d.paths.filter((p) => opt.layers.has(p.layer));
  for (const p of paths)
    for (const [x, y] of p.points) {
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  if (!paths.length) throw new Error('選んだ画層に線がありません');
  const segments: number[] = [];
  for (const p of paths) {
    const n = p.points.length;
    const last = p.closed ? n : n - 1;
    for (let i = 0; i < last; i++) {
      const a = p.points[i];
      const b = p.points[(i + 1) % n];
      if (a[0] === b[0] && a[1] === b[1]) continue;
      segments.push((a[0] - minX) * u, (a[1] - minY) * u, (b[0] - minX) * u, (b[1] - minY) * u);
    }
  }
  let origin: [number, number, number] = [0, opt.elevation, 0];
  if (view === 'plan' && opt.georeferenced) {
    geo.ensureOriginNear({ X: ((minY + maxY) / 2) * u, Y: ((minX + maxX) / 2) * u, H: opt.elevation });
    const o = geo.toLocal({ X: minY * u, Y: minX * u, H: opt.elevation });
    origin = [o.x, o.y, o.z];
  }
  return {
    name,
    view,
    segments,
    width: (maxX - minX) * u,
    height: (maxY - minY) * u,
    scale: 1,
    origin,
    angle: (VIEW_ANGLE[view] * Math.PI) / 180,
    opacity: 1,
    visible: true,
  };
}

/** PDF・画像の図面シート。縮尺 1/N が分かれば用紙サイズから実寸にする */
export function sheetFromRaster(name: string, view: SheetView, r: RasterResult, scaleDenominator?: number): SheetData {
  // PDF は用紙サイズが分かる。画像は縮尺不明なので幅 20m で置き、あとで縮尺合わせ
  const mpp = r.paperMmPerPx && scaleDenominator ? (r.paperMmPerPx * scaleDenominator) / 1000 : 20 / r.widthPx;
  return {
    name,
    view,
    image: { dataUrl: r.dataUrl, widthPx: r.widthPx, heightPx: r.heightPx, metersPerPixel: mpp },
    width: r.widthPx * mpp,
    height: r.heightPx * mpp,
    scale: 1,
    origin: [0, 0, 0],
    angle: (VIEW_ANGLE[view] * Math.PI) / 180,
    opacity: 0.85,
    visible: true,
  };
}
