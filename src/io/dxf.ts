import DxfParser from 'dxf-parser';
import type { IDxf, IEntity } from 'dxf-parser';
import {
  arcToPoints,
  bulgeToPoints,
  finalizeDrawing,
  type Drawing2D,
  type DrawingPath,
  type DrawingText,
} from './drawing2d';

/** AutoCAD カラーインデックスの代表色（1〜9） */
const ACI: Record<number, string> = {
  1: '#ff0000',
  2: '#ffff00',
  3: '#00ff00',
  4: '#00ffff',
  5: '#0000ff',
  6: '#ff00ff',
  7: '#333333',
  8: '#808080',
  9: '#c0c0c0',
};

/**
 * DXF のバイト列を文字列にする。
 * 日本の CAD が出力する DXF は Shift_JIS（ANSI_932）が多いので自動判定する。
 */
export function decodeDxf(buf: ArrayBuffer): string {
  const head = new TextDecoder('latin1').decode(new Uint8Array(buf, 0, Math.min(buf.byteLength, 20000)));
  const m = /\$DWGCODEPAGE\s*\r?\n\s*3\s*\r?\n\s*(\S+)/.exec(head);
  const verM = /\$ACADVER\s*\r?\n\s*1\s*\r?\n\s*AC(\d+)/.exec(head);
  const ver = verM ? parseInt(verM[1], 10) : 0;
  // AC1021（AutoCAD 2007）以降は UTF-8
  if (ver >= 1021) return new TextDecoder('utf-8').decode(buf);
  if (m && /932/.test(m[1])) return new TextDecoder('shift_jis').decode(buf);
  // UTF-8 として正しく読めなければ Shift_JIS とみなす
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch {
    return new TextDecoder('shift_jis').decode(buf);
  }
}

interface Xform {
  // 2D アフィン: x' = a x + c y + e, y' = b x + d y + f
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}

const IDENTITY: Xform = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

function apply(t: Xform, x: number, y: number): [number, number] {
  return [t.a * x + t.c * y + t.e, t.b * x + t.d * y + t.f];
}

function compose(p: Xform, q: Xform): Xform {
  // p ∘ q
  return {
    a: p.a * q.a + p.c * q.b,
    b: p.b * q.a + p.d * q.b,
    c: p.a * q.c + p.c * q.d,
    d: p.b * q.c + p.d * q.d,
    e: p.a * q.e + p.c * q.f + p.e,
    f: p.b * q.e + p.d * q.f + p.f,
  };
}

/** OCS の押し出し方向が -Z（ミラーされた円弧など）なら X を反転 */
function ocsFlip(e: { extrusionDirectionZ?: number; extrusionDirection?: { z: number } }): boolean {
  const z = e.extrusionDirectionZ ?? e.extrusionDirection?.z ?? 1;
  return z < 0;
}

