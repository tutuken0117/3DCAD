import {
  Box3,
  BufferGeometry,
  CanvasTexture,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  LineBasicMaterial,
  LineSegments,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  type Ray,
  SRGBColorSpace,
  Vector3,
} from 'three';
import { findClosedRegions } from '../io/drawing2d';
import type { Viewport } from './Viewport';

/** 図面の種類と、3D 空間での向き */
export type SheetView = 'plan' | 'south' | 'north' | 'east' | 'west' | 'section';

export const VIEW_LABEL: Record<SheetView, string> = {
  plan: '平面図',
  south: '立面図（南）',
  north: '立面図（北）',
  east: '立面図（東）',
  west: '立面図（西）',
  section: '断面図',
};

/** 立面図の右方向（上から見た角度, 度）。南立面は右=東、東立面は右=北 … */
export const VIEW_ANGLE: Record<SheetView, number> = {
  plan: 0,
  south: 0,
  east: 90,
  north: 180,
  west: 270,
  section: 0,
};

const VIEW_COLOR: Record<SheetView, string> = {
  plan: '#1f5fbf',
  south: '#b0451f',
  north: '#b0451f',
  east: '#b0451f',
  west: '#b0451f',
  section: '#7a2fb0',
};

export interface SheetImage {
  dataUrl: string;
  widthPx: number;
  heightPx: number;
  /** 1 ピクセルの図面上の長さ (m, scale=1 のとき) */
  metersPerPixel: number;
}

export interface SheetData {
  name: string;
  view: SheetView;
  /** 線分 [u1, v1, u2, v2, …]（m。図面の左下が 0 になるよう正規化） */
  segments?: number[];
  image?: SheetImage;
  /** 図面の大きさ (m, scale=1) */
  width: number;
  height: number;
  /** 縮尺補正の倍率（縮尺合わせで変わる） */
  scale: number;
  /** 図面の (0,0) が置かれるローカル座標 */
  origin: [number, number, number];
  /** 図面の右方向の向き（上から見て反時計回り, ラジアン） */
  angle: number;
  opacity: number;
  visible: boolean;
}

export interface Sheet extends SheetData {
  id: number;
  group: Group;
  lines?: LineSegments;
  mesh?: Mesh;
  regions?: { regions: [number, number][][]; outers: [number, number][][] };
}

export interface SheetHit {
  sheet: Sheet;
  point: Vector3;
  uv: [number, number];
  distance: number;
}

export const isVertical = (s: { view: SheetView }) => s.view !== 'plan';

/**
 * 図面シート: 平面図は地面に水平に、立面図・断面図は鉛直に立てて 3D 空間に配置する。
 * 線（DXF/SXF）にはスナップでき、外形をクリックして立体化に使える。
 * PDF・画像は下図として表示し、なぞって作図する。
 */
export class SheetManager {
  readonly items: Sheet[] = [];
  private nextId = 1;
  private listeners = new Set<() => void>();
  private segCache: [Vector3, Vector3, Vector3][] | null = null;

  constructor(private viewport: Viewport) {}

  onChange(fn: () => void): void {
    this.listeners.add(fn);
  }

  private emit(): void {
    this.segCache = null;
    for (const fn of this.listeners) fn();
    this.viewport.requestRender();
  }

  // ------------------------------------------------------------------
  // 座標
  // ------------------------------------------------------------------

  /** 図面の右方向（ローカル座標の単位ベクトル） */
  axisU(s: SheetData): Vector3 {
    return new Vector3(Math.cos(s.angle), 0, -Math.sin(s.angle));
  }

  /** 図面の上方向（平面図は北、立面図は鉛直上） */
  axisV(s: SheetData): Vector3 {
    return isVertical(s) ? new Vector3(0, 1, 0) : new Vector3(-Math.sin(s.angle), 0, -Math.cos(s.angle));
  }

  /** 図面の表側の向き（平面図は上、立面図は見る人の側） */
  normal(s: SheetData): Vector3 {
    return this.axisU(s).cross(this.axisV(s)).normalize();
  }

