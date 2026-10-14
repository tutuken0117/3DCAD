import { arcToPoints, finalizeDrawing, type Drawing2D, type DrawingPath, type DrawingText } from './drawing2d';

/**
 * Jw_cad（.jww）のリーダー。
 *
 * JWW は MFC の CArchive 形式で保存されたバイナリ。ヘッダー（各種設定）は
 * 版ごとに長さが変わるため、図形リストの先頭（最初のクラス名 "CData…"）を探して
 * そこから読む。座標は実寸の mm。
 * レイヤは「グループ番号-レイヤ番号」（例: 0-3）の名前にする。
 */

const JW_COLORS: Record<number, string> = {
  1: '#00a0a0',
  2: '#000000',
  3: '#00a000',
  4: '#c0a000',
  5: '#a000a0',
  6: '#0000ff',
  7: '#00a0a0',
  8: '#ff0000',
  9: '#808080',
};

const hex = (n: number) => n.toString(16);

class Reader {
  pos = 0;
  readonly dv: DataView;
  readonly sjis = new TextDecoder('shift_jis');
  constructor(readonly buf: Uint8Array) {
    this.dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  }
  u8(): number {
    return this.dv.getUint8(this.pos++);
  }
  u16(): number {
    const v = this.dv.getUint16(this.pos, true);
    this.pos += 2;
    return v;
  }
  u32(): number {
    const v = this.dv.getUint32(this.pos, true);
    this.pos += 4;
    return v;
  }
  f64(): number {
    const v = this.dv.getFloat64(this.pos, true);
    this.pos += 8;
    return v;
  }
  /** MFC CString（長さ BYTE → WORD → DWORD） */
  str(): string {
    let n = this.u8();
    if (n === 0xff) {
      n = this.u16();
      if (n === 0xfffe) throw new Error('Unicode 文字列には未対応です');
      if (n === 0xffff) n = this.u32();
    }
    const s = this.sjis.decode(this.buf.subarray(this.pos, this.pos + n));
    this.pos += n;
    return s;
  }
  count(): number {
    const n = this.u16();
    return n === 0xffff ? this.u32() : n;
  }
}

interface JwData {
  cls: string;
  group: number;
  penStyle: number;
  penColor: number;
  layer: number;
  gLayer: number;
  [k: string]: unknown;
}

export interface JwwFile {
  version: number;
  memo: string;
  /** レイヤグループごとの縮尺の分母（1/100 なら 100） */
  scales: number[];
  data: JwData[];
  blocks: Map<number, { name: string; data: JwData[] }>;
}

/** MFC の CArchive からオブジェクトを読む */
class ObjectReader {
  private classes = new Map<number, string>();
  private objects = new Map<number, JwData>();
  private mapCount = 1;
  constructor(
    private r: Reader,
    private version: number,
  ) {}

  readObject(): JwData | null {
    const r = this.r;
    let tag = r.u16();
    let isClass = false;
    let classIndex = 0;
    if (tag === 0x7fff) {
      const big = r.u32();
      if (big & 0x80000000) {
        isClass = true;
        classIndex = big & 0x7fffffff;
      } else tag = big;
    } else if (tag & 0x8000 && tag !== 0xffff) {
      isClass = true;
      classIndex = tag & 0x7fff;
    }
    let cls: string;
    if (tag === 0xffff) {
      r.u16(); // schema
      const n = r.u16();
      cls = new TextDecoder('latin1').decode(r.buf.subarray(r.pos, r.pos + n));
      r.pos += n;
      this.classes.set(this.mapCount++, cls);
    } else if (isClass) {
      const c = this.classes.get(classIndex);
      if (!c) throw new Error(`不明なクラス番号 ${classIndex} (0x${hex(r.pos)})`);
      cls = c;
    } else {
      // 既に読んだオブジェクトの参照
      if (tag === 0) return null;
      return this.objects.get(tag) ?? null;
    }
    const idx = this.mapCount++;
    const obj = this.readBody(cls);
    this.objects.set(idx, obj);
    return obj;
  }

