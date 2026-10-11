/**
 * 点群ファイルの読み込み（LAS / PLY / XYZ・TXT・CSV・PTS）。
 *
 * 公共座標の点群は値が大きいため、座標は Float64 のまま返す。
 * GPU に渡す前に GeoReference でプロジェクト原点からの相対座標に変換する。
 */

export interface RawPointCloud {
  /** x, y, z の繰り返し（ファイルに書かれた座標そのまま） */
  positions: Float64Array;
  /** r, g, b（0〜1）の繰り返し。色情報が無ければ undefined */
  colors?: Float32Array;
  /** 反射強度（0〜1 に正規化） */
  intensity?: Float32Array;
  count: number;
  /** 元ファイルの総点数（間引き前） */
  totalCount: number;
  min: [number, number, number];
  max: [number, number, number];
  format: string;
  /** 付加情報（LAS のバージョンなど） */
  info: string[];
}

export interface LoadOptions {
  /** 読み込む最大点数（超える場合は等間隔に間引く） */
  maxPoints?: number;
}

const DEFAULT_MAX = 3_000_000;

export function detectPointCloudFormat(name: string): 'las' | 'laz' | 'ply' | 'text' | null {
  const ext = name.toLowerCase().split('.').pop() ?? '';
  if (ext === 'las') return 'las';
  if (ext === 'laz') return 'laz';
  if (ext === 'ply') return 'ply';
  if (['xyz', 'txt', 'csv', 'pts', 'asc', 'pcd'].includes(ext)) return 'text';
  return null;
}

export function parsePointCloud(name: string, buf: ArrayBuffer, opt: LoadOptions = {}): RawPointCloud {
  const fmt = detectPointCloudFormat(name);
  switch (fmt) {
    case 'las':
      return parseLas(buf, opt);
    case 'laz':
      throw new Error('LAZ（圧縮 LAS）は未対応です。LAStools や CloudCompare で LAS に変換してから読み込んでください。');
    case 'ply':
      return parsePly(buf, opt);
    case 'text':
      return parseTextPoints(new TextDecoder().decode(buf), opt);
    default:
      throw new Error(`対応していない点群形式です: ${name}`);
  }
}

class Builder {
  positions: Float64Array;
  colors?: Float32Array;
  intensity?: Float32Array;
  n = 0;
  min: [number, number, number] = [Infinity, Infinity, Infinity];
  max: [number, number, number] = [-Infinity, -Infinity, -Infinity];

  constructor(capacity: number, hasColor: boolean, hasIntensity: boolean) {
    this.positions = new Float64Array(capacity * 3);
    if (hasColor) this.colors = new Float32Array(capacity * 3);
    if (hasIntensity) this.intensity = new Float32Array(capacity);
  }

  push(x: number, y: number, z: number, r?: number, g?: number, b?: number, it?: number): void {
    if (this.n * 3 >= this.positions.length) this.grow();
    const i = this.n * 3;
    this.positions[i] = x;
    this.positions[i + 1] = y;
    this.positions[i + 2] = z;
    if (this.colors) {
      this.colors[i] = r ?? 1;
      this.colors[i + 1] = g ?? 1;
      this.colors[i + 2] = b ?? 1;
    }
    if (this.intensity) this.intensity[this.n] = it ?? 0;
    if (x < this.min[0]) this.min[0] = x;
    if (y < this.min[1]) this.min[1] = y;
    if (z < this.min[2]) this.min[2] = z;
    if (x > this.max[0]) this.max[0] = x;
    if (y > this.max[1]) this.max[1] = y;
    if (z > this.max[2]) this.max[2] = z;
    this.n++;
  }

  private grow(): void {
    const cap = Math.max(1024, (this.positions.length / 3) * 2);
    const p = new Float64Array(cap * 3);
    p.set(this.positions);
    this.positions = p;
    if (this.colors) {
      const c = new Float32Array(cap * 3);
      c.set(this.colors);
      this.colors = c;
    }
    if (this.intensity) {
      const t = new Float32Array(cap);
      t.set(this.intensity);
      this.intensity = t;
    }
  }

  finish(format: string, totalCount: number, info: string[] = []): RawPointCloud {
    if (this.n === 0) throw new Error('点が 1 つも読み込めませんでした');
    return {
      positions: this.positions.subarray(0, this.n * 3),
      colors: this.colors?.subarray(0, this.n * 3),
      intensity: this.intensity?.subarray(0, this.n),
      count: this.n,
      totalCount,
      min: this.min,
      max: this.max,
      format,
      info,
    };
  }
}

