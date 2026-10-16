import {
  AmbientLight,
  BufferGeometry,
  Color,
  DirectionalLight,
  Float32BufferAttribute,
  Group,
  HemisphereLight,
  LineBasicMaterial,
  LineDashedMaterial,
  LineSegments,
  MOUSE,
  OrthographicCamera,
  PerspectiveCamera,
  Raycaster,
  Scene,
  Sphere,
  TOUCH,
  Vector2,
  Vector3,
  WebGLRenderer,
  type Box3,
  type Camera,
} from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

export const AXIS_COLORS = {
  x: 0xd8312a, // 赤: 東
  y: 0x2a64d8, // 青: 上
  z: 0x2aa84a, // 緑: 北（ローカル -Z）
};

export type StandardView = 'iso' | 'top' | 'front' | 'back' | 'left' | 'right';

/** 3D ビュー（カメラ・操作・グリッド・座標軸） */
export class Viewport {
  readonly renderer: WebGLRenderer;
  readonly scene = new Scene();
  readonly perspCamera: PerspectiveCamera;
  readonly orthoCamera: OrthographicCamera;
  camera: PerspectiveCamera | OrthographicCamera;
  readonly controls: OrbitControls;

  /** モデル（面・エッジ） */
  readonly modelRoot = new Group();
  /** 点群 */
  readonly pointCloudRoot = new Group();
  /** 下図（画像・PDF） */
  readonly underlayRoot = new Group();
  /** ツールのプレビューやスナップ表示 */
  readonly overlayRoot = new Group();
  /** グリッドと軸 */
  readonly helpersRoot = new Group();

  /** 照明（プレゼン表示で太陽の向きや強さを変える） */
  readonly lights = {
    hemi: new HemisphereLight(0xffffff, 0x8899aa, 1.6),
    amb: new AmbientLight(0xffffff, 0.6),
    sun: new DirectionalLight(0xffffff, 1.6),
    fill: new DirectionalLight(0xffffff, 0.5),
  };
  /** 通常の描画の代わりに使う描画処理（陰影強調などの後処理） */
  customRender: (() => void) | null = null;
  private readonly resizeListeners = new Set<(w: number, h: number) => void>();

  private readonly frameCallbacks = new Set<(time: number, frame?: XRFrame) => void>();
  private needsRender = true;

  constructor(readonly container: HTMLElement) {
    // alpha: AR（WebXR）でカメラ映像を背景に透かすため
    this.renderer = new WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor(new Color('#e9eef2'), 1);
    container.appendChild(this.renderer.domElement);
    this.renderer.domElement.tabIndex = 0;

    this.perspCamera = new PerspectiveCamera(45, 1, 0.05, 20000);
    this.perspCamera.position.set(12, 9, 15);
    this.orthoCamera = new OrthographicCamera(-10, 10, 10, -10, -20000, 20000);
    this.camera = this.perspCamera;

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = false;
    this.controls.zoomToCursor = true;
    this.controls.screenSpacePanning = true;
    this.controls.maxPolarAngle = Math.PI;
    this.setNavigationMode('default');
    this.controls.addEventListener('change', () => this.requestRender());

    this.scene.add(this.helpersRoot, this.underlayRoot, this.pointCloudRoot, this.modelRoot, this.overlayRoot);
    this.setupLights();
    this.setupHelpers();

    new ResizeObserver(() => this.resize()).observe(container);
    this.resize();

    this.renderer.setAnimationLoop((time, frame) => this.frame(time, frame));
  }

  /**
   * マウスの割り当て。
   *  default: 左=ツール, 中=オービット(Shift+中=パン), 右=パン
   *  orbit / pan: 左ドラッグ・1 本指でも視点操作（トラックパッド・タブレット用）
   */
  setNavigationMode(mode: 'default' | 'orbit' | 'pan'): void {
    const left = mode === 'orbit' ? MOUSE.ROTATE : mode === 'pan' ? MOUSE.PAN : (null as unknown as MOUSE);
    this.controls.mouseButtons = { LEFT: left, MIDDLE: MOUSE.ROTATE, RIGHT: MOUSE.PAN };
    // タッチ: 1 本指はツール操作（オービット/パンツールのときは視点操作）、2 本指でズーム・パン
    const one = mode === 'orbit' ? TOUCH.ROTATE : mode === 'pan' ? TOUCH.PAN : (null as unknown as TOUCH);
    this.controls.touches = { ONE: one, TWO: TOUCH.DOLLY_PAN };
  }

