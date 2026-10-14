import { Box3, Vector3 } from 'three';
import {
  MERGE_TOL,
  PLANE_TOL,
  centroid,
  closestParamOnSegment,
  isPlanar,
  pointInPolygon,
  polygonArea,
  polygonNormal,
  triangulate,
} from './geometry';

export interface Edge {
  id: number;
  a: number;
  b: number;
  layer: string;
}

export interface Face {
  id: number;
  /** 外周の頂点 ID のループ。右ねじの向きが表面の法線 */
  loop: number[];
  /** 穴（内周）のループ */
  holes?: number[][];
  layer: string;
  color?: string;
}

export interface Layer {
  name: string;
  color: string;
  visible: boolean;
}

export interface GroupInfo {
  id: number;
  name: string;
}

export interface ModelData {
  version: 1;
  /** [id, x, y, z, group?] */
  vertices: [number, number, number, number, number?][];
  edges: [number, number, number, string][];
  faces: { id: number; loop: number[]; holes?: number[][]; layer: string; color?: string }[];
  layers: Layer[];
  currentLayer: string;
  groups?: GroupInfo[];
}

export const DEFAULT_LAYER = '0';

const edgeKey = (a: number, b: number) => (a < b ? `${a}_${b}` : `${b}_${a}`);

/**
 * SketchUp と同じ「くっつくジオメトリ」モデル。
 * 頂点は位置が同じなら共有され、面は境界のエッジを共有する。
 * そのため、面をプッシュ/プルすると隣の面が一緒に伸び縮みする。
 *
 * グループ: 頂点ごとに所属グループ（0 = グループ外）を持ち、
 * 違うグループの頂点どうしは同じ位置でも共有しない（＝くっつかない）。
 */
export class Model {
  readonly vertices = new Map<number, Vector3>();
  readonly edges = new Map<number, Edge>();
  readonly faces = new Map<number, Face>();
  readonly layers = new Map<string, Layer>();
  readonly groups = new Map<number, GroupInfo>();
  currentLayer = DEFAULT_LAYER;
  /** 編集中のグループ（0 = グループの外） */
  activeGroup = 0;

  private vertexGroup = new Map<number, number>();
  private nextId = 1;
  private edgeIndex = new Map<string, number>();
  private vertexGrid: Map<string, number[]> | null = null;
  private listeners = new Set<() => void>();

  constructor() {
    this.layers.set(DEFAULT_LAYER, { name: DEFAULT_LAYER, color: '#ffffff', visible: true });
  }

  // ------------------------------------------------------------------
  // 変更通知
  // ------------------------------------------------------------------

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emitChange(): void {
    for (const fn of this.listeners) fn();
  }

  // ------------------------------------------------------------------
  // レイヤー（タグ）
  // ------------------------------------------------------------------

  ensureLayer(name: string, color?: string): Layer {
    let l = this.layers.get(name);
    if (!l) {
      l = { name, color: color ?? randomLayerColor(this.layers.size), visible: true };
      this.layers.set(name, l);
    }
    return l;
  }

  isLayerVisible(name: string): boolean {
    return this.layers.get(name)?.visible ?? true;
  }

  // ------------------------------------------------------------------
  // グループ
  // ------------------------------------------------------------------

  groupOf(v: number): number {
    return this.vertexGroup.get(v) ?? 0;
  }

  groupOfFace(f: Face | number): number {
    const face = typeof f === 'number' ? this.faces.get(f) : f;
    return face ? this.groupOf(face.loop[0]) : 0;
  }

  groupOfEdge(e: Edge | number): number {
    const edge = typeof e === 'number' ? this.edges.get(e) : e;
    return edge ? this.groupOf(edge.a) : 0;
  }

  private setVertexGroup(v: number, g: number): void {
    if (g) this.vertexGroup.set(v, g);
    else this.vertexGroup.delete(v);
  }

  /** グループに属する面とエッジ */
  groupEntities(gid: number): { edges: number[]; faces: number[] } {
    const edges = [...this.edges.values()].filter((e) => this.groupOfEdge(e) === gid).map((e) => e.id);
    const faces = [...this.faces.values()].filter((f) => this.groupOfFace(f) === gid).map((f) => f.id);
    return { edges, faces };
  }

