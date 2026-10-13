import {
  ACESFilmicToneMapping,
  CanvasTexture,
  Color,
  Mesh,
  MeshStandardMaterial,
  NoToneMapping,
  PCFSoftShadowMap,
  PMREMGenerator,
  PlaneGeometry,
  SRGBColorSpace,
  ShadowMaterial,
  Sphere,
  Vector2,
  Vector3,
  type Material,
  type Texture,
} from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import type { App } from '../App';
import { getMaterial } from '../core/materials';
import { jstDate, sunDirection, sunPosition } from '../core/sun';
import { threeMaterial } from './materialTextures';

/** 表示スタイル */
export type RenderStyle = 'edit' | 'real' | 'white' | 'sketch';

export const STYLE_LABEL: Record<Exclude<RenderStyle, 'edit'>, { name: string; desc: string }> = {
  real: { name: 'リアル', desc: '材料・太陽の光と影・空。完成イメージに' },
  white: { name: '白模型', desc: '白い模型のような上品な表現。形やボリュームの検討に' },
  sketch: { name: 'スケッチ', desc: '線画風。打ち合わせ・説明資料に' },
};

export type GroundKind = 'grass' | 'paving' | 'plain' | 'none';

export interface RenderSettings {
  style: Exclude<RenderStyle, 'edit'>;
  month: number;
  day: number;
  /** 時刻（9.5 = 9:30） */
  hour: number;
  shadows: boolean;
  ground: GroundKind;
  edges: boolean;
  /** 高品質（陰影の強調・きめ細かい影） */
  high: boolean;
  showPointClouds: boolean;
  showSheets: boolean;
}

export const DEFAULT_SETTINGS: RenderSettings = {
  style: 'real',
  month: 5,
  day: 15,
  hour: 14,
  shadows: true,
  ground: 'grass',
  edges: false,
  high: true,
  showPointClouds: false,
  showSheets: false,
};

export interface ImageOptions {
  width: number;
  height: number;
  /** 背景を透明に（地面は影だけ残す） */
  transparent?: boolean;
  /** 右下に入れる文字 */
  caption?: string;
}

function skyTexture(): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 4;
  c.height = 256;
  const g = c.getContext('2d')!;
  const grad = g.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, '#6f9fd0');
  grad.addColorStop(0.55, '#b9d3ea');
  grad.addColorStop(1, '#eef2f4');
  g.fillStyle = grad;
  g.fillRect(0, 0, 4, 256);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

/**
 * プレゼン表示: 太陽の光と影・空・地面・材料で「見せる」ための描画。
 * 編集用の表示（グリッド・図面・選択表示など）は隠す。
 */
export class Presentation {
  active = false;
  settings: RenderSettings = { ...DEFAULT_SETTINGS };

  private ground: Mesh;
  private sky: CanvasTexture;
  private envMap: Texture | null = null;
  private composer: EffectComposer | null = null;
  private renderPass: RenderPass | null = null;
  private gtao: GTAOPass | null = null;
  private fatLines: LineSegments2 | null = null;
  private saved: { visible: Map<object, boolean>; background: unknown } | null = null;
  private unsub: (() => void) | null = null;

  constructor(private app: App) {
    this.ground = new Mesh(new PlaneGeometry(1, 1).rotateX(-Math.PI / 2), new MeshStandardMaterial({ color: '#e8e8e5' }));
    this.ground.receiveShadow = true;
    this.ground.visible = false;
    this.ground.renderOrder = -3;
    this.sky = skyTexture();
    app.viewport.scene.add(this.ground);
    app.viewport.onResize((w, h) => {
      this.composer?.setSize(w, h);
      (this.fatLines?.material as LineMaterial | undefined)?.resolution.set(w, h);
    });
  }

  /** プレゼン表示を開始 */
  enter(): void {
    if (this.active) return;
    const vp = this.app.viewport;
    this.active = true;
    this.app.selection.clear();
    this.app.tool.reset();
    this.saved = {
      visible: new Map<object, boolean>([
        [vp.helpersRoot, vp.helpersRoot.visible],
        [vp.overlayRoot, vp.overlayRoot.visible],
        [vp.underlayRoot, vp.underlayRoot.visible],
        [vp.pointCloudRoot, vp.pointCloudRoot.visible],
      ]),
      background: vp.scene.background,
    };
    vp.helpersRoot.visible = false;
    vp.overlayRoot.visible = false;
    // モデルが変わったら太い線や影の範囲を更新
    this.unsub = this.app.model.onChange(() => this.active && this.apply());
    this.apply();
  }

