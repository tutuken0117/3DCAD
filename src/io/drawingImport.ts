import { Vector3 } from 'three';
import type { Model } from '../core/Model';
import type { GeoReference } from '../geo/GeoReference';
import { findClosedRegions, type Drawing2D } from './drawing2d';

export interface DrawingImportOptions {
  /** 図面単位 → m の倍率（mm なら 0.001） */
  unitToMeters: number;
  /** 図面座標を公共座標（x=東 Y, y=北 X）として扱う */
  georeferenced: boolean;
  /** 配置する高さ（標高, m） */
  elevation: number;
  /** 読み込む画層 */
  layers: Set<string>;
  /** 閉じた領域に面を張る画層 */
  faceLayers: Set<string>;
}

export interface DrawingImportResult {
  edges: number;
  faces: number;
  /** 作成された面 ID（画層ごと） */
  facesByLayer: Map<string, number[]>;
}

/**
 * 2D 図面をモデルに取り込む。
 * 画層はそのままモデルのレイヤー（タグ）になり、
 * 面を張った画層は「レイヤー押し出し」で一括して立体化できる。
 */
export function importDrawing(
  model: Model,
  geo: GeoReference,
  drawing: Drawing2D,
  opt: DrawingImportOptions,
): DrawingImportResult {
  const u = opt.unitToMeters;
  const minE = drawing.min[0] * u;
  const minN = drawing.min[1] * u;
  if (opt.georeferenced) {
    geo.ensureOriginNear({
      X: ((drawing.min[1] + drawing.max[1]) / 2) * u,
      Y: ((drawing.min[0] + drawing.max[0]) / 2) * u,
      H: opt.elevation,
    });
  }
  const toLocal = (x: number, y: number): Vector3 => {
    const e = x * u;
    const n = y * u;
    if (opt.georeferenced) return geo.toLocal({ X: n, Y: e, H: opt.elevation });
    return new Vector3(e - minE, opt.elevation, -(n - minN));
  };

  const result: DrawingImportResult = { edges: 0, faces: 0, facesByLayer: new Map() };
  const byLayer = new Map<string, typeof drawing.paths>();
  for (const p of drawing.paths) {
    if (!opt.layers.has(p.layer)) continue;
    const arr = byLayer.get(p.layer);
    if (arr) arr.push(p);
    else byLayer.set(p.layer, [p]);
  }
  const colorOf = new Map(drawing.layers.map((l) => [l.name, l.color]));

  for (const [layer, paths] of byLayer) {
    model.ensureLayer(layer);
    const segs: [[number, number], [number, number]][] = [];
    for (const p of paths) {
      const n = p.points.length;
      const last = p.closed ? n : n - 1;
      for (let i = 0; i < last; i++) segs.push([p.points[i], p.points[(i + 1) % n]]);
    }
    if (opt.faceLayers.has(layer)) {
      // 交点で分割した線分をエッジにし、閉じた領域に面を張る
      const tol = 1e-4 / u;
      const { regions, segments } = findClosedRegions(segs, tol);
      for (const [a, b] of segments) {
        const va = model.addVertex(toLocal(a[0], a[1]));
        const vb = model.addVertex(toLocal(b[0], b[1]));
        if (va !== vb) (model.addEdge(va, vb, layer), result.edges++);
      }
      const ids: number[] = [];
      for (const r of regions) {
        const id = model.addFace(
          r.map(([x, y]) => toLocal(x, y)),
          layer,
        );
        if (id === undefined) continue;
        if (model.faceNormal(id).y < 0) model.reverseFace(id);
        ids.push(id);
      }
      result.faces += ids.length;
      result.facesByLayer.set(layer, ids);
    } else {
      for (const [a, b] of segs) {
        const va = model.addVertex(toLocal(a[0], a[1]));
        const vb = model.addVertex(toLocal(b[0], b[1]));
        if (va !== vb) (model.addEdge(va, vb, layer), result.edges++);
      }
    }
    const l = model.layers.get(layer);
    const c = colorOf.get(layer);
    if (l && c && c !== '#333333' && c !== '#000000') l.color = lighten(c);
  }
  return result;
}

/** 線の色をそのまま面の色にすると濃すぎるので明るくする */
function lighten(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const mix = (v: number) => Math.round(v + (255 - v) * 0.55);
  const r = mix((n >> 16) & 255);
  const g = mix((n >> 8) & 255);
  const b = mix(n & 255);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

/** 指定レイヤーの面をすべて同じ高さで押し出す */
export function extrudeLayer(model: Model, layer: string, height: number): number {
  const ids = [...model.faces.values()]
    .filter((f) => f.layer === layer && Math.abs(model.faceNormal(f).y) > 0.999)
    .map((f) => f.id);
  // 隣り合う面があっても、それぞれ底面を残した独立した立体として押し出す
  let n = 0;
  for (const id of ids) {
    if (!model.faces.has(id)) continue;
    const normal = model.faceNormal(id);
    model.pushPull(id, normal.y > 0 ? height : -height, { keepBase: true });
    n++;
  }
  return n;
}