  /**
   * 選んだ面・エッジをグループにする。
   * グループ外のジオメトリと共有している頂点は複製して切り離す。
   */
  makeGroup(edgeIds: Iterable<number>, faceIds: Iterable<number>, name?: string): number | undefined {
    const faces = new Set<number>([...faceIds].filter((id) => this.faces.has(id)));
    const edges = new Set<number>([...edgeIds].filter((id) => this.edges.has(id)));
    for (const id of faces) for (const e of this.faceEdgeIds(id)) edges.add(e);
    if (!faces.size && !edges.size) return undefined;

    const gid = this.nextId++;
    this.groups.set(gid, { id: gid, name: name ?? `グループ${this.groups.size + 1}` });

    // 選択外でも使われている頂点を調べる
    const outside = new Set<number>();
    for (const e of this.edges.values()) if (!edges.has(e.id)) (outside.add(e.a), outside.add(e.b));
    for (const f of this.faces.values()) if (!faces.has(f.id)) for (const L of this.faceLoops(f)) for (const v of L) outside.add(v);

    const remap = new Map<number, number>();
    const r = (v: number) => {
      let n = remap.get(v);
      if (n === undefined) {
        n = outside.has(v) ? this.addVertex(this.pos(v).clone(), false, gid) : v;
        this.setVertexGroup(n, gid);
        remap.set(v, n);
      }
      return n;
    };
    for (const id of edges) {
      const e = this.edges.get(id)!;
      const a = r(e.a);
      const b = r(e.b);
      if (a !== e.a || b !== e.b) {
        this.edgeIndex.delete(edgeKey(e.a, e.b));
        e.a = a;
        e.b = b;
        this.edgeIndex.set(edgeKey(a, b), e.id);
      }
    }
    for (const id of faces) {
      const f = this.faces.get(id)!;
      f.loop = f.loop.map(r);
      if (f.holes) f.holes = f.holes.map((h) => h.map(r));
    }
    // 切り離したことで残ったグループ外の境界エッジを補う
    for (const f of this.faces.values()) {
      if (faces.has(f.id)) continue;
      for (const L of this.faceLoops(f)) {
        for (let i = 0; i < L.length; i++) {
          const a = L[i];
          const b = L[(i + 1) % L.length];
          if (this.findEdge(a, b) === undefined) this.addEdge(a, b, f.layer);
        }
      }
    }
    this.vertexGrid = null;
    this.removeUnusedVertices();
    return gid;
  }

  /**
   * 多角形の面（ブーリアン演算の結果など）を新しいグループとして追加する。
   * points はローカル座標、faces は points のインデックス。
   */
  addPolyFacesAsGroup(
    points: Vector3[],
    faces: { outer: number[]; holes: number[][]; color?: string }[],
    name: string,
    layer = this.currentLayer,
    color?: string,
  ): number | undefined {
    if (!faces.length) return undefined;
    const gid = this.nextId++;
    this.groups.set(gid, { id: gid, name });
    const ids = new Map<number, number>();
    const vid = (i: number) => {
      let v = ids.get(i);
      if (v === undefined) {
        v = this.addVertex(points[i], true, gid);
        ids.set(i, v);
      }
      return v;
    };
    let count = 0;
    for (const f of faces) {
      const outer = f.outer.map(vid);
      const holes = f.holes.map((h) => h.map(vid));
      // 重なった頂点で潰れたループは除く
      if (new Set(outer).size < 3) continue;
      if (this.addFaceFromVertices(outer, layer, f.color ?? color, holes.filter((h) => new Set(h).size >= 3)) !== undefined) count++;
    }
    if (!count) {
      this.groups.delete(gid);
      this.removeUnusedVertices();
      return undefined;
    }
    return gid;
  }

  /** グループを解除する（中身は編集中の階層に戻り、他のジオメトリとくっつく） */
  explodeGroup(gid: number): void {
    if (!this.groups.has(gid)) return;
    for (const [v, g] of [...this.vertexGroup]) if (g === gid) this.setVertexGroup(v, this.activeGroup === gid ? 0 : this.activeGroup);
    this.groups.delete(gid);
    if (this.activeGroup === gid) this.activeGroup = 0;
    this.mergeCoincidentVertices();
  }

  // ------------------------------------------------------------------
  // 頂点
  // ------------------------------------------------------------------

  private cellKey(x: number, y: number, z: number): string {
    return `${x},${y},${z}`;
  }

  private cellOf(p: Vector3): [number, number, number] {
    const s = MERGE_TOL * 10;
    return [Math.floor(p.x / s), Math.floor(p.y / s), Math.floor(p.z / s)];
  }

  private grid(): Map<string, number[]> {
    if (this.vertexGrid) return this.vertexGrid;
    const g = new Map<string, number[]>();
    for (const [id, p] of this.vertices) {
      const k = this.cellKey(...this.cellOf(p));
      const arr = g.get(k);
      if (arr) arr.push(id);
      else g.set(k, [id]);
    }
    this.vertexGrid = g;
    return g;
  }

  /** p と同じ位置にある既存頂点を探す（同じグループ内のみ） */
  findVertex(p: Vector3, tol = MERGE_TOL, group = this.activeGroup): number | undefined {
    const g = this.grid();
    const [cx, cy, cz] = this.cellOf(p);
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (let dz = -1; dz <= 1; dz++) {
          const ids = g.get(this.cellKey(cx + dx, cy + dy, cz + dz));
          if (!ids) continue;
          for (const id of ids) {
            const q = this.vertices.get(id);
            if (q && this.groupOf(id) === group && q.distanceTo(p) <= tol) return id;
          }
        }
    return undefined;
  }

  /** 頂点を追加する。merge=true なら同じグループ・同じ位置の既存頂点を再利用する */
  addVertex(p: Vector3, merge = true, group = this.activeGroup): number {
    if (merge) {
      const found = this.findVertex(p, MERGE_TOL, group);
      if (found !== undefined) return found;
    }
    const id = this.nextId++;
    this.vertices.set(id, p.clone());
    this.setVertexGroup(id, group);
    if (this.vertexGrid) {
      const k = this.cellKey(...this.cellOf(p));
      const arr = this.vertexGrid.get(k);
      if (arr) arr.push(id);
      else this.vertexGrid.set(k, [id]);
    }
    return id;
  }

  pos(id: number): Vector3 {
    const p = this.vertices.get(id);
    if (!p) throw new Error(`頂点 ${id} がありません`);
    return p;
  }

