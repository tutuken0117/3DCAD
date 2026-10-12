import { Plane, Vector3 } from 'three';
import type { App } from '../App';
import { AXIS_DIRS, type InferenceOptions, type InferenceResult } from '../view/Inference';

export interface ToolDef {
  id: string;
  label: string;
  /** ショートカットキー（表示用） */
  key: string;
  icon: string;
}

/**
 * ツールの基底クラス。
 * マウス・キー入力と、画面右下の「数値入力（VCB）」を受け取る。
 */
export abstract class Tool {
  abstract readonly def: ToolDef;
  /** 数値入力ボックスのラベル */
  vcbLabel = '';
  /** 矢印キーでロックした方向 */
  protected lockDir: Vector3 | undefined;
  protected shiftLock: Vector3 | undefined;

  constructor(protected app: App) {}

  activate(): void {
    this.reset();
  }

  deactivate(): void {
    this.reset();
  }

  /** 操作を中断して初期状態に戻す（Esc） */
  reset(): void {
    this.lockDir = undefined;
    this.shiftLock = undefined;
    this.app.overlay.clear();
    this.app.renderer.setHover([]);
    this.updateStatus();
  }

  /** ステータスバーの説明文 */
  abstract hint(): string;

  updateStatus(): void {
    this.app.ui.setHint(this.hint());
    this.app.ui.setVcbLabel(this.vcbLabel);
  }

  onPointerDown(_e: PointerEvent): void {}
  onPointerMove(_e: PointerEvent): void {}
  onPointerUp(_e: PointerEvent): void {}
  onDoubleClick(_e: MouseEvent): void {}

  /** 数値入力の確定。処理したら true */
  onVcb(_text: string): boolean {
    return false;
  }

  /** キー入力。処理したら true */
  onKeyDown(e: KeyboardEvent): boolean {
    if (e.key === 'Escape') {
      this.reset();
      return true;
    }
    const axes: Record<string, Vector3> = {
      ArrowRight: AXIS_DIRS.x,
      ArrowLeft: AXIS_DIRS.z,
      ArrowUp: AXIS_DIRS.y,
      ArrowDown: AXIS_DIRS.y,
    };
    if (axes[e.key]) {
      const d = axes[e.key];
      this.lockDir = this.lockDir && this.lockDir.equals(d) ? undefined : d.clone();
      this.app.ui.toast(this.lockDir ? '方向をロックしました（もう一度押すと解除）' : 'ロックを解除しました');
      return true;
    }
    return false;
  }

  onKeyUp(_e: KeyboardEvent): void {}

  /** 推定つきのカーソル位置 */
  protected infer(e: { clientX: number; clientY: number }, opt: InferenceOptions = {}): InferenceResult {
    const lock = this.lockDir ?? this.shiftLock;
    const inf = this.app.inference.infer(e.clientX, e.clientY, { ...opt, lockDir: opt.from ? lock : undefined });
    this.app.overlay.showInference(inf, e.clientX, e.clientY);
    this.app.ui.setCursorPosition(inf.point);
    return inf;
  }

  /** 面上なら面の平面、それ以外は水平面 */
  protected planeFrom(inf: InferenceResult): Plane {
    if ((inf.type === 'onFace' || inf.type === 'onSheet' || inf.sheet) && inf.normal) {
      return new Plane().setFromNormalAndCoplanarPoint(inf.normal, inf.point);
    }
    return new Plane(new Vector3(0, 1, 0), -inf.point.y);
  }

  /** モデル上の頂点を取得（エッジ上なら分割して頂点を作る） */
  protected vertexAt(inf: InferenceResult): number {
    const m = this.app.model;
    // 別のグループの点にスナップした場合は、位置だけ使って今の階層に頂点を作る（くっつかない）
    if (inf.vertexId !== undefined && m.vertices.has(inf.vertexId) && m.groupOf(inf.vertexId) === m.activeGroup) return inf.vertexId;
    const existing = m.findVertex(inf.point);
    if (existing !== undefined) return existing;
    if (
      (inf.type === 'onEdge' || inf.type === 'midpoint') &&
      inf.edgeId !== undefined &&
      m.edges.has(inf.edgeId) &&
      m.groupOfEdge(inf.edgeId) === m.activeGroup
    ) {
      return m.splitEdge(inf.edgeId, inf.point);
    }
    return m.addVertex(inf.point);
  }
}