  /** 編集表示に戻す */
  exit(): void {
    if (!this.active) return;
    const vp = this.app.viewport;
    this.active = false;
    this.unsub?.();
    this.unsub = null;
    if (this.saved) {
      for (const [o, v] of this.saved.visible) (o as { visible: boolean }).visible = v;
      vp.scene.background = this.saved.background as Color | null;
    }
    const r = vp.renderer;
    r.toneMapping = NoToneMapping;
    r.shadowMap.enabled = false;
    vp.scene.environment = null;
    const { hemi, amb, sun, fill } = vp.lights;
    hemi.intensity = 1.6;
    hemi.color.set(0xffffff);
    hemi.groundColor.set(0x8899aa);
    amb.intensity = 0.6;
    sun.intensity = 1.6;
    sun.color.set(0xffffff);
    sun.castShadow = false;
    sun.position.set(30, 60, 40);
    sun.target.position.set(0, 0, 0);
    fill.intensity = 0.5;
    this.ground.visible = false;
    if (this.fatLines) this.fatLines.visible = false;
    vp.customRender = null;
    const mr = this.app.renderer;
    mr.presentation = false;
    mr.whiteModel = false;
    mr.showEdges = true;
    mr.rebuild();
    this.refreshMaterials();
  }

  update(partial: Partial<RenderSettings>): void {
    this.settings = { ...this.settings, ...partial };
    if (this.active) this.apply();
  }

  /** 太陽の高度・方位（度） */
  sun(): { altitude: number; azimuth: number } {
    const s = this.settings;
    const c = this.modelCenter();
    const ll = this.app.geo.toLatLon(c) ?? { lat: 35.68, lon: 139.77 };
    const h = Math.floor(s.hour);
    return sunPosition(jstDate(s.month, s.day, h, Math.round((s.hour - h) * 60)), ll.lat, ll.lon);
  }

  private modelCenter(): Vector3 {
    const box = this.app.model.boundingBox();
    return box.isEmpty() ? new Vector3() : box.getCenter(new Vector3());
  }

  private apply(): void {
    const app = this.app;
    const vp = app.viewport;
    const s = this.settings;
    const r = vp.renderer;
    const mr = app.renderer;
    const { hemi, amb, sun, fill } = vp.lights;

    vp.underlayRoot.visible = s.showSheets;
    vp.pointCloudRoot.visible = s.showPointClouds;

    mr.presentation = true;
    mr.whiteModel = s.style !== 'real';
    mr.showEdges = s.style === 'sketch' ? false : s.edges;
    mr.rebuild();

    // 範囲と太陽
    const box = app.model.boundingBox();
    const sphere = box.isEmpty() ? new Sphere(new Vector3(), 10) : box.getBoundingSphere(new Sphere());
    const R = Math.max(5, sphere.radius);
    const pos = this.sun();
    const alt = Math.max(4, pos.altitude); // 夜は低い位置の光で代用
    const dir = sunDirection(alt, pos.azimuth);

    const shadows = s.shadows && s.style !== 'sketch';
    r.shadowMap.enabled = shadows;
    r.shadowMap.type = PCFSoftShadowMap;
    sun.castShadow = shadows;
    sun.position.copy(sphere.center).addScaledVector(dir, R * 3);
    sun.target.position.copy(sphere.center);
    sun.target.updateMatrixWorld();
    const cam = sun.shadow.camera;
    const ext = R * 1.6;
    cam.left = -ext;
    cam.right = ext;
    cam.top = ext;
    cam.bottom = -ext;
    cam.near = 0.1;
    cam.far = R * 6;
    cam.updateProjectionMatrix();
    const mapSize = s.high ? 4096 : 2048;
    if (sun.shadow.mapSize.x !== mapSize) {
      sun.shadow.mapSize.set(mapSize, mapSize);
      sun.shadow.map?.dispose();
      sun.shadow.map = null as never;
    }
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.02;

    // 地面
    const groundY = box.isEmpty() ? 0 : box.min.y - 0.003;
    const size = R * 30;
    this.ground.geometry.dispose();
    const pg = new PlaneGeometry(size, size).rotateX(-Math.PI / 2);
    const uv = pg.getAttribute('uv');
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * size, uv.getY(i) * size);
    this.ground.geometry = pg;
    this.ground.position.set(sphere.center.x, groundY, sphere.center.z);
    this.ground.visible = s.ground !== 'none' && s.style !== 'sketch';
    this.ground.material = this.groundMaterial();
    this.ground.castShadow = false;