  private setupLights(): void {
    const { hemi, amb, sun, fill } = this.lights;
    sun.position.set(30, 60, 40);
    fill.position.set(-40, 20, -30);
    this.scene.add(hemi, amb, sun, fill, sun.target);
  }

  private setupHelpers(): void {
    // グリッド（1m と 10m）
    // グリッドと軸は深度を書かずに最初に描く → 地面に置いた面や下図がグリッドを隠す
    const mkGrid = (size: number, step: number, color: number) => {
      // 長い線はカメラの背後で欠ける環境があるため、短い区間に分けて作る
      const pos: number[] = [];
      const chunk = step * 10;
      for (let i = -size; i <= size; i += step) {
        for (let t = -size; t < size; t += chunk) {
          const t2 = Math.min(size, t + chunk);
          pos.push(t, 0, i, t2, 0, i, i, 0, t, i, 0, t2);
        }
      }
      const g = new BufferGeometry();
      g.setAttribute('position', new Float32BufferAttribute(pos, 3));
      const m = new LineBasicMaterial({ color, depthWrite: false });
      const l = new LineSegments(g, m);
      l.renderOrder = -2;
      return l;
    };
    this.helpersRoot.add(mkGrid(50, 1, 0xcfd7df), mkGrid(500, 10, 0xb3bec9));

    // 座標軸: 正方向は実線、負方向は点線（SketchUp と同じ）
    const L = 5000;
    const axis = (dir: Vector3, color: number) => {
      const solid = new BufferGeometry().setFromPoints([new Vector3(), dir.clone().multiplyScalar(L)]);
      const dashed = new BufferGeometry().setFromPoints([new Vector3(), dir.clone().multiplyScalar(-L)]);
      const a = new LineSegments(solid, new LineBasicMaterial({ color, depthWrite: false }));
      const b = new LineSegments(dashed, new LineDashedMaterial({ color, dashSize: 0.3, gapSize: 0.3, depthWrite: false }));
      b.computeLineDistances();
      a.renderOrder = b.renderOrder = -1;
      this.helpersRoot.add(a, b);
    };
    axis(new Vector3(1, 0, 0), AXIS_COLORS.x);
    axis(new Vector3(0, 1, 0), AXIS_COLORS.y);
    axis(new Vector3(0, 0, -1), AXIS_COLORS.z);
  }

  onFrame(fn: (time: number, frame?: XRFrame) => void): () => void {
    this.frameCallbacks.add(fn);
    return () => this.frameCallbacks.delete(fn);
  }

  requestRender(): void {
    this.needsRender = true;
  }

  private frame(time: number, xrFrame?: XRFrame): void {
    for (const fn of this.frameCallbacks) fn(time, xrFrame);
    if (this.renderer.xr.isPresenting || this.needsRender) {
      this.needsRender = false;
      if (this.customRender && !this.renderer.xr.isPresenting) this.customRender();
      else this.renderer.render(this.scene, this.camera);
    }
  }

  get size(): Vector2 {
    const r = this.renderer.domElement.getBoundingClientRect();
    return new Vector2(r.width, r.height);
  }

  private resize(): void {
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    if (this.renderer.xr.isPresenting) return;
    this.renderer.setSize(w, h, false);
    this.perspCamera.aspect = w / h;
    this.perspCamera.updateProjectionMatrix();
    this.updateOrthoFrustum();
    for (const fn of this.resizeListeners) fn(w, h);
    this.requestRender();
  }

  onResize(fn: (w: number, h: number) => void): void {
    this.resizeListeners.add(fn);
  }

  /** 画面サイズの変更を反映し直す（画像書き出しの後など） */
  refreshSize(): void {
    this.resize();
  }

  updateOrthoFrustum(): void {
    const { x: w, y: h } = this.size;
    const dist = this.orthoCamera.position.distanceTo(this.controls.target);
    const halfH = Math.max(0.5, dist * Math.tan((this.perspCamera.fov * Math.PI) / 360));
    const aspect = w / Math.max(1, h);
    this.orthoCamera.left = -halfH * aspect;
    this.orthoCamera.right = halfH * aspect;
    this.orthoCamera.top = halfH;
    this.orthoCamera.bottom = -halfH;
    this.orthoCamera.updateProjectionMatrix();
  }

  get isOrtho(): boolean {
    return this.camera === this.orthoCamera;
  }

