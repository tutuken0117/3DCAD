import {
  BufferGeometry,
  Color,
  Float32BufferAttribute,
  Points,
  PointsMaterial,
  SRGBColorSpace,
  type Raycaster,
  Vector3,
} from 'three';
import type { GeoReference } from '../geo/GeoReference';
import type { RawPointCloud } from '../io/pointcloud';
import type { Viewport } from './Viewport';

export type PointColorMode = 'rgb' | 'elevation' | 'intensity' | 'single';

/** ファイル座標の並び */
export type AxisOrder =
  /** x=東, y=北（LAS・GIS の標準） */
  | 'EN'
  /** x=北, y=東（測量の X・Y の順） */
  | 'NE';

export interface PointCloudImportOptions {
  /** 公共座標（平面直角座標）として扱う */
  georeferenced: boolean;
  axisOrder: AxisOrder;
}

export interface PointCloudEntry {
  id: number;
  name: string;
  raw: RawPointCloud;
  points: Points;
  /** 間引き表示用（スナップ判定に使う） */
  pickPoints: Points;
  options: PointCloudImportOptions;
  /** 公共座標で扱わない場合の基準点（この点をローカル原点に置く） */
  localBase: { X: number; Y: number; H: number };
  colorMode: PointColorMode;
}

const PICK_MAX = 400_000;

/** 点群の表示とスナップ用の検索 */
export class PointCloudManager {
  readonly clouds: PointCloudEntry[] = [];
  pointSize = 2;
  private nextId = 1;
  private listeners = new Set<() => void>();

  constructor(
    private viewport: Viewport,
    private geo: GeoReference,
  ) {
    // 原点を変更したら全点群を再配置
    geo.onChange(() => this.clouds.forEach((c) => this.rebuildPositions(c)));
  }

  onChange(fn: () => void): void {
    this.listeners.add(fn);
  }

  private emit(): void {
    for (const fn of this.listeners) fn();
    this.viewport.requestRender();
  }

  /** ファイル座標 → 公共座標 */
  private toPublic(e: PointCloudEntry, x: number, y: number, z: number) {
    return e.options.axisOrder === 'EN' ? { X: y, Y: x, H: z } : { X: x, Y: y, H: z };
  }

  add(name: string, raw: RawPointCloud, options: PointCloudImportOptions): PointCloudEntry {
    const mat = new PointsMaterial({ size: this.pointSize, sizeAttenuation: false, vertexColors: true });
    const points = new Points(new BufferGeometry(), mat);
    points.name = name;
    const pickPoints = new Points(new BufferGeometry(), mat);
    pickPoints.visible = false;
    const entry: PointCloudEntry = {
      id: this.nextId++,
      name,
      raw,
      points,
      pickPoints,
      options,
      localBase: { X: 0, Y: 0, H: 0 },
      colorMode: raw.colors ? 'rgb' : 'elevation',
    };
    const base = this.toPublic(entry, (raw.min[0] + raw.max[0]) / 2, (raw.min[1] + raw.max[1]) / 2, raw.min[2]);
    if (options.georeferenced) {
      this.geo.ensureOriginNear(base);
    } else {
      // ローカル座標: 点群の底面中央をモデルの原点に置く
      entry.localBase = base;
    }
    this.clouds.push(entry);
    this.viewport.pointCloudRoot.add(points, pickPoints);
    this.rebuildPositions(entry);
    this.rebuildColors(entry);
    this.emit();
    return entry;
  }

