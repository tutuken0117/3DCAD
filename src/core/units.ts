/**
 * 長さの入力・表示。既定の単位は mm（建設・土木の図面に合わせる）。
 * 入力例: "1500" → 1.5m, "1.5m" → 1.5m, "30cm" → 0.3m, "-200" → -0.2m
 */
export type DisplayUnit = 'mm' | 'm';

let displayUnit: DisplayUnit = 'mm';

export function setDisplayUnit(u: DisplayUnit): void {
  displayUnit = u;
}

export function getDisplayUnit(): DisplayUnit {
  return displayUnit;
}

const UNIT_TO_M: Record<string, number> = { mm: 0.001, cm: 0.01, m: 1, km: 1000 };

/** 長さの文字列 → m。解釈できなければ null */
export function parseLength(input: string, defaultUnit: DisplayUnit = displayUnit): number | null {
  const s = input.trim().replace(/，/g, ',').replace(/[０-９．－]/g, (c) =>
    c === '．' ? '.' : c === '－' ? '-' : String.fromCharCode(c.charCodeAt(0) - 0xfee0),
  );
  const m = /^([-+]?\d*\.?\d+(?:e[-+]?\d+)?)\s*(mm|cm|m|km)?$/i.exec(s);
  if (!m) return null;
  const v = parseFloat(m[1]);
  const unit = (m[2] ?? defaultUnit).toLowerCase();
  return v * UNIT_TO_M[unit];
}

/** "2000,3000" のようなカンマ区切りを複数の長さに */
export function parseLengths(input: string): number[] | null {
  const parts = input.replace(/，/g, ',').split(/[,;x×*]/);
  const out: number[] = [];
  for (const p of parts) {
    if (!p.trim()) continue;
    const v = parseLength(p);
    if (v === null) return null;
    out.push(v);
  }
  return out.length ? out : null;
}

/** m → 表示用の文字列 */
export function formatLength(m: number, unit: DisplayUnit = displayUnit): string {
  if (unit === 'mm') {
    const mm = m * 1000;
    const digits = Math.abs(mm) < 10 ? 1 : 0;
    return `${mm.toLocaleString('ja-JP', { maximumFractionDigits: digits, minimumFractionDigits: 0 })} mm`;
  }
  return `${m.toLocaleString('ja-JP', { maximumFractionDigits: 3, minimumFractionDigits: 3 })} m`;
}

export function formatArea(m2: number): string {
  return `${m2.toLocaleString('ja-JP', { maximumFractionDigits: 3 })} m²`;
}

/** 公共座標用（m, 小数 3 桁） */
export function formatCoord(v: number): string {
  return v.toLocaleString('ja-JP', { minimumFractionDigits: 3, maximumFractionDigits: 3, useGrouping: false });
}
