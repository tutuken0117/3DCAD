import {
  BackSide,
  BufferGeometry,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  FrontSide,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  MeshStandardMaterial,
  type Material,
  type Raycaster,
  Vector3,
} from 'three';
import { planeBasis } from '../core/geometry';
import { getMaterial, MAT_PREFIX } from '../core/materials';
import type { Model } from '../core/Model';
import { threeMaterial } from './materialTextures';
import type { Selection } from '../core/Selection';
import type { Viewport } from './Viewport';

export const FRONT_COLOR = '#f4f2ea';
export const BACK_COLOR = '#a7b4c6';
const SELECT_COLOR = 0x1f6fff;
const HOVER_COLOR = 0x6fa8ff;

/** 表示モード */
export type FaceStyle = 'shaded' | 'layer' | 'xray' | 'wireframe';

/** モデル（Model）を Three.js のメッシュとして描画する */
export class ModelRenderer {
  private front: Mesh;
  private back: Mesh;
  private edges: LineSegments;
  private fadedEdges: LineSegments;
  private selFaces: Mesh;
  private selEdges: LineSegments;
  private hoverFaces: Mesh;
  private hoverEdges: LineSegments;

  /** 三角形インデックス → 面 ID */
  private triFace: number[] = [];

  faceStyle: FaceStyle = 'shaded';
  /** プレゼン表示（影・両面同じ見た目・裏面色なし） */
  presentation = false;
  /** 白模型（材料・色を使わず白で表示） */
  whiteModel = false;
  /** プレゼン表示で線を出すか */
  showEdges = true;

  private baseMat: MeshStandardMaterial;
  private baseMatDouble: MeshStandardMaterial;
  private whiteMat: MeshStandardMaterial;

  constructor(
    private viewport: Viewport,
    private model: Model,
    private selection: Selection,
  ) {
    const std = (opts: ConstructorParameters<typeof MeshStandardMaterial>[0]) =>
      new MeshStandardMaterial({ roughness: 0.92, metalness: 0, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1, ...opts });
    this.baseMat = std({ vertexColors: true, side: FrontSide });
    this.baseMatDouble = std({ vertexColors: true, side: DoubleSide });
    this.whiteMat = std({ color: '#eceae6', side: DoubleSide, roughness: 0.95 });
    const frontMat = this.baseMat;
    const backMat = new MeshLambertMaterial({
      color: BACK_COLOR,
      side: BackSide,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
    });
    this.front = new Mesh(new BufferGeometry(), frontMat);
    this.back = new Mesh(new BufferGeometry(), backMat);
    this.edges = new LineSegments(new BufferGeometry(), new LineBasicMaterial({ color: 0x1a1a1a }));
    this.fadedEdges = new LineSegments(new BufferGeometry(), new LineBasicMaterial({ color: 0xa9b3bd }));

    const overlayFace = (color: number, opacity: number) =>
      new Mesh(
        new BufferGeometry(),
        new MeshBasicMaterial({
          color,
          transparent: true,
          opacity,
          side: DoubleSide,
          depthWrite: false,
          polygonOffset: true,
          polygonOffsetFactor: -1,
          polygonOffsetUnits: -1,
        }),
      );
    this.selFaces = overlayFace(SELECT_COLOR, 0.35);
    this.hoverFaces = overlayFace(HOVER_COLOR, 0.25);
    this.selEdges = new LineSegments(new BufferGeometry(), new LineBasicMaterial({ color: SELECT_COLOR, depthTest: false }));
    this.hoverEdges = new LineSegments(new BufferGeometry(), new LineBasicMaterial({ color: HOVER_COLOR, depthTest: false }));
    this.selEdges.renderOrder = 10;
    this.hoverEdges.renderOrder = 9;

    viewport.modelRoot.add(this.front, this.back, this.edges, this.fadedEdges, this.hoverFaces, this.selFaces, this.hoverEdges, this.selEdges);

    model.onChange(() => this.rebuild());
    selection.onChange(() => this.rebuildSelection());
    this.rebuild();
  }