  toWorld(s: SheetData, u: number, v: number): Vector3 {
    return new Vector3(...s.origin).addScaledVector(this.axisU(s), u * s.scale).addScaledVector(this.axisV(s), v * s.scale);
  }

  toSheet(s: SheetData, p: Vector3): [number, number] {
    const d = p.clone().sub(new Vector3(...s.origin));
    return [d.dot(this.axisU(s)) / s.scale, d.dot(this.axisV(s)) / s.scale];
  }

  // ------------------------------------------------------------------
  // 追加・表示
  // ------------------------------------------------------------------

  async add(data: SheetData): Promise<Sheet> {
    const group = new Group();
    group.matrixAutoUpdate = false;
    const s: Sheet = { ...data, id: this.nextId++, group };
    if (data.image) {
      const img = new Image();
      img.src = data.image.dataUrl;
      await img.decode();
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      canvas.getContext('2d')!.drawImage(img, 0, 0);
      const tex = new CanvasTexture(canvas);
      tex.colorSpace = SRGBColorSpace;
      tex.anisotropy = this.viewport.renderer.capabilities.getMaxAnisotropy();
      const w = data.image.widthPx * data.image.metersPerPixel;
      const h = data.image.heightPx * data.image.metersPerPixel;
      const geo = new PlaneGeometry(w, h).translate(w / 2, h / 2, -0.002);
      s.mesh = new Mesh(
        geo,
        new MeshBasicMaterial({ map: tex, transparent: true, side: DoubleSide, depthWrite: false }),
      );
      s.mesh.renderOrder = -1;
      group.add(s.mesh);
    }
    if (data.segments?.length) {
      const pos: number[] = [];
      const seg = data.segments;
      for (let i = 0; i < seg.length; i += 4) pos.push(seg[i], seg[i + 1], 0.002, seg[i + 2], seg[i + 3], 0.002);
      const g = new BufferGeometry();
      g.setAttribute('position', new Float32BufferAttribute(pos, 3));
      s.lines = new LineSegments(g, new LineBasicMaterial({ color: new Color(VIEW_COLOR[data.view]), transparent: true }));
      group.add(s.lines);
    }
    this.items.push(s);
    this.viewport.underlayRoot.add(group);
    this.apply(s);
    return s;
  }

  /** パラメータを表示に反映 */
  apply(s: Sheet): void {
    const U = this.axisU(s).multiplyScalar(s.scale);
    const V = this.axisV(s).multiplyScalar(s.scale);
    const N = this.normal(s).multiplyScalar(s.scale);
    s.group.matrix.copy(new Matrix4().makeBasis(U, V, N).setPosition(...s.origin));
    s.group.matrixWorldNeedsUpdate = true;
    s.group.visible = s.visible;
    if (s.mesh) (s.mesh.material as MeshBasicMaterial).opacity = s.opacity;
    if (s.lines) {
      const m = s.lines.material as LineBasicMaterial;
      m.color.set(VIEW_COLOR[s.view]);
      m.opacity = Math.max(0.35, s.opacity);
    }
    this.emit();
  }

  remove(s: Sheet): void {
    const i = this.items.indexOf(s);
    if (i < 0) return;
    this.items.splice(i, 1);
    this.viewport.underlayRoot.remove(s.group);
    s.group.traverse((o) => {
      const any = o as Mesh;
      any.geometry?.dispose();
      const mat = any.material as MeshBasicMaterial | undefined;
      mat?.map?.dispose();
      mat?.dispose();
    });
    this.emit();
  }

  /** 図面の 4 隅（ローカル座標） */
  corners(s: SheetData): Vector3[] {
    return [
      this.toWorld(s, 0, 0),
      this.toWorld(s, s.width, 0),
      this.toWorld(s, s.width, s.height),
      this.toWorld(s, 0, s.height),
    ];
  }

  boundingBox(filter: (s: Sheet) => boolean = (s) => s.visible): Box3 {
    const box = new Box3();
    for (const s of this.items) if (filter(s)) for (const c of this.corners(s)) box.expandByPoint(c);
    return box;
  }

