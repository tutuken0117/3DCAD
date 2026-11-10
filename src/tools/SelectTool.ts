import { Vector2, Vector3 } from 'three';
import { pickEntity } from './ModifyTools';
import { Tool, type ToolDef } from './Tool';

export class SelectTool extends Tool {
  readonly def: ToolDef = { id: 'select', label: '選択', key: 'Space', icon: 'select' };
  private down: Vector2 | null = null;
  private box: HTMLDivElement;
  private clicks = 0;
  private lastClick = 0;
  /** 画面に触れている指（ピンチ・2 本指の移動を選択と取り違えないため） */
  private touches = new Set<number>();
  private gesture = false;
  /** 視点操作中の 1 回目のタップで触れた図形（同じ図形をもう一度タップすると選択） */
  private lastTapKey = '';

  constructor(app: ConstructorParameters<typeof Tool>[0]) {
    super(app);
    this.box = document.createElement('div');
    this.box.className = 'select-box';
    this.app.viewport.container.appendChild(this.box);
  }

  /** 視点を動かす操作（オービット・移動・拡大縮小）が左ドラッグ・1 本指に割り当てられているか */
  private viewing(): boolean {
    return this.app.viewport.navMode !== 'default';
  }

  hint(): string {
    if (this.viewing()) return 'ドラッグで視点を回転・ホイール／ピンチで拡大縮小。図形を選ぶときは、同じ図形を 2 回タップ（ダブルクリック）';
    return this.app.model.activeGroup
      ? 'グループを編集中。外側をクリックするか Esc で編集を終了します'
      : 'クリックで選択（Shift で追加/解除）。ダブルクリックで面と境界（グループなら中を編集）、トリプルクリックでつながった全体。ドラッグで範囲選択。Ctrl+G でグループ化';
  }

  reset(): void {
    this.down = null;
    this.gesture = false;
    this.touches.clear();
    this.lastTapKey = '';
    this.box.style.display = 'none';
    super.reset();
  }

  onPointerMove(e: PointerEvent): void {
    // 視点操作中・2 本指の操作中は、範囲選択も強調表示もしない
    if (this.gesture || this.viewing()) {
      this.box.style.display = 'none';
      if (e.pointerType !== 'mouse' || e.buttons) return;
      this.app.renderer.setHover([], []);
      return;
    }
    if (this.down && e.buttons & 1) {
      const p = this.app.viewport.toCanvas(e.clientX, e.clientY);
      const d = this.down;
      if (p.distanceTo(d) > 4) {
        const crossing = p.x < d.x;
        Object.assign(this.box.style, {
          display: 'block',
          left: `${Math.min(p.x, d.x)}px`,
          top: `${Math.min(p.y, d.y)}px`,
          width: `${Math.abs(p.x - d.x)}px`,
          height: `${Math.abs(p.y - d.y)}px`,
          borderStyle: crossing ? 'dashed' : 'solid',
        });
      }
      return;
    }
    const inf = this.app.inference.infer(e.clientX, e.clientY);
    this.app.ui.setCursorPosition(inf.point);
    const sel = this.app.expandPick(pickEntity(this.app, inf));
    this.app.renderer.setHover(sel.faces, sel.edges);
  }

  onPointerDown(e: PointerEvent): void {
    if (e.button !== 0) return;
    if (e.pointerType === 'touch') {
      if (e.isPrimary) this.touches.clear();
      this.touches.add(e.pointerId);
      if (this.touches.size > 1) {
        // 2 本目の指: ピンチ・移動なので選択はしない
        this.gesture = true;
        this.down = null;
        this.box.style.display = 'none';
        return;
      }
      this.gesture = false;
    }
    this.down = this.app.viewport.toCanvas(e.clientX, e.clientY);
  }

  onPointerUp(e: PointerEvent): void {
    if (e.pointerType === 'touch') {
      this.touches.delete(e.pointerId);
      if (this.gesture) {
        if (!this.touches.size) this.gesture = false;
        this.down = null;
        return;
      }
    }
    if (!this.down || e.button !== 0) return;
    const p = this.app.viewport.toCanvas(e.clientX, e.clientY);
    const start = this.down;
    this.down = null;
    this.box.style.display = 'none';
    if (this.viewing()) {
      // 視点操作中: ドラッグは視点の操作。同じ図形を続けて 2 回タップしたときだけ選ぶ
      if (p.distanceTo(start) > 6) return;
      const key = this.pickKey(e);
      // 描画が重いと処理が遅れるので、指を離した時刻（イベントの時刻）で比べる
      const t = e.timeStamp;
      const second = key !== '' && key === this.lastTapKey && t - this.lastClick < 700;
      this.lastTapKey = second ? '' : key;
      this.lastClick = t;
      if (second) this.clickSelect(e, 1);
      return;
    }
    if (p.distanceTo(start) > 4) {
      this.boxSelect(start, p, e.shiftKey);
      return;
    }
    const now = e.timeStamp;
    this.clicks = now - this.lastClick < 350 ? this.clicks + 1 : 1;
    this.lastClick = now;
    this.clickSelect(e, this.clicks);
  }

