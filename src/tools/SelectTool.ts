import { Vector2, Vector3 } from 'three';
import { pickEntity } from './ModifyTools';
import { Tool, type ToolDef } from './Tool';

export class SelectTool extends Tool {
  readonly def: ToolDef = { id: 'select', label: '選択', key: 'Space', icon: 'select' };
  private down: Vector2 | null = null;
  private box: HTMLDivElement;
  private clicks = 0;
  private lastClick = 0;

  constructor(app: ConstructorParameters<typeof Tool>[0]) {
    super(app);
    this.box = document.createElement('div');
    this.box.className = 'select-box';
    this.app.viewport.container.appendChild(this.box);
  }

  hint(): string {
    return 'クリックで選択（Shift で追加/解除）。ダブルクリックで面と境界、トリプルクリックでつながった全体。ドラッグで範囲選択（左→右: 完全に囲む / 右→左: 一部でも）';
  }

  reset(): void {
    this.down = null;
    this.box.style.display = 'none';
    super.reset();
  }

  onPointerMove(e: PointerEvent): void {
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
    const ent = pickEntity(this.app, inf);
    this.app.renderer.setHover(ent.face !== undefined ? [ent.face] : [], ent.edge !== undefined ? [ent.edge] : []);
  }

  onPointerDown(e: PointerEvent): void {
    if (e.button !== 0) return;
    this.down = this.app.viewport.toCanvas(e.clientX, e.clientY);
  }

  onPointerUp(e: PointerEvent): void {
    if (!this.down || e.button !== 0) return;
    const p = this.app.viewport.toCanvas(e.clientX, e.clientY);
    const start = this.down;
    this.down = null;
    this.box.style.display = 'none';
    if (p.distanceTo(start) > 4) {
      this.boxSelect(start, p, e.shiftKey);
      return;
    }
    const now = performance.now();
    this.clicks = now - this.lastClick < 350 ? this.clicks + 1 : 1;
    this.lastClick = now;
    this.clickSelect(e, this.clicks);
  }

  private clickSelect(e: PointerEvent, clicks: number): void {
    const app = this.app;
    const m = app.model;
    const inf = app.inference.infer(e.clientX, e.clientY);
    const ent = pickEntity(app, inf);
    if (ent.edge === undefined && ent.face === undefined) {
      if (!e.shiftKey) app.selection.clear();
      return;
    }
    let edges: number[] = ent.edge !== undefined ? [ent.edge] : [];
    let faces: number[] = ent.face !== undefined ? [ent.face] : [];
    if (clicks >= 3) {
      const c = m.connectedFrom(edges, faces);
      edges = [...c.edges];
      faces = [...c.faces];
    } else if (clicks === 2) {
      if (ent.face !== undefined) {
        const L = m.faces.get(ent.face)!.loop;
        for (let i = 0; i < L.length; i++) {
          const id = m.findEdge(L[i], L[(i + 1) % L.length]);
          if (id !== undefined) edges.push(id);
        }
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
    const edges: number[] = [];
    const faces: number[] = [];
    for (const e of m.edges.values()) if (m.isLayerVisible(e.layer) && test([e.a, e.b])) edges.push(e.id);
    for (const f of m.faces.values()) if (m.isLayerVisible(f.layer) && test(f.loop)) faces.push(f.id);
    if (add) app.selection.add(edges, faces);
    else app.selection.set(edges, faces);
  }
}
