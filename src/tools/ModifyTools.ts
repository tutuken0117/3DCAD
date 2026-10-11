import { Vector2, Vector3 } from 'three';
import { formatLength, parseLength } from '../core/units';
import { closestOnLineToRay, type InferenceResult } from '../view/Inference';
import { Overlay } from '../view/Overlay';
import type { App } from '../App';
import { Tool, type ToolDef } from './Tool';

/** カーソル下のエッジまたは面 */
export function pickEntity(app: App, inf: InferenceResult): { edge?: number; face?: number } {
  const m = app.model;
  if (inf.edgeId !== undefined && m.edges.has(inf.edgeId)) return { edge: inf.edgeId };
  if (inf.vertexId !== undefined) {
    for (const e of m.edges.values()) if (e.a === inf.vertexId || e.b === inf.vertexId) return { edge: e.id };
  }
  if (inf.faceId !== undefined) return { face: inf.faceId };
  return {};
}

// ---------------------------------------------------------------------------
// プッシュ/プル
// ---------------------------------------------------------------------------

export class PushPullTool extends Tool {
  readonly def: ToolDef = { id: 'pushpull', label: 'プッシュ/プル', key: 'P', icon: 'pushpull' };
  vcbLabel = '距離';
  private faceId: number | null = null;
  private start = new Vector3();
  private normal = new Vector3();
  private dist = 0;
  private lastDist = 0;
  private lastFace: number | null = null;
  private downAt: Vector2 | null = null;

  hint(): string {
    return this.faceId !== null
      ? 'マウスを動かして高さを決めてクリック、または距離を入力して Enter（他の点に合わせるとその高さに揃います）'
      : '押し出す面をクリック（ドラッグでも可）。ダブルクリックで前回と同じ距離を押し出し';
  }

  activate(): void {
    this.lastFace = null;
    super.activate();
  }

  reset(): void {
    this.faceId = null;
    this.dist = 0;
    this.downAt = null;
    super.reset();
  }

  onPointerMove(e: PointerEvent): void {
    const app = this.app;
    if (this.faceId === null) {
      const hit = app.renderer.pickFace(app.viewport.raycaster(e.clientX, e.clientY));
      app.renderer.setHover(hit ? [hit.faceId] : []);
      app.overlay.showInference(null);
      if (hit) app.ui.setCursorPosition(hit.point);
      return;
    }
    const face = app.model.faces.get(this.faceId);
    if (!face) return this.reset();
    const own = new Set(face.loop);
    const inf = app.inference.infer(e.clientX, e.clientY, { excludeVertices: own });
    if (['endpoint', 'midpoint', 'onEdge', 'pointcloud'].includes(inf.type)) {
      this.dist = inf.point.clone().sub(this.start).dot(this.normal);
      app.overlay.showInference(inf, e.clientX, e.clientY);
    } else {
      const rc = app.viewport.raycaster(e.clientX, e.clientY);
      const p = closestOnLineToRay(rc.ray, this.start, this.normal);
      this.dist = p.sub(this.start).dot(this.normal);
      app.overlay.showInference(null);
    }
    this.preview();
    app.ui.setVcbValue(formatLength(this.dist));
  }

  private preview(): void {
    if (this.faceId === null) return;
    const pts = this.app.model.facePoints(this.faceId);
    const off = this.normal.clone().multiplyScalar(this.dist);
    const top = pts.map((p) => p.clone().add(off));
    const segs = Overlay.outline(top);
    pts.forEach((p, i) => segs.push([p, top[i]]));
    this.app.overlay.setPreviewLines(segs);
    this.app.overlay.setPreviewFaces([top]);
  }

  onPointerDown(e: PointerEvent): void {
    if (e.button !== 0) return;
    if (this.faceId === null) {
      const hit = this.app.renderer.pickFace(this.app.viewport.raycaster(e.clientX, e.clientY));
      if (!hit) return;
      this.faceId = hit.faceId;
      this.start.copy(hit.point);
      this.normal.copy(hit.normal);
      this.dist = 0;
      this.downAt = new Vector2(e.clientX, e.clientY);
      this.app.renderer.setHover([]);
      this.updateStatus();
      return;
    }
    if (Math.abs(this.dist) < 1e-6) return this.reset();
    this.commit(this.dist);
  }

  onPointerUp(e: PointerEvent): void {
    // ドラッグ操作で押し出した場合
    if (this.faceId !== null && this.downAt && this.downAt.distanceTo(new Vector2(e.clientX, e.clientY)) > 6) {
      if (Math.abs(this.dist) > 1e-6) this.commit(this.dist);
    }
    this.downAt = null;
  }