  /** 頂点群を平行移動する（つながっている面・エッジは一緒に変形する） */
  moveVertices(ids: Iterable<number>, delta: Vector3): void {
    for (const id of new Set(ids)) this.vertices.get(id)?.add(delta);
    this.vertexGrid = null;
    this.mergeCoincidentVertices();
  }

  /** 移動などで重なった頂点を統合する（同じグループ内のみ） */
  mergeCoincidentVertices(): void {
    this.vertexGrid = null;
    const remap = new Map<number, number>();
    const seen = new Map<string, number[]>();
    for (const [id, p] of this.vertices) {
      const [cx, cy, cz] = this.cellOf(p);
      const g = this.groupOf(id);
      let target: number | undefined;
      for (let dx = -1; dx <= 1 && target === undefined; dx++)
        for (let dy = -1; dy <= 1 && target === undefined; dy++)
          for (let dz = -1; dz <= 1 && target === undefined; dz++) {
            for (const other of seen.get(this.cellKey(cx + dx, cy + dy, cz + dz)) ?? []) {
              if (this.groupOf(other) === g && this.vertices.get(other)!.distanceTo(p) <= MERGE_TOL) {
                target = other;
                break;
              }
            }
          }
      if (target !== undefined) {
        remap.set(id, target);
      } else {
        const k = this.cellKey(cx, cy, cz);
        const arr = seen.get(k);
        if (arr) arr.push(id);
        else seen.set(k, [id]);
      }
    }
    if (remap.size === 0) return;
    const r = (id: number) => remap.get(id) ?? id;
    for (const id of remap.keys()) (this.vertices.delete(id), this.vertexGroup.delete(id));
    // エッジを付け替え（潰れたもの・重複は削除）
    const oldEdges = [...this.edges.values()];
    this.edges.clear();
    this.edgeIndex.clear();
    for (const e of oldEdges) {
      const a = r(e.a);
      const b = r(e.b);
      if (a === b || this.edgeIndex.has(edgeKey(a, b))) continue;
      const ne = { ...e, a, b };
      this.edges.set(ne.id, ne);
      this.edgeIndex.set(edgeKey(a, b), ne.id);
    }
    const clean = (L: number[]) => {
      const out: number[] = [];
      for (const v of L.map(r)) if (out[out.length - 1] !== v) out.push(v);
      while (out.length > 1 && out[0] === out[out.length - 1]) out.pop();
      return out;
    };
    for (const f of [...this.faces.values()]) {
      const loop = clean(f.loop);
      if (loop.length < 3) {
        this.faces.delete(f.id);
        continue;
      }
      f.loop = loop;
      if (f.holes) {
        f.holes = f.holes.map(clean).filter((h) => h.length >= 3);
        if (!f.holes.length) delete f.holes;
      }
    }
    this.vertexGrid = null;
  }

  // ------------------------------------------------------------------
  // エッジ
  // ------------------------------------------------------------------

  findEdge(a: number, b: number): number | undefined {
    return this.edgeIndex.get(edgeKey(a, b));
  }

  /** エッジを追加（既存なら既存 ID を返す） */
  addEdge(a: number, b: number, layer = this.currentLayer): number {
    if (a === b) throw new Error('長さ 0 のエッジは作れません');
    const existing = this.findEdge(a, b);
    if (existing !== undefined) return existing;
    const id = this.nextId++;
    this.edges.set(id, { id, a, b, layer });
    this.edgeIndex.set(edgeKey(a, b), id);
    this.ensureLayer(layer);
    return id;
  }

  /** 面の外周と穴のループ */
  faceLoops(f: Face): number[][] {
    return f.holes?.length ? [f.loop, ...f.holes] : [f.loop];
  }

  /** ループ L がエッジ a-b を含むか */
  private static loopHasEdge(L: number[], a: number, b: number): boolean {
    for (let i = 0; i < L.length; i++) {
      const p = L[i];
      const q = L[(i + 1) % L.length];
      if ((p === a && q === b) || (p === b && q === a)) return true;
    }
    return false;
  }

  /** エッジを使っている面（外周・穴のどちらでも） */
  facesOfEdge(a: number, b: number): Face[] {
    const res: Face[] = [];
    for (const f of this.faces.values()) {
      if (this.faceLoops(f).some((L) => Model.loopHasEdge(L, a, b))) res.push(f);
    }
    return res;
  }

  /** 面の境界（外周・穴）のエッジ ID */
  faceEdgeIds(f: Face | number): number[] {
    const face = typeof f === 'number' ? this.faces.get(f) : f;
    if (!face) return [];
    const ids: number[] = [];
    for (const L of this.faceLoops(face)) {
      for (let i = 0; i < L.length; i++) {
        const e = this.findEdge(L[i], L[(i + 1) % L.length]);
        if (e !== undefined) ids.push(e);
      }
    }
    return ids;
  }

  /**
   * エッジを削除する。外周のエッジなら面も消え（SketchUp と同じ）、
   * 穴のエッジなら穴がふさがる。
   */
  removeEdge(id: number): void {
    const e = this.edges.get(id);
    if (!e) return;
    for (const f of this.facesOfEdge(e.a, e.b)) {
      if (Model.loopHasEdge(f.loop, e.a, e.b)) {
        this.faces.delete(f.id);
      } else if (f.holes) {
        f.holes = f.holes.filter((h) => !Model.loopHasEdge(h, e.a, e.b));
        if (!f.holes.length) delete f.holes;
      }
    }
    this.edges.delete(id);
    this.edgeIndex.delete(edgeKey(e.a, e.b));
    this.removeUnusedVertices();
  }