  private base(cls: string): JwData {
    const r = this.r;
    const group = r.u32();
    const penStyle = r.u8();
    const penColor = r.u16();
    if (this.version >= 351) r.u16(); // 線幅
    const layer = r.u16();
    const gLayer = r.u16();
    r.u16(); // フラグ
    return { cls, group, penStyle, penColor, layer, gLayer };
  }

  private sen(d: JwData): JwData {
    const r = this.r;
    d.x1 = r.f64();
    d.y1 = r.f64();
    d.x2 = r.f64();
    d.y2 = r.f64();
    return d;
  }

  private moji(d: JwData): JwData {
    const r = this.r;
    d.x1 = r.f64();
    d.y1 = r.f64();
    d.x2 = r.f64();
    d.y2 = r.f64();
    d.kind = r.u32();
    d.sizeX = r.f64();
    d.sizeY = r.f64();
    d.space = r.f64();
    d.angle = r.f64();
    d.font = r.str();
    d.text = r.str();
    return d;
  }

  private ten(d: JwData): JwData {
    const r = this.r;
    d.x = r.f64();
    d.y = r.f64();
    d.temp = r.u32();
    if (d.penStyle === 100) {
      d.code = r.u32();
      d.angle = r.f64();
      d.scale = r.f64();
    }
    return d;
  }

  readBody(cls: string): JwData {
    const r = this.r;
    const d = this.base(cls);
    switch (cls) {
      case 'CDataSen':
        return this.sen(d);
      case 'CDataEnko':
        d.cx = r.f64();
        d.cy = r.f64();
        d.r = r.f64();
        d.start = r.f64();
        d.sweep = r.f64();
        d.tilt = r.f64();
        d.flat = r.f64();
        d.full = r.u32();
        return d;
      case 'CDataTen':
        return this.ten(d);
      case 'CDataMoji':
        return this.moji(d);
      case 'CDataSolid':
        d.x1 = r.f64();
        d.y1 = r.f64();
        d.x4 = r.f64();
        d.y4 = r.f64();
        d.x2 = r.f64();
        d.y2 = r.f64();
        d.x3 = r.f64();
        d.y3 = r.f64();
        if (d.penColor === 10) d.rgb = r.u32();
        return d;
      case 'CDataBlock':
        d.x = r.f64();
        d.y = r.f64();
        d.sx = r.f64();
        d.sy = r.f64();
        d.angle = r.f64();
        d.number = r.u32();
        return d;
      case 'CDataSunpou': {
        d.line = this.sen(this.base('CDataSen'));
        d.label = this.moji(this.base('CDataMoji'));
        if (this.version >= 420) {
          r.u16();
          this.sen(this.base('CDataSen'));
          this.sen(this.base('CDataSen'));
          for (let i = 0; i < 4; i++) this.ten(this.base('CDataTen'));
        }
        return d;
      }
      case 'CDataList': {
        d.number = r.u32();
        r.u32(); // 参照されているか
        r.u32(); // 時刻（CTime）
        d.name = r.str();
        d.items = this.list();
        return d;
      }
      default:
        throw new Error(`未対応の図形 ${cls} (0x${hex(r.pos)})`);
    }
  }

  list(): JwData[] {
    const n = this.r.count();
    const out: JwData[] = [];
    for (let i = 0; i < n; i++) {
      const o = this.readObject();
      if (o) out.push(o);
    }
    return out;
  }
}

/** 図形リストの開始位置（件数の WORD の位置）を探す */
function findDataStart(b: Uint8Array): number {
  for (let i = 8; i < b.length - 16; i++) {
    if (b[i] !== 0xff || b[i + 1] !== 0xff) continue;
    const n = b[i + 4] | (b[i + 5] << 8);
    if (n < 6 || n > 16) continue;
    if (String.fromCharCode(...b.subarray(i + 6, i + 11)) !== 'CData') continue;
    // 件数が 0xFFFF 以上なら WORD 0xFFFF + DWORD
    if (i >= 6 && b[i - 6] === 0xff && b[i - 5] === 0xff) return i - 6;
    return i - 2;
  }
  throw new Error('JWW の図形データが見つかりませんでした');
}