  onDoubleClick(e: MouseEvent): void {
    if (!this.lastDist) return;
    this.reset();
    const hit = this.app.renderer.pickFace(this.app.viewport.raycaster(e.clientX, e.clientY));
    if (!hit) return;
    this.faceId = hit.faceId;
    this.commit(this.lastDist);
  }

  private commit(d: number): void {
    if (this.faceId === null) return;
    this.app.model.pushPull(this.faceId, d);
    this.lastDist = d;
    this.lastFace = this.faceId;
    this.app.history.commit('プッシュ/プル');
    this.reset();
  }

  onVcb(text: string): boolean {
    const d = parseLength(text);
    if (d === null) return false;
    if (this.faceId !== null) {
      this.commit(d);
      return true;
    }
    // 押し出し直後なら、直前の押し出し量を修正（SketchUp と同じ）
    if (this.lastFace !== null && this.app.history.canUndo) {
      const face = this.lastFace;
      this.app.history.undo();
      if (!this.app.model.faces.has(face)) return false;
      this.faceId = face;
      this.commit(d);
      this.app.ui.toast('直前の押し出し量を修正しました');
      return true;
    }
    return false;
  }
}

// ---------------------------------------------------------------------------
// 移動（Ctrl でコピー）
// ---------------------------------------------------------------------------

export class MoveTool extends Tool {
  readonly def: ToolDef = { id: 'move', label: '移動', key: 'M', icon: 'move' };
  vcbLabel = '距離';
  private base: Vector3 | null = null;
  private current: Vector3 | null = null;
  private copy = false;
  private lastCopy: { edges: number[]; faces: number[]; offset: Vector3 } | null = null;

  hint(): string {
    const mode = this.copy ? '【コピー】' : '';
    return this.base
      ? `${mode}移動先をクリック、または距離を入力して Enter。Ctrl でコピーに切替`
      : `${mode}移動する物をクリック（先に選択しておくと選択範囲を移動）。Ctrl でコピーに切替`;
  }

  reset(): void {
    this.base = null;
    this.current = null;
    super.reset();
  }

  private previewAt(offset: Vector3): void {
    const m = this.app.model;
    const sel = this.app.selection;
    const segs: [Vector3, Vector3][] = [];
    const add = (a: number, b: number) => segs.push([m.pos(a).clone().add(offset), m.pos(b).clone().add(offset)]);
    for (const id of sel.edges) {
      const e = m.edges.get(id);
      if (e) add(e.a, e.b);
    }
    for (const id of sel.faces) {
      const L = m.faces.get(id)?.loop ?? [];
      for (let i = 0; i < L.length; i++) add(L[i], L[(i + 1) % L.length]);
    }
    this.app.overlay.setPreviewLines(segs);
  }

  onPointerMove(e: PointerEvent): void {
    if (!this.base) {
      const inf = this.infer(e);
      if (this.app.selection.isEmpty) {
        const ent = pickEntity(this.app, inf);
        this.app.renderer.setHover(ent.face !== undefined ? [ent.face] : [], ent.edge !== undefined ? [ent.edge] : []);
      }
      return;
    }
    const inf = this.infer(e, { from: this.base, excludeVertices: this.copy ? undefined : this.app.selection.vertexIds() });
    this.current = inf.point;
    this.app.overlay.setRubberBand(this.base, inf.point, inf);
    this.previewAt(inf.point.clone().sub(this.base));
    this.app.ui.setVcbValue(formatLength(inf.point.distanceTo(this.base)));
  }

  onPointerDown(e: PointerEvent): void {
    if (e.button !== 0) return;
    if (!this.base) {
      const inf = this.infer(e);
      if (this.app.selection.isEmpty) {
        const ent = pickEntity(this.app, inf);
        if (ent.face !== undefined) {
          // 面を選んだら境界のエッジも一緒に動かす
          const f = this.app.model.faces.get(ent.face)!;
          const edges: number[] = [];
          for (let i = 0; i < f.loop.length; i++) {
            const id = this.app.model.findEdge(f.loop[i], f.loop[(i + 1) % f.loop.length]);
            if (id !== undefined) edges.push(id);
          }
          this.app.selection.set(edges, [ent.face]);
        } else if (ent.edge !== undefined) this.app.selection.set([ent.edge], []);
      }
      if (this.app.selection.isEmpty) {
        this.app.ui.toast('移動する物がありません');
        return;
      }
      this.app.renderer.setHover([]);
      this.base = inf.point.clone();
      this.updateStatus();
      return;
    }
    const inf = this.infer(e, { from: this.base, excludeVertices: this.copy ? undefined : this.app.selection.vertexIds() });
    this.commit(inf.point.clone().sub(this.base));
  }

