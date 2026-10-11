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
  type Raycaster,
  Vector3,
} from 'three';
import type { Model } from '../core/Model';
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

  constructor(
    private viewport: Viewport,
    private model: Model,
    private selection: Selection,
  ) {
    const frontMat = new MeshLambertMaterial({
      vertexColors: true,
      side: FrontSide,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
    });
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
    const fm = this.front.material as MeshLambertMaterial;
    const bm = this.back.material as MeshLambertMaterial;
    const xray = style === 'xray';
    for (const m of [fm, bm]) {
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
    const pos: number[] = [];
    const col: number[] = [];
    const nrm: number[] = [];
    this.triFace = [];
    const c = new Color();
    // グループ編集中は、編集対象以外を薄く表示する
    const fade = new Color('#e9eef2');
    const editing = m.activeGroup;
    for (const f of m.faces.values()) {
      if (!m.isLayerVisible(f.layer)) continue;
      const { points: pts, tris, normal: n } = m.faceTriangles(f);
      if (n.lengthSq() === 0) continue;
      const colorStr = this.faceStyle === 'layer' ? (m.layers.get(f.layer)?.color ?? FRONT_COLOR) : (f.color ?? FRONT_COLOR);
      c.set(colorStr);
      if (editing && m.groupOfFace(f) !== editing) c.lerp(fade, 0.65);
      for (const tri of tris) {
        for (const i of tri) {
          pos.push(pts[i].x, pts[i].y, pts[i].z);
          nrm.push(n.x, n.y, n.z);
          col.push(c.r, c.g, c.b);
        }
        this.triFace.push(f.id);
      }
    }
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new Float32BufferAttribute(nrm, 3));
    g.setAttribute('color', new Float32BufferAttribute(col, 3));
    g.computeBoundingSphere();
    this.front.geometry.dispose();
    this.front.geometry = g;
    this.back.geometry = g;

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

  /** レイが当たった面 */
  pickFace(rc: Raycaster): { faceId: number; point: Vector3; normal: Vector3; distance: number } | null {
    if (this.faceStyle === 'wireframe') return null;
    const hits = rc.intersectObjects([this.front, this.back], false);
    for (const h of hits) {
      if (h.faceIndex == null) continue;
      const faceId = this.triFace[h.faceIndex];
      if (faceId === undefined) continue;
      return { faceId, point: h.point.clone(), normal: this.model.faceNormal(faceId), distance: h.distance };
    }
    return null;
  }
}
