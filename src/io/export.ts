import {
  Box3,
  BufferGeometry,
  DoubleSide,
  FrontSide,
  Float32BufferAttribute,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshStandardMaterial,
  Vector3,
} from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { USDZExporter } from 'three/examples/jsm/exporters/USDZExporter.js';
import { polygonNormal, triangulate } from '../core/geometry';
import type { Model } from '../core/Model';
import type { GeoReference } from '../geo/GeoReference';
import { FRONT_COLOR } from '../view/ModelRenderer';

export interface ExportSceneOptions {
  /** 底面中央を原点に移動する（AR 用） */
  centerOnOrigin: boolean;
  /** 線（エッジ）も含める */
  includeEdges: boolean;
  /** 縮尺（1 = 実寸） */
  scale: number;
  /** レイヤーの色で塗る */
  useLayerColors?: boolean;
  /** 裏面も描く（USDZ は非対応なので false） */
  doubleSided?: boolean;
}

export interface ExportScene {
  group: Group;
  /** 原点移動量（ローカル座標）。元の位置 = 書き出し座標 + offset */
  offset: Vector3;
  bounds: Box3;
}

/** モデルを書き出し用の Three.js シーンに変換（色ごとにメッシュを分ける） */
export function buildExportScene(model: Model, opt: ExportSceneOptions): ExportScene {
  const group = new Group();
  group.name = 'Model';
  const byColor = new Map<string, number[]>();
  const normals = new Map<string, number[]>();
  for (const f of model.faces.values()) {
    if (!model.isLayerVisible(f.layer)) continue;
    const pts = model.facePoints(f);
    const n = polygonNormal(pts);
    if (n.lengthSq() === 0) continue;
    const color = opt.useLayerColors ? (model.layers.get(f.layer)?.color ?? FRONT_COLOR) : (f.color ?? FRONT_COLOR);
    if (!byColor.has(color)) (byColor.set(color, []), normals.set(color, []));
    const pos = byColor.get(color)!;
    const nrm = normals.get(color)!;
    for (const tri of triangulate(pts, n)) {
      for (const i of tri) {
        pos.push(pts[i].x, pts[i].y, pts[i].z);
        nrm.push(n.x, n.y, n.z);
      }
    }
  }
  let k = 0;
  for (const [color, pos] of byColor) {
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new Float32BufferAttribute(normals.get(color)!, 3));
    const mesh = new Mesh(g, new MeshStandardMaterial({ color, roughness: 0.85, metalness: 0, side: opt.doubleSided === false ? FrontSide : DoubleSide }));
    mesh.name = `faces_${k++}`;
    group.add(mesh);
  }
  if (opt.includeEdges) {
    const ep: number[] = [];
    for (const e of model.edges.values()) {
      if (!model.isLayerVisible(e.layer)) continue;
      const a = model.pos(e.a);
      const b = model.pos(e.b);
      ep.push(a.x, a.y, a.z, b.x, b.y, b.z);
    }
    if (ep.length) {
      const g = new BufferGeometry();
      g.setAttribute('position', new Float32BufferAttribute(ep, 3));
      const lines = new LineSegments(g, new LineBasicMaterial({ color: 0x222222 }));
      lines.name = 'edges';
      group.add(lines);
    }
  }
  const bounds = model.boundingBox();
  const offset = new Vector3();
  if (opt.centerOnOrigin && !bounds.isEmpty()) {
    const c = bounds.getCenter(new Vector3());
    offset.set(c.x, bounds.min.y, c.z);
    for (const child of group.children) (child as Mesh).geometry.translate(-offset.x, -offset.y, -offset.z);
  }
  if (opt.scale !== 1) group.scale.setScalar(opt.scale);
  return { group, offset, bounds };
}

/** glTF に埋め込む位置情報（公共座標） */
export function geoExtras(geo: GeoReference, offset: Vector3) {
  const anchor = geo.toPublic(offset);
  const ll = geo.toLatLon(offset);
  return {
    crs: geo.zone ? `JGD2011 / Japan Plane Rectangular CS ${geo.zone} (EPSG:${6668 + geo.zone})` : null,
    zone: geo.zone,
    /** モデル座標 (0,0,0) の公共座標。glTF は Y-up, +X=東, -Z=北 */
    anchor: { X: anchor.X, Y: anchor.Y, H: anchor.H },
    latitude: ll?.lat ?? null,
    longitude: ll?.lon ?? null,
    axes: 'glTF +X = East(Y), +Y = Up(H), -Z = North(X)',
  };
}

export async function exportGLB(model: Model, geo: GeoReference, opt: ExportSceneOptions): Promise<Blob> {
  const { group, offset } = buildExportScene(model, opt);
  group.userData = { georeference: geoExtras(geo, offset), generator: '3DCAD' };
  const exporter = new GLTFExporter();
  const result = await exporter.parseAsync(group, { binary: true, onlyVisible: true });
  return new Blob([result as ArrayBuffer], { type: 'model/gltf-binary' });
}