  setFaceStyle(style: FaceStyle): void {
    this.faceStyle = style;
    const fm = this.baseMat;
    const bm = this.back.material as MeshLambertMaterial;
    const xray = style === 'xray';
    for (const m of [fm, this.baseMatDouble, bm]) {
      m.transparent = xray;
      m.opacity = xray ? 0.45 : 1;
      m.depthWrite = !xray;
      m.needsUpdate = true;
    }
    this.front.visible = this.back.visible = style !== 'wireframe';
    this.rebuild();
  }

  rebuild(): void {
    const m = this.model;
    // 材料ごとに三角形をまとめ、BufferGeometry のグループで描き分ける
    type Bucket = { pos: number[]; nrm: number[]; col: number[]; uv: number[]; faces: number[] };
    const buckets = new Map<string, Bucket>();
    const bucket = (key: string) => {
      let b = buckets.get(key);
      if (!b) buckets.set(key, (b = { pos: [], nrm: [], col: [], uv: [], faces: [] }));
      return b;
    };
    const c = new Color();
    // グループ編集中は、編集対象以外を薄く表示する
    const fade = new Color('#e9eef2');
    const editing = m.activeGroup;
    const useMaterials = this.faceStyle === 'shaded' && !this.whiteModel;
    for (const f of m.faces.values()) {
      if (!m.isLayerVisible(f.layer)) continue;
      const { points: pts, tris, normal: n } = m.faceTriangles(f);
      if (n.lengthSq() === 0) continue;
      const matId = useMaterials && f.color?.startsWith(MAT_PREFIX) ? f.color.slice(MAT_PREFIX.length) : '';
      const key = this.whiteModel ? 'white' : matId && getMaterial(matId) ? matId : '';
      const colorStr = this.faceStyle === 'layer' ? (m.layers.get(f.layer)?.color ?? FRONT_COLOR) : f.color?.startsWith('#') ? f.color : FRONT_COLOR;
      c.set(colorStr);
      if (editing && m.groupOfFace(f) !== editing) c.lerp(fade, 0.65);
      const { u, v } = planeBasis(n);
      const b = bucket(key);
      for (const tri of tris) {
        for (const i of tri) {
          const p = pts[i];
          b.pos.push(p.x, p.y, p.z);
          b.nrm.push(n.x, n.y, n.z);
          b.col.push(c.r, c.g, c.b);
          b.uv.push(p.dot(u), p.dot(v));
        }
        b.faces.push(f.id);
      }
    }
    let total = 0;
    for (const b of buckets.values()) total += b.pos.length / 3;
    const pos = new Float32Array(total * 3);
    const nrm = new Float32Array(total * 3);
    const col = new Float32Array(total * 3);
    const uvs = new Float32Array(total * 2);
    this.triFace = [];
    const g = new BufferGeometry();
    const materials: Material[] = [];
    let start = 0;
    for (const [key, b] of buckets) {
      pos.set(b.pos, start * 3);
      nrm.set(b.nrm, start * 3);
      col.set(b.col, start * 3);
      uvs.set(b.uv, start * 2);
      for (const id of b.faces) this.triFace.push(id);
      let mat: Material;
      if (key === 'white') mat = this.whiteMat;
      else if (key) mat = threeMaterial(getMaterial(key)!, this.presentation);
      else mat = this.presentation ? this.baseMatDouble : this.baseMat;
      const count = b.pos.length / 3;
      g.addGroup(start, count, materials.length);
      materials.push(mat);
      start += count;
    }
    g.setAttribute('position', new Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new Float32BufferAttribute(nrm, 3));
    g.setAttribute('color', new Float32BufferAttribute(col, 3));
    g.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
    g.computeBoundingSphere();
    this.front.geometry.dispose();
    this.front.geometry = g;
    this.front.material = materials.length ? materials : this.baseMat;
    this.back.geometry = g;
    this.back.visible = !this.presentation && this.faceStyle !== 'wireframe';
    this.front.castShadow = this.front.receiveShadow = this.presentation;
    this.edges.visible = !this.presentation || this.showEdges;
    // プレゼン表示の線は少し柔らかい色に
    (this.edges.material as LineBasicMaterial).color.set(this.presentation ? 0x60656a : 0x1a1a1a);

    // エッジ: 曲面の稜線（隣接面の角度が小さい）は表示しない
    const facesByEdge = new Map<string, Vector3[]>();
    for (const f of m.faces.values()) {
      if (!m.isLayerVisible(f.layer)) continue;
      const n = m.faceNormal(f);
      for (const L of m.faceLoops(f)) {
        for (let i = 0; i < L.length; i++) {
          const a = L[i];
          const b = L[(i + 1) % L.length];
          const k = a < b ? `${a}_${b}` : `${b}_${a}`;
          const arr = facesByEdge.get(k);
          if (arr) arr.push(n);
          else facesByEdge.set(k, [n]);
        }
      }
    }
    const SOFT = Math.cos((25 * Math.PI) / 180);
    const ep: number[] = [];
    const fp: number[] = [];
    for (const e of m.edges.values()) {
      if (!m.isLayerVisible(e.layer)) continue;
      const k = e.a < e.b ? `${e.a}_${e.b}` : `${e.b}_${e.a}`;
      const ns = facesByEdge.get(k);
      if (ns && ns.length === 2) {
        const d = ns[0].dot(ns[1]);
        if (d > SOFT && d < 0.99999) continue;
      }
      const a = m.pos(e.a);
      const b = m.pos(e.b);
      (editing && m.groupOfEdge(e) !== editing ? fp : ep).push(a.x, a.y, a.z, b.x, b.y, b.z);
    }
    const eg = new BufferGeometry();
    eg.setAttribute('position', new Float32BufferAttribute(ep, 3));
    this.edges.geometry.dispose();
    this.edges.geometry = eg;
    const fg = new BufferGeometry();
    fg.setAttribute('position', new Float32BufferAttribute(fp, 3));
    this.fadedEdges.geometry.dispose();
    this.fadedEdges.geometry = fg;

    this.rebuildSelection();
    this.viewport.requestRender();
  }