  /**
   * エッジ上の点で分割し、新しい頂点 ID を返す。
   * そのエッジを使う面のループにも頂点を挿入する。
   */
  splitEdge(edgeId: number, p: Vector3): number {
    const e = this.edges.get(edgeId);
    if (!e) throw new Error(`エッジ ${edgeId} がありません`);
    const pa = this.pos(e.a);
    const pb = this.pos(e.b);
    const t = closestParamOnSegment(p, pa, pb);
    const q = pa.clone().lerp(pb, t);
    if (q.distanceTo(pa) <= MERGE_TOL) return e.a;
    if (q.distanceTo(pb) <= MERGE_TOL) return e.b;
    const v = this.addVertex(q, false, this.groupOf(e.a));
    for (const f of this.facesOfEdge(e.a, e.b)) {
      for (const L of this.faceLoops(f)) {
        for (let i = 0; i < L.length; i++) {
          const j = (i + 1) % L.length;
          if ((L[i] === e.a && L[j] === e.b) || (L[i] === e.b && L[j] === e.a)) {
            L.splice(i + 1, 0, v);
            break;
          }
        }
      }
    }
    this.edges.delete(edgeId);
    this.edgeIndex.delete(edgeKey(e.a, e.b));
    this.addEdge(e.a, v, e.layer);
    this.addEdge(v, e.b, e.layer);
    return v;
  }

  // ------------------------------------------------------------------
  // 面
  // ------------------------------------------------------------------

  facePoints(f: Face | number): Vector3[] {
    const face = typeof f === 'number' ? this.faces.get(f)! : f;
    return face.loop.map((v) => this.pos(v));
  }

  faceHolePoints(f: Face | number): Vector3[][] {
    const face = typeof f === 'number' ? this.faces.get(f)! : f;
    return (face.holes ?? []).map((h) => h.map((v) => this.pos(v)));
  }

  faceNormal(f: Face | number): Vector3 {
    return polygonNormal(this.facePoints(f));
  }

  /** 面積（穴を除く） */
  faceArea(f: Face | number): number {
    let a = polygonArea(this.facePoints(f));
    for (const h of this.faceHolePoints(f)) a -= polygonArea(h);
    return a;
  }

  /** 描画・書き出し用の三角形分割（穴を考慮） */
  faceTriangles(f: Face | number): { points: Vector3[]; tris: number[][]; normal: Vector3 } {
    const outer = this.facePoints(f);
    const holes = this.faceHolePoints(f);
    const normal = polygonNormal(outer);
    return { points: [...outer, ...holes.flat()], tris: triangulate(outer, normal, holes), normal };
  }

  /** 点が面の内側にあるか（穴の中は外側） */
  pointInFace(p: Vector3, f: Face | number): boolean {
    const outer = this.facePoints(f);
    const n = polygonNormal(outer);
    if (Math.abs(n.dot(p) - n.dot(outer[0])) > PLANE_TOL) return false;
    if (!pointInPolygon(p, outer, n)) return false;
    return !this.faceHolePoints(f).some((h) => pointInPolygon(p, h, n));
  }

  /** 頂点ループから面を作る（境界エッジも作成）。失敗時は undefined */
  addFaceFromVertices(loop: number[], layer = this.currentLayer, color?: string, holes?: number[][]): number | undefined {
    const clean: number[] = [];
    for (const v of loop) if (clean[clean.length - 1] !== v) clean.push(v);
    while (clean.length > 1 && clean[0] === clean[clean.length - 1]) clean.pop();
    if (clean.length < 3 || new Set(clean).size !== clean.length) return undefined;
    const pts = clean.map((v) => this.pos(v));
    if (polygonArea(pts) < 1e-8 || !isPlanar(pts)) return undefined;
    if (this.findFaceByVertexSet(clean) !== undefined) return undefined;
    const hs = (holes ?? []).filter((h) => h.length >= 3);
    for (const L of [clean, ...hs]) for (let i = 0; i < L.length; i++) this.addEdge(L[i], L[(i + 1) % L.length], layer);
    const id = this.nextId++;
    const face: Face = { id, loop: clean, layer, color };
    if (hs.length) face.holes = hs.map((h) => [...h]);
    this.faces.set(id, face);
    this.ensureLayer(layer);
    return id;
  }

  /**
   * 座標列から面を作る。既存の面の内側に描いた場合は、
   * その面に穴をあけて内側を別の面にする（SketchUp の「面への刻み込み」）。
   */
  addFace(points: Vector3[], layer = this.currentLayer, color?: string): number | undefined {
    const loop = points.map((p) => this.addVertex(p));
    return this.placeFace(loop, layer, color);
  }

  /** ループで面を作る。既存の面の内側なら刻み込み（穴あけ）を行う */
  private placeFace(loop: number[], layer: string, color?: string): number | undefined {
    const host = this.findHostFace(loop);
    if (!host) return this.addFaceFromVertices(loop, layer, color);
    const hn = this.faceNormal(host);
    const pts = loop.map((v) => this.pos(v));
    const ordered = polygonNormal(pts).dot(hn) < 0 ? [...loop].reverse() : [...loop];
    // ホストの既存の穴のうち、新しい面の内側にあるものは新しい面へ移す
    const inner: number[][] = [];
    const keep: number[][] = [];
    for (const h of host.holes ?? []) {
      if (pointInPolygon(this.pos(h[0]), pts, hn)) inner.push(h);
      else keep.push(h);
    }
    const id = this.addFaceFromVertices(ordered, host.layer, host.color ?? color, inner);
    if (id === undefined) return undefined;
    host.holes = [...keep, [...ordered].reverse()];
    return id;
  }

