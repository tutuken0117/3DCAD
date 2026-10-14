import { Color } from 'three';
import type { FurnitureDef } from '../core/furniture';
import { getMaterial } from '../core/materials';

/**
 * 家具の小さな見本（斜め上から見た図を SVG で描く）。
 * 部品を箱として、奥から手前の順に上面・正面・右面を塗る。
 */
export function furnitureThumb(def: FurnitureDef, size = 64): string {
  const boxes = def.parts.map((p) => {
    if ('box' in p) return { a: p.box[0], b: p.box[1], mat: p.mat };
    const { x, y, r, z0, z1 } = p.cyl;
    return { a: [x - r, y - r, z0] as const, b: [x + r, y + r, z1] as const, mat: p.mat };
  });
  // 斜投影: 右へ x、奥へ y（右上がり）、上へ z
  const P = (x: number, y: number, z: number): [number, number] => [x * 0.87 + y * 0.5, -z - x * 0.3 + y * 0.35];
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const { a, b } of boxes)
    for (const x of [a[0], b[0]])
      for (const y of [a[1], b[1]])
        for (const z of [a[2], b[2]]) {
          const [u, v] = P(x, y, z);
          minX = Math.min(minX, u);
          maxX = Math.max(maxX, u);
          minY = Math.min(minY, v);
          maxY = Math.max(maxY, v);
        }
  const k = (size - 8) / Math.max(maxX - minX, maxY - minY, 0.01);
  const ox = (size - (maxX - minX) * k) / 2;
  const oy = (size - (maxY - minY) * k) / 2;
  const pt = (x: number, y: number, z: number) => {
    const [u, v] = P(x, y, z);
    return `${(ox + (u - minX) * k).toFixed(1)},${(oy + (v - minY) * k).toFixed(1)}`;
  };
  const shade = (hex: string, f: number) => `#${new Color(hex).multiplyScalar(f).getHexString()}`;
  // 奥（y 大）・下・左から描く
  const order = [...boxes].sort((p, q) => q.b[1] + q.a[1] - (p.b[1] + p.a[1]) || p.a[2] - q.a[2] || p.a[0] - q.a[0]);
  let svg = '';
  for (const { a, b, mat } of order) {
    const c = getMaterial(mat)?.color ?? '#999999';
    const [x0, y0, z0] = a;
    const [x1, y1, z1] = b;
    svg += `<polygon points="${pt(x0, y0, z0)} ${pt(x1, y0, z0)} ${pt(x1, y0, z1)} ${pt(x0, y0, z1)}" fill="${shade(c, 0.9)}"/>`;
    svg += `<polygon points="${pt(x1, y0, z0)} ${pt(x1, y1, z0)} ${pt(x1, y1, z1)} ${pt(x1, y0, z1)}" fill="${shade(c, 0.7)}"/>`;
    svg += `<polygon points="${pt(x0, y0, z1)} ${pt(x1, y0, z1)} ${pt(x1, y1, z1)} ${pt(x0, y1, z1)}" fill="${shade(c, 1.08)}"/>`;
  }
  return `<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" aria-hidden="true" stroke="rgba(0,0,0,.25)" stroke-width="0.4" stroke-linejoin="round">${svg}</svg>`;
}