    // 光の強さ・色
    if (s.style === 'real') {
      r.toneMapping = ACESFilmicToneMapping;
      r.toneMappingExposure = 1.0;
      sun.intensity = 3.2;
      sun.color.set('#fff3e0');
      hemi.intensity = 1.1;
      hemi.color.set('#d6e6ff');
      hemi.groundColor.set('#8a8579');
      amb.intensity = 0.1;
      fill.intensity = 0.2;
      vp.scene.background = this.sky;
    } else if (s.style === 'white') {
      // 白い面が背景に溶け込まないよう、光は控えめ・背景は少し暗めに
      r.toneMapping = ACESFilmicToneMapping;
      r.toneMappingExposure = 0.9;
      sun.intensity = 1.7;
      sun.color.set('#ffffff');
      hemi.intensity = 0.9;
      hemi.color.set('#ffffff');
      hemi.groundColor.set('#9c9c98');
      amb.intensity = 0.15;
      fill.intensity = 0.25;
      vp.scene.background = new Color('#dfe2e5');
    } else {
      r.toneMapping = NoToneMapping;
      sun.intensity = 0.9;
      sun.color.set('#ffffff');
      hemi.intensity = 2.1;
      hemi.color.set('#ffffff');
      hemi.groundColor.set('#d6d2c8');
      amb.intensity = 0.7;
      fill.intensity = 0.35;
      vp.scene.background = new Color('#f8f4ea');
    }
    // 映り込み用の環境光（ガラス・金属）
    if (!this.envMap) {
      const pm = new PMREMGenerator(r);
      this.envMap = pm.fromScene(new RoomEnvironment(), 0.04).texture;
      pm.dispose();
    }
    vp.scene.environment = s.style === 'real' ? this.envMap : null;
    vp.scene.environmentIntensity = 0.35;

