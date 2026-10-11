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
} from './geometry';

export interface Edge {
  id: number;
  a: number;
  b: number;
  layer: string;
}

export interface Face {
  id: number;
  /** 頂点 ID のループ。右ねじの向きが表面の法線 */
  loop: number[];
  layer: string;
  color?: string;
}

export interface Layer {
  name: string;
  color: string;
  visible: boolean;
}

export interface ModelData {
  version: 1;
  vertices: [number, number, number, number][];
  edges: [number, number, number, string][];
  faces: { id: number; loop: number[]; layer: string; color?: string }[];
  layers: Layer[];
  currentLayer: string;
}

export const DEFAULT_LAYER = '0';

const edgeKey = (a: number, b: number) => (a < b ? `${a}_${b}` : `${b}_${a}`);

/**
 * SketchUp と同じ「くっつくジオメトリ」モデル。
 * 頂点は位置が同じなら共有され、面は境界のエッジを共有する。
 * そのため、面をプッシュ/プルすると隣の面が一緒に伸び縮みする。
 */
export class Model {
  readonly vertices = new Map<number, Vector3>();
  readonly edges = new Map<number, Edge>();
  readonly faces = new Map<number, Face>();
  readonly layers = new Map<string, Layer>();
  currentLayer = DEFAULT_LAYER;

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

  /** p と同じ位置にある既存頂点を探す */
  findVertex(p: Vector3, tol = MERGE_TOL): number | undefined {
    const g = this.grid();
    const [cx, cy, cz] = this.cellOf(p);
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (let dz = -1; dz <= 1; dz++) {
          const ids = g.get(this.cellKey(cx + dx, cy + dy, cz + dz));
          if (!ids) continue;
          for (const id of ids) {
            if (this.vertices.get(id)!.distanceTo(p) <= tol) return id;
          }
        }
    return undefined;
  }

