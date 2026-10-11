import { Vector3 } from 'three';
import { getZone, latLonToPlane, planeToLatLon, type LatLon } from './jprcs';

/**
 * 公共座標（平面直角座標系 X=北, Y=東, H=標高）と、
 * 3D ビュー内部のローカル座標（Three.js: x=東, y=上, z=南）を相互変換する。
 *
 * 公共座標は数万〜数十万 m の大きな値になるため、そのまま GPU に渡すと
 * float32 の精度不足で形状が崩れる。そこで「プロジェクト原点」を
 * 公共座標系上に置き、内部ではそこからの相対座標で扱う。
 */
export interface GeoReferenceData {
  /** 平面直角座標系の系番号（1〜19）。0 = 未設定 */
  zone: number;
  /** プロジェクト原点の公共座標 X（北, m） */
  originX: number;
  /** プロジェクト原点の公共座標 Y（東, m） */
  originY: number;
  /** プロジェクト原点の標高 H（m） */
  originH: number;
  /** 原点が明示的に設定されたか（未設定なら最初の公共座標データで自動設定） */
  originSet: boolean;
}

export interface PublicCoord {
  /** 北 (m) */
  X: number;
  /** 東 (m) */
  Y: number;
  /** 標高 (m) */
  H: number;
}

export class GeoReference {
  zone = 9;
  originX = 0;
  originY = 0;
  originH = 0;
  originSet = false;

  private listeners = new Set<() => void>();

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    for (const fn of this.listeners) fn();
  }

  get zoneInfo() {
    return this.zone > 0 ? getZone(this.zone) : null;
  }

  setZone(zone: number): void {
    this.zone = zone;
    this.emit();
  }

  setOrigin(X: number, Y: number, H: number): void {
    this.originX = X;
    this.originY = Y;
    this.originH = H;
    this.originSet = true;
    this.emit();
  }

  /**
   * 原点が未設定なら、与えた公共座標の近く（キリの良い値）に原点を置く。
   * 点群や図面を最初に読み込んだときに使う。
   */
  ensureOriginNear(p: PublicCoord): void {
    if (this.originSet) return;
    const round = (v: number, step: number) => Math.round(v / step) * step;
    this.setOrigin(round(p.X, 100), round(p.Y, 100), round(p.H, 1));
  }

  /** 公共座標 → ローカル（Three.js）座標 */
  toLocal(p: PublicCoord, target = new Vector3()): Vector3 {
    return target.set(p.Y - this.originY, p.H - this.originH, -(p.X - this.originX));
  }

  /** ローカル（Three.js）座標 → 公共座標 */
  toPublic(v: Vector3): PublicCoord {
    return {
      X: this.originX - v.z,
      Y: this.originY + v.x,
      H: this.originH + v.y,
    };
  }

  /** ローカル座標 → 緯度経度（系番号未設定なら null） */
  toLatLon(v: Vector3): LatLon | null {
    if (!this.zone) return null;
    const p = this.toPublic(v);
    return planeToLatLon(p.X, p.Y, this.zone);
  }

  /** 緯度経度 → ローカル座標 */
  fromLatLon(lat: number, lon: number, h = 0): Vector3 {
    const p = latLonToPlane(lat, lon, this.zone);
    return this.toLocal({ X: p.x, Y: p.y, H: h });
  }

  toJSON(): GeoReferenceData {
    return {
      zone: this.zone,
      originX: this.originX,
      originY: this.originY,
      originH: this.originH,
      originSet: this.originSet,
    };
  }

  load(d: Partial<GeoReferenceData>): void {
    this.zone = d.zone ?? 9;
    this.originX = d.originX ?? 0;
    this.originY = d.originY ?? 0;
    this.originH = d.originH ?? 0;
    this.originSet = d.originSet ?? false;
    this.emit();
  }
}
