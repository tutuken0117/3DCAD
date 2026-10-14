import { Raycaster, Vector3 } from 'three';
import { formatLength, parseLength } from '../core/units';
import { Tool, type ToolDef } from './Tool';

/**
 * 立ち位置・見回し・歩く（室内を見るためのツール）。
 *  - クリック: その場所（床）に立つ（目の高さは 1.6m。数字で変更）
 *  - ドラッグ: その場で見回す（外に出ていかない）
 *  - ホイール・↑↓: 前後に歩く ／ ←→: 左右に向きを変える（Shift で横歩き）
 *  壁にはぶつかって止まり、床の高さに合わせて上り下りする。
 */
export class WalkTool extends Tool {
  readonly def: ToolDef = { id: 'walk', label: '立ち位置', key: 'G', icon: 'walk' };
  vcbLabel = '目の高さ';
  /** 目の高さ (m) */
  eye = 1.6;
  /** 室内が見やすい広めの画角 */
  static readonly FOV = 62;
  private down: { x: number; y: number; yaw: number; pitch: number; moved: boolean } | null = null;
  private yaw = 0;
  private pitch = 0;
  private wheelHandler = (e: WheelEvent) => this.onWheel(e);
  private prevFov = 45;

  hint(): string {
    return `床をクリック（タップ）でそこに立つ・ドラッグで見回す・ホイール／↑↓で前後に歩く・←→で向きを変える（目の高さ ${formatLength(this.eye)}、数字で変更）`;
  }

  activate(): void {
    super.activate();
    const vp = this.app.viewport;
    vp.controls.enabled = false;
    vp.renderer.domElement.addEventListener('wheel', this.wheelHandler, { passive: false });
    if (vp.camera === vp.perspCamera) {
      this.prevFov = vp.perspCamera.fov;
      vp.perspCamera.fov = WalkTool.FOV;
      vp.perspCamera.updateProjectionMatrix();
    }
    this.readAngles();
    vp.requestRender();
  }

  deactivate(): void {
    super.deactivate();
    const vp = this.app.viewport;
    vp.controls.enabled = true;
    vp.renderer.domElement.removeEventListener('wheel', this.wheelHandler);
    vp.perspCamera.fov = this.prevFov;
    vp.perspCamera.updateProjectionMatrix();
    vp.controls.update();
    vp.requestRender();
  }

  /** 今の視線から向き（ヨー・ピッチ）を読む */
  private readAngles(): void {
    const vp = this.app.viewport;
    const d = vp.controls.target.clone().sub(vp.camera.position).normalize();
    this.yaw = Math.atan2(d.x, -d.z);
    this.pitch = Math.asin(Math.max(-1, Math.min(1, d.y)));
  }

  private dir(): Vector3 {
    const c = Math.cos(this.pitch);
    return new Vector3(Math.sin(this.yaw) * c, Math.sin(this.pitch), -Math.cos(this.yaw) * c);
  }

  /** カメラを今の位置・向きに合わせる（注視点はすぐ目の前） */
  private apply(pos = this.app.viewport.camera.position.clone()): void {
    const vp = this.app.viewport;
    vp.camera.position.copy(pos);
    vp.controls.target.copy(pos).addScaledVector(this.dir(), 1);
    vp.camera.lookAt(vp.controls.target);
    vp.requestRender();
  }

  /** 点 p から下を見て、最初にある床（上向きの面）の高さ。p より up だけ上から探す */
  private floorUnder(p: Vector3, up = 0.3): number | undefined {
    const rc = new Raycaster(p.clone().setY(p.y + up), new Vector3(0, -1, 0), 0, up + 50);
    const hit = this.app.renderer.pickFace(rc);
    return hit && hit.normal.y > 0.5 ? hit.point.y : undefined;
  }