  /** 頂点を追加する。merge=true なら同じ位置の既存頂点を再利用する */
  addVertex(p: Vector3, merge = true): number {
    if (merge) {
      const found = this.findVertex(p);
      if (found !== undefined) return found;
    }
    const id = this.nextId++;
    this.vertices.set(id, p.clone());
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

  /** 移動などで重なった頂点を統合する */
  mergeCoincidentVertices(): void {
    this.vertexGrid = null;
    const remap = new Map<number, number>();
    const seen = new Map<string, number[]>();
    for (const [id, p] of this.vertices) {
      const [cx, cy, cz] = this.cellOf(p);
      let target: number | undefined;
      for (let dx = -1; dx <= 1 && target === undefined; dx++)
        for (let dy = -1; dy <= 1 && target === undefined; dy++)
          for (let dz = -1; dz <= 1 && target === undefined; dz++) {
            for (const other of seen.get(this.cellKey(cx + dx, cy + dy, cz + dz)) ?? []) {
              if (this.vertices.get(other)!.distanceTo(p) <= MERGE_TOL) {
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
    for (const id of remap.keys()) this.vertices.delete(id);
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
    for (const f of [...this.faces.values()]) {
      const loop: number[] = [];
      for (const v of f.loop.map(r)) if (loop[loop.length - 1] !== v) loop.push(v);
      while (loop.length > 1 && loop[0] === loop[loop.length - 1]) loop.pop();
      if (loop.length < 3) this.faces.delete(f.id);
      else f.loop = loop;
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

  /** エッジを使っている面 */
  facesOfEdge(a: number, b: number): Face[] {
    const res: Face[] = [];
    for (const f of this.faces.values()) {
      const L = f.loop;
      for (let i = 0; i < L.length; i++) {
        const p = L[i];
        const q = L[(i + 1) % L.length];
        if ((p === a && q === b) || (p === b && q === a)) {
          res.push(f);
          break;
        }
      }
    }
    return res;
  }

  /** エッジを削除する。そのエッジを境界に持つ面も消える（SketchUp と同じ） */
  removeEdge(id: number): void {
    const e = this.edges.get(id);
    if (!e) return;
    for (const f of this.facesOfEdge(e.a, e.b)) this.faces.delete(f.id);
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
    const v = this.addVertex(q, false);
    for (const f of this.facesOfEdge(e.a, e.b)) {
      const L = f.loop;
      for (let i = 0; i < L.length; i++) {
        const j = (i + 1) % L.length;
        if ((L[i] === e.a && L[j] === e.b) || (L[i] === e.b && L[j] === e.a)) {
          L.splice(i + 1, 0, v);
          break;
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

  faceNormal(f: Face | number): Vector3 {
    return polygonNormal(this.facePoints(f));
  }

  faceArea(f: Face | number): number {
    return polygonArea(this.facePoints(f));
  }

  /** 頂点ループから面を作る（境界エッジも作成）。失敗時は undefined */
  addFaceFromVertices(loop: number[], layer = this.currentLayer, color?: string): number | undefined {
    const clean: number[] = [];
    for (const v of loop) if (clean[clean.length - 1] !== v) clean.push(v);
    while (clean.length > 1 && clean[0] === clean[clean.length - 1]) clean.pop();
    if (clean.length < 3 || new Set(clean).size !== clean.length) return undefined;
    const pts = clean.map((v) => this.pos(v));
    if (polygonArea(pts) < 1e-8 || !isPlanar(pts)) return undefined;
    if (this.findFaceByVertexSet(clean) !== undefined) return undefined;
    for (let i = 0; i < clean.length; i++) this.addEdge(clean[i], clean[(i + 1) % clean.length], layer);
    const id = this.nextId++;
    this.faces.set(id, { id, loop: clean, layer, color });
    this.ensureLayer(layer);
    return id;
  }

  /** 座標列から面を作る */
  addFace(points: Vector3[], layer = this.currentLayer, color?: string): number | undefined {
    return this.addFaceFromVertices(
      points.map((p) => this.addVertex(p)),
      layer,
      color,
    );
  }

  findFaceByVertexSet(loop: number[]): number | undefined {
    const key = [...loop].sort((a, b) => a - b).join(',');
    for (const f of this.faces.values()) {
      if (f.loop.length !== loop.length) continue;
      if ([...f.loop].sort((a, b) => a - b).join(',') === key) return f.id;
    }
    return undefined;
  }

  removeFace(id: number): void {
    this.faces.delete(id);
  }

  reverseFace(id: number): void {
    this.faces.get(id)?.loop.reverse();
  }

  /** 面と境界エッジを共有している面 */
  neighborFaces(faceId: number): Face[] {
    const f = this.faces.get(faceId);
    if (!f) return [];
    const res = new Map<number, Face>();
    const L = f.loop;
    for (let i = 0; i < L.length; i++) {
      for (const g of this.facesOfEdge(L[i], L[(i + 1) % L.length])) {
        if (g.id !== faceId) res.set(g.id, g);
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
    for (const f of this.faces.values()) for (const v of f.loop) used.add(v);
    let removed = false;
    for (const id of [...this.vertices.keys()]) {
      if (!used.has(id)) {
        this.vertices.delete(id);
        removed = true;
      }
    }
    if (removed) this.vertexGrid = null;
  }

  // ------------------------------------------------------------------
  // 線を引く（面の自動生成・面の分割つき）
  // ------------------------------------------------------------------

  /**
   * 2 点間に線を引く。SketchUp と同様に
   *  - 既存の面の上を横切る線なら、その面を 2 つに分割する
   *  - 線で閉じた平面ループができたら、自動で面を張る
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
      const pts = this.facePoints(f);
      const normal = polygonNormal(pts);
      if (Math.abs(normal.dot(mid) - normal.dot(pts[0])) > PLANE_TOL) continue;
      if (!pointInPolygon(mid, pts, normal)) continue;
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
      const ids: number[] = [];
      for (const loop of [loop1, loop2]) {
        const id = this.nextId++;
        this.faces.set(id, { id, loop, layer: f.layer, color: f.color });
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
      // loop: va → ... → vb, そこから va-vb のエッジで閉じる
      const pts = loop.map((v) => this.pos(v));
      // 既存の面と重なる（同一平面で重心が内部）なら作らない
      const c = centroid(pts);
      const n = polygonNormal(pts);
      let overlaps = false;
      for (const f of this.faces.values()) {
        const fp = this.facePoints(f);
        const fn = polygonNormal(fp);
        if (Math.abs(Math.abs(fn.dot(n)) - 1) > 1e-6) continue;
        if (Math.abs(fn.dot(c) - fn.dot(fp[0])) > PLANE_TOL) continue;
        if (pointInPolygon(c, fp, fn)) {
          overlaps = true;
          break;
        }
      }
      if (overlaps) continue;
      // 水平面は上向き、それ以外はカメラ非依存の既定（+法線方向）にそろえる
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
   *  - それ以外の立体の面: 新しい立体部分を追加（または凹みを作る）
   * 返り値は押し出し後の面 ID
   */
  pushPull(faceId: number, distance: number, opt: { keepBase?: boolean } = {}): number | undefined {
    const face = this.faces.get(faceId);
    if (!face || Math.abs(distance) < 1e-9) return faceId;
    const pts = this.facePoints(face);
    const n = polygonNormal(pts);
    const offset = n.clone().multiplyScalar(distance);
    const neighbors = this.neighborFaces(faceId);

    // 隣接面がすべての辺にあり、すべて直交 → 面を移動して伸縮
    const L = face.loop;
    const allEdgesShared = L.every((v, i) => this.facesOfEdge(v, L[(i + 1) % L.length]).length >= 2);
    const allPerpendicular = neighbors.length > 0 && neighbors.every((g) => Math.abs(this.faceNormal(g).dot(n)) < 1e-6);
    if (!opt.keepBase && allEdgesShared && allPerpendicular) {
      this.moveVertices(L, offset);
      return faceId;
    }

    // 隣接面が無い・すべて同一平面（図面を分割した面など）なら単独の面として扱い、元の面を底面として残す
    const free = opt.keepBase || neighbors.every((g) => Math.abs(Math.abs(this.faceNormal(g).dot(n)) - 1) < 1e-6);
    const top = L.map((v) => this.addVertex(this.pos(v).clone().add(offset), false));
    const flipSides = free && distance < 0;
    const created: number[][] = [];
    for (let i = 0; i < L.length; i++) {
      const j = (i + 1) % L.length;
      const quad = [L[i], L[j], top[j], top[i]];
      created.push(flipSides ? quad.reverse() : quad);
    }
    const topLoop = flipSides ? [...top].reverse() : top;

    if (free) {
      if (distance > 0) face.loop.reverse();
    } else {
      this.faces.delete(faceId);
    }

    for (const q of created) this.addFaceFromVertices(q, face.layer, face.color);
    const newId = this.addFaceFromVertices(topLoop, face.layer, face.color);
    this.mergeCoincidentVertices();
    return newId;
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

  /** エッジ・面を複製して offset だけずらす。新しい ID を返す */
  copyEntities(edgeIds: Iterable<number>, faceIds: Iterable<number>, offset: Vector3): { edges: number[]; faces: number[] } {
    const map = new Map<number, number>();
    const vid = (v: number) => {
      let n = map.get(v);
      if (n === undefined) {
        n = this.addVertex(this.pos(v).clone().add(offset));
        map.set(v, n);
      }
      return n;
    };
    const faces: number[] = [];
    const edgeSet = new Set(edgeIds);
    for (const id of faceIds) {
      const f = this.faces.get(id);
      if (!f) continue;
      const L = f.loop;
      for (let i = 0; i < L.length; i++) {
        const e = this.findEdge(L[i], L[(i + 1) % L.length]);
        if (e !== undefined) edgeSet.add(e);
      }
      const nid = this.addFaceFromVertices(L.map(vid), f.layer, f.color);
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
    for (const id of faceIds) startVerts.push(...(this.faces.get(id)?.loop ?? []));
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
    const edges = new Set<number>();
    for (const e of this.edges.values()) if (seen.has(e.a)) edges.add(e.id);
    const faces = new Set<number>();
    for (const f of this.faces.values()) if (seen.has(f.loop[0])) faces.add(f.id);
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
    this.edges.clear();
    this.faces.clear();
    this.edgeIndex.clear();
    this.vertexGrid = null;
    this.layers.clear();
    this.layers.set(DEFAULT_LAYER, { name: DEFAULT_LAYER, color: '#ffffff', visible: true });
    this.currentLayer = DEFAULT_LAYER;
  }

  toJSON(): ModelData {
    return {
      version: 1,
      vertices: [...this.vertices].map(([id, p]) => [id, p.x, p.y, p.z]),
      edges: [...this.edges.values()].map((e) => [e.id, e.a, e.b, e.layer]),
      faces: [...this.faces.values()].map((f) => ({ id: f.id, loop: [...f.loop], layer: f.layer, color: f.color })),
      layers: [...this.layers.values()].map((l) => ({ ...l })),
      currentLayer: this.currentLayer,
    };
  }

  load(d: ModelData): void {
    this.clear();
    let maxId = 0;
    for (const [id, x, y, z] of d.vertices) {
      this.vertices.set(id, new Vector3(x, y, z));
      maxId = Math.max(maxId, id);
    }
    for (const [id, a, b, layer] of d.edges) {
      this.edges.set(id, { id, a, b, layer });
      this.edgeIndex.set(edgeKey(a, b), id);
      maxId = Math.max(maxId, id);
    }
    for (const f of d.faces) {
      this.faces.set(f.id, { id: f.id, loop: [...f.loop], layer: f.layer, color: f.color });
      maxId = Math.max(maxId, f.id);
    }
    for (const l of d.layers ?? []) this.layers.set(l.name, { ...l });
    this.currentLayer = d.currentLayer && this.layers.has(d.currentLayer) ? d.currentLayer : DEFAULT_LAYER;
    this.nextId = maxId + 1;
  }
}

const LAYER_COLORS = ['#e8e4d8', '#d9c7a7', '#b8c9d9', '#c9d9b8', '#d9b8c4', '#c4b8d9', '#d9d2b8', '#b8d9d4'];

function randomLayerColor(i: number): string {
  return LAYER_COLORS[i % LAYER_COLORS.length];
}