  private rebuildPositions(e: PointCloudEntry): void {
    const { raw } = e;
    const pos = new Float32Array(raw.count * 3);
    const v = new Vector3();
    for (let i = 0; i < raw.count; i++) {
      const x = raw.positions[i * 3];
      const y = raw.positions[i * 3 + 1];
      const z = raw.positions[i * 3 + 2];
      const p = this.toPublic(e, x, y, z);
      if (e.options.georeferenced) {
        this.geo.toLocal(p, v);
      } else {
        const b = e.localBase;
        v.set(p.Y - b.Y, p.H - b.H, -(p.X - b.X));
      }
      pos[i * 3] = v.x;
      pos[i * 3 + 1] = v.y;
      pos[i * 3 + 2] = v.z;
    }
    e.points.geometry.setAttribute('position', new Float32BufferAttribute(pos, 3));
    e.points.geometry.computeBoundingSphere();
    e.points.geometry.computeBoundingBox();

    const step = Math.max(1, Math.ceil(raw.count / PICK_MAX));
    const pick = new Float32Array(Math.ceil(raw.count / step) * 3);
    for (let i = 0, j = 0; i < raw.count; i += step, j++) {
      pick[j * 3] = pos[i * 3];
      pick[j * 3 + 1] = pos[i * 3 + 1];
      pick[j * 3 + 2] = pos[i * 3 + 2];
    }
    e.pickPoints.geometry.setAttribute('position', new Float32BufferAttribute(pick, 3));
    e.pickPoints.geometry.computeBoundingSphere();
    this.viewport.requestRender();
  }

  setColorMode(e: PointCloudEntry, mode: PointColorMode): void {
    e.colorMode = mode;
    this.rebuildColors(e);
    this.emit();
  }

  private rebuildColors(e: PointCloudEntry): void {
    const { raw } = e;
    const col = new Float32Array(raw.count * 3);
    const c = new Color();
    const zMin = raw.min[2];
    const zRange = raw.max[2] - raw.min[2] || 1;
    // RGB が無い点群は標高で色分け
    const mode = e.colorMode === 'rgb' && !raw.colors ? 'elevation' : e.colorMode;
    for (let i = 0; i < raw.count; i++) {
      switch (mode) {
        case 'rgb':
          c.setRGB(raw.colors![i * 3], raw.colors![i * 3 + 1], raw.colors![i * 3 + 2], SRGBColorSpace);
          break;
        case 'elevation': {
          const t = (raw.positions[i * 3 + 2] - zMin) / zRange;
          c.setHSL(0.66 * (1 - t), 0.85, 0.5);
          break;
        }
        case 'intensity': {
          const t = raw.intensity ? raw.intensity[i] : 0.7;
          c.setRGB(t, t, t, SRGBColorSpace);
          break;
        }
        case 'single':
          c.set('#5a6b7d');
          break;
      }
      col[i * 3] = c.r;
      col[i * 3 + 1] = c.g;
      col[i * 3 + 2] = c.b;
    }
    e.points.geometry.setAttribute('color', new Float32BufferAttribute(col, 3));
    this.viewport.requestRender();
  }

  setPointSize(size: number): void {
    this.pointSize = size;
    for (const c of this.clouds) (c.points.material as PointsMaterial).size = size;
    this.viewport.requestRender();
  }

  setVisible(e: PointCloudEntry, visible: boolean): void {
    e.points.visible = visible;
    this.emit();
  }

  remove(e: PointCloudEntry): void {
    const i = this.clouds.indexOf(e);
    if (i < 0) return;
    this.clouds.splice(i, 1);
    this.viewport.pointCloudRoot.remove(e.points, e.pickPoints);
    e.points.geometry.dispose();
    e.pickPoints.geometry.dispose();
    this.emit();
  }

  /** レイに最も近い点（threshold はワールド単位） */
  pick(rc: Raycaster, threshold: number): Vector3 | null {
    const visible = this.clouds.filter((c) => c.points.visible);
    if (!visible.length) return null;
    rc.params.Points = { threshold };
    let best: { d: number; p: Vector3 } | null = null;
    for (const c of visible) {
      c.pickPoints.visible = true;
      const hits = rc.intersectObject(c.pickPoints, false);
      c.pickPoints.visible = false;
      const pos = c.pickPoints.geometry.getAttribute('position');
      for (const h of hits) {
        if (h.index == null) continue;
        // レイからの距離が小さく、手前のものを優先
        const score = h.distance + (h.distanceToRay ?? 0) * 50;
        if (!best || score < best.d) best = { d: score, p: new Vector3().fromBufferAttribute(pos, h.index) };
      }
    }
    return best?.p ?? null;
  }

  /** 全点群の範囲（ローカル座標） */
  boundingBoxes() {
    return this.clouds.filter((c) => c.points.visible).map((c) => c.points.geometry.boundingBox!);
  }
}
