import type { Model } from './Model';

/** 選択中のエッジと面 */
export class Selection {
  readonly edges = new Set<number>();
  readonly faces = new Set<number>();
  private listeners = new Set<() => void>();

  constructor(private model: Model) {
    // モデルから消えた要素は選択から外す
    model.onChange(() => {
      let changed = false;
      for (const id of this.edges) if (!model.edges.has(id)) (this.edges.delete(id), (changed = true));
      for (const id of this.faces) if (!model.faces.has(id)) (this.faces.delete(id), (changed = true));
      if (changed) this.emit();
    });
  }

  onChange(fn: () => void): void {
    this.listeners.add(fn);
  }

  private emit(): void {
    for (const fn of this.listeners) fn();
  }

  get isEmpty(): boolean {
    return this.edges.size === 0 && this.faces.size === 0;
  }

  clear(): void {
    if (this.isEmpty) return;
    this.edges.clear();
    this.faces.clear();
    this.emit();
  }

  set(edges: Iterable<number>, faces: Iterable<number>): void {
    this.edges.clear();
    this.faces.clear();
    for (const e of edges) this.edges.add(e);
    for (const f of faces) this.faces.add(f);
    this.emit();
  }

  add(edges: Iterable<number>, faces: Iterable<number>): void {
    for (const e of edges) this.edges.add(e);
    for (const f of faces) this.faces.add(f);
    this.emit();
  }

  toggle(edges: Iterable<number>, faces: Iterable<number>): void {
    for (const e of edges) (this.edges.has(e) ? this.edges.delete(e) : this.edges.add(e));
    for (const f of faces) (this.faces.has(f) ? this.faces.delete(f) : this.faces.add(f));
    this.emit();
  }

  selectAll(): void {
    this.set(
      [...this.model.edges.values()].filter((e) => this.model.isLayerVisible(e.layer)).map((e) => e.id),
      [...this.model.faces.values()].filter((f) => this.model.isLayerVisible(f.layer)).map((f) => f.id),
    );
  }

  /** 選択に含まれる頂点（面の頂点も含む） */
  vertexIds(): Set<number> {
    const vs = new Set<number>();
    for (const id of this.edges) {
      const e = this.model.edges.get(id);
      if (e) (vs.add(e.a), vs.add(e.b));
    }
    for (const id of this.faces) for (const v of this.model.faces.get(id)?.loop ?? []) vs.add(v);
    return vs;
  }
}
