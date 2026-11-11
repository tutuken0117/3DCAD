/**
 * 文字の形（広告・球場名・スコアボード用）。フォントの輪郭を折れ線にして返す。
 * フォント: IPA ゴシック（環境変数 STADIUM_FONT で変更可）。見つからないときは文字なし（null）。
 */
import { existsSync, readFileSync } from 'node:fs';
import opentype from 'opentype.js';

type Ring = [number, number][];
const FONTS = [process.env.STADIUM_FONT ?? '', '/usr/share/fonts/opentype/ipafont-gothic/ipagp.ttf', '/usr/share/fonts/opentype/ipafont-gothic/ipag.ttf', '/usr/share/fonts/truetype/fonts-japanese-gothic.ttf'];

let font: any = null;
for (const p of FONTS) {
  if (p && existsSync(p)) {
    const b = readFileSync(p);
    font = opentype.parse(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
    break;
  }
}
if (!font) console.log('font not found: 文字なしで作ります');
export const hasFont = () => !!font;

/** パスの命令を輪郭（y 上向き）に。曲線は細かく折る */
const toRings = (cmds: any[]): Ring[] => {
  const rings: Ring[] = [];
  let cur: Ring = [];
  let x = 0;
  let y = 0;
  for (const c of cmds) {
    if (c.type === 'M') {
      if (cur.length > 2) rings.push(cur);
      cur = [[c.x, -c.y]];
      x = c.x; y = c.y;
    } else if (c.type === 'L') {
      cur.push([c.x, -c.y]);
      x = c.x; y = c.y;
    } else if (c.type === 'Q') {
      for (let k = 1; k <= 2; k++) {
        const t = k / 2;
        const a = (1 - t) ** 2;
        const b = 2 * (1 - t) * t;
        const d = t * t;
        cur.push([a * x + b * c.x1 + d * c.x, -(a * y + b * c.y1 + d * c.y)]);
      }
      x = c.x; y = c.y;
    } else if (c.type === 'C') {
      for (let k = 1; k <= 3; k++) {
        const t = k / 3;
        const a = (1 - t) ** 3;
        const b = 3 * (1 - t) ** 2 * t;
        const e = 3 * (1 - t) * t * t;
        const d = t ** 3;
        cur.push([a * x + b * c.x1 + e * c.x2 + d * c.x, -(a * y + b * c.y1 + e * c.y2 + d * c.y)]);
      }
      x = c.x; y = c.y;
    } else if (c.type === 'Z') {
      if (cur.length > 2) rings.push(cur);
      cur = [];
    }
  }
  if (cur.length > 2) rings.push(cur);
  // 重なった点を除く
  return rings.map((r) => r.filter((p, i) => i === 0 || Math.hypot(p[0] - r[i - 1][0], p[1] - r[i - 1][1]) > 1e-4));
};

/** 1 行の文字（em = 1）。left = 0、ベースライン = 0 */
export const textRings = (s: string): { rings: Ring[]; width: number } | null => {
  if (!font) return null;
  const p = font.getPath(s, 0, 0, 1);
  return { rings: toRings(p.commands), width: font.getAdvanceWidth(s, 1) };
};

/** 1 文字ずつ（曲がった壁に沿わせる用）: 文字の輪郭と送り幅 */
export const glyphs = (s: string): { rings: Ring[]; adv: number; ch: string }[] => {
  if (!font) return [];
  return [...s].map((ch) => {
    const p = font.getPath(ch, 0, 0, 1);
    return { rings: toRings(p.commands), adv: font.getAdvanceWidth(ch, 1), ch };
  });
};
