import { describe, expect, it } from 'vitest';
import { parseJww, readJww } from '../src/io/jww';

/** 最小の JWW（線分 2 本・文字 1 つ）をバイト列で作る */
function makeJww(scale: number, text = ''): ArrayBuffer {
  const bytes: number[] = [];
  const u8 = (v: number) => bytes.push(v & 0xff);
  const u16 = (v: number) => (u8(v), u8(v >> 8));
  const u32 = (v: number) => (u16(v), u16(v >>> 16));
  const f64 = (v: number) => {
    const b = new Uint8Array(new Float64Array([v]).buffer);
    for (const x of b) u8(x);
  };
  const str = (s: string) => {
    const b = new TextEncoder().encode(s);
    u8(b.length);
    for (const x of b) u8(x);
  };
  for (const c of 'JwwData.') u8(c.charCodeAt(0));
  u32(420);
  str('');
  u32(3);
  u32(0);
  for (let g = 0; g < 16; g++) {
    u32(2);
    u32(0);
    f64(scale);
    u32(0);
    for (let i = 0; i < 32; i++) u32(0);
  }
  const base = (layer: number) => (u32(0), u8(1), u16(2), u16(0), u16(layer), u16(0), u16(0));
  u16(text ? 3 : 2);
  // 1 本目: 新しいクラス
  u16(0xffff);
  u16(420);
  u16(8);
  for (const c of 'CDataSen') u8(c.charCodeAt(0));
  base(1);
  [0, 0, 10, 0].forEach(f64);
  // 2 本目: クラス番号 1 の参照
  u16(0x8001);
  base(2);
  [10, 0, 10, 5].forEach(f64);
  if (text) {
    u16(0xffff);
    u16(420);
    u16(9);
    for (const c of 'CDataMoji') u8(c.charCodeAt(0));
    base(3);
    [0, 20, 30, 20].forEach(f64);
    u32(1);
    [3, 3, 0, 0].forEach(f64);
    str('MS Gothic');
    str(text);
  }
  u16(0); // ブロック定義なし
  return new Uint8Array(bytes).buffer;
}

describe('Jw_cad（JWW）', () => {
  it('線分を読み、クラスの参照も解決する', () => {
    const f = readJww(makeJww(100));
    expect(f.version).toBe(420);
    expect(f.scales[0]).toBe(100);
    expect(f.data.map((d) => d.cls)).toEqual(['CDataSen', 'CDataSen']);
    expect(f.data[1].layer).toBe(2);
  });
  it('用紙上の mm に縮尺を掛けて実寸にする', () => {
    const d = parseJww(makeJww(50));
    expect(d.paths).toHaveLength(2);
    expect(d.paths[0].points[1]).toEqual([500, 0]);
    expect(d.paths[1].layer).toBe('0-2');
    expect(d.max).toEqual([500, 250]);
  });
  it('縮尺が 1/1 なら図面の文字（S=1:100）から縮尺を推定する', () => {
    const d = parseJww(makeJww(1, 'S=1:100'));
    expect(d.max[0]).toBeCloseTo(1000);
    expect(d.texts[0].text).toBe('S=1:100');
  });
  it('JWW でなければエラー', () => {
    expect(() => readJww(new TextEncoder().encode('hello world!').buffer as ArrayBuffer)).toThrow();
  });
});