  /** 水平方向 d に dist 進む（壁の手前 0.3m で止まる） */
  private walk(d: Vector3, dist: number): void {
    const vp = this.app.viewport;
    const pos = vp.camera.position.clone();
    const h = d.clone().setY(0);
    if (h.lengthSq() < 1e-9) return;
    h.normalize();
    const sign = Math.sign(dist);
    const dirMove = h.clone().multiplyScalar(sign);
    // 腰の高さと目の高さで壁を確かめる
    let allowed = Math.abs(dist);
    for (const dy of [-this.eye + 0.5, 0]) {
      const rc = new Raycaster(pos.clone().add(new Vector3(0, dy, 0)), dirMove, 0, Math.abs(dist) + 0.3);
      const hit = this.app.renderer.pickFace(rc);
      if (hit && Math.abs(hit.normal.y) < 0.7) allowed = Math.min(allowed, Math.max(0, hit.distance - 0.3));
    }
    if (allowed <= 0.001) return this.app.ui.toast('壁があります');
    const next = pos.addScaledVector(dirMove, allowed);
    // 足元から 0.5m 上までの段差は上り下りする
    const floor = this.floorUnder(next.clone().setY(next.y - this.eye), 0.5);
    if (floor !== undefined && Math.abs(floor + this.eye - next.y) < 0.6) next.y = floor + this.eye;
    this.apply(next);
  }

  onPointerDown(e: PointerEvent): void {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    this.readAngles();
    this.down = { x: e.clientX, y: e.clientY, yaw: this.yaw, pitch: this.pitch, moved: false };
  }

  onPointerMove(e: PointerEvent): void {
    if (!this.down || (e.buttons === 0 && e.pointerType === 'mouse')) {
      this.down = null;
      return;
    }
    const dx = e.clientX - this.down.x;
    const dy = e.clientY - this.down.y;
    if (!this.down.moved && Math.hypot(dx, dy) < 5) return;
    this.down.moved = true;
    // ドラッグした向きに視線を動かす（画面をつかんで回す感覚）
    const k = (this.app.viewport.perspCamera.fov * Math.PI) / 180 / this.app.viewport.size.y;
    this.yaw = this.down.yaw - dx * k;
    this.pitch = Math.max(-1.45, Math.min(1.45, this.down.pitch + dy * k));
    this.apply();
  }

  onPointerUp(e: PointerEvent): void {
    const d = this.down;
    this.down = null;
    if (!d || d.moved) return;
    // クリック: そこに立つ
    const hit = this.app.renderer.pickFace(this.app.viewport.raycaster(e.clientX, e.clientY));
    if (!hit) return this.app.ui.toast('床（面）をクリックしてください');
    let p = hit.point.clone();
    if (hit.normal.y < 0.5) {
      // 壁をクリックしたら、その手前の床に立つ
      const back = this.app.viewport.camera.position.clone().sub(hit.point).setY(0).normalize();
      p.addScaledVector(back, 0.6);
      // クリックした高さから下を探す（屋根の上に立たないように）
      const f = this.floorUnder(p, 0.05);
      p.y = f ?? this.app.viewport.camera.position.y - this.eye;
    }
    p = p.add(new Vector3(0, this.eye, 0));
    // 向きは今のまま（水平に近づける）
    this.pitch = Math.max(-0.3, Math.min(0.3, this.pitch));
    this.apply(p);
    this.updateStatus();
  }

  private onWheel(e: WheelEvent): void {
    e.preventDefault();
    this.readAngles();
    this.walk(this.dir(), e.deltaY < 0 ? 0.5 : -0.5);
  }

  onKeyDown(e: KeyboardEvent): boolean {
    if (e.key === 'Escape') {
      this.app.setTool('select');
      return true;
    }
    this.readAngles();
    const step = e.shiftKey ? 0.8 : 0.4;
    switch (e.key) {
      case 'ArrowUp':
        this.walk(this.dir(), step);
        return true;
      case 'ArrowDown':
        this.walk(this.dir(), -step);
        return true;
      case 'ArrowLeft':
      case 'ArrowRight': {
        const s = e.key === 'ArrowLeft' ? -1 : 1;
        if (e.shiftKey) {
          const right = new Vector3(Math.cos(this.yaw), 0, Math.sin(this.yaw));
          this.walk(right, 0.4 * s);
        } else {
          this.yaw += s * 0.12;
          this.apply();
        }
        return true;
      }
    }
    return false;
  }

  /** 目の高さを変える */
  onVcb(text: string): boolean {
    const v = parseLength(text);
    if (v === null || v <= 0 || v > 50) return false;
    const vp = this.app.viewport;
    const pos = vp.camera.position.clone();
    pos.y += v - this.eye;
    this.eye = v;
    this.apply(pos);
    this.updateStatus();
    return true;
  }
}