export function readJww(buf: ArrayBuffer): JwwFile {
  const b = new Uint8Array(buf);
  const sig = String.fromCharCode(...b.subarray(0, 8));
  if (sig !== 'JwwData.') throw new Error('Jw_cad（JWW）のファイルではありません');
  const r = new Reader(b);
  r.pos = 8;
  const version = r.u32();
  const memo = r.str().trim();
  r.u32(); // 図面サイズ
  r.u32(); // 書込みレイヤグループ
  const scales: number[] = [];
  for (let g = 0; g < 16; g++) {
    r.u32();
    r.u32();
    scales.push(r.f64());
    r.u32();
    r.pos += 16 * 8;
  }
  r.pos = findDataStart(b);
  const or = new ObjectReader(r, version);
  const data = or.list();
  const blocks = new Map<number, { name: string; data: JwData[] }>();
  try {
    for (const bl of or.list()) {
      if (bl.cls === 'CDataList') blocks.set(bl.number as number, { name: bl.name as string, data: bl.items as JwData[] });
    }
  } catch {
    // ブロック定義が読めなくても本体の図形は使う
  }
  return { version, memo, scales, data, blocks };
}

interface Xf {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}
const ap = (t: Xf, x: number, y: number): [number, number] => [t.a * x + t.c * y + t.e, t.b * x + t.d * y + t.f];
const mul = (p: Xf, q: Xf): Xf => ({
  a: p.a * q.a + p.c * q.b,
  b: p.b * q.a + p.d * q.b,
  c: p.a * q.c + p.c * q.d,
  d: p.b * q.c + p.d * q.d,
  e: p.a * q.e + p.c * q.f + p.e,
  f: p.b * q.e + p.d * q.f + p.f,
});

/** レイヤ名（グループ-レイヤ を 16 進 1 桁ずつ。Jw_cad の表示と同じ） */
export const jwLayerName = (g: number, l: number) => `${hex(g & 15).toUpperCase()}-${hex(l & 15).toUpperCase()}`;

/**
 * 縮尺の分母を決める。JWW の座標は用紙上の mm なので、実寸にするにはレイヤグループの縮尺を掛ける。
 * 縮尺が 1/1 のまま 1/100 などの図面を描いている場合は、図面の文字（「S=1:100」など）から推定する。
 */
function scaleFactors(f: JwwFile): number[] {
  if (f.scales.some((s) => s > 1)) return f.scales.map((s) => (s > 0 ? s : 1));
  const count = new Map<number, number>();
  const visit = (items: JwData[]) => {
    for (const d of items) {
      if (d.cls === 'CDataMoji') {
        const m = /1\s*[:：/／]\s*(\d{2,4})(?!\d)/.exec(String(d.text).normalize('NFKC'));
        if (m) count.set(+m[1], (count.get(+m[1]) ?? 0) + 1);
      }
    }
  };
  visit(f.data);
  let best = 1;
  let n = 0;
  for (const [k, v] of count) if (v > n) (best = k), (n = v);
  return f.scales.map(() => best);
}

