import type { Model, ModelData } from './Model';

/** スナップショット方式の元に戻す / やり直し */
export class History {
  private undoStack: { label: string; state: string }[] = [];
  private redoStack: { label: string; state: string }[] = [];
  private current: string;
  private listeners = new Set<() => void>();

  constructor(
    private model: Model,
    private limit = 100,
  ) {
    this.current = JSON.stringify(model.toJSON());
  }

  onChange(fn: () => void): void {
    this.listeners.add(fn);
  }

  private emit(): void {
    for (const fn of this.listeners) fn();
  }

  /** 操作の確定。モデル変更後に呼ぶ */
  commit(label: string): void {
    const next = JSON.stringify(this.model.toJSON());
    if (next === this.current) {
      this.model.emitChange();
      return;
    }
    this.undoStack.push({ label, state: this.current });
    if (this.undoStack.length > this.limit) this.undoStack.shift();
    this.redoStack = [];
    this.current = next;
    this.model.emitChange();
    this.emit();
  }

  /** 履歴を作らずに現在の状態を基準にする（ファイルを開いたときなど） */
  reset(): void {
    this.undoStack = [];
    this.redoStack = [];
    this.current = JSON.stringify(this.model.toJSON());
    this.model.emitChange();
    this.emit();
  }

  /** コミットされていない変更を破棄して直前の確定状態に戻す */
  revert(): void {
    this.model.load(JSON.parse(this.current) as ModelData);
    this.model.emitChange();
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  undo(): string | undefined {
    const prev = this.undoStack.pop();
    if (!prev) return undefined;
    this.redoStack.push({ label: prev.label, state: this.current });
    this.current = prev.state;
    this.model.load(JSON.parse(prev.state) as ModelData);
    this.model.emitChange();
    this.emit();
    return prev.label;
  }

  redo(): string | undefined {
    const next = this.redoStack.pop();
    if (!next) return undefined;
    this.undoStack.push({ label: next.label, state: this.current });
    this.current = next.state;
    this.model.load(JSON.parse(next.state) as ModelData);
    this.model.emitChange();
    this.emit();
    return next.label;
  }
}