  /** ループが完全に内側に収まる、同じ平面・同じグループの面 */
  private findHostFace(loop: number[]): Face | undefined {
    const g = this.groupOf(loop[0]);
    const pts = loop.map((v) => this.pos(v));
    const n = polygonNormal(pts);
    if (n.lengthSq() === 0) return undefined;
    const samples = [...pts];
    for (let i = 0; i < pts.length; i++) samples.push(pts[i].clone().add(pts[(i + 1) % pts.length]).multiplyScalar(0.5));
    let best: Face | undefined;
    let bestArea = Infinity;
    for (const f of this.faces.values()) {
      if (this.groupOfFace(f) !== g) continue;
      if (this.faceLoops(f).some((L) => L.some((v) => loop.includes(v)))) continue;
      const fn = this.faceNormal(f);
      if (Math.abs(Math.abs(fn.dot(n)) - 1) > 1e-6) continue;
      if (!samples.every((p) => this.pointInFace(p, f))) continue;
      const a = this.faceArea(f);
      if (a < bestArea) (bestArea = a), (best = f);
    }
    return best;
  }

  findFaceByVertexSet(loop: number[]): number | undefined {
    const key = [...loop].sort((a, b) => a - b).join(',');
    for (const f of this.faces.values()) {
      if (f.loop.length !== loop.length) continue;
      if ([...f.loop].sort((a, b) => a - b).join(',') === key) return f.id;
    }
    return undefined;
  }

  /** ループ L が、ある面の穴と一致していればその面 */
  private faceWithHole(loop: number[]): Face | undefined {
    const key = [...loop].sort((a, b) => a - b).join(',');
    for (const f of this.faces.values()) {
      for (const h of f.holes ?? []) {
        if (h.length === loop.length && [...h].sort((a, b) => a - b).join(',') === key) return f;
      }
    }
    return undefined;
  }

  removeFace(id: number): void {
    this.faces.delete(id);
  }

  reverseFace(id: number): void {
    const f = this.faces.get(id);
    if (!f) return;
    f.loop.reverse();
    f.holes?.forEach((h) => h.reverse());
  }

  /** 面と境界エッジを共有している面 */
  neighborFaces(faceId: number): Face[] {
    const f = this.faces.get(faceId);
    if (!f) return [];
    const res = new Map<number, Face>();
    for (const L of this.faceLoops(f)) {
      for (let i = 0; i < L.length; i++) {
        for (const g of this.facesOfEdge(L[i], L[(i + 1) % L.length])) {
          if (g.id !== faceId) res.set(g.id, g);
        }
      }
    }
    return [...res.values()];
  }

  /** どの面にも使われていない頂点を消す */
  removeUnusedVertices(): void {
    const used = new Set<number>();
    for (const e of this.edges.values()) {
      used.add(e.a);
      used.add(e.b);
    }
    for (const f of this.faces.values()) for (const L of this.faceLoops(f)) for (const v of L) used.add(v);
    let removed = false;
    for (const id of [...this.vertices.keys()]) {
      if (!used.has(id)) {
        this.vertices.delete(id);
        this.vertexGroup.delete(id);
        removed = true;
      }
    }
    if (removed) this.vertexGrid = null;
    // 空になったグループを消す
    const live = new Set(this.vertexGroup.values());
    for (const gid of [...this.groups.keys()]) if (!live.has(gid)) this.groups.delete(gid);
    if (this.activeGroup && !this.groups.has(this.activeGroup)) this.activeGroup = 0;
  }

  // ------------------------------------------------------------------
  // 線を引く（面の自動生成・面の分割つき）
  // ------------------------------------------------------------------

  /**
   * 2 点間に線を引く。SketchUp と同様に
   *  - 既存の面の上を横切る線なら、その面を 2 つに分割する
   *  - 線で閉じた平面ループができたら、自動で面を張る（面の内側なら穴をあける）
   * 返り値は作成・分割された面 ID のリスト
   */
  drawLine(va: number, vb: number, layer = this.currentLayer): number[] {
    if (va === vb) return [];
    if (this.findEdge(va, vb) !== undefined) return [];

    const split = this.trySplitFace(va, vb);
    if (split) return split;

    this.addEdge(va, vb, layer);
    return this.autoFaces(va, vb, layer);
  }

  private trySplitFace(va: number, vb: number): number[] | null {
    const pa = this.pos(va);
    const pb = this.pos(vb);
    const mid = pa.clone().add(pb).multiplyScalar(0.5);
    for (const f of this.faces.values()) {
      const ia = f.loop.indexOf(va);
      const ib = f.loop.indexOf(vb);
      if (ia < 0 || ib < 0) continue;
      const n = f.loop.length;
      if ((ia + 1) % n === ib || (ib + 1) % n === ia) continue;
      if (!this.pointInFace(mid, f)) continue;
      const loop1: number[] = [];
      for (let i = ia; ; i = (i + 1) % n) {
        loop1.push(f.loop[i]);
        if (i === ib) break;
      }
      const loop2: number[] = [];
      for (let i = ib; ; i = (i + 1) % n) {
        loop2.push(f.loop[i]);
        if (i === ia) break;
      }
      this.addEdge(va, vb, f.layer);
      this.faces.delete(f.id);
      const normal = this.faceNormal(f);
      const ids: number[] = [];
      for (const loop of [loop1, loop2]) {
        const id = this.nextId++;
        const pts = loop.map((v) => this.pos(v));
        // 穴は、それを含む側の面に引き継ぐ
        const holes = (f.holes ?? []).filter((h) => pointInPolygon(this.pos(h[0]), pts, normal));
        const face: Face = { id, loop, layer: f.layer, color: f.color };
        if (holes.length) face.holes = holes;
        this.faces.set(id, face);
        ids.push(id);
      }
      return ids;
    }
    return null;
  }

