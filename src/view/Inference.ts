import { Plane, Ray, Vector2, Vector3 } from 'three';
import type { Model } from '../core/Model';
import type { ModelRenderer } from './ModelRenderer';
import type { Viewport } from './Viewport';
import type { PointCloudManager } from './PointCloudManager';
import type { UnderlayManager } from './UnderlayManager';

export type InferenceType =
  | 'endpoint'
  | 'midpoint'
  | 'onEdge'
  | 'onFace'
  | 'axis'
  | 'locked'
  | 'pointcloud'
  | 'underlay'
  | 'ground'
  | 'free';

export type AxisName = 'x' | 'y' | 'z';

export interface InferenceResult {
  point: Vector3;
  type: InferenceType;
  vertexId?: number;
  edgeId?: number;
  faceId?: number;
  /** 面の法線（onFace の場合） */
  normal?: Vector3;
  axis?: AxisName;
}

export interface InferenceOptions {
  /** 線を引き始めた点。軸方向の推定に使う */
  from?: Vector3;
  /** 方向ロック（矢印キー・Shift） */
  lockDir?: Vector3;
  /** 作図平面（未指定なら from を通る水平面 or 地面） */
  plane?: Plane;
  /** 推定対象から外す頂点（移動中の要素など） */
  excludeVertices?: Set<number>;
}

export const AXIS_DIRS: Record<AxisName, Vector3> = {
  x: new Vector3(1, 0, 0),
  y: new Vector3(0, 1, 0),
  z: new Vector3(0, 0, -1),
};

export const INFERENCE_LABEL: Record<InferenceType, string> = {
  endpoint: '端点',
  midpoint: '中点',
  onEdge: 'エッジ上',
  onFace: '面上',
  axis: '軸方向',
  locked: 'ロック中',
  pointcloud: '点群',
  underlay: '下図上',
  ground: '地面',
  free: '',
};

const SNAP_PX = 10;
const EDGE_PX = 6;
const AXIS_PX = 14;

/** 線分上で、レイに最も近い点 */
function closestOnSegmentToRay(ray: Ray, a: Vector3, b: Vector3): Vector3 {
  const seg = new Vector3();
  ray.distanceSqToSegment(a, b, undefined, seg);
  return seg;
}

/** 無限直線上で、レイに最も近い点 */
export function closestOnLineToRay(ray: Ray, p0: Vector3, dir: Vector3): Vector3 {
  const d = dir.clone().normalize();
  const w0 = p0.clone().sub(ray.origin);
  const a = d.dot(d);
  const b = d.dot(ray.direction);
  const c = ray.direction.dot(ray.direction);
  const dd = d.dot(w0);
  const e = ray.direction.dot(w0);
  const denom = a * c - b * b;
  if (Math.abs(denom) < 1e-12) return p0.clone();
  const s = (b * e - c * dd) / denom;
  return p0.clone().addScaledVector(d, s);
}

/**
 * SketchUp の「推定（インファレンス）」に相当するスナップ機能。
 * 端点・中点・エッジ上・面上・軸方向・点群 を自動で判定する。
 */
export class Inference {
  pointCloudSnap = true;

  constructor(
    private viewport: Viewport,
    private model: Model,
    private renderer: ModelRenderer,
    private pointClouds: PointCloudManager,
    private underlays: UnderlayManager,
  ) {}

