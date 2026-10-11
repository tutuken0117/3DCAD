import { Plane, Vector3 } from 'three';
import { arcPoints, planeBasis } from '../core/geometry';
import { formatLength, parseLength, parseLengths } from '../core/units';
import type { InferenceResult } from '../view/Inference';
import { Overlay } from '../view/Overlay';
import { Tool, type ToolDef } from './Tool';

// ---------------------------------------------------------------------------
// 線
// ---------------------------------------------------------------------------

export class LineTool extends Tool {
  readonly def: ToolDef = { id: 'line', label: '線', key: 'L', icon: 'line' };
  vcbLabel = '長さ';
  private start: InferenceResult | null = null;
  private plane: Plane | undefined;
  private current: InferenceResult | null = null;

  hint(): string {
    return this.start
      ? '終点をクリック、または長さを入力して Enter。軸の色に合わせると水平・垂直に引けます（矢印キーで方向ロック、Esc で終了）'
      : '始点をクリックしてください';
  }

  reset(): void {
    this.start = null;
    this.current = null;
    this.plane = undefined;
    super.reset();
  }

  onPointerMove(e: PointerEvent): void {
    const inf = this.infer(e, this.start ? { from: this.start.point, plane: this.plane } : {});
    this.current = inf;
    if (this.start) {
      this.app.overlay.setRubberBand(this.start.point, inf.point, inf);
      this.app.ui.setVcbValue(formatLength(this.start.point.distanceTo(inf.point)));
    }
  }

  onPointerDown(e: PointerEvent): void {
    if (e.button !== 0) return;
    const inf = this.infer(e, this.start ? { from: this.start.point, plane: this.plane } : {});
    if (!this.start) {
      this.start = inf;
      this.plane = inf.type === 'onFace' ? this.planeFrom(inf) : undefined;
      this.updateStatus();
      return;
    }
    this.commitTo(inf);
  }

  private commitTo(end: InferenceResult): void {
    if (!this.start || end.point.distanceTo(this.start.point) < 1e-6) return;
    const m = this.app.model;
    const va = this.vertexAt(this.start);
    const vb = this.vertexAt(end);
    const faces = m.drawLine(va, vb);
    this.app.history.commit('線');
    if (faces.length) {
      // 面ができたら連続線を終了（SketchUp と同じ）
      this.reset();
      return;
    }
    this.start = { point: m.pos(vb).clone(), type: 'endpoint', vertexId: vb };
    this.app.overlay.setRubberBand(null);
    this.updateStatus();
  }

  onVcb(text: string): boolean {
    if (!this.start || !this.current) return false;
    const len = parseLength(text);
    if (len === null) return false;
    const dir = this.current.point.clone().sub(this.start.point);
    if (dir.lengthSq() < 1e-12) return false;
    dir.normalize();
    this.commitTo({ point: this.start.point.clone().addScaledVector(dir, len), type: 'free' });
    return true;
  }

  onKeyDown(e: KeyboardEvent): boolean {
    if (e.key === 'Shift' && this.start && this.current && !this.shiftLock) {
      const d = this.current.point.clone().sub(this.start.point);
      if (d.lengthSq() > 1e-10) this.shiftLock = d.normalize();
      return true;
    }
    return super.onKeyDown(e);
  }

  onKeyUp(e: KeyboardEvent): void {
    if (e.key === 'Shift') this.shiftLock = undefined;
  }
}

// ---------------------------------------------------------------------------
// 長方形・円の共通処理（作図平面）
// ---------------------------------------------------------------------------

abstract class PlanarShapeTool extends Tool {
  protected origin: Vector3 | null = null;
  protected normal = new Vector3(0, 1, 0);
  protected u = new Vector3(1, 0, 0);
  protected v = new Vector3(0, 0, -1);
  protected cursor: Vector3 | null = null;

  reset(): void {
    this.origin = null;
    this.cursor = null;
    super.reset();
  }

  protected setupPlane(inf: InferenceResult): void {
    this.origin = inf.point.clone();
    this.normal = inf.type === 'onFace' && inf.normal ? inf.normal.clone() : new Vector3(0, 1, 0);
    const b = planeBasis(this.normal);
    this.u = b.u;
    this.v = b.v;
    // 水平面では u=東, v=北 になるように
    if (Math.abs(this.normal.y) > 0.999) {
      this.u.set(1, 0, 0);
      this.v.set(0, 0, -1);
      if (this.normal.y < 0) this.v.negate();
    }
  }

  /** カーソル位置を作図平面に投影 */
  protected projectToPlane(e: PointerEvent): Vector3 {
    const plane = new Plane().setFromNormalAndCoplanarPoint(this.normal, this.origin!);
    const inf = this.infer(e, { plane });
    const p = inf.point.clone();
    // 推定点が平面から外れていれば投影
    const d = plane.distanceToPoint(p);
    if (Math.abs(d) > 1e-6) {
      const rc = this.app.viewport.raycaster(e.clientX, e.clientY);
      const hit = rc.ray.intersectPlane(plane, new Vector3());
      return hit ?? plane.projectPoint(p, new Vector3());
    }
    return p;
  }