    this.updateFatLines();
    this.setupComposer();
    this.refreshMaterials();
    vp.requestRender();
  }

  private groundMaterial(transparent = false): Material {
    if (transparent) return new ShadowMaterial({ opacity: 0.28 });
    const s = this.settings;
    if (s.style === 'white') return new MeshStandardMaterial({ color: '#e4e6e8', roughness: 1 });
    const def = s.ground === 'grass' ? getMaterial('grass') : s.ground === 'paving' ? getMaterial('paving') : undefined;
    if (def) return threeMaterial(def, true);
    return new MeshStandardMaterial({ color: '#dcdcd6', roughness: 1 });
  }

  /** スケッチ風の太い線 */
  private updateFatLines(): void {
    const vp = this.app.viewport;
    const want = this.settings.style === 'sketch';
    if (!want) {
      if (this.fatLines) this.fatLines.visible = false;
      return;
    }
    const pos = this.app.renderer.edgePositions();
    const geo = new LineSegmentsGeometry();
    geo.setPositions(pos.length ? pos : new Float32Array(6));
    if (!this.fatLines) {
      const mat = new LineMaterial({ color: 0x23262b, linewidth: 1.8, worldUnits: false });
      this.fatLines = new LineSegments2(geo, mat);
      this.fatLines.renderOrder = 5;
      vp.modelRoot.add(this.fatLines);
    } else {
      this.fatLines.geometry.dispose();
      this.fatLines.geometry = geo;
    }
    const sz = vp.renderer.getSize(new Vector2());
    (this.fatLines.material as LineMaterial).resolution.set(sz.x, sz.y);
    this.fatLines.visible = true;
  }

  /** 陰影の強調（GTAO）。高品質のときだけ */
  private setupComposer(): void {
    const vp = this.app.viewport;
    const useAo = this.settings.high && this.settings.style !== 'sketch';
    if (!useAo) {
      vp.customRender = null;
      return;
    }
    if (!this.composer) {
      const r = vp.renderer;
      const sz = r.getSize(new Vector2());
      this.composer = new EffectComposer(r);
      this.renderPass = new RenderPass(vp.scene, vp.camera);
      this.gtao = new GTAOPass(vp.scene, vp.camera, sz.x, sz.y);
      this.gtao.updateGtaoMaterial({ radius: 0.6, distanceExponent: 1.5, thickness: 1, scale: 1, samples: 16 });
      this.gtao.blendIntensity = 0.9;
      this.composer.addPass(this.renderPass);
      this.composer.addPass(this.gtao);
      this.composer.addPass(new OutputPass());
      this.composer.setSize(sz.x, sz.y);
    }
    vp.customRender = () => {
      this.renderPass!.camera = vp.camera;
      this.gtao!.camera = vp.camera;
      this.composer!.render();
    };
  }

  /** 影の有無などを変えたら材料を作り直させる */
  private refreshMaterials(): void {
    this.app.viewport.scene.traverse((o) => {
      const m = (o as Mesh).material as Material | Material[] | undefined;
      if (Array.isArray(m)) m.forEach((x) => (x.needsUpdate = true));
      else if (m) m.needsUpdate = true;
    });
  }

  /**
   * 今の視点を指定の解像度で画像にする（画面の表示は変えない）。
   * 返り値の canvas から PNG / JPEG にできる。
   */
  renderImage(opt: ImageOptions): HTMLCanvasElement {
    const vp = this.app.viewport;
    const r = vp.renderer;
    const max = r.capabilities.maxTextureSize;
    const k = Math.min(1, max / Math.max(opt.width, opt.height));
    const w = Math.round(opt.width * k);
    const h = Math.round(opt.height * k);

    const prevPR = r.getPixelRatio();
    const prevBg = vp.scene.background;
    const prevGroundMat = this.ground.material;
    const prevAlpha = r.getClearAlpha();
    r.setPixelRatio(1);
    r.setSize(w, h, false);
    const cam = vp.camera;
    if ('isPerspectiveCamera' in cam) {
      cam.aspect = w / h;
      cam.updateProjectionMatrix();
    } else {
      const half = (cam.top - cam.bottom) / 2;
      cam.left = -half * (w / h);
      cam.right = half * (w / h);
      cam.updateProjectionMatrix();
    }
    (this.fatLines?.material as LineMaterial | undefined)?.resolution.set(w, h);
    if (opt.transparent) {
      vp.scene.background = null;
      r.setClearAlpha(0);
      if (this.ground.visible) this.ground.material = this.groundMaterial(true);
    }
    const useComposer = !!vp.customRender && !opt.transparent && this.active;
    if (useComposer) this.composer!.setSize(w, h);

    if (useComposer) vp.customRender!();
    else r.render(vp.scene, cam);

    const out = document.createElement('canvas');
    out.width = w;
    out.height = h;
    const g = out.getContext('2d')!;
    g.drawImage(r.domElement, 0, 0);
    if (opt.caption) drawCaption(g, w, h, opt.caption);

    // 元に戻す
    vp.scene.background = prevBg;
    this.ground.material = prevGroundMat;
    r.setClearAlpha(prevAlpha);
    r.setPixelRatio(prevPR);
    vp.refreshSize();
    return out;
  }
}

/** 右下に文字（タイトル・日付など） */
function drawCaption(g: CanvasRenderingContext2D, w: number, h: number, text: string): void {
  const fs = Math.max(14, Math.round(h * 0.022));
  g.font = `600 ${fs}px "Hiragino Sans", "Yu Gothic UI", Meiryo, system-ui, sans-serif`;
  const pad = fs * 0.6;
  const tw = g.measureText(text).width;
  const x = w - tw - pad * 3;
  const y = h - fs - pad * 3;
  g.fillStyle = 'rgba(255,255,255,0.82)';
  g.beginPath();
  g.roundRect(x - pad, y - pad * 0.6, tw + pad * 2, fs + pad * 1.4, pad * 0.6);
  g.fill();
  g.fillStyle = '#1f2a35';
  g.textBaseline = 'top';
  g.fillText(text, x, y);
}