  private adjacency(): Map<number, number[]> {
    const adj = new Map<number, number[]>();
    for (const e of this.edges.values()) {
      if (!adj.has(e.a)) adj.set(e.a, []);
      if (!adj.has(e.b)) adj.set(e.b, []);
      adj.get(e.a)!.push(e.b);
      adj.get(e.b)!.push(e.a);
    }
    return adj;
  }

  /** 新しいエッジ va-vb を含む閉じた平面ループを探して面を張る */
  private autoFaces(va: number, vb: number, layer: string): number[] {
    const adj = this.adjacency();
    const pa = this.pos(va);
    const pb = this.pos(vb);
    const dir = pb.clone().sub(pa);
    // 候補平面: va-vb と、va / vb に隣接する頂点が作る平面
    const planes: { n: Vector3; d: number }[] = [];
    for (const v of [...(adj.get(va) ?? []), ...(adj.get(vb) ?? [])]) {
      if (v === va || v === vb) continue;
      const n = dir.clone().cross(this.pos(v).clone().sub(pa));
      if (n.lengthSq() < 1e-12) continue;
      n.normalize();
      const d = n.dot(pa);
      if (planes.some((p) => Math.abs(Math.abs(p.n.dot(n)) - 1) < 1e-6 && Math.abs(Math.abs(p.d) - Math.abs(d)) < PLANE_TOL)) continue;
      planes.push({ n, d });
    }
    const created: number[] = [];
    for (const plane of planes) {
      const onPlane = (v: number) => Math.abs(plane.n.dot(this.pos(v)) - plane.d) < PLANE_TOL;
      // vb から va への最短経路（va-vb の直接エッジは除く）
      const prev = new Map<number, number>([[vb, -1]]);
      const queue = [vb];
      let found = false;
      while (queue.length && !found) {
        const cur = queue.shift()!;
        for (const nx of adj.get(cur) ?? []) {
          if (cur === vb && nx === va) continue;
          if (prev.has(nx) || !onPlane(nx)) continue;
          prev.set(nx, cur);
          if (nx === va) {
            found = true;
            break;
          }
          queue.push(nx);
        }
      }
      if (!found) continue;
      const loop: number[] = [];
      for (let v = va; v !== -1; v = prev.get(v)!) loop.push(v);
      const pts = loop.map((v) => this.pos(v));
      const n = polygonNormal(pts);
      // 既存の面の内側に完全に収まる → 刻み込み（穴あけ）
      if (this.findHostFace(loop)) {
        const id = this.placeFace(loop, layer);
        if (id !== undefined) created.push(id);
        continue;
      }
      // それ以外で既存の面と重なる（同一平面で重心が内部）なら作らない
      const c = centroid(pts);
      let overlaps = false;
      for (const f of this.faces.values()) {
        const fn = this.faceNormal(f);
        if (Math.abs(Math.abs(fn.dot(n)) - 1) > 1e-6) continue;
        if (this.pointInFace(c, f)) {
          overlaps = true;
          break;
        }
      }
      if (overlaps) continue;
      // 水平面は上向きにそろえる
      if (Math.abs(n.y) > 0.999 && n.y < 0) loop.reverse();
      const id = this.addFaceFromVertices(loop, layer);
      if (id !== undefined) created.push(id);
    }
    return created;
  }

  // ------------------------------------------------------------------
  // プッシュ/プル
  // ------------------------------------------------------------------