  private commit(offset: Vector3): void {
    if (offset.lengthSq() < 1e-12) return this.reset();
    const m = this.app.model;
    const sel = this.app.selection;
    if (this.copy) {
      const res = m.copyEntities(sel.edges, sel.faces, offset);
      this.lastCopy = { ...res, offset: offset.clone() };
      this.app.history.commit('コピー');
      sel.set(res.edges, res.faces);
      this.app.ui.toast('コピーしました。続けて「5x」と入力すると等間隔に 5 個並べます');
    } else {
      m.moveVertices(sel.vertexIds(), offset);
      this.lastCopy = null;
      this.app.history.commit('移動');
    }
    this.reset();
  }

  onVcb(text: string): boolean {
    // 配列コピー: "5x" / "x5" / "*5"
    const arr = /^(?:[x×*](\d+)|(\d+)\s*[x×*])$/i.exec(text.trim());
    if (arr && this.lastCopy) {
      const n = parseInt(arr[1] ?? arr[2], 10);
      const m = this.app.model;
      const { edges, faces, offset } = this.lastCopy;
      // 直前のコピー元から見て 2 個目以降を追加
      const srcEdges = edges;
      const srcFaces = faces;
      for (let i = 2; i <= n; i++) {
        m.copyEntities(srcEdges, srcFaces, offset.clone().multiplyScalar(i - 1));
      }
      this.app.history.commit('配列コピー');
      this.lastCopy = null;
      return true;
    }
    if (!this.base || !this.current) return false;
    const len = parseLength(text);
    if (len === null) return false;
    const dir = this.current.clone().sub(this.base);
    if (dir.lengthSq() < 1e-12) return false;
    this.commit(dir.normalize().multiplyScalar(len));
    return true;
  }

  onKeyDown(e: KeyboardEvent): boolean {
    if (e.key === 'Control' || e.key === 'Alt') {
      this.copy = !this.copy;
      this.updateStatus();
      return true;
    }
    return super.onKeyDown(e);
  }
}

// ---------------------------------------------------------------------------
// 回転（鉛直軸まわり）
// ---------------------------------------------------------------------------

export class RotateTool extends Tool {
  readonly def: ToolDef = { id: 'rotate', label: '回転', key: 'Q', icon: 'rotate' };
  vcbLabel = '角度(°)';
  private center: Vector3 | null = null;
  private ref: Vector3 | null = null;
  private angle = 0;

  hint(): string {
    if (!this.center) return '回転する物を選択してから、回転の中心をクリック（上から見て水平に回転します）';
    if (!this.ref) return '基準の方向をクリック';
    return '回転先をクリック、または角度を入力して Enter（15° ごとにスナップ、反時計回りが正）';
  }

  reset(): void {
    this.center = null;
    this.ref = null;
    this.angle = 0;
    super.reset();
  }

  private flat(p: Vector3): Vector3 {
    return new Vector3(p.x - this.center!.x, 0, p.z - this.center!.z);
  }

  onPointerMove(e: PointerEvent): void {
    const inf = this.infer(e, this.center ? { from: this.center } : {});
    if (!this.center) return;
    if (!this.ref) {
      this.app.overlay.setRubberBand(this.center, inf.point, inf);
      return;
    }
    const cur = this.flat(inf.point);
    if (cur.lengthSq() < 1e-12) return;
    let a = Math.atan2(-cur.z, cur.x) - Math.atan2(-this.ref.z, this.ref.x);
    while (a > Math.PI) a -= Math.PI * 2;
    while (a < -Math.PI) a += Math.PI * 2;
    const step = (15 * Math.PI) / 180;
    const snapped = Math.round(a / step) * step;
    if (Math.abs(snapped - a) < (3 * Math.PI) / 180) a = snapped;
    this.angle = a;
    this.preview();
    this.app.ui.setVcbValue(`${((a * 180) / Math.PI).toFixed(1)}°`);
  }

  private preview(): void {
    const m = this.app.model;
    const sel = this.app.selection;
    const c = this.center!;
    const up = new Vector3(0, 1, 0);
    const rot = (v: number) => m.pos(v).clone().sub(c).applyAxisAngle(up, this.angle).add(c);
    const segs: [Vector3, Vector3][] = [];
    for (const id of sel.edges) {
      const e = m.edges.get(id);
      if (e) segs.push([rot(e.a), rot(e.b)]);
    }
    const r = Math.max(1, this.ref!.length());
    const refEnd = c.clone().add(this.ref!.clone().normalize().multiplyScalar(r));
    const curEnd = c.clone().add(this.ref!.clone().normalize().applyAxisAngle(up, this.angle).multiplyScalar(r));
    this.app.overlay.setPreviewLines(segs, [
      [c, refEnd],
      [c, curEnd],
    ]);
  }