  private buildOverlay(faceIds: Iterable<number>, edgeIds: Iterable<number>, mesh: Mesh, lines: LineSegments): void {
    const m = this.model;
    const pos: number[] = [];
    for (const id of faceIds) {
      if (!m.faces.has(id)) continue;
      const { points: pts, tris } = m.faceTriangles(id);
      for (const tri of tris) for (const i of tri) pos.push(pts[i].x, pts[i].y, pts[i].z);
    }
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(pos, 3));
    mesh.geometry.dispose();
    mesh.geometry = g;

    const ep: number[] = [];
    for (const id of edgeIds) {
      const e = m.edges.get(id);
      if (!e) continue;
      const a = m.pos(e.a);
      const b = m.pos(e.b);
      ep.push(a.x, a.y, a.z, b.x, b.y, b.z);
    }
    const eg = new BufferGeometry();
    eg.setAttribute('position', new Float32BufferAttribute(ep, 3));
    lines.geometry.dispose();
    lines.geometry = eg;
    this.viewport.requestRender();
  }

  rebuildSelection(): void {
    this.buildOverlay(this.selection.faces, this.selection.edges, this.selFaces, this.selEdges);
  }

  /** マウスを乗せた要素の強調表示 */
  setHover(faceIds: number[], edgeIds: number[] = []): void {
    this.buildOverlay(faceIds, edgeIds, this.hoverFaces, this.hoverEdges);
  }

  /** 表示中のエッジ（稜線）の座標 [x1,y1,z1,x2,y2,z2,…]（スケッチ表示の太い線に使う） */
  edgePositions(): Float32Array {
    const a = this.edges.geometry.getAttribute('position');
    return a ? (a.array as Float32Array) : new Float32Array();
  }

  /** レイが当たった面 */
  pickFace(rc: Raycaster): { faceId: number; point: Vector3; normal: Vector3; distance: number } | null {
    if (this.faceStyle === 'wireframe') return null;
    const hits = rc.intersectObjects(this.back.visible ? [this.front, this.back] : [this.front], false);
    for (const h of hits) {
      if (h.faceIndex == null) continue;
      const faceId = this.triFace[h.faceIndex];
      if (faceId === undefined) continue;
      return { faceId, point: h.point.clone(), normal: this.model.faceNormal(faceId), distance: h.distance };
    }
    return null;
  }
}
