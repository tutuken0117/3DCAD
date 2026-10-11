import {
  BufferGeometry,
  CanvasTexture,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  Line,
  LineBasicMaterial,
  LineDashedMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  Points,
  PointsMaterial,
  Vector3,
} from 'three';
import { triangulate } from '../core/geometry';
import type { InferenceResult } from './Inference';
import { INFERENCE_LABEL } from './Inference';
import { AXIS_COLORS, type Viewport } from './Viewport';

const MARKER_COLORS: Record<string, number> = {
  endpoint: 0x00b050,
  midpoint: 0x00b8d9,
  onEdge: 0xe0301e,
  onFace: 0x2a64d8,
  pointcloud: 0xff8c00,
  underlay: 0x8a5cd6,
  axis: 0x000000,
  locked: 0x000000,
  ground: 0x666666,
  free: 0x666666,
};

function dotTexture(): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  g.beginPath();
  g.arc(32, 32, 26, 0, Math.PI * 2);
  g.fillStyle = '#fff';
  g.fill();
  g.lineWidth = 8;
  g.strokeStyle = '#000';
  g.globalAlpha = 0.35;
  g.stroke();
  return new CanvasTexture(c);
}

/** ツールのプレビュー（ラバーバンド線・スナップ表示・ツールチップ） */
export class Overlay {
  private root = new Group();
  private marker: Points;
  private rubber: Line;
  private previewLines: LineSegments;
  private previewDashed: LineSegments;
  private previewFill: Mesh;
  private tooltip: HTMLDivElement;

  constructor(private viewport: Viewport) {
    viewport.overlayRoot.add(this.root);
    this.marker = new Points(
      new BufferGeometry().setAttribute('position', new Float32BufferAttribute([0, 0, 0], 3)),
      new PointsMaterial({
        size: 13,
        sizeAttenuation: false,
        map: dotTexture(),
        transparent: true,
        depthTest: false,
        alphaTest: 0.1,
      }),
    );
    this.marker.renderOrder = 100;
    this.marker.visible = false;

    this.rubber = new Line(new BufferGeometry(), new LineBasicMaterial({ color: 0x000000, depthTest: false }));
    this.rubber.renderOrder = 99;
    this.previewLines = new LineSegments(new BufferGeometry(), new LineBasicMaterial({ color: 0x1f3f7f, depthTest: false }));
    this.previewLines.renderOrder = 98;
    this.previewDashed = new LineSegments(
      new BufferGeometry(),
      new LineDashedMaterial({ color: 0x555555, dashSize: 0.1, gapSize: 0.08, depthTest: false }),
    );
    this.previewDashed.renderOrder = 98;
    this.previewFill = new Mesh(
      new BufferGeometry(),
      new MeshBasicMaterial({ color: 0x6fa8ff, transparent: true, opacity: 0.3, side: DoubleSide, depthWrite: false }),
    );
    this.root.add(this.previewFill, this.previewLines, this.previewDashed, this.rubber, this.marker);

    this.tooltip = document.createElement('div');
    this.tooltip.className = 'inference-tooltip';
    viewport.container.appendChild(this.tooltip);
  }

  /** スナップ位置の表示 */
  showInference(inf: InferenceResult | null, clientX?: number, clientY?: number): void {
    if (!inf) {
      this.marker.visible = false;
      this.tooltip.style.display = 'none';
      this.viewport.requestRender();
      return;
    }
    const showMarker = !['free', 'ground', 'axis', 'locked'].includes(inf.type);
    this.marker.visible = showMarker;
    if (showMarker) {
      (this.marker.geometry.getAttribute('position') as Float32BufferAttribute).setXYZ(0, inf.point.x, inf.point.y, inf.point.z);
      this.marker.geometry.getAttribute('position').needsUpdate = true;
      this.marker.geometry.computeBoundingSphere();
      (this.marker.material as PointsMaterial).color.setHex(MARKER_COLORS[inf.type] ?? 0x000000);
    }
    let label = INFERENCE_LABEL[inf.type];
    if (inf.type === 'axis' && inf.axis) label = { x: '赤い軸上（東西）', y: '青い軸上（高さ）', z: '緑の軸上（南北）' }[inf.axis];
    if (label && clientX !== undefined && clientY !== undefined) {
      const p = this.viewport.toCanvas(clientX, clientY);
      this.tooltip.textContent = label;
      this.tooltip.style.display = 'block';
      this.tooltip.style.left = `${p.x + 14}px`;
      this.tooltip.style.top = `${p.y + 16}px`;
    } else {
      this.tooltip.style.display = 'none';
    }
    this.viewport.requestRender();
  }

  /** 始点からカーソルまでの線（軸方向なら軸の色） */
  setRubberBand(from: Vector3 | null, to?: Vector3, inf?: InferenceResult): void {
    if (!from || !to) {
      this.rubber.visible = false;
      this.viewport.requestRender();
      return;
    }
    this.rubber.visible = true;
    this.rubber.geometry.dispose();
    this.rubber.geometry = new BufferGeometry().setFromPoints([from, to]);
    const color = inf?.axis ? AXIS_COLORS[inf.axis] : inf?.type === 'locked' ? 0xb000b0 : 0x000000;
    (this.rubber.material as LineBasicMaterial).color.setHex(color);
    this.viewport.requestRender();
  }

  /** プレビュー用の線分（[a,b] の組の配列） */
  setPreviewLines(segments: [Vector3, Vector3][], dashed: [Vector3, Vector3][] = []): void {
    const set = (obj: LineSegments, segs: [Vector3, Vector3][]) => {
      const pos: number[] = [];
      for (const [a, b] of segs) pos.push(a.x, a.y, a.z, b.x, b.y, b.z);
      obj.geometry.dispose();
      obj.geometry = new BufferGeometry();
      obj.geometry.setAttribute('position', new Float32BufferAttribute(pos, 3));
      obj.computeLineDistances();
    };
    set(this.previewLines, segments);
    set(this.previewDashed, dashed);
    // 破線の間隔を画面の大きさに合わせる
    if (dashed.length) {
      const wpp = this.viewport.worldPerPixel(dashed[0][0]);
      const m = this.previewDashed.material as LineDashedMaterial;
      m.dashSize = wpp * 6;
      m.gapSize = wpp * 4;
    }
    this.viewport.requestRender();
  }

  /** プレビュー用の面（多角形のリスト） */
  setPreviewFaces(polys: Vector3[][]): void {
    const pos: number[] = [];
    for (const pts of polys) {
      for (const tri of triangulate(pts)) for (const i of tri) pos.push(pts[i].x, pts[i].y, pts[i].z);
    }
    this.previewFill.geometry.dispose();
    this.previewFill.geometry = new BufferGeometry();
    this.previewFill.geometry.setAttribute('position', new Float32BufferAttribute(pos, 3));
    this.viewport.requestRender();
  }

  /** ポリゴンの輪郭線をプレビュー線分に */
  static outline(pts: Vector3[], closed = true): [Vector3, Vector3][] {
    const segs: [Vector3, Vector3][] = [];
    const n = closed ? pts.length : pts.length - 1;
    for (let i = 0; i < n; i++) segs.push([pts[i], pts[(i + 1) % pts.length]]);
    return segs;
  }

  clear(): void {
    this.showInference(null);
    this.setRubberBand(null);
    this.setPreviewLines([]);
    this.setPreviewFaces([]);
  }
}