  /** タップした図形を表すキー（何も無ければ空文字） */
  private pickKey(e: PointerEvent): string {
    const ent = pickEntity(this.app, this.app.inference.infer(e.clientX, e.clientY));
    const sel = this.app.expandPick(ent);
    if (!sel.edges.length && !sel.faces.length) return '';
    return sel.group !== this.app.model.activeGroup ? `g${sel.group}` : `f${ent.face ?? ''}e${ent.edge ?? ''}`;
  }

  private clickSelect(e: PointerEvent, clicks: number): void {
    const app = this.app;
    const m = app.model;
    const inf = app.inference.infer(e.clientX, e.clientY);
    const ent = pickEntity(app, inf);
    let sel = app.expandPick(ent);
    // グループ編集中に外側をクリック → 編集を終了
    if (m.activeGroup && sel.group !== m.activeGroup) {
      app.exitGroup();
      sel = app.expandPick(ent);
    }
    if (!sel.edges.length && !sel.faces.length) {
      if (!e.shiftKey) app.selection.clear();
      return;
    }
    // 編集階層の外のグループ: ダブルクリックで中に入る
    if (sel.group !== m.activeGroup) {
      if (clicks >= 2) {
        app.enterGroup(sel.group);
        if (ent.face !== undefined) app.selection.set([], [ent.face]);
        else if (ent.edge !== undefined) app.selection.set([ent.edge], []);
        return;
      }
      if (e.shiftKey) app.selection.toggle(sel.edges, sel.faces);
      else app.selection.set(sel.edges, sel.faces);
      return;
    }
    let edges = sel.edges;
    let faces = sel.faces;
    if (clicks >= 3) {
      const c = m.connectedFrom(edges, faces);
      edges = [...c.edges];
      faces = [...c.faces];
    } else if (clicks === 2) {
      if (ent.face !== undefined) {
        edges = m.faceEdgeIds(ent.face);
      } else if (ent.edge !== undefined) {
        const ed = m.edges.get(ent.edge)!;
        faces = m.facesOfEdge(ed.a, ed.b).map((f) => f.id);
      }
    }
    if (e.shiftKey && clicks === 1) app.selection.toggle(edges, faces);
    else if (e.shiftKey || e.ctrlKey) app.selection.add(edges, faces);
    else app.selection.set(edges, faces);
  }

  private boxSelect(a: Vector2, b: Vector2, add: boolean): void {
    const app = this.app;
    const m = app.model;
    const minX = Math.min(a.x, b.x);
    const maxX = Math.max(a.x, b.x);
    const minY = Math.min(a.y, b.y);
    const maxY = Math.max(a.y, b.y);
    const crossing = b.x < a.x;
    const inside = new Map<number, boolean>();
    const scr = new Vector2();
    const camDir = app.viewport.camera.getWorldDirection(new Vector3());
    const isIn = (v: number) => {
      let r = inside.get(v);
      if (r === undefined) {
        const p = m.pos(v);
        const front = p.clone().sub(app.viewport.camera.position).dot(camDir) > 0;
        app.viewport.toScreen(p, scr);
        r = front && scr.x >= minX && scr.x <= maxX && scr.y >= minY && scr.y <= maxY;
        inside.set(v, r);
      }
      return r;
    };
    const test = (vs: number[]) => (crossing ? vs.some(isIn) : vs.every(isIn));
    const edges = new Set<number>();
    const faces = new Set<number>();
    // 編集中の階層の要素は個別に、それ以外のグループは丸ごと選ぶ
    for (const e of m.edges.values()) {
      if (!m.isLayerVisible(e.layer) || !test([e.a, e.b])) continue;
      const s = app.expandPick({ edge: e.id });
      s.edges.forEach((id) => edges.add(id));
      s.faces.forEach((id) => faces.add(id));
    }
    for (const f of m.faces.values()) {
      if (!m.isLayerVisible(f.layer) || !test(f.loop)) continue;
      const s = app.expandPick({ face: f.id });
      s.edges.forEach((id) => edges.add(id));
      s.faces.forEach((id) => faces.add(id));
    }
    if (add) app.selection.add(edges, faces);
    else app.selection.set(edges, faces);
  }
}
