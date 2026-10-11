import { arcToPoints, finalizeDrawing, type Drawing2D, type DrawingPath, type DrawingText } from './drawing2d';

/**
 * SXF（SFC 形式）の簡易リーダー。
 *
 * 電子納品で使われる SXF の SFC ファイルから、基本図形
 * （線分・折線・円・円弧・文字・多角形）を読み込む。
 * SFC の座標は用紙上の mm なので、縮尺（1/N）を掛けて実寸にする。
 * 複合図形の配置（部分図の縮尺など）は簡略化して扱う。
 */

const SXF_COLORS: Record<number, string> = {
  1: '#000000',
  2: '#ff0000',
  3: '#00ff00',
  4: '#0000ff',
  5: '#ffff00',
  6: '#ff00ff',
  7: '#00ffff',
  8: '#333333',
  9: '#c0c0c0',
  10: '#800000',
  11: '#008000',
  12: '#000080',
  13: '#808000',
  14: '#800080',
  15: '#008080',
  16: '#808080',
};

/** 関数呼び出し風の引数を分割する（引用符と括弧の中のカンマは区切らない） */
export function splitArgs(s: string): string[] {
  const out: string[] = [];
  let cur = '';
  let depth = 0;
  let quote = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quote) {
      if (ch === "'" && s[i + 1] === "'") {
        cur += "'";
        i++;
      } else if (ch === "'") quote = false;
      else cur += ch;
      continue;
    }
    if (ch === "'") quote = true;
    else if (ch === '(') {
      depth++;
      cur += ch;
    } else if (ch === ')') {
      depth--;
      cur += ch;
    } else if (ch === ',' && depth === 0) {
      out.push(cur.trim());
      cur = '';
    } else cur += ch;
  }
  if (cur.trim() || out.length) out.push(cur.trim());
  return out;
}

const num = (s: string | undefined) => parseFloat(s ?? '0');
const arr = (s: string | undefined) =>
  (s ?? '')
    .replace(/[()]/g, '')
    .split(',')
    .map((v) => parseFloat(v))
    .filter((v) => Number.isFinite(v));

export function parseSfc(text: string, scaleDenominator = 1): Drawing2D {
  // mm（用紙上）× 縮尺 → 実寸 mm
  const k = scaleDenominator;
  const layerNames: string[] = [];
  const layerColors = new Map<string, string>();
  const paths: DrawingPath[] = [];
  const texts: DrawingText[] = [];
  const warnings: string[] = [];
  const skipped = new Map<string, number>();

  // /*SXF ... SXF*/ の囲みを外し、行単位で「#n = 要素名(引数)」を集める（複数行にまたがる場合は連結）
  const body = text.replace(/\/\*SXF/g, '').replace(/SXF\*\//g, '\n');
  const lines = body.split(/\r?\n/);
  let buffer = '';
  const records: [string, string][] = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    buffer = buffer ? buffer + line : line;
    const m = /^#\d+\s*=\s*([a-z_0-9]+)\s*\(([\s\S]*)\)\s*;?$/i.exec(buffer);
    if (m) {
      records.push([m[1].toLowerCase(), m[2]]);
      buffer = '';
    } else if (!buffer.startsWith('#')) {
      buffer = '';
    }
  }

  const layerOf = (idx: string) => layerNames[parseInt(idx, 10) - 1] ?? `レイヤ${idx}`;
  const colorOf = (idx: string) => SXF_COLORS[parseInt(idx, 10)] ?? '#333333';

  for (const [name, argStr] of records) {
    const a = splitArgs(argStr);
    switch (name) {
      case 'layer_feature':
        layerNames.push(a[0] || `レイヤ${layerNames.length + 1}`);
        break;
      case 'line_feature': {
        const layer = layerOf(a[0]);
        layerColors.set(layer, layerColors.get(layer) ?? colorOf(a[1]));
        paths.push({
          layer,
          points: [
            [num(a[4]) * k, num(a[5]) * k],
            [num(a[6]) * k, num(a[7]) * k],
          ],
          closed: false,
        });
        break;
      }
      case 'polyline_feature': {
        const layer = layerOf(a[0]);
        layerColors.set(layer, layerColors.get(layer) ?? colorOf(a[1]));
        const xs = arr(a[5]);
        const ys = arr(a[6]);
        const pts: [number, number][] = xs.map((x, i) => [x * k, (ys[i] ?? 0) * k]);
        const closed =
          pts.length > 3 &&
          Math.hypot(pts[0][0] - pts[pts.length - 1][0], pts[0][1] - pts[pts.length - 1][1]) < 1e-6 * k;
        if (closed) pts.pop();
        paths.push({ layer, points: pts, closed });
        break;
      }
      case 'circle_feature': {
        const layer = layerOf(a[0]);
        layerColors.set(layer, layerColors.get(layer) ?? colorOf(a[1]));
        const pts = arcToPoints(num(a[4]) * k, num(a[5]) * k, num(a[6]) * k, 0, Math.PI * 2);
        pts.pop();
        paths.push({ layer, points: pts, closed: true });
        break;
      }
      case 'arc_feature': {
        const layer = layerOf(a[0]);
        layerColors.set(layer, layerColors.get(layer) ?? colorOf(a[1]));
        const dir = num(a[7]);
        let s = (num(a[8]) * Math.PI) / 180;
        let e = (num(a[9]) * Math.PI) / 180;
        if (dir === 0) [s, e] = [e, s]; // 0: 時計回り
        paths.push({ layer, points: arcToPoints(num(a[4]) * k, num(a[5]) * k, num(a[6]) * k, s, e), closed: false });
        break;
      }
      case 'polygon_feature': {
        const layer = layerOf(a[0]);
        const xs = arr(a[3]);
        const ys = arr(a[4]);
        paths.push({ layer, points: xs.map((x, i) => [x * k, (ys[i] ?? 0) * k]), closed: true });
        break;
      }
      case 'text_string_feature': {
        const layer = layerOf(a[0]);
        texts.push({ layer, text: a[3] ?? '', x: num(a[4]) * k, y: num(a[5]) * k, height: num(a[6]) * k });
        break;
      }
      case 'drawing_sheet_feature':
      case 'pre_defined_font_feature':
      case 'userdefined_font_feature':
      case 'pre_defined_colour_feature':
      case 'userdefined_colour_feature':
      case 'width_feature':
      case 'text_font_feature':
      case 'sfig_org_feature':
      case 'sfig_locate_feature':
      case 'composite_curve_org_feature':
        break;
      default:
        skipped.set(name, (skipped.get(name) ?? 0) + 1);
    }
  }

  if (!records.length) throw new Error('SFC の図形データが見つかりませんでした（P21 形式は DXF に変換して読み込んでください）');
  if (skipped.size) warnings.push(`未対応の要素をスキップ: ${[...skipped].map(([n, c]) => `${n}×${c}`).join(', ')}`);
  warnings.push('SXF は簡易対応です。複合図形の縮尺・配置は反映されない場合があります。');
  return finalizeDrawing(paths, texts, layerColors, 'SXF(SFC)', warnings, 'mm');
}