  /** 透視投影 ⇔ 平行投影 */
  setOrtho(ortho: boolean): void {
    if (ortho === this.isOrtho) return;
    const from = this.camera;
    const to = ortho ? this.orthoCamera : this.perspCamera;
    to.position.copy(from.position);
    to.quaternion.copy(from.quaternion);
    if (ortho) {
      this.orthoCamera.zoom = 1;
      this.updateOrthoFrustum();
    } else {
      // 平行投影でズームした分をカメラ距離に反映
      const dir = to.position.clone().sub(this.controls.target);
      dir.multiplyScalar(1 / this.orthoCamera.zoom);
      to.position.copy(this.controls.target).add(dir);
    }
    this.camera = to;
    this.controls.object = to;
    this.controls.update();
    this.requestRender();
  }

  /** 画面座標（クライアント座標）→ 正規化デバイス座標 */
  toNdc(clientX: number, clientY: number): Vector2 {
    const r = this.renderer.domElement.getBoundingClientRect();
    return new Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
  }

  /** ワールド座標 → キャンバス上のピクセル座標 */
  toScreen(p: Vector3, target = new Vector2()): Vector2 {
    const v = p.clone().project(this.camera);
    const { x: w, y: h } = this.size;
    return target.set(((v.x + 1) / 2) * w, ((1 - v.y) / 2) * h);
  }

  /** 画面座標 → キャンバス上のピクセル座標 */
  toCanvas(clientX: number, clientY: number): Vector2 {
    const r = this.renderer.domElement.getBoundingClientRect();
    return new Vector2(clientX - r.left, clientY - r.top);
  }

  raycaster(clientX: number, clientY: number): Raycaster {
    const rc = new Raycaster();
    rc.setFromCamera(this.toNdc(clientX, clientY), this.camera as Camera);
    return rc;
  }

  /** 1 ピクセルがワールドで何 m に相当するか（点 p の位置で） */
  worldPerPixel(p: Vector3): number {
    const h = this.size.y;
    if (this.isOrtho) {
      return (this.orthoCamera.top - this.orthoCamera.bottom) / this.orthoCamera.zoom / h;
    }
    const dist = this.camera.position.distanceTo(p);
    return (2 * dist * Math.tan((this.perspCamera.fov * Math.PI) / 360)) / h;
  }

  /** 拡大（f < 1）・縮小（f > 1）。注視点に近づく・離れる */
  zoomBy(f: number): void {
    if (this.isOrtho) {
      this.orthoCamera.zoom = Math.max(0.01, this.orthoCamera.zoom / f);
      this.updateOrthoFrustum();
    } else {
      const t = this.controls.target;
      const off = this.camera.position.clone().sub(t).multiplyScalar(f);
      if (off.length() < 0.05) return;
      this.camera.position.copy(t).add(off);
    }
    this.controls.update();
    this.requestRender();
  }

  /** 範囲全体が見えるようにカメラを合わせる */
  zoomToBox(box: Box3): void {
    if (box.isEmpty()) return;
    const sphere = box.getBoundingSphere(new Sphere());
    const r = Math.max(sphere.radius, 0.5);
    const dir = this.camera.position.clone().sub(this.controls.target).normalize();
    const dist = r / Math.sin((this.perspCamera.fov * Math.PI) / 360) * 1.1;
    this.controls.target.copy(sphere.center);
    this.camera.position.copy(sphere.center).addScaledVector(dir, dist);
    this.adjustClipping(dist + r);
    if (this.isOrtho) {
      this.orthoCamera.zoom = 1;
      this.updateOrthoFrustum();
    }
    this.controls.update();
    this.requestRender();
  }

  private adjustClipping(extent: number): void {
    this.perspCamera.near = Math.max(0.01, extent / 20000);
    this.perspCamera.far = Math.max(2000, extent * 20);
    this.perspCamera.updateProjectionMatrix();
  }

  setStandardView(view: StandardView): void {
    const t = this.controls.target;
    const dist = Math.max(5, this.camera.position.distanceTo(t));
    const dirs: Record<StandardView, Vector3> = {
      iso: new Vector3(1, 0.8, 1.2),
      top: new Vector3(0, 1, 0.0001),
      front: new Vector3(0, 0, 1), // 南から北を見る
      back: new Vector3(0, 0, -1),
      left: new Vector3(-1, 0, 0),
      right: new Vector3(1, 0, 0),
    };
    this.camera.position.copy(t).addScaledVector(dirs[view].normalize(), dist);
    this.camera.up.set(0, 1, 0);
    this.controls.update();
    if (this.isOrtho) this.updateOrthoFrustum();
    this.requestRender();
  }
}