export async function exportUSDZ(model: Model, opt: ExportSceneOptions): Promise<Blob> {
  const { group } = buildExportScene(model, { ...opt, includeEdges: false, doubleSided: false });
  const exporter = new USDZExporter();
  const data = await exporter.parseAsync(group, { quickLookCompatible: true });
  return new Blob([data], { type: 'model/vnd.usdz+zip' });
}

/** 公共座標の点 (X=北, Y=東, H) を出力軸の並び（東, 北, 高さ）に */
function enh(geo: GeoReference, p: Vector3, georef: boolean): [number, number, number] {
  if (!georef) return [p.x, -p.z, p.y];
  const q = geo.toPublic(p);
  return [q.Y, q.X, q.H];
}

/**
 * OBJ（Z-up, x=東 Y, y=北 X, z=標高）。
 * 点群ソフト（CloudCompare など）と重ねやすいよう公共座標のまま出力できる。
 */
export function exportOBJ(model: Model, geo: GeoReference, georef: boolean): string {
  const lines: string[] = [
    '# 3DCAD export',
    georef ? `# 公共座標 平面直角座標系 第${geo.zone}系 (x=Y東, y=X北, z=H標高) [m]` : '# ローカル座標 (x=東, y=北, z=上) [m]',
  ];
  const index = new Map<number, number>();
  let n = 0;
  for (const [id, p] of model.vertices) {
    const [x, y, z] = enh(geo, p, georef);
    lines.push(`v ${x.toFixed(4)} ${y.toFixed(4)} ${z.toFixed(4)}`);
    index.set(id, ++n);
  }
  const byLayer = new Map<string, string[]>();
  for (const f of model.faces.values()) {
    if (!model.isLayerVisible(f.layer)) continue;
    const arr = byLayer.get(f.layer) ?? [];
    arr.push(`f ${f.loop.map((v) => index.get(v)).join(' ')}`);
    byLayer.set(f.layer, arr);
  }
  for (const [layer, faces] of byLayer) {
    lines.push(`g ${layer.replace(/\s+/g, '_')}`);
    lines.push(...faces);
  }
  // 面に使われていない単独の線
  const faceEdges = new Set<string>();
  for (const f of model.faces.values()) {
    const L = f.loop;
    for (let i = 0; i < L.length; i++) {
      const a = L[i];
      const b = L[(i + 1) % L.length];
      faceEdges.add(a < b ? `${a}_${b}` : `${b}_${a}`);
    }
  }
  const loose = [...model.edges.values()].filter(
    (e) => model.isLayerVisible(e.layer) && !faceEdges.has(e.a < e.b ? `${e.a}_${e.b}` : `${e.b}_${e.a}`),
  );
  if (loose.length) {
    lines.push('g edges');
    for (const e of loose) lines.push(`l ${index.get(e.a)} ${index.get(e.b)}`);
  }
  return lines.join('\n') + '\n';
}

/**
 * DXF（R12, 3DFACE + LINE）。発注者側の CAD でも開けるよう、公共座標（x=Y東, y=X北, z=H）で出力。
 */
export function exportDXF(model: Model, geo: GeoReference, georef: boolean): string {
  const out: string[] = [];
  const w = (code: number, value: string | number) => out.push(String(code), String(value));
  const layerName = (s: string) => s.replace(/[<>/\\":;?*|=,]/g, '_') || '0';
  w(0, 'SECTION');
  w(2, 'HEADER');
  w(9, '$ACADVER');
  w(1, 'AC1009');
  w(9, '$INSUNITS');
  w(70, 6);
  w(0, 'ENDSEC');
  w(0, 'SECTION');
  w(2, 'TABLES');
  w(0, 'TABLE');
  w(2, 'LAYER');
  w(70, model.layers.size);
  for (const l of model.layers.values()) {
    w(0, 'LAYER');
    w(2, layerName(l.name));
    w(70, 0);
    w(62, 7);
    w(6, 'CONTINUOUS');
  }
  w(0, 'ENDTAB');
  w(0, 'ENDSEC');
  w(0, 'SECTION');
  w(2, 'ENTITIES');
  const pt = (p: Vector3) => enh(geo, p, georef);
  for (const f of model.faces.values()) {
    if (!model.isLayerVisible(f.layer)) continue;
    const pts = model.facePoints(f);
    for (const tri of triangulate(pts)) {
      const [a, b, c] = tri.map((i) => pt(pts[i]));
      w(0, '3DFACE');
      w(8, layerName(f.layer));
      [a, b, c, c].forEach((p, i) => {
        w(10 + i, p[0].toFixed(4));
        w(20 + i, p[1].toFixed(4));
        w(30 + i, p[2].toFixed(4));
      });
    }
  }
  for (const e of model.edges.values()) {
    if (!model.isLayerVisible(e.layer)) continue;
    const a = pt(model.pos(e.a));
    const b = pt(model.pos(e.b));
    w(0, 'LINE');
    w(8, layerName(e.layer));
    w(10, a[0].toFixed(4));
    w(20, a[1].toFixed(4));
    w(30, a[2].toFixed(4));
    w(11, b[0].toFixed(4));
    w(21, b[1].toFixed(4));
    w(31, b[2].toFixed(4));
  }
  w(0, 'ENDSEC');
  w(0, 'EOF');
  return out.join('\r\n') + '\r\n';
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