  /**
   * 面を法線方向に distance (m) だけ押し出す。
   *  - 単独の面（または同一平面上の面だけと接する面）: 立体（箱・円柱など）を作る
   *  - 立体の面で、隣接面がすべて直交している: 面を動かして立体を伸縮する
   *  - 面に刻み込んだ面: 引き出すと出っ張り、押し込むと凹み。
   *    反対側の面まで押し込むと貫通して穴（開口）になる
   * 返り値は押し出し後の面 ID（貫通した場合は undefined）
   */
  pushPull(faceId: number, distance: number, opt: { keepBase?: boolean } = {}): number | undefined {
    const face = this.faces.get(faceId);
    if (!face || Math.abs(distance) < 1e-9) return faceId;
    const n = this.faceNormal(face);
    const offset = n.clone().multiplyScalar(distance);
    const neighbors = this.neighborFaces(faceId);
    const group = this.groupOfFace(face);

    // ループの向きをそろえる（外周は法線に対して反時計回り、穴は時計回り）
    const outer = face.loop;
    const holes = (face.holes ?? []).map((h) => (polygonNormal(h.map((v) => this.pos(v))).dot(n) > 0 ? [...h].reverse() : [...h]));
    const loops = [outer, ...holes];

    // 隣接面がすべての辺にあり、すべて直交 → 面を移動して伸縮
    const allEdgesShared = loops.every((L) => L.every((v, i) => this.facesOfEdge(v, L[(i + 1) % L.length]).length >= 2));
    const allPerpendicular = neighbors.length > 0 && neighbors.every((g) => Math.abs(this.faceNormal(g).dot(n)) < 1e-6);
    if (!opt.keepBase && allEdgesShared && allPerpendicular) {
      this.moveVertices(loops.flat(), offset);
      return faceId;
    }

    // 単独の面かどうか: 隣接面が無い・すべて同一平面（図面を分割した面など）。
    // ただし他の面に刻み込んだ面（その面の穴と一致）は立体の一部として扱う
    const imprinted = this.faceWithHole(outer) !== undefined;
    const free =
      opt.keepBase ||
      (!imprinted && neighbors.every((g) => Math.abs(Math.abs(this.faceNormal(g).dot(n)) - 1) < 1e-6));

    const tops = loops.map((L) => L.map((v) => this.addVertex(this.pos(v).clone().add(offset), false, group)));
    const flip = free && distance < 0;
    const sides: number[][] = [];
    loops.forEach((L, k) => {
      const T = tops[k];
      for (let i = 0; i < L.length; i++) {
        const j = (i + 1) % L.length;
        const quad = [L[i], L[j], T[j], T[i]];
        sides.push(flip ? quad.reverse() : quad);
      }
    });
    const topOuter = flip ? [...tops[0]].reverse() : tops[0];
    const topHoles = tops.slice(1).map((T) => (flip ? [...T].reverse() : T));

    // 貫通: 押し込んだ先に、向かい合う面があり内側に収まる → その面に穴をあける
    let through: Face | undefined;
    if (!free && distance < 0) {
      const topPts = tops[0].map((v) => this.pos(v));
      for (const f of this.faces.values()) {
        if (f.id === faceId || this.groupOfFace(f) !== group) continue;
        if (this.faceNormal(f).dot(n) > -1 + 1e-6) continue;
        if (topPts.every((p) => this.pointInFace(p, f))) {
          through = f;
          break;
        }
      }
    }

    if (free) {
      if (distance > 0) this.reverseFace(faceId);
    } else {
      this.faces.delete(faceId);
    }

    for (const q of sides) this.addFaceFromVertices(q, face.layer, face.color);
    let newId: number | undefined;
    if (through) {
      through.holes = [...(through.holes ?? []), [...tops[0]]];
    } else {
      newId = this.addFaceFromVertices(topOuter, face.layer, face.color, topHoles);
    }
    this.mergeCoincidentVertices();
    this.removeCancellingFaces();
    return newId;
  }

  /** 同じ頂点で向きが逆の面（内部に埋もれた面）を取り除く */
  private removeCancellingFaces(): void {
    const byKey = new Map<string, Face[]>();
    for (const f of this.faces.values()) {
      const k = [...f.loop].sort((a, b) => a - b).join(',');
      const arr = byKey.get(k);
      if (arr) arr.push(f);
      else byKey.set(k, [f]);
    }
    for (const arr of byKey.values()) {
      if (arr.length < 2) continue;
      if (this.faceNormal(arr[0]).dot(this.faceNormal(arr[1])) < -0.999) {
        this.faces.delete(arr[0].id);
        this.faces.delete(arr[1].id);
      }
    }
  }

  // ------------------------------------------------------------------
  // 変形・複製
  // ------------------------------------------------------------------

  /** 頂点群を回転する（center を通る axis 周り、ラジアン） */
  rotateVertices(ids: Iterable<number>, center: Vector3, axis: Vector3, angle: number): void {
    for (const id of new Set(ids)) {
      const p = this.vertices.get(id);
      if (p) p.sub(center).applyAxisAngle(axis, angle).add(center);
    }
    this.vertexGrid = null;
    this.mergeCoincidentVertices();
  }

  /**
   * エッジ・面を複製して offset だけずらす。新しい ID を返す。
   * グループの中身は、新しいグループとして複製する。
   */
  copyEntities(edgeIds: Iterable<number>, faceIds: Iterable<number>, offset: Vector3): { edges: number[]; faces: number[] } {
    const groupMap = new Map<number, number>();
    const targetGroup = (g: number) => {
      if (!g || g === this.activeGroup) return g;
      let ng = groupMap.get(g);
      if (ng === undefined) {
        ng = this.nextId++;
        this.groups.set(ng, { id: ng, name: `${this.groups.get(g)?.name ?? 'グループ'} のコピー` });
        groupMap.set(g, ng);
      }
      return ng;
    };
    const map = new Map<number, number>();
    const vid = (v: number) => {
      let n = map.get(v);
      if (n === undefined) {
        n = this.addVertex(this.pos(v).clone().add(offset), true, targetGroup(this.groupOf(v)));
        map.set(v, n);
      }
      return n;
    };
    const faces: number[] = [];
    const edgeSet = new Set(edgeIds);
    for (const id of faceIds) {
      const f = this.faces.get(id);
      if (!f) continue;
      for (const e of this.faceEdgeIds(f)) edgeSet.add(e);
      const nid = this.addFaceFromVertices(
        f.loop.map(vid),
        f.layer,
        f.color,
        f.holes?.map((h) => h.map(vid)),
      );
      if (nid !== undefined) faces.push(nid);
    }
    const edges: number[] = [];
    for (const id of edgeSet) {
      const e = this.edges.get(id);
      if (!e) continue;
      const a = vid(e.a);
      const b = vid(e.b);
      if (a !== b) edges.push(this.addEdge(a, b, e.layer));
    }
    return { edges, faces };
  }