  /**
   * 立面図・断面図を、建物（ref の範囲）に合わせて初期配置する。
   * 横方向は建物の中央に合わせ、図面の一番下（地盤線）を高さ 0 に置く。
   * 立面図は建物の外側（見る人の側）に、断面図は建物の中央に立てる。
   */
  autoPlace(s: SheetData, ref: Box3): void {
    if (s.view === 'plan') return;
    const U = this.axisU(s);
    const N = this.normal(s);
    if (ref.isEmpty()) {
      const o = U.clone().multiplyScalar((-s.width * s.scale) / 2);
      s.origin = [o.x, 0, o.z];
      return;
    }
    const center = ref.getCenter(new Vector3());
    const pts: Vector3[] = [];
    for (const x of [ref.min.x, ref.max.x]) for (const z of [ref.min.z, ref.max.z]) pts.push(new Vector3(x, 0, z));
    const d = s.view === 'section' ? center.dot(N) : Math.max(...pts.map((p) => p.dot(N))) + 2;
    const o = U.clone()
      .multiplyScalar(center.dot(U) - (s.width * s.scale) / 2)
      .addScaledVector(N, d);
    s.origin = [o.x, ref.min.y, o.z];
  }

  // ------------------------------------------------------------------
  // 調整
  // ------------------------------------------------------------------

  /** 図面の面内で平行移動（from の位置が to に来るように） */
  translateInPlane(s: Sheet, from: Vector3, to: Vector3): void {
    const d = to.clone().sub(from);
    const U = this.axisU(s);
    const V = this.axisV(s);
    const o = new Vector3(...s.origin).addScaledVector(U, d.dot(U)).addScaledVector(V, d.dot(V));
    s.origin = [o.x, o.y, o.z];
    this.apply(s);
  }

  /** 面に垂直な方向も含めて平行移動 */
  translate(s: Sheet, d: Vector3): void {
    s.origin = [s.origin[0] + d.x, s.origin[1] + d.y, s.origin[2] + d.z];
    this.apply(s);
  }

  /** 鉛直軸まわりに回転（上から見て反時計回り） */
  rotate(s: Sheet, pivot: Vector3, angle: number): void {
    const o = new Vector3(...s.origin).sub(pivot).applyAxisAngle(new Vector3(0, 1, 0), angle).add(pivot);
    s.origin = [o.x, o.y, o.z];
    s.angle += angle;
    this.apply(s);
  }

  /** 2 点間の実寸から縮尺を合わせる（p1 を固定） */
  calibrateScale(s: Sheet, p1: Vector3, p2: Vector3, realDistance: number): void {
    const cur = p1.distanceTo(p2);
    if (cur < 1e-9 || realDistance <= 0) return;
    const k = realDistance / cur;
    s.scale *= k;
    const o = new Vector3(...s.origin).sub(p1).multiplyScalar(k).add(p1);
    s.origin = [o.x, o.y, o.z];
    this.apply(s);
  }

  // ------------------------------------------------------------------
  // スナップ・クリック判定
  // ------------------------------------------------------------------

  /** スナップ対象の線分（ローカル座標）と、その図面の法線 */
  worldSegments(): [Vector3, Vector3, Vector3][] {
    if (this.segCache) return this.segCache;
    const out: [Vector3, Vector3, Vector3][] = [];
    for (const s of this.items) {
      if (!s.visible || !s.segments) continue;
      const seg = s.segments;
      const n = this.normal(s);
      for (let i = 0; i < seg.length; i += 4) out.push([this.toWorld(s, seg[i], seg[i + 1]), this.toWorld(s, seg[i + 2], seg[i + 3]), n]);
    }
    this.segCache = out;
    return out;
  }

  /** レイが当たった図面（手前のもの） */
  hit(ray: Ray, filter: (s: Sheet) => boolean = () => true): SheetHit | null {
    return this.hitAll(ray, filter)[0] ?? null;
  }

