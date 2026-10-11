import {
  CanvasTexture,
  DoubleSide,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  SRGBColorSpace,
  Vector3,
} from 'three';
import type { Viewport } from './Viewport';

export interface UnderlayData {
  name: string;
  /** 画像（PNG の data URL） */
  dataUrl: string;
  widthPx: number;
  heightPx: number;
  /** 1 ピクセルあたりの実寸 (m) */
  metersPerPixel: number;
  /** 中心のローカル座標 */
  cx: number;
  cz: number;
  /** 高さ（標高方向） */
  elevation: number;
  /** 回転（ラジアン、上から見て反時計回り） */
  rotation: number;
  opacity: number;
  visible: boolean;
}

export interface Underlay extends UnderlayData {
  id: number;
  mesh: Mesh;
}

/**
 * 下図（発注図面の PDF・画像）を地面に敷いて、なぞって 3D 化するための管理クラス。
 */
export class UnderlayManager {
  readonly items: Underlay[] = [];
  private nextId = 1;
  private listeners = new Set<() => void>();

  constructor(private viewport: Viewport) {}

  onChange(fn: () => void): void {
    this.listeners.add(fn);
  }

  private emit(): void {
    for (const fn of this.listeners) fn();
    this.viewport.requestRender();
  }

  async add(data: UnderlayData): Promise<Underlay> {
    const img = new Image();
    img.src = data.dataUrl;
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    canvas.getContext('2d')!.drawImage(img, 0, 0);
    const tex = new CanvasTexture(canvas);
    tex.colorSpace = SRGBColorSpace;
    tex.anisotropy = this.viewport.renderer.capabilities.getMaxAnisotropy();
    const geo = new PlaneGeometry(1, 1);
    geo.rotateX(-Math.PI / 2);
    const mat = new MeshBasicMaterial({
      map: tex,
      transparent: true,
      opacity: data.opacity,
      side: DoubleSide,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: 2,
      polygonOffsetUnits: 2,
    });
    const mesh = new Mesh(geo, mat);
    mesh.renderOrder = -1;
    const u: Underlay = { ...data, id: this.nextId++, mesh };
    this.items.push(u);
    this.viewport.underlayRoot.add(mesh);
    this.apply(u);
    this.emit();
    return u;
  }

  /** 変更したパラメータをメッシュに反映 */
  apply(u: Underlay): void {
    u.mesh.scale.set(u.widthPx * u.metersPerPixel, 1, u.heightPx * u.metersPerPixel);
    u.mesh.position.set(u.cx, u.elevation - 0.001, u.cz);
    u.mesh.rotation.set(0, u.rotation, 0);
    u.mesh.visible = u.visible;
    (u.mesh.material as MeshBasicMaterial).opacity = u.opacity;
    this.emit();
  }

  remove(u: Underlay): void {
    const i = this.items.indexOf(u);
    if (i < 0) return;
    this.items.splice(i, 1);
    this.viewport.underlayRoot.remove(u.mesh);
    u.mesh.geometry.dispose();
    const m = u.mesh.material as MeshBasicMaterial;
    m.map?.dispose();
    m.dispose();
    this.emit();
  }

  /** 点がどれかの下図の上にあれば、その下図 */
  hitTest(p: Vector3): Underlay | null {
    for (const u of this.items) {
      if (!u.visible) continue;
      const local = u.mesh.worldToLocal(p.clone());
      if (Math.abs(local.x) <= 0.5 && Math.abs(local.z) <= 0.5) return u;
    }
    return null;
  }

  /** 2 点間の実寸を指定して縮尺を合わせる（p1 を固定点として拡大縮小） */
  calibrateScale(u: Underlay, p1: Vector3, p2: Vector3, realDistance: number): void {
    const cur = Math.hypot(p2.x - p1.x, p2.z - p1.z);
    if (cur < 1e-9 || realDistance <= 0) return;
    const k = realDistance / cur;
    u.metersPerPixel *= k;
    u.cx = p1.x + (u.cx - p1.x) * k;
    u.cz = p1.z + (u.cz - p1.z) * k;
    this.apply(u);
  }

  /** 下図を平行移動（from の位置が to に来るように） */
  translate(u: Underlay, from: Vector3, to: Vector3): void {
    u.cx += to.x - from.x;
    u.cz += to.z - from.z;
    this.apply(u);
  }

  /** 下図を回転（pivot 周り、上から見て反時計回り） */
  rotate(u: Underlay, pivot: Vector3, angle: number): void {
    const dx = u.cx - pivot.x;
    const dz = u.cz - pivot.z;
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    // Three.js の Y 軸回転（上から見て反時計回り）: x' = x c + z s, z' = -x s + z c
    u.cx = pivot.x + dx * c + dz * s;
    u.cz = pivot.z - dx * s + dz * c;
    u.rotation += angle;
    this.apply(u);
  }

  toJSON(): UnderlayData[] {
    return this.items.map(({ id: _id, mesh: _mesh, ...rest }) => rest);
  }

  async load(list: UnderlayData[]): Promise<void> {
    for (const u of [...this.items]) this.remove(u);
    for (const d of list) await this.add(d);
  }
}