export function parseJww(buf: ArrayBuffer): Drawing2D {
  const f = readJww(buf);
  const scales = scaleFactors(f);
  const paths: DrawingPath[] = [];
  const texts: DrawingText[] = [];
  const colors = new Map<string, string>();
  const warnings: string[] = [];

  const emit = (items: JwData[], t: Xf, depth: number, parentLayer?: string) => {
    for (const d of items) {
      const layer = parentLayer ?? jwLayerName(d.gLayer, d.layer);
      if (!colors.has(layer)) colors.set(layer, JW_COLORS[d.penColor] ?? '#333333');
      switch (d.cls) {
        case 'CDataSen':
          paths.push({ layer, points: [ap(t, d.x1 as number, d.y1 as number), ap(t, d.x2 as number, d.y2 as number)], closed: false });
          break;
        case 'CDataEnko': {
          const r = d.r as number;
          const flat = (d.flat as number) || 1;
          const tilt = d.tilt as number;
          const full = !!d.full;
          const s = full ? 0 : (d.start as number);
          const e = full ? Math.PI * 2 : s + (d.sweep as number);
          const pts = arcToPoints(0, 0, r, s, e, 64).map(([x, y]): [number, number] => {
            const yy = y * flat;
            const c = Math.cos(tilt);
            const sn = Math.sin(tilt);
            return ap(t, (d.cx as number) + x * c - yy * sn, (d.cy as number) + x * sn + yy * c);
          });
          if (full) pts.pop();
          paths.push({ layer, points: pts, closed: full });
          break;
        }
        case 'CDataSolid': {
          if (d.penStyle >= 101) {
            // 円・円弧ソリッド: 中心(x1,y1)・半径(x4)・扁平率(y4)・傾き(x2)・開始角(y2)・円弧角(x3)
            const r = d.x4 as number;
            const flat = (d.y4 as number) || 1;
            const tilt = d.x2 as number;
            const s0 = d.y2 as number;
            const sw = (d.x3 as number) || Math.PI * 2;
            const c = Math.cos(tilt);
            const sn = Math.sin(tilt);
            const pts = arcToPoints(0, 0, r, s0, s0 + sw, 32).map(([x, y]): [number, number] =>
              ap(t, (d.x1 as number) + x * c - y * flat * sn, (d.y1 as number) + x * sn + y * flat * c),
            );
            paths.push({ layer, points: pts, closed: true });
            break;
          }
          const pts: [number, number][] = [
            ap(t, d.x1 as number, d.y1 as number),
            ap(t, d.x2 as number, d.y2 as number),
            ap(t, d.x3 as number, d.y3 as number),
            ap(t, d.x4 as number, d.y4 as number),
          ];
          paths.push({ layer, points: pts, closed: true });
          break;
        }
        case 'CDataMoji': {
          const [x, y] = ap(t, d.x1 as number, d.y1 as number);
          const text = (d.text as string).replace(/^\^@\w*/, '');
          if (text.trim()) texts.push({ layer, x, y, height: (d.sizeY as number) * Math.hypot(t.a, t.b), text });
          break;
        }
        case 'CDataSunpou':
          emit([d.line as JwData, d.label as JwData], t, depth, layer);
          break;
        case 'CDataBlock': {
          const bl = f.blocks.get(d.number as number);
          if (!bl || depth > 8) break;
          const c = Math.cos(d.angle as number);
          const s = Math.sin(d.angle as number);
          const sx = d.sx as number;
          const sy = d.sy as number;
          const bt: Xf = { a: c * sx, b: s * sx, c: -s * sy, d: c * sy, e: d.x as number, f: d.y as number };
          emit(bl.data, mul(t, bt), depth + 1, layer);
          break;
        }
      }
    }
  };
  // レイヤグループごとに縮尺を掛けて実寸 (mm) にする
  const all: JwData[] = f.data;
  for (let g = 0; g < 16; g++) {
    const items = all.filter((d) => (d.gLayer & 15) === g);
    if (!items.length) continue;
    const k = scales[g] ?? 1;
    emit(items, { a: k, b: 0, c: 0, d: k, e: 0, f: 0 }, 0);
  }
  if (scales.some((s) => s !== 1)) warnings.push(`縮尺 1/${scales.find((s) => s !== 1)} として実寸に換算しました`);
  return finalizeDrawing(paths, texts, colors, f.memo || 'Jw_cad', warnings, 'mm');
}