  protected commitFace(points: Vector3[], label: string): void {
    const m = this.app.model;
    const id = m.addFace(points);
    if (id !== undefined) {
      // 面の向きを作図面に合わせる
      if (m.faceNormal(id).dot(this.normal) < 0) m.reverseFace(id);
      this.app.history.commit(label);
    } else {
      this.app.ui.toast('面を作成できませんでした');
    }
    this.reset();
  }
}

// ---------------------------------------------------------------------------
// 長方形
// ---------------------------------------------------------------------------

export class RectangleTool extends PlanarShapeTool {
  readonly def: ToolDef = { id: 'rect', label: '長方形', key: 'R', icon: 'rect' };
  vcbLabel = '寸法';

  hint(): string {
    return this.origin
      ? '対角の点をクリック、または「幅,奥行き」を入力して Enter（例: 3000,2000）'
      : '最初の角をクリックしてください（面の上をクリックするとその面に描けます）';
  }

  private corners(du: number, dv: number): Vector3[] {
    const o = this.origin!;
    return [
      o.clone(),
      o.clone().addScaledVector(this.u, du),
      o.clone().addScaledVector(this.u, du).addScaledVector(this.v, dv),
      o.clone().addScaledVector(this.v, dv),
    ];
  }

  private dims(p: Vector3): [number, number] {
    const d = p.clone().sub(this.origin!);
    return [d.dot(this.u), d.dot(this.v)];
  }

  onPointerMove(e: PointerEvent): void {
    if (!this.origin) {
      this.infer(e);
      return;
    }
    this.cursor = this.projectToPlane(e);
    const [du, dv] = this.dims(this.cursor);
    const pts = this.corners(du, dv);
    this.app.overlay.setPreviewLines(Overlay.outline(pts));
    this.app.overlay.setPreviewFaces(Math.abs(du) > 1e-6 && Math.abs(dv) > 1e-6 ? [pts] : []);
    this.app.ui.setVcbValue(`${formatLength(Math.abs(du))}, ${formatLength(Math.abs(dv))}`);
  }

  onPointerDown(e: PointerEvent): void {
    if (e.button !== 0) return;
    if (!this.origin) {
      this.setupPlane(this.infer(e));
      this.updateStatus();
      return;
    }
    const [du, dv] = this.dims(this.projectToPlane(e));
    if (Math.abs(du) < 1e-6 || Math.abs(dv) < 1e-6) return;
    this.commitFace(this.corners(du, dv), '長方形');
  }

  onVcb(text: string): boolean {
    if (!this.origin) return false;
    const vals = parseLengths(text);
    if (!vals || vals.length < 2) return false;
    const [cu, cv] = this.cursor ? this.dims(this.cursor) : [1, 1];
    const du = Math.abs(vals[0]) * (cu < 0 ? -1 : 1);
    const dv = Math.abs(vals[1]) * (cv < 0 ? -1 : 1);
    this.commitFace(this.corners(du, dv), '長方形');
    return true;
  }
}

// ---------------------------------------------------------------------------
// 円
// ---------------------------------------------------------------------------

export class CircleTool extends PlanarShapeTool {
  readonly def: ToolDef = { id: 'circle', label: '円', key: 'C', icon: 'circle' };
  vcbLabel = '半径';
  segments = 24;

  hint(): string {
    return this.origin
      ? '半径の位置をクリック、または半径を入力して Enter（「36s」で分割数を変更）'
      : '円の中心をクリックしてください';
  }

  private points(r: number): Vector3[] {
    const pts = arcPoints(this.origin!, r, this.u, this.v, 0, Math.PI * 2, this.segments);
    pts.pop();
    return pts;
  }

  onPointerMove(e: PointerEvent): void {
    if (!this.origin) {
      this.infer(e);
      return;
    }
    this.cursor = this.projectToPlane(e);
    const r = this.cursor.distanceTo(this.origin);
    if (r < 1e-6) return;
    const pts = this.points(r);
    this.app.overlay.setPreviewLines(Overlay.outline(pts), [[this.origin, this.cursor]]);
    this.app.overlay.setPreviewFaces([pts]);
    this.app.ui.setVcbValue(formatLength(r));
  }

  onPointerDown(e: PointerEvent): void {
    if (e.button !== 0) return;
    if (!this.origin) {
      this.setupPlane(this.infer(e));
      this.updateStatus();
      return;
    }
    const r = this.projectToPlane(e).distanceTo(this.origin);
    if (r < 1e-6) return;
    this.commitFace(this.points(r), '円');
  }

  onVcb(text: string): boolean {
    const seg = /^(\d+)\s*s$/i.exec(text.trim());
    if (seg) {
      this.segments = Math.max(3, Math.min(360, parseInt(seg[1], 10)));
      this.app.ui.toast(`円の分割数: ${this.segments}`);
      return true;
    }
    if (!this.origin) return false;
    const r = parseLength(text);
    if (r === null || r <= 0) return false;
    this.commitFace(this.points(r), '円');
    return true;
  }
}