// ---------------------------------------------------------------------------
// LAS
// ---------------------------------------------------------------------------

const LAS_RGB_OFFSET: Record<number, number> = { 2: 20, 3: 28, 5: 28, 7: 30, 8: 30, 10: 30 };

export function parseLas(buf: ArrayBuffer, opt: LoadOptions = {}): RawPointCloud {
  const dv = new DataView(buf);
  const sig = String.fromCharCode(dv.getUint8(0), dv.getUint8(1), dv.getUint8(2), dv.getUint8(3));
  if (sig !== 'LASF') throw new Error('LAS ファイルではありません');
  const vMajor = dv.getUint8(24);
  const vMinor = dv.getUint8(25);
  const offsetToPoints = dv.getUint32(96, true);
  const rawFormat = dv.getUint8(104);
  if (rawFormat & 0x80 || rawFormat & 0x40) {
    throw new Error('圧縮された LAS（LAZ）は未対応です。LAS に変換してから読み込んでください。');
  }
  const pointFormat = rawFormat & 0x3f;
  const recordLen = dv.getUint16(105, true);
  let count = dv.getUint32(107, true);
  if (vMajor === 1 && vMinor >= 4 && count === 0 && buf.byteLength > 255) {
    count = Number(dv.getBigUint64(247, true));
  }
  const sx = dv.getFloat64(131, true);
  const sy = dv.getFloat64(139, true);
  const sz = dv.getFloat64(147, true);
  const ox = dv.getFloat64(155, true);
  const oy = dv.getFloat64(163, true);
  const oz = dv.getFloat64(171, true);

  const available = Math.floor((buf.byteLength - offsetToPoints) / recordLen);
  count = Math.min(count, available);
  const maxPoints = opt.maxPoints ?? DEFAULT_MAX;
  const step = Math.max(1, Math.ceil(count / maxPoints));
  const rgbOff = LAS_RGB_OFFSET[pointFormat];

  // RGB が 8bit か 16bit かを先頭の点から判定
  let rgbScale = 1 / 65535;
  if (rgbOff !== undefined) {
    let maxC = 0;
    for (let i = 0; i < Math.min(count, 5000); i++) {
      const o = offsetToPoints + i * recordLen + rgbOff;
      maxC = Math.max(maxC, dv.getUint16(o, true), dv.getUint16(o + 2, true), dv.getUint16(o + 4, true));
    }
    if (maxC <= 255) rgbScale = 1 / 255;
  }

  const b = new Builder(Math.ceil(count / step), rgbOff !== undefined, true);
  for (let i = 0; i < count; i += step) {
    const o = offsetToPoints + i * recordLen;
    const x = dv.getInt32(o, true) * sx + ox;
    const y = dv.getInt32(o + 4, true) * sy + oy;
    const z = dv.getInt32(o + 8, true) * sz + oz;
    const it = dv.getUint16(o + 12, true) / 65535;
    if (rgbOff !== undefined) {
      b.push(
        x,
        y,
        z,
        dv.getUint16(o + rgbOff, true) * rgbScale,
        dv.getUint16(o + rgbOff + 2, true) * rgbScale,
        dv.getUint16(o + rgbOff + 4, true) * rgbScale,
        it,
      );
    } else {
      b.push(x, y, z, undefined, undefined, undefined, it);
    }
  }
  // 反射強度を 0〜1 に正規化
  if (b.intensity) {
    let maxI = 0;
    for (let i = 0; i < b.n; i++) maxI = Math.max(maxI, b.intensity[i]);
    if (maxI > 0) for (let i = 0; i < b.n; i++) b.intensity[i] /= maxI;
  }
  return b.finish(`LAS ${vMajor}.${vMinor} (形式 ${pointFormat})`, count, [
    step > 1 ? `${step} 点ごとに間引いて表示` : '全点を表示',
  ]);
}

// ---------------------------------------------------------------------------
// PLY（ascii / binary_little_endian / binary_big_endian）
// ---------------------------------------------------------------------------

type PlyType = 'char' | 'uchar' | 'short' | 'ushort' | 'int' | 'uint' | 'float' | 'double';