  onPointerDown(e: PointerEvent): void {
    if (e.button !== 0) return;
    if (this.app.selection.isEmpty) {
      this.app.ui.toast('先に回転する物を選択してください（選択ツール: スペースキー）');
      return;
    }
    const inf = this.infer(e, this.center ? { from: this.center } : {});
    if (!this.center) {
      this.center = inf.point.clone();
    } else if (!this.ref) {
      const r = this.flat(inf.point);
      if (r.lengthSq() < 1e-10) return;
      this.ref = r;
    } else {
      this.commit(this.angle);
      return;
    }
    this.updateStatus();
  }

  private commit(angle: number): void {
    if (!this.center) return;
    this.app.model.rotateVertices(this.app.selection.vertexIds(), this.center, new Vector3(0, 1, 0), angle);
    this.app.history.commit('回転');
    this.reset();
  }

  onVcb(text: string): boolean {
    if (!this.center) return false;
    const deg = parseFloat(text.replace('°', ''));
    if (!Number.isFinite(deg)) return false;
    this.commit((deg * Math.PI) / 180);
    return true;
  }
}

// ---------------------------------------------------------------------------
// 消しゴム
// ---------------------------------------------------------------------------

export class EraserTool extends Tool {
  readonly def: ToolDef = { id: 'eraser', label: '消しゴム', key: 'E', icon: 'eraser' };
  private erasing = false;
  private edges = new Set<number>();
  private faces = new Set<number>();

  hint(): string {
    return 'エッジをクリック（ドラッグでなぞって複数）して削除。エッジを消すとその面も消えます。面をクリックすると面だけ削除';
  }

  reset(): void {
    this.erasing = false;
    this.edges.clear();
    this.faces.clear();
    super.reset();
  }

  private target(e: PointerEvent) {
    const inf = this.app.inference.infer(e.clientX, e.clientY);
    return pickEntity(this.app, inf);
  }

  onPointerMove(e: PointerEvent): void {
    const t = this.target(e);
    if (this.erasing) {
      if (t.edge !== undefined) this.edges.add(t.edge);
      this.app.renderer.setHover([...this.faces], [...this.edges]);
    } else {
      this.app.renderer.setHover(t.face !== undefined ? [t.face] : [], t.edge !== undefined ? [t.edge] : []);
    }
  }

  onPointerDown(e: PointerEvent): void {
    if (e.button !== 0) return;
    this.erasing = true;
    const t = this.target(e);
    if (t.edge !== undefined) this.edges.add(t.edge);
    else if (t.face !== undefined) this.faces.add(t.face);
  }

  onPointerUp(): void {
    if (!this.erasing) return;
    const m = this.app.model;
    for (const id of this.faces) m.removeFace(id);
    for (const id of this.edges) m.removeEdge(id);
    if (this.edges.size || this.faces.size) this.app.history.commit('削除');
    this.reset();
  }
}

// ---------------------------------------------------------------------------
// ペイント
// ---------------------------------------------------------------------------

export class PaintTool extends Tool {
  readonly def: ToolDef = { id: 'paint', label: 'ペイント', key: 'B', icon: 'paint' };

  hint(): string {
    return '面をクリックして色を塗ります（選択中の面をクリックすると選択した面すべて）。Alt+クリックで色を拾う';
  }

  onPointerMove(e: PointerEvent): void {
    const hit = this.app.renderer.pickFace(this.app.viewport.raycaster(e.clientX, e.clientY));
    this.app.renderer.setHover(hit ? [hit.faceId] : []);
  }

  onPointerDown(e: PointerEvent): void {
    if (e.button !== 0) return;
    const hit = this.app.renderer.pickFace(this.app.viewport.raycaster(e.clientX, e.clientY));
    if (!hit) return;
    const m = this.app.model;
    if (e.altKey) {
      const c = m.faces.get(hit.faceId)?.color;
      if (c) this.app.ui.setPaintColor(c);
      return;
    }
    const color = this.app.ui.paintColor;
    const ids = this.app.selection.faces.has(hit.faceId) ? [...this.app.selection.faces] : [hit.faceId];
    for (const id of ids) {
      const f = m.faces.get(id);
      if (f) f.color = color;
    }
    this.app.history.commit('ペイント');
  }
}