  infer(clientX: number, clientY: number, opt: InferenceOptions = {}): InferenceResult {
    const vp = this.viewport;
    const mouse = vp.toCanvas(clientX, clientY);
    const rc = vp.raycaster(clientX, clientY);
    const ray = rc.ray;
    const camPos = vp.camera.position;

    // 方向ロック中は、その直線上に拘束
    if (opt.from && opt.lockDir) {
      const p = closestOnLineToRay(ray, opt.from, opt.lockDir);
      // ロック中でも端点があればその投影点を使う
      const snap = this.snapVertex(mouse, opt.excludeVertices);
      if (snap) {
        const d = opt.lockDir.clone().normalize();
        const proj = opt.from.clone().addScaledVector(d, snap.point.clone().sub(opt.from).dot(d));
        return { point: proj, type: 'locked', vertexId: undefined };
      }
      return { point: p, type: 'locked' };
    }

    const faceHit = this.renderer.pickFace(rc);
    const occluded = (p: Vector3) => {
      if (!faceHit) return false;
      const d = p.distanceTo(camPos);
      return d > faceHit.distance + vp.worldPerPixel(p) * 4 + 1e-3;
    };

    // 1. 端点
    const v = this.snapVertex(mouse, opt.excludeVertices, occluded);
    if (v) return v;

    // 2. 中点
    const scr = new Vector2();
    let best: InferenceResult | null = null;
    let bestD = SNAP_PX;
    for (const e of this.model.edges.values()) {
      if (!this.model.isLayerVisible(e.layer)) continue;
      if (opt.excludeVertices && (opt.excludeVertices.has(e.a) || opt.excludeVertices.has(e.b))) continue;
      const mid = this.model.pos(e.a).clone().add(this.model.pos(e.b)).multiplyScalar(0.5);
      vp.toScreen(mid, scr);
      const d = scr.distanceTo(mouse);
      if (d < bestD && !occluded(mid)) {
        bestD = d;
        best = { point: mid, type: 'midpoint', edgeId: e.id };
      }
    }
    if (best) return best;

    // 3. 軸方向（始点がある場合）
    if (opt.from) {
      let bestAxis: InferenceResult | null = null;
      let bestAxisD = AXIS_PX;
      for (const name of ['x', 'y', 'z'] as AxisName[]) {
        const p = closestOnLineToRay(ray, opt.from, AXIS_DIRS[name]);
        if (p.distanceTo(opt.from) < 1e-6) continue;
        // カメラの後ろは無視
        if (p.clone().sub(camPos).dot(ray.direction) <= 0) continue;
        const d = vp.toScreen(p, scr).distanceTo(mouse);
        if (d < bestAxisD) {
          bestAxisD = d;
          bestAxis = { point: p, type: 'axis', axis: name };
        }
      }
      if (bestAxis) return bestAxis;
    }

    // 4. エッジ上
    bestD = EDGE_PX;
    for (const e of this.model.edges.values()) {
      if (!this.model.isLayerVisible(e.layer)) continue;
      if (opt.excludeVertices && (opt.excludeVertices.has(e.a) || opt.excludeVertices.has(e.b))) continue;
      const p = closestOnSegmentToRay(ray, this.model.pos(e.a), this.model.pos(e.b));
      const d = vp.toScreen(p, scr).distanceTo(mouse);
      if (d < bestD && !occluded(p)) {
        bestD = d;
        best = { point: p, type: 'onEdge', edgeId: e.id };
      }
    }
    if (best) return best;

    // 5. 点群
    if (this.pointCloudSnap) {
      const pc = this.pointClouds.pick(rc, vp.worldPerPixel(faceHit?.point ?? vp.controls.target) * SNAP_PX);
      if (pc && (!faceHit || pc.distanceTo(camPos) < faceHit.distance)) {
        return { point: pc, type: 'pointcloud' };
      }
    }

    // 6. 面上
    if (faceHit) {
      return { point: faceHit.point, type: 'onFace', faceId: faceHit.faceId, normal: faceHit.normal };
    }

    // 7. 作図平面 / 下図 / 地面
    const plane = opt.plane ?? new Plane(new Vector3(0, 1, 0), opt.from ? -opt.from.y : 0);
    const hit = ray.intersectPlane(plane, new Vector3());
    if (hit) {
      const onUnderlay = this.underlays.hitTest(hit);
      return { point: hit, type: onUnderlay ? 'underlay' : opt.plane || opt.from ? 'free' : 'ground' };
    }
    return { point: ray.at(Math.max(1, vp.camera.position.distanceTo(vp.controls.target)), new Vector3()), type: 'free' };
  }

  private snapVertex(
    mouse: Vector2,
    exclude?: Set<number>,
    occluded?: (p: Vector3) => boolean,
  ): InferenceResult | null {
    const scr = new Vector2();
    let best: InferenceResult | null = null;
    let bestD = SNAP_PX;
    const visible = new Set<number>();
    for (const e of this.model.edges.values()) {
      if (this.model.isLayerVisible(e.layer)) (visible.add(e.a), visible.add(e.b));
    }
    for (const id of visible) {
      if (exclude?.has(id)) continue;
      const p = this.model.pos(id);
      const d = this.viewport.toScreen(p, scr).distanceTo(mouse);
      if (d < bestD && !occluded?.(p)) {
        bestD = d;
        best = { point: p.clone(), type: 'endpoint', vertexId: id };
      }
    }
    return best;
  }
}