const PLY_TYPES: Record<string, PlyType> = {
  char: 'char',
  int8: 'char',
  uchar: 'uchar',
  uint8: 'uchar',
  short: 'short',
  int16: 'short',
  ushort: 'ushort',
  uint16: 'ushort',
  int: 'int',
  int32: 'int',
  uint: 'uint',
  uint32: 'uint',
  float: 'float',
  float32: 'float',
  double: 'double',
  float64: 'double',
};

const PLY_SIZE: Record<PlyType, number> = { char: 1, uchar: 1, short: 2, ushort: 2, int: 4, uint: 4, float: 4, double: 8 };

interface PlyProp {
  name: string;
  type: PlyType;
  list?: { countType: PlyType };
}

interface PlyElement {
  name: string;
  count: number;
  props: PlyProp[];
}

export function parsePly(buf: ArrayBuffer, opt: LoadOptions = {}): RawPointCloud {
  const bytes = new Uint8Array(buf);
  // ヘッダーの終わりを探す
  const headText = new TextDecoder().decode(bytes.subarray(0, Math.min(bytes.length, 64 * 1024)));
  const endIdx = headText.indexOf('end_header');
  if (!headText.startsWith('ply') || endIdx < 0) throw new Error('PLY ファイルではありません');
  let headerLen = endIdx + 'end_header'.length;
  while (headerLen < bytes.length && bytes[headerLen] !== 0x0a) headerLen++;
  headerLen++;
  const header = headText.slice(0, endIdx).split(/\r?\n/);

  let format = 'ascii';
  const elements: PlyElement[] = [];
  for (const line of header) {
    const t = line.trim().split(/\s+/);
    if (t[0] === 'format') format = t[1];
    else if (t[0] === 'element') elements.push({ name: t[1], count: parseInt(t[2], 10), props: [] });
    else if (t[0] === 'property') {
      const el = elements[elements.length - 1];
      if (t[1] === 'list') el.props.push({ name: t[4], type: PLY_TYPES[t[3]], list: { countType: PLY_TYPES[t[2]] } });
      else el.props.push({ name: t[2], type: PLY_TYPES[t[1]] });
    }
  }
  const vertexEl = elements.find((e) => e.name === 'vertex');
  if (!vertexEl) throw new Error('PLY に vertex 要素がありません');
  const idx = (n: string) => vertexEl.props.findIndex((p) => p.name === n);
  const ix = idx('x');
  const iy = idx('y');
  const iz = idx('z');
  const ir = Math.max(idx('red'), idx('r'));
  const ig = Math.max(idx('green'), idx('g'));
  const ib = Math.max(idx('blue'), idx('b'));
  const ii = Math.max(idx('intensity'), idx('scalar_intensity'));
  const hasColor = ir >= 0 && ig >= 0 && ib >= 0;
  const colorScale = hasColor && vertexEl.props[ir].type === 'ushort' ? 1 / 65535 : vertexEl.props[ir]?.type === 'float' ? 1 : 1 / 255;
  const maxPoints = opt.maxPoints ?? DEFAULT_MAX;
  const step = Math.max(1, Math.ceil(vertexEl.count / maxPoints));
  const b = new Builder(Math.ceil(vertexEl.count / step), hasColor, ii >= 0);

  const vals = new Array<number>(vertexEl.props.length);
  const emit = (i: number) => {
    if (i % step !== 0) return;
    b.push(
      vals[ix],
      vals[iy],
      vals[iz],
      hasColor ? vals[ir] * colorScale : undefined,
      hasColor ? vals[ig] * colorScale : undefined,
      hasColor ? vals[ib] * colorScale : undefined,
      ii >= 0 ? vals[ii] : undefined,
    );
  };

  if (format === 'ascii') {
    const body = new TextDecoder().decode(bytes.subarray(headerLen)).split(/\r?\n/);
    let line = 0;
    for (const el of elements) {
      for (let i = 0; i < el.count; i++, line++) {
        if (el !== vertexEl) continue;
        const t = body[line].trim().split(/\s+/).map(Number);
        for (let k = 0; k < el.props.length; k++) vals[k] = t[k];
        emit(i);
      }
    }
  } else {
    const little = format === 'binary_little_endian';
    const dv = new DataView(buf);
    let off = headerLen;
    const read = (type: PlyType): number => {
      let v: number;
      switch (type) {
        case 'char': v = dv.getInt8(off); break;
        case 'uchar': v = dv.getUint8(off); break;
        case 'short': v = dv.getInt16(off, little); break;
        case 'ushort': v = dv.getUint16(off, little); break;
        case 'int': v = dv.getInt32(off, little); break;
        case 'uint': v = dv.getUint32(off, little); break;
        case 'float': v = dv.getFloat32(off, little); break;
        case 'double': v = dv.getFloat64(off, little); break;
      }
      off += PLY_SIZE[type];
      return v;
    };
    for (const el of elements) {
      for (let i = 0; i < el.count; i++) {
        for (let k = 0; k < el.props.length; k++) {
          const p = el.props[k];
          if (p.list) {
            const c = read(p.list.countType);
            off += c * PLY_SIZE[p.type];
            vals[k] = 0;
          } else {
            vals[k] = read(p.type);
          }
        }
        if (el === vertexEl) emit(i);
      }
      if (el === vertexEl) break;
    }
  }
  if (b.intensity) {
    let maxI = 0;
    for (let i = 0; i < b.n; i++) maxI = Math.max(maxI, b.intensity[i]);
    if (maxI > 0) for (let i = 0; i < b.n; i++) b.intensity[i] /= maxI;
  }
  return b.finish(`PLY (${format})`, vertexEl.count, [step > 1 ? `${step} 点ごとに間引いて表示` : '全点を表示']);
}