  // ------------------------------------------------------------------
  // その他
  // ------------------------------------------------------------------

  /** 頂点からつながっているジオメトリ（面とエッジ）をすべて集める */
  connectedFrom(edgeIds: number[], faceIds: number[]): { edges: Set<number>; faces: Set<number> } {
    const adj = this.adjacency();
    const startVerts: number[] = [];
    for (const id of edgeIds) {
      const e = this.edges.get(id);
      if (e) startVerts.push(e.a, e.b);
    }
    for (const id of faceIds) {
      const f = this.faces.get(id);
      if (f) for (const L of this.faceLoops(f)) startVerts.push(...L);
    }
    const seen = new Set<number>(startVerts);
    const stack = [...startVerts];
    while (stack.length) {
      const v = stack.pop()!;
      for (const nx of adj.get(v) ?? []) {
        if (!seen.has(nx)) {
          seen.add(nx);
          stack.push(nx);
        }
      }
    }
    // 穴を介してつながる面も含めるため、面の全ループで判定
    const edges = new Set<number>();
    const faces = new Set<number>();
    let grew = true;
    while (grew) {
      grew = false;
      for (const f of this.faces.values()) {
        if (faces.has(f.id)) continue;
        const loops = this.faceLoops(f);
        if (loops.some((L) => L.some((v) => seen.has(v)))) {
          faces.add(f.id);
          for (const L of loops) for (const v of L) if (!seen.has(v)) (seen.add(v), (grew = true));
        }
      }
    }
    for (const e of this.edges.values()) if (seen.has(e.a)) edges.add(e.id);
    return { edges, faces };
  }

  boundingBox(visibleOnly = true): Box3 {
    const box = new Box3();
    for (const e of this.edges.values()) {
      if (visibleOnly && !this.isLayerVisible(e.layer)) continue;
      box.expandByPoint(this.pos(e.a));
      box.expandByPoint(this.pos(e.b));
    }
    return box;
  }

  isEmpty(): boolean {
    return this.edges.size === 0 && this.faces.size === 0;
  }

  clear(): void {
    this.vertices.clear();
    this.vertexGroup.clear();
    this.edges.clear();
    this.faces.clear();
    this.edgeIndex.clear();
    this.groups.clear();
    this.activeGroup = 0;
    this.vertexGrid = null;
    this.layers.clear();
    this.layers.set(DEFAULT_LAYER, { name: DEFAULT_LAYER, color: '#ffffff', visible: true });
    this.currentLayer = DEFAULT_LAYER;
  }

  toJSON(): ModelData {
    return {
      version: 1,
      vertices: [...this.vertices].map(([id, p]) => {
        const g = this.groupOf(id);
        return g ? [id, p.x, p.y, p.z, g] : [id, p.x, p.y, p.z];
      }),
      edges: [...this.edges.values()].map((e) => [e.id, e.a, e.b, e.layer]),
      faces: [...this.faces.values()].map((f) => {
        const o: ModelData['faces'][number] = { id: f.id, loop: [...f.loop], layer: f.layer, color: f.color };
        if (f.holes?.length) o.holes = f.holes.map((h) => [...h]);
        return o;
      }),
      layers: [...this.layers.values()].map((l) => ({ ...l })),
      currentLayer: this.currentLayer,
      groups: [...this.groups.values()].map((g) => ({ ...g })),
    };
  }

  load(d: ModelData): void {
    const active = this.activeGroup;
    this.clear();
    let maxId = 0;
    for (const [id, x, y, z, g] of d.vertices) {
      this.vertices.set(id, new Vector3(x, y, z));
      if (g) this.vertexGroup.set(id, g);
      maxId = Math.max(maxId, id);
    }
    for (const [id, a, b, layer] of d.edges) {
      this.edges.set(id, { id, a, b, layer });
      this.edgeIndex.set(edgeKey(a, b), id);
      maxId = Math.max(maxId, id);
    }
    for (const f of d.faces) {
      const face: Face = { id: f.id, loop: [...f.loop], layer: f.layer, color: f.color };
      if (f.holes?.length) face.holes = f.holes.map((h) => [...h]);
      this.faces.set(f.id, face);
      maxId = Math.max(maxId, f.id);
    }
    for (const g of d.groups ?? []) {
      this.groups.set(g.id, { ...g });
      maxId = Math.max(maxId, g.id);
    }
    for (const l of d.layers ?? []) this.layers.set(l.name, { ...l });
    this.currentLayer = d.currentLayer && this.layers.has(d.currentLayer) ? d.currentLayer : DEFAULT_LAYER;
    // 元に戻す等で読み直しても、編集中のグループが残っていれば編集を続ける
    this.activeGroup = this.groups.has(active) ? active : 0;
    this.nextId = maxId + 1;
  }
}

const LAYER_COLORS = ['#e8e4d8', '#d9c7a7', '#b8c9d9', '#c9d9b8', '#d9b8c4', '#c4b8d9', '#d9d2b8', '#b8d9d4'];

function randomLayerColor(i: number): string {
  return LAYER_COLORS[i % LAYER_COLORS.length];
}