export function parseDxf(text: string): Drawing2D {
  const parser = new DxfParser();
  let dxf: IDxf | null;
  try {
    dxf = parser.parseSync(text);
  } catch (err) {
    throw new Error(`DXF の解析に失敗しました: ${(err as Error).message}`);
  }
  if (!dxf) throw new Error('DXF の解析に失敗しました');

  const layerColors = new Map<string, string>();
  const layers = dxf.tables?.layer?.layers ?? {};
  for (const [name, l] of Object.entries(layers)) {
    layerColors.set(name, ACI[Math.abs(l.colorIndex)] ?? `#${(l.color ?? 0x333333).toString(16).padStart(6, '0')}`);
  }

  const paths: DrawingPath[] = [];
  const texts: DrawingText[] = [];
  const warnings: string[] = [];
  const skipped = new Map<string, number>();
  const blocks = dxf.blocks ?? {};

  const walk = (entities: IEntity[], t: Xform, depth: number, parentLayer?: string) => {
    if (depth > 8) return;
    for (const ent of entities) {
      // ブロック内の画層 "0" は挿入側の画層を引き継ぐ
      const layer = ent.layer === '0' && parentLayer ? parentLayer : (ent.layer ?? '0');
      if (ent.inPaperSpace) continue;
      const e = ent as unknown as Record<string, any>;
      const push = (pts: [number, number][], closed: boolean) => {
        if (pts.length < 2) return;
        paths.push({ layer, points: pts.map(([x, y]) => apply(t, x, y)), closed });
      };
      switch (ent.type) {
        case 'LINE': {
          const v = e.vertices as { x: number; y: number }[];
          push([[v[0].x, v[0].y], [v[1].x, v[1].y]], false);
          break;
        }
        case 'LWPOLYLINE':
        case 'POLYLINE': {
          if (e.is3dPolygonMesh || e.isPolyfaceMesh) {
            skipped.set(ent.type + '(メッシュ)', (skipped.get(ent.type) ?? 0) + 1);
            break;
          }
          const vs = (e.vertices ?? []) as { x: number; y: number; bulge?: number }[];
          if (vs.length < 2) break;
          const closed = !!e.shape;
          const pts: [number, number][] = [[vs[0].x, vs[0].y]];
          const n = closed ? vs.length : vs.length - 1;
          for (let i = 0; i < n; i++) {
            const a = vs[i];
            const b = vs[(i + 1) % vs.length];
            pts.push(...bulgeToPoints([a.x, a.y], [b.x, b.y], a.bulge ?? 0));
          }
          if (closed) pts.pop();
          const flip = ocsFlip(e);
          push(flip ? pts.map(([x, y]) => [-x, y] as [number, number]) : pts, closed);
          break;
        }
        case 'CIRCLE': {
          const c = e.center;
          const pts = arcToPoints(c.x, c.y, e.radius, 0, Math.PI * 2);
          pts.pop();
          const flip = ocsFlip(e);
          push(flip ? pts.map(([x, y]) => [-x, y] as [number, number]) : pts, true);
          break;
        }
        case 'ARC': {
          const c = e.center;
          const pts = arcToPoints(c.x, c.y, e.radius, e.startAngle, e.endAngle);
          const flip = ocsFlip(e);
          push(flip ? pts.map(([x, y]) => [-x, y] as [number, number]) : pts, false);
          break;
        }
        case 'ELLIPSE': {
          const c = e.center;
          const mj = e.majorAxisEndPoint;
          const ratio = e.axisRatio ?? 1;
          const s = e.startAngle ?? 0;
          let en = e.endAngle ?? Math.PI * 2;
          if (en <= s) en += Math.PI * 2;
          const n = Math.max(8, Math.ceil(((en - s) / (Math.PI * 2)) * 64));
          const pts: [number, number][] = [];
          for (let i = 0; i <= n; i++) {
            const a = s + ((en - s) * i) / n;
            const cos = Math.cos(a);
            const sin = Math.sin(a) * ratio;
            pts.push([c.x + mj.x * cos - mj.y * sin, c.y + mj.y * cos + mj.x * sin]);
          }
          const full = Math.abs(en - s - Math.PI * 2) < 1e-6;
          if (full) pts.pop();
          push(pts, full);
          break;
        }
        case 'SPLINE': {
          const cps = (e.fitPoints?.length ? e.fitPoints : e.controlPoints) as { x: number; y: number }[] | undefined;
          if (cps?.length) push(cps.map((p) => [p.x, p.y] as [number, number]), !!e.closed);
          break;
        }
        case 'SOLID':
        case '3DFACE': {
          const vs = (e.vertices ?? e.points ?? []) as { x: number; y: number }[];
          const pts = vs.map((p) => [p.x, p.y] as [number, number]);
          // SOLID は 3 番目と 4 番目の点が入れ替わっている
          if (ent.type === 'SOLID' && pts.length === 4) [pts[2], pts[3]] = [pts[3], pts[2]];
          push(pts, true);
          break;
        }
        case 'TEXT':
        case 'MTEXT': {
          const p = e.startPoint ?? e.position;
          if (!p) break;
          const [x, y] = apply(t, p.x, p.y);
          const raw = String(e.text ?? '');
          const clean = raw.replace(/\\[A-Za-z][^;]*;/g, '').replace(/[{}]/g, '').replace(/\\P/g, ' ');
          texts.push({ layer, x, y, height: e.textHeight ?? e.height ?? 1, text: clean });
          break;
        }
        case 'INSERT': {
          const blk = blocks[e.name];
          if (!blk) break;
          const rot = ((e.rotation ?? 0) * Math.PI) / 180;
          const sx = (e.xScale ?? 1) * (ocsFlip(e) ? -1 : 1);
          const sy = e.yScale ?? 1;
          const bp = blk.position ?? { x: 0, y: 0 };
          const cols = Math.max(1, e.columnCount ?? 1);
          const rows = Math.max(1, e.rowCount ?? 1);
          for (let ci = 0; ci < cols; ci++)
            for (let ri = 0; ri < rows; ri++) {
              const ox = ci * (e.columnSpacing ?? 0);
              const oy = ri * (e.rowSpacing ?? 0);
              const cos = Math.cos(rot);
              const sin = Math.sin(rot);
              const local: Xform = {
                a: cos * sx,
                b: sin * sx,
                c: -sin * sy,
                d: cos * sy,
                e: e.position.x + cos * ox - sin * oy,
                f: e.position.y + sin * ox + cos * oy,
              };
              const toBase: Xform = { ...IDENTITY, e: -bp.x, f: -bp.y };
              walk(blk.entities ?? [], compose(t, compose(local, toBase)), depth + 1, layer);
            }
          break;
        }
        case 'DIMENSION':
        case 'POINT':
        case 'ATTDEF':
          break;
        default:
          skipped.set(ent.type, (skipped.get(ent.type) ?? 0) + 1);
      }
    }
  };
  walk(dxf.entities ?? [], IDENTITY, 0);

  if (skipped.size) {
    warnings.push(`未対応の図形をスキップ: ${[...skipped].map(([k, v]) => `${k}×${v}`).join(', ')}`);
  }
  const insUnits = (dxf.header?.['$INSUNITS'] as number | undefined) ?? 0;
  const unitHint = insUnits === 4 ? 'mm' : insUnits === 5 ? 'cm' : insUnits === 6 ? 'm' : undefined;
  return finalizeDrawing(paths, texts, layerColors, 'DXF', warnings, unitHint);
}
