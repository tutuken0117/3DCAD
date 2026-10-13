import { Box3, Vector3 } from 'three';
import type { Viewport } from './Viewport';

/** 保存した視点（シーン） */
export interface SceneView {
  id: number;
  name: string;
  position: [number, number, number];
  target: [number, number, number];
  /** 一覧に出す小さな画像（data URL） */
  thumbnail?: string;
}

export type SceneData = Omit<SceneView, 'id'>;

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/**
 * おすすめの視点を計算する（初めての人でも、ボタン 1 つで見栄えのよい視点がそろう）。
 * 鳥瞰（南東）、人の目線（南正面）、鳥瞰（北西）、真上（配置）
 */
export function recommendedViews(box: Box3, fovDeg = 45, aspect = 16 / 9): SceneData[] {
  if (box.isEmpty()) return [];
  const c = box.getCenter(new Vector3());
  const size = box.getSize(new Vector3());
  const radius = Math.max(1, size.length() / 2);
  const vfov = (fovDeg * Math.PI) / 180;
  const hfov = 2 * Math.atan(Math.tan(vfov / 2) * aspect);
  const fit = radius / Math.sin(Math.min(vfov, hfov) / 2);
  const arr = (v: Vector3): [number, number, number] => [v.x, v.y, v.z];

  const views: SceneData[] = [];
  // 鳥瞰（南東から）
  const se = new Vector3(1, 0.75, 1).normalize();
  views.push({ name: '鳥瞰（南東から）', position: arr(c.clone().addScaledVector(se, fit * 1.15)), target: arr(c) });
  // 人の目線（南正面から）: 縦の線がまっすぐ見えるよう、ほぼ水平に見る
  const eyeY = box.min.y + 1.6;
  const distW = size.x / 2 / Math.tan(hfov / 2);
  const distH = (size.y + 1) / 2 / Math.tan(vfov / 2);
  const d = Math.max(distW, distH) * 1.25 + size.z / 2;
  const lookY = box.min.y + Math.max(1.6, size.y * 0.45);
  views.push({
    name: '人の目線（南正面）',
    position: [c.x, eyeY, c.z + d],
    target: [c.x, lookY, c.z],
  });
  // 鳥瞰（北西から）
  const nw = new Vector3(-1, 0.75, -1).normalize();
  views.push({ name: '鳥瞰（北西から）', position: arr(c.clone().addScaledVector(nw, fit * 1.15)), target: arr(c) });
  // 真上（配置図）
  const top = Math.max(size.x / aspect, size.z) / 2 / Math.tan(vfov / 2) * 1.2 + size.y;
  views.push({ name: '真上（配置）', position: [c.x, c.y + top, c.z + 0.001], target: arr(c) });
  return views;
}

/** 視点の保存・切り替え（なめらかに移動） */
export class SceneManager {
  readonly items: SceneView[] = [];
  private nextId = 1;
  private listeners = new Set<() => void>();
  private anim: { from: [Vector3, Vector3]; to: [Vector3, Vector3]; t0: number; dur: number; done?: () => void } | null = null;

  constructor(private viewport: Viewport) {
    viewport.onFrame((time) => this.step(time));
  }

  onChange(fn: () => void): void {
    this.listeners.add(fn);
  }

  emit(): void {
    for (const fn of this.listeners) fn();
  }

  /** 今の視点を追加 */
  addCurrent(name?: string): SceneView {
    const cam = this.viewport.camera;
    const t = this.viewport.controls.target;
    return this.add({
      name: name ?? `シーン ${this.items.length + 1}`,
      position: [cam.position.x, cam.position.y, cam.position.z],
      target: [t.x, t.y, t.z],
    });
  }

  add(d: SceneData): SceneView {
    const s: SceneView = { ...d, id: this.nextId++ };
    this.items.push(s);
    this.emit();
    return s;
  }

  remove(s: SceneView): void {
    const i = this.items.indexOf(s);
    if (i >= 0) this.items.splice(i, 1);
    this.emit();
  }

  move(s: SceneView, delta: number): void {
    const i = this.items.indexOf(s);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= this.items.length) return;
    [this.items[i], this.items[j]] = [this.items[j], this.items[i]];
    this.emit();
  }

  /** 視点を移す（animate=false なら即座に） */
  goTo(s: SceneData, animate = true, durationMs = 1200): Promise<void> {
    const vp = this.viewport;
    const toP = new Vector3(...s.position);
    const toT = new Vector3(...s.target);
    if (!animate) {
      this.anim = null;
      vp.camera.position.copy(toP);
      vp.controls.target.copy(toT);
      vp.controls.update();
      vp.requestRender();
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this.anim = {
        from: [vp.camera.position.clone(), vp.controls.target.clone()],
        to: [toP, toT],
        t0: performance.now(),
        dur: durationMs,
        done: resolve,
      };
    });
  }

  get animating(): boolean {
    return !!this.anim;
  }

  /** time を指定してアニメーションを進める（動画の書き出しでは固定の時間刻みで呼ぶ） */
  step(time = performance.now()): void {
    const a = this.anim;
    if (!a) return;
    const vp = this.viewport;
    const t = Math.min(1, (time - a.t0) / a.dur);
    const k = ease(t);
    vp.camera.position.lerpVectors(a.from[0], a.to[0], k);
    vp.controls.target.lerpVectors(a.from[1], a.to[1], k);
    vp.controls.update();
    vp.requestRender();
    if (t >= 1) {
      this.anim = null;
      a.done?.();
    }
  }

  toJSON(): SceneData[] {
    return this.items.map(({ id: _id, ...rest }) => rest);
  }

  load(list: SceneData[]): void {
    this.items.length = 0;
    for (const d of list) this.items.push({ ...d, id: this.nextId++ });
    this.emit();
  }
}