  /** レイが当たった図面をすべて（手前から順に） */
  hitAll(ray: Ray, filter: (s: Sheet) => boolean = () => true): SheetHit[] {
    const hits: SheetHit[] = [];
    for (const s of this.items) {
      if (!s.visible || !filter(s)) continue;
      const n = this.normal(s);
      const o = new Vector3(...s.origin);
      const denom = ray.direction.dot(n);
      if (Math.abs(denom) < 1e-9) continue;
      const t = o.clone().sub(ray.origin).dot(n) / denom;
      if (t <= 0) continue;
      const p = ray.at(t, new Vector3());
      const uv = this.toSheet(s, p);
      const m = Math.max(s.width, s.height) * 0.02;
      if (uv[0] < -m || uv[1] < -m || uv[0] > s.width + m || uv[1] > s.height + m) continue;
      hits.push({ sheet: s, point: p, uv, distance: t });
    }
    return hits.sort((a, b) => a.distance - b.distance);
  }

  /**
   * クリックした位置の外形（図面座標の多角形）。
   * mode='outer': その位置を囲む図形全体の外形（建物のシルエット。窓の内側をクリックしても建物全体）
   * mode='region': 線で囲まれた一番小さい領域（部屋・窓など）
   */
  pickOutline(s: Sheet, uv: [number, number], mode: 'outer' | 'region' = 'outer'): [number, number][] | null {
    if (!s.segments?.length) return null;
    if (!s.regions) {
      const seg = s.segments;
      const segs: [[number, number], [number, number]][] = [];
      for (let i = 0; i < seg.length; i += 4) segs.push([[seg[i], seg[i + 1]], [seg[i + 2], seg[i + 3]]]);
      const { regions, outers } = findClosedRegions(segs, 1e-4);
      s.regions = { regions, outers };
    }
    // 外形: 窓などの内側をクリックしても建物全体になるよう、含む外形のうち最大のもの
    // 領域: 線で囲まれた最小の範囲
    const list = mode === 'outer' ? s.regions.outers : s.regions.regions;
    let best: [number, number][] | null = null;
    let bestArea = mode === 'outer' ? -Infinity : Infinity;
    for (const poly of list) {
      if (!inside2d(uv, poly)) continue;
      const a = Math.abs(area2d(poly));
      if (mode === 'outer' ? a > bestArea : a < bestArea) (bestArea = a), (best = poly);
    }
    return best;
  }

  toJSON(): SheetData[] {
    return this.items.map(({ id: _id, group: _g, lines: _l, mesh: _m, regions: _r, ...rest }) => rest);
  }

  async load(list: SheetData[]): Promise<void> {
    for (const s of [...this.items]) this.remove(s);
    for (const d of list) await this.add(d);
  }
}

export function area2d(poly: [number, number][]): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}

export function inside2d(pt: [number, number], poly: [number, number][]): boolean {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > pt[1] !== yj > pt[1] && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

/** 旧形式（下図）のデータを図面シートに変換 */
export function sheetFromLegacyUnderlay(u: {
  name: string;
  dataUrl: string;
  widthPx: number;
  heightPx: number;
  metersPerPixel: number;
  cx: number;
  cz: number;
  elevation: number;
  rotation: number;
  opacity: number;
  visible: boolean;
}): SheetData {
  const w = u.widthPx * u.metersPerPixel;
  const h = u.heightPx * u.metersPerPixel;
  // 旧形式は中心座標・回転。左下隅 = 中心 - U*w/2 - V*h/2
  const a = u.rotation;
  const U = new Vector3(Math.cos(a), 0, -Math.sin(a));
  const V = new Vector3(-Math.sin(a), 0, -Math.cos(a));
  const o = new Vector3(u.cx, u.elevation, u.cz).addScaledVector(U, -w / 2).addScaledVector(V, -h / 2);
  return {
    name: u.name,
    view: 'plan',
    image: { dataUrl: u.dataUrl, widthPx: u.widthPx, heightPx: u.heightPx, metersPerPixel: u.metersPerPixel },
    width: w,
    height: h,
    scale: 1,
    origin: [o.x, o.y, o.z],
    angle: a,
    opacity: u.opacity,
    visible: u.visible,
  };
}
