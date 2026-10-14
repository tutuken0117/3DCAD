import { BufferGeometry, DoubleSide, Float32BufferAttribute, Group, Mesh, MeshBasicMaterial, Plane, Raycaster, Vector3 } from 'three';
import { furnitureMesh, getFurniture, placeFurniture, type FurnitureDef } from '../core/furniture';
import { Tool, type ToolDef } from './Tool';

/**
 * 家具を置くツール。
 *  - 床をクリック: その場所に置く（R・Tab で 90° 回す）
 *  - 壁をクリック: 背中を壁に付けて置く（壁付けの物は決まった高さに）
 *  - 天井をクリック: 照明・エアコンなどを天井に付ける
 */
export class FurnitureTool extends Tool {
  readonly def: ToolDef = { id: 'furniture', label: '家具を置く', key: 'F', icon: 'furniture' };
  current: FurnitureDef | undefined;
  private rot = 0;
  private ghost: Group | null = null;
  private place: { pos: Vector3; rot: number } | null = null;

  hint(): string {
    if (!this.current) return '右の「家具」パネルで置く物を選んでください';
    const where = this.current.mount === 'wall' ? '壁をクリックで取り付け' : this.current.mount === 'ceiling' ? '天井をクリックで取り付け' : '床をクリックで置く（壁の近くなら壁に寄せる）';
    return `${this.current.name}: ${where}・R / Tab で 90° 回す・Esc で終わる`;
  }

  setFurniture(id: string): void {
    this.current = getFurniture(id);
    this.rebuildGhost();
    this.updateStatus();
  }

  activate(): void {
    super.activate();
    this.app.viewport.setNavigationMode('default');
    this.rebuildGhost();
  }

  deactivate(): void {
    super.deactivate();
    this.removeGhost();
    if (this.app.presentation.active) this.app.viewport.setNavigationMode('orbit');
  }

  private removeGhost(): void {
    if (!this.ghost) return;
    this.ghost.removeFromParent();
    this.ghost.traverse((o) => {
      if (o instanceof Mesh) o.geometry.dispose();
    });
    this.ghost = null;
    this.app.viewport.requestRender();
  }

  /** 置く前の半透明の見本 */
  private rebuildGhost(): void {
    this.removeGhost();
    if (!this.current) return;
    const { points, faces } = furnitureMesh(this.current, new Vector3(), 0);
    const pos: number[] = [];
    for (const f of faces)
      for (let i = 1; i < f.outer.length - 1; i++)
        for (const k of [f.outer[0], f.outer[i], f.outer[i + 1]]) pos.push(points[k].x, points[k].y, points[k].z);
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(pos, 3));
    const mesh = new Mesh(g, new MeshBasicMaterial({ color: 0x2f7bff, transparent: true, opacity: 0.45, side: DoubleSide, depthWrite: false }));
    this.ghost = new Group();
    this.ghost.add(mesh);
    this.ghost.visible = false;
    this.app.viewport.scene.add(this.ghost);
  }

  /** 面の高さを、真下・真上に探す */
  private probe(from: Vector3, dir: 1 | -1, max = 6): number | undefined {
    const rc = new Raycaster(from, new Vector3(0, dir, 0), 0, max);
    const hit = this.app.renderer.pickFace(rc);
    if (!hit) return undefined;
    return dir < 0 ? (hit.normal.y > 0.5 ? hit.point.y : undefined) : hit.normal.y < -0.5 ? hit.point.y : undefined;
  }

  private compute(e: { clientX: number; clientY: number }): { pos: Vector3; rot: number } | null {
    const def = this.current;
    if (!def) return null;
    const rc = this.app.viewport.raycaster(e.clientX, e.clientY);
    const hit = this.app.renderer.pickFace(rc);
    let point: Vector3;
    let n = new Vector3(0, 1, 0);
    if (hit) {
      point = hit.point;
      n = hit.normal.clone();
      // 裏から見たときは向きを反転
      if (n.dot(rc.ray.direction) > 0) n.negate();
    } else {
      const p = rc.ray.intersectPlane(new Plane(new Vector3(0, 1, 0), 0), new Vector3());
      if (!p) return null;
      point = p;
    }
    const wall = Math.abs(n.y) < 0.5;
    const wallRot = Math.atan2(n.x, n.z);
    if (def.mount === 'ceiling') {
      if (n.y < -0.5) return { pos: point.clone(), rot: this.rot };
      const top = this.probe(point.clone().add(new Vector3(0, 0.05, 0)), 1, 30);
      return { pos: point.clone().setY(top ?? point.y + 2.6), rot: this.rot };
    }
    if (def.mount === 'wall') {
      if (!wall) return null;
      const floor = this.probe(point.clone().addScaledVector(n, 0.05).add(new Vector3(0, 0.2, 0)), -1, 10);
      return { pos: point.clone().addScaledVector(n, 0.002).setY((floor ?? point.y) + (def.wallHeight ?? 1)), rot: wallRot };
    }
    // 床置き
    if (wall) {
      // 壁に背中を付けて、その下の床に置く
      const p = point.clone().addScaledVector(n, def.size[1] / 2 + 0.005);
      const floor = this.probe(p.clone().add(new Vector3(0, 0.3, 0)), -1, 10);
      return { pos: p.setY(floor ?? 0), rot: wallRot + this.rot };
    }
    return { pos: point.clone(), rot: this.rot };
  }

  onPointerMove(e: PointerEvent): void {
    if (e.buttons) return; // ドラッグ中（視点操作）
    this.place = this.compute(e);
    if (!this.ghost) return;
    this.ghost.visible = !!this.place;
    if (this.place && this.current) {
      // 見本は回転 0 で作ってあるので、位置と回転を合わせて作り直す
      const { points, faces } = furnitureMesh(this.current, this.place.pos, this.place.rot);
      const pos: number[] = [];
      for (const f of faces)
        for (let i = 1; i < f.outer.length - 1; i++)
          for (const k of [f.outer[0], f.outer[i], f.outer[i + 1]]) pos.push(points[k].x, points[k].y, points[k].z);
      const mesh = this.ghost.children[0] as Mesh;
      mesh.geometry.setAttribute('position', new Float32BufferAttribute(pos, 3));
      mesh.geometry.computeBoundingSphere();
    }
    this.app.viewport.requestRender();
  }

  onPointerDown(e: PointerEvent): void {
    if (e.button !== 0 || !this.current) return;
    const at = this.compute(e);
    if (!at) {
      this.app.ui.toast(this.current.mount === 'wall' ? '壁をクリックしてください' : '置く場所をクリックしてください');
      return;
    }
    const gid = placeFurniture(this.app.model, this.current, at.pos, at.rot);
    if (gid === undefined) return;
    this.app.history.commit(`家具: ${this.current.name}`);
    this.app.ui.toast(`${this.current.name}を置きました（続けてクリックで同じ物を置けます。動かすときは移動ツール）`);
  }

  onKeyDown(e: KeyboardEvent): boolean {
    if (e.key === 'Escape') {
      this.app.setTool('select');
      return true;
    }
    if (e.key === 'r' || e.key === 'R' || e.key === 'Tab') {
      this.rot += ((e.shiftKey ? -1 : 1) * Math.PI) / 2;
      this.app.ui.toast(`向き ${Math.round((((this.rot * 180) / Math.PI) % 360 + 360) % 360)}°`);
      return true;
    }
    return false;
  }
}