// ---------------------------------------------------------------------------
// テキスト形式（XYZ / TXT / CSV / PTS）
// ---------------------------------------------------------------------------

/**
 * 1 行 1 点のテキスト。区切りは空白・カンマ・タブ。
 *  3 列: x y z
 *  4 列: x y z 強度
 *  6 列: x y z r g b
 *  7 列: x y z 強度 r g b（PTS 形式）
 */
export function parseTextPoints(text: string, opt: LoadOptions = {}): RawPointCloud {
  const lines = text.split(/\r?\n/);
  const maxPoints = opt.maxPoints ?? DEFAULT_MAX;
  const step = Math.max(1, Math.ceil(lines.length / maxPoints));
  // 先頭のデータ行から列数を判定
  let cols = 0;
  for (const l of lines) {
    const t = l.trim().split(/[\s,;]+/).filter(Boolean).map(Number);
    if (t.length >= 3 && t.every((v) => Number.isFinite(v))) {
      cols = t.length;
      break;
    }
  }
  if (cols < 3) throw new Error('座標（x y z）の行が見つかりません');
  const rgbAt = cols >= 7 ? 4 : cols === 6 ? 3 : -1;
  const intAt = cols === 4 || cols >= 7 ? 3 : -1;
  // RGB が 0〜1 か 0〜255 か
  let rgbScale = 1 / 255;
  const b = new Builder(Math.ceil(lines.length / step), rgbAt >= 0, intAt >= 0);
  let scaleChecked = rgbAt < 0;
  let total = 0;
  for (let i = 0; i < lines.length; i++) {
    const s = lines[i].trim();
    if (!s || s[0] === '#' || s[0] === '/') continue;
    const t = s.split(/[\s,;]+/);
    if (t.length < 3) continue;
    const x = Number(t[0]);
    const y = Number(t[1]);
    const z = Number(t[2]);
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;
    total++;
    if (i % step !== 0) continue;
    if (!scaleChecked) {
      const r = Number(t[rgbAt]);
      const g = Number(t[rgbAt + 1]);
      const bl = Number(t[rgbAt + 2]);
      if (r <= 1 && g <= 1 && bl <= 1 && (r % 1 !== 0 || g % 1 !== 0 || bl % 1 !== 0)) rgbScale = 1;
      scaleChecked = true;
    }
    if (rgbAt >= 0) {
      b.push(
        x,
        y,
        z,
        Number(t[rgbAt]) * rgbScale,
        Number(t[rgbAt + 1]) * rgbScale,
        Number(t[rgbAt + 2]) * rgbScale,
        intAt >= 0 ? Number(t[intAt]) : undefined,
      );
    } else {
      b.push(x, y, z, undefined, undefined, undefined, intAt >= 0 ? Number(t[intAt]) : undefined);
    }
  }
  if (b.intensity) {
    let minI = Infinity;
    let maxI = -Infinity;
    for (let i = 0; i < b.n; i++) (minI = Math.min(minI, b.intensity[i]), (maxI = Math.max(maxI, b.intensity[i])));
    const r = maxI - minI || 1;
    for (let i = 0; i < b.n; i++) b.intensity[i] = (b.intensity[i] - minI) / r;
  }
  return b.finish(`テキスト (${cols} 列)`, total, [step > 1 ? `${step} 点ごとに間引いて表示` : '全点を表示']);
}
