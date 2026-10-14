import { Vector3 } from 'three';
import type { Model } from './Model';
import { MAT_PREFIX } from './materials';

/**
 * 家具・設備の部品集（箱と円柱の組み合わせで手続き的に作る）。
 * 家具の座標: x = 幅（右）、y = 奥行き（奥 +）、z = 高さ。原点は足元の中心。正面は -y 側。
 * 置くときは「正面」がカメラ側（壁に寄せたときは部屋側）を向く。
 */

type V3 = [number, number, number];

export type FurniturePart =
  | { box: [V3, V3]; mat: string }
  | { cyl: { x: number; y: number; r: number; z0: number; z1: number; seg?: number }; mat: string };

export type FurnitureCategory = '事務所' | '住まい' | 'キッチン・水まわり' | '照明・設備' | '外構・点景';

export interface FurnitureDef {
  id: string;
  name: string;
  category: FurnitureCategory;
  /** 幅・奥行き・高さ (m) */
  size: V3;
  /** 置き方: 床 / 壁（背面を壁に付ける）/ 天井（上面を天井に付ける） */
  mount: 'floor' | 'wall' | 'ceiling';
  /** 壁付けのとき、床からの高さ（下端） */
  wallHeight?: number;
  parts: FurniturePart[];
}

const B = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, mat: string): FurniturePart => ({
  box: [
    [Math.min(x0, x1), Math.min(y0, y1), Math.min(z0, z1)],
    [Math.max(x0, x1), Math.max(y0, y1), Math.max(z0, z1)],
  ],
  mat,
});
const C = (x: number, y: number, r: number, z0: number, z1: number, mat: string, seg = 16): FurniturePart => ({ cyl: { x, y, r, z0, z1, seg }, mat });
const move = (parts: FurniturePart[], dx: number, dy: number, rot = 0): FurniturePart[] =>
  parts.map((p) => {
    const c = Math.round(Math.cos(rot));
    const s = Math.round(Math.sin(rot));
    const tr = (x: number, y: number): [number, number] => [x * c - y * s + dx, x * s + y * c + dy];
    if ('box' in p) {
      const [a, b] = p.box;
      const [x0, y0] = tr(a[0], a[1]);
      const [x1, y1] = tr(b[0], b[1]);
      return B(x0, y0, a[2], x1, y1, b[2], p.mat);
    }
    const [x, y] = tr(p.cyl.x, p.cyl.y);
    return { cyl: { ...p.cyl, x, y }, mat: p.mat };
  });

// ---- 部品のまとまり ----
const chair = (seat: string, frame = 'stainless'): FurniturePart[] => [
  B(-0.22, -0.22, 0.42, 0.22, 0.2, 0.47, seat),
  B(-0.22, 0.18, 0.47, 0.22, 0.22, 0.85, seat),
  ...[
    [-0.2, -0.2],
    [0.2, -0.2],
    [-0.2, 0.2],
    [0.2, 0.2],
  ].map(([x, y]) => B(x - 0.012, y - 0.012, 0, x + 0.012, y + 0.012, 0.42, frame)),
];
const officeChair: FurniturePart[] = [
  C(0, 0, 0.3, 0.03, 0.06, 'plastic-black', 5),
  C(0, 0, 0.03, 0.06, 0.42, 'stainless', 8),
  B(-0.24, -0.24, 0.42, 0.24, 0.22, 0.5, 'fabric-navy'),
  B(-0.22, 0.2, 0.56, 0.22, 0.26, 1.0, 'fabric-navy'),
  B(-0.26, -0.15, 0.6, -0.23, 0.15, 0.64, 'plastic-black'),
  B(0.23, -0.15, 0.6, 0.26, 0.15, 0.64, 'plastic-black'),
];
const legs = (w: number, d: number, h: number, t: number, mat: string): FurniturePart[] =>
  [
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1],
  ].map(([sx, sy]) => B(sx * (w / 2 - t) - t / 2, sy * (d / 2 - t) - t / 2, 0, sx * (w / 2 - t) + t / 2, sy * (d / 2 - t) + t / 2, h, mat));
const books = (x0: number, x1: number, y: number, z: number): FurniturePart[] => {
  const out: FurniturePart[] = [];
  const mats = ['fabric-navy', 'fabric-beige', 'wood-walnut', 'fabric-gray', 'steel-white'];
  let x = x0;
  let i = 0;
  while (x < x1 - 0.05) {
    const w = 0.03 + ((i * 37) % 5) * 0.008;
    const h = 0.22 + ((i * 53) % 4) * 0.025;
    out.push(B(x, y - 0.12, z, Math.min(x + w, x1), y + 0.1, z + h, mats[i % mats.length]));
    x += w + 0.004;
    i++;
    if (i % 9 === 0) x += 0.08;
  }
  return out;
};
const sofa = (w: number, mat: string): FurniturePart[] => {
  const h = w / 2;
  const seats = Math.max(1, Math.round((w - 0.3) / 0.6));
  const sw = (w - 0.36) / seats;
  return [
    B(-h, -0.42, 0.08, h, 0.42, 0.4, mat),
    B(-h, 0.2, 0.4, h, 0.42, 0.8, mat),
    B(-h, -0.42, 0.4, -h + 0.18, 0.2, 0.62, mat),
    B(h - 0.18, -0.42, 0.4, h, 0.2, 0.62, mat),
    ...Array.from({ length: seats }, (_, i) => B(-h + 0.18 + i * sw + 0.01, -0.4, 0.4, -h + 0.18 + (i + 1) * sw - 0.01, 0.18, 0.5, mat)),
    ...legs(w, 0.84, 0.08, 0.04, 'wood-walnut'),
  ];
};
const ceilingLight = (w: number, d: number): FurniturePart[] => [
  B(-w / 2, -d / 2, 0.012, w / 2, d / 2, 0.07, 'steel-white'),
  B(-w / 2 + 0.02, -d / 2 + 0.02, 0, w / 2 - 0.02, d / 2 - 0.02, 0.012, 'light'),
];

export const FURNITURE: FurnitureDef[] = [
  // ---------------- 事務所 ----------------
  {
    id: 'desk',
    name: '事務机（幅 1200）',
    category: '事務所',
    size: [1.2, 0.7, 0.72],
    mount: 'floor',
    parts: [
      B(-0.6, -0.35, 0.69, 0.6, 0.35, 0.72, 'wood-light'),
      B(-0.58, -0.32, 0, -0.55, 0.33, 0.69, 'steel-white'),
      B(0.18, -0.32, 0, 0.58, 0.33, 0.69, 'steel-white'),
      B(0.2, -0.325, 0.47, 0.56, -0.32, 0.67, 'steel-white'),
      B(0.2, -0.325, 0.25, 0.56, -0.32, 0.45, 'steel-white'),
      B(0.2, -0.325, 0.03, 0.56, -0.32, 0.23, 'steel-white'),
      B(-0.55, 0.31, 0.2, 0.18, 0.33, 0.69, 'steel-white'),
    ],
  },
  { id: 'office-chair', name: '事務椅子', category: '事務所', size: [0.6, 0.6, 1.0], mount: 'floor', parts: officeChair },
  {
    id: 'desk-set',
    name: '事務机＋椅子',
    category: '事務所',
    size: [1.2, 1.3, 1.0],
    mount: 'floor',
    parts: [
      ...move(
        [
          B(-0.6, -0.35, 0.69, 0.6, 0.35, 0.72, 'wood-light'),
          B(-0.58, -0.32, 0, -0.55, 0.33, 0.69, 'steel-white'),
          B(0.18, -0.32, 0, 0.58, 0.33, 0.69, 'steel-white'),
          B(-0.55, 0.31, 0.2, 0.18, 0.33, 0.69, 'steel-white'),
        ],
        0,
        0.3,
      ),
      ...move(officeChair, -0.15, -0.35, Math.PI),
    ],
  },
  {
    id: 'meeting-table',
    name: '会議テーブル（1800×900）',
    category: '事務所',
    size: [1.8, 0.9, 0.72],
    mount: 'floor',
    parts: [B(-0.9, -0.45, 0.69, 0.9, 0.45, 0.72, 'wood-light'), B(-0.75, -0.3, 0, -0.7, 0.3, 0.69, 'stainless'), B(0.7, -0.3, 0, 0.75, 0.3, 0.69, 'stainless'), B(-0.75, -0.03, 0.02, 0.75, 0.03, 0.06, 'stainless')],
  },
  { id: 'chair', name: '椅子（ミーティング）', category: '事務所', size: [0.45, 0.45, 0.85], mount: 'floor', parts: chair('fabric-navy') },
  {
    id: 'table-4',
    name: 'テーブル＋椅子 4 脚（休憩・打合せ）',
    category: '事務所',
    size: [1.2, 1.7, 0.85],
    mount: 'floor',
    parts: [
      B(-0.6, -0.375, 0.69, 0.6, 0.375, 0.72, 'wood-light'),
      ...legs(1.2, 0.75, 0.69, 0.04, 'stainless'),
      ...move(chair('fabric-gray'), -0.3, -0.62, Math.PI),
      ...move(chair('fabric-gray'), 0.3, -0.62, Math.PI),
      ...move(chair('fabric-gray'), -0.3, 0.62),
      ...move(chair('fabric-gray'), 0.3, 0.62),
    ],
  },
  { id: 'sofa-3', name: '応接ソファ（3 人掛け）', category: '事務所', size: [2.0, 0.85, 0.8], mount: 'floor', parts: sofa(2.0, 'leather-black') },
  { id: 'sofa-1', name: '応接ソファ（1 人掛け）', category: '事務所', size: [0.85, 0.85, 0.8], mount: 'floor', parts: sofa(0.85, 'leather-black') },
  {
    id: 'reception-set',
    name: '応接セット（3 人掛け＋1 人掛け×2＋テーブル）',
    category: '事務所',
    size: [2.4, 2.5, 0.8],
    mount: 'floor',
    parts: [
      ...move(sofa(2.0, 'leather-black'), 0, 0.78),
      ...move(sofa(0.85, 'leather-black'), -0.55, -0.85, Math.PI),
      ...move(sofa(0.85, 'leather-black'), 0.55, -0.85, Math.PI),
      B(-0.55, -0.3, 0.36, 0.55, 0.3, 0.4, 'wood-walnut'),
      ...legs(1.1, 0.6, 0.36, 0.04, 'wood-walnut'),
    ],
  },
  { id: 'low-table', name: 'ローテーブル', category: '事務所', size: [1.1, 0.6, 0.4], mount: 'floor', parts: [B(-0.55, -0.3, 0.36, 0.55, 0.3, 0.4, 'wood-walnut'), ...legs(1.1, 0.6, 0.36, 0.04, 'wood-walnut')] },
  {
    id: 'bookshelf',
    name: '書棚（スチール・幅 900）',
    category: '事務所',
    size: [0.9, 0.4, 1.8],
    mount: 'floor',
    parts: [
      B(-0.45, -0.2, 0, -0.43, 0.2, 1.8, 'steel-white'),
      B(0.43, -0.2, 0, 0.45, 0.2, 1.8, 'steel-white'),
      B(-0.43, 0.18, 0, 0.43, 0.2, 1.8, 'steel-white'),
      ...[0, 0.44, 0.88, 1.32, 1.78].map((z) => B(-0.43, -0.2, z, 0.43, 0.18, z + 0.02, 'steel-white')),
      ...books(-0.42, 0.42, 0.02, 0.02),
      ...books(-0.42, 0.3, 0.02, 0.46),
      ...books(-0.2, 0.42, 0.02, 0.9),
      ...books(-0.42, 0.1, 0.02, 1.34),
    ],
  },
  { id: 'safe', name: '金庫', category: '事務所', size: [0.5, 0.5, 0.8], mount: 'floor', parts: [B(-0.25, -0.25, 0, 0.25, 0.25, 0.8, 'steel-gray'), B(-0.21, -0.26, 0.06, 0.21, -0.25, 0.74, 'steel-black'), C(0.1, -0.27, 0.04, 0.45, 0.47, 'stainless')] },
  {
    id: 'locker',
    name: 'ロッカー（2 人用）',
    category: '事務所',
    size: [0.9, 0.515, 1.79],
    mount: 'floor',
    parts: [B(-0.45, -0.257, 0, 0.45, 0.257, 1.79, 'steel-white'), B(-0.003, -0.26, 0.02, 0.003, -0.257, 1.77, 'plastic-black'), B(-0.07, -0.27, 0.9, -0.04, -0.257, 1.05, 'stainless'), B(0.04, -0.27, 0.9, 0.07, -0.257, 1.05, 'stainless')],
  },
  {
    id: 'counter',
    name: '受付カウンター（幅 1800）',
    category: '事務所',
    size: [1.8, 0.6, 1.0],
    mount: 'floor',
    parts: [B(-0.9, -0.3, 0, 0.9, 0.3, 0.97, 'wood-light'), B(-0.92, -0.34, 0.97, 0.92, 0.3, 1.0, 'wood-walnut'), B(-0.9, -0.31, 0, 0.9, -0.3, 0.08, 'plastic-black')],
  },
  {
    id: 'shoe-box',
    name: '下足箱',
    category: '事務所',
    size: [0.9, 0.35, 1.0],
    mount: 'floor',
    parts: [B(-0.45, -0.175, 0.08, 0.45, 0.175, 1.0, 'wood-light'), B(-0.003, -0.18, 0.1, 0.003, -0.175, 0.98, 'wood-walnut'), B(-0.43, -0.16, 0, 0.43, 0.16, 0.08, 'plastic-black')],
  },
  {
    id: 'whiteboard',
    name: 'ホワイトボード（脚付き）',
    category: '事務所',
    size: [1.8, 0.55, 1.8],
    mount: 'floor',
    parts: [B(-0.9, -0.02, 0.75, 0.9, 0.02, 1.8, 'steel-white'), B(-0.88, -0.03, 0.78, 0.88, -0.02, 1.77, 'ceramic'), B(-0.85, -0.25, 0, -0.81, 0.25, 0.75, 'stainless'), B(0.81, -0.25, 0, 0.85, 0.25, 0.75, 'stainless')],
  },
  {
    id: 'plant',
    name: '観葉植物',
    category: '事務所',
    size: [0.6, 0.6, 1.4],
    mount: 'floor',
    parts: [C(0, 0, 0.18, 0, 0.35, 'plastic-black', 12), C(0, 0, 0.02, 0.35, 0.6, 'wood-walnut', 6), C(0, 0, 0.26, 0.55, 0.9, 'foliage', 9), C(0, 0, 0.3, 0.85, 1.2, 'foliage', 9), C(0, 0, 0.2, 1.15, 1.4, 'foliage', 9)],
  },
  // ---------------- 住まい ----------------
  {
    id: 'bed-single',
    name: 'ベッド（シングル）',
    category: '住まい',
    size: [1.0, 2.05, 0.75],
    mount: 'floor',
    parts: [B(-0.5, -1.0, 0.1, 0.5, 1.0, 0.3, 'wood-light'), B(-0.48, -0.98, 0.3, 0.48, 0.98, 0.5, 'fabric-white'), B(-0.5, 1.0, 0, 0.5, 1.05, 0.75, 'wood-light'), B(-0.35, 0.65, 0.5, 0.35, 0.92, 0.6, 'fabric-white'), B(-0.49, -0.98, 0.5, 0.49, 0.45, 0.53, 'fabric-beige')],
  },
  {
    id: 'bed-double',
    name: 'ベッド（ダブル）',
    category: '住まい',
    size: [1.4, 2.05, 0.75],
    mount: 'floor',
    parts: [B(-0.7, -1.0, 0.1, 0.7, 1.0, 0.3, 'wood-walnut'), B(-0.68, -0.98, 0.3, 0.68, 0.98, 0.5, 'fabric-white'), B(-0.7, 1.0, 0, 0.7, 1.05, 0.8, 'wood-walnut'), B(-0.6, 0.65, 0.5, -0.08, 0.92, 0.6, 'fabric-white'), B(0.08, 0.65, 0.5, 0.6, 0.92, 0.6, 'fabric-white'), B(-0.69, -0.98, 0.5, 0.69, 0.45, 0.53, 'fabric-gray')],
  },
  {
    id: 'dining-set',
    name: 'ダイニングセット（4 人）',
    category: '住まい',
    size: [1.35, 1.8, 0.85],
    mount: 'floor',
    parts: [
      B(-0.675, -0.4, 0.69, 0.675, 0.4, 0.72, 'wood-walnut'),
      ...legs(1.35, 0.8, 0.69, 0.05, 'wood-walnut'),
      ...move(chair('fabric-beige', 'wood-walnut'), -0.32, -0.65, Math.PI),
      ...move(chair('fabric-beige', 'wood-walnut'), 0.32, -0.65, Math.PI),
      ...move(chair('fabric-beige', 'wood-walnut'), -0.32, 0.65),
      ...move(chair('fabric-beige', 'wood-walnut'), 0.32, 0.65),
    ],
  },
  { id: 'sofa-living', name: 'ソファ（リビング・3 人掛け）', category: '住まい', size: [2.0, 0.85, 0.8], mount: 'floor', parts: sofa(2.0, 'fabric-gray') },
  {
    id: 'tv-board',
    name: 'テレビボード＋テレビ',
    category: '住まい',
    size: [1.6, 0.45, 1.15],
    mount: 'floor',
    parts: [B(-0.8, -0.22, 0.05, 0.8, 0.22, 0.4, 'wood-walnut'), B(-0.78, -0.2, 0, 0.78, 0.2, 0.05, 'plastic-black'), B(-0.12, -0.05, 0.4, 0.12, 0.05, 0.43, 'plastic-black'), B(-0.02, 0, 0.43, 0.02, 0.03, 0.5, 'plastic-black'), B(-0.62, -0.02, 0.48, 0.62, 0.02, 1.15, 'plastic-black'), B(-0.6, -0.025, 0.5, 0.6, -0.02, 1.13, 'screen')],
  },
  // ---------------- キッチン・水まわり ----------------
  {
    id: 'mini-kitchen',
    name: 'ミニキッチン（幅 1200・IH）',
    category: 'キッチン・水まわり',
    size: [1.2, 0.6, 1.15],
    mount: 'floor',
    parts: [
      B(-0.6, -0.3, 0.1, 0.6, 0.3, 0.87, 'steel-white'),
      B(-0.58, -0.28, 0, 0.58, 0.28, 0.1, 'plastic-black'),
      B(-0.6, -0.3, 0.87, 0.6, 0.3, 0.9, 'stainless'),
      B(-0.5, -0.2, 0.895, -0.05, 0.15, 0.902, 'steel-gray'),
      C(-0.15, 0.22, 0.02, 0.9, 1.15, 'stainless', 8),
      B(-0.16, 0.05, 1.12, -0.14, 0.22, 1.14, 'stainless'),
      C(0.18, -0.02, 0.1, 0.9, 0.905, 'plastic-black', 16),
      C(0.42, -0.02, 0.1, 0.9, 0.905, 'plastic-black', 16),
      B(-0.003, -0.305, 0.12, 0.003, -0.3, 0.84, 'steel-gray'),
    ],
  },
  {
    id: 'kitchen-i',
    name: 'システムキッチン（I 型 2550）',
    category: 'キッチン・水まわり',
    size: [2.55, 0.65, 1.12],
    mount: 'floor',
    parts: [
      B(-1.275, -0.3, 0.1, 1.275, 0.325, 0.82, 'wood-light'),
      B(-1.265, -0.28, 0, 1.265, 0.32, 0.1, 'plastic-black'),
      B(-1.275, -0.325, 0.82, 1.275, 0.325, 0.85, 'ceramic'),
      B(-0.7, -0.2, 0.845, -0.1, 0.18, 0.852, 'stainless'),
      C(-0.4, 0.25, 0.02, 0.85, 1.12, 'stainless', 8),
      C(0.55, 0, 0.11, 0.85, 0.856, 'plastic-black'),
      C(0.85, 0, 0.11, 0.85, 0.856, 'plastic-black'),
    ],
  },
  { id: 'fridge', name: '冷蔵庫', category: 'キッチン・水まわり', size: [0.6, 0.65, 1.5], mount: 'floor', parts: [B(-0.3, -0.325, 0, 0.3, 0.325, 1.5, 'steel-white'), B(-0.3, -0.33, 0.95, 0.3, -0.325, 0.96, 'steel-gray'), B(0.22, -0.35, 1.0, 0.24, -0.33, 1.3, 'stainless'), B(0.22, -0.35, 0.6, 0.24, -0.33, 0.9, 'stainless')] },
  { id: 'water-heater', name: '電気温水器（小型・壁付け）', category: 'キッチン・水まわり', size: [0.38, 0.26, 0.6], mount: 'wall', wallHeight: 1.25, parts: [B(-0.19, -0.13, 0, 0.19, 0.13, 0.48, 'steel-white'), C(0.1, -0.05, 0.012, -0.12, 0, 'stainless', 6)] },
  {
    id: 'toilet',
    name: '洋式便器',
    category: 'キッチン・水まわり',
    size: [0.4, 0.75, 0.8],
    mount: 'floor',
    parts: [C(0, -0.1, 0.14, 0, 0.36, 'ceramic', 14), C(0, -0.12, 0.19, 0.36, 0.4, 'ceramic', 16), B(-0.2, 0.2, 0.35, 0.2, 0.375, 0.8, 'ceramic'), B(-0.12, 0.05, 0, 0.12, 0.25, 0.36, 'ceramic')],
  },
  { id: 'wash-basin', name: '手洗い器（壁付け）', category: 'キッチン・水まわり', size: [0.45, 0.3, 0.32], mount: 'wall', wallHeight: 0.6, parts: [B(-0.225, -0.15, 0, 0.225, 0.15, 0.2, 'ceramic'), C(0, 0.1, 0.015, 0.2, 0.32, 'stainless', 6)] },
  // ---------------- 照明・設備 ----------------
  { id: 'base-light-2', name: 'ベースライト（40W×2 相当・幅 1250）', category: '照明・設備', size: [1.25, 0.23, 0.07], mount: 'ceiling', parts: ceilingLight(1.25, 0.23) },
  { id: 'base-light-1', name: 'ベースライト（逆富士・40W 相当）', category: '照明・設備', size: [1.25, 0.15, 0.07], mount: 'ceiling', parts: ceilingLight(1.25, 0.15) },
  { id: 'downlight', name: 'ダウンライト', category: '照明・設備', size: [0.15, 0.15, 0.03], mount: 'ceiling', parts: [C(0, 0, 0.075, 0.008, 0.03, 'steel-white', 16), C(0, 0, 0.06, 0, 0.008, 'light', 16)] },
  { id: 'high-bay', name: '高天井用 LED（吊り下げ）', category: '照明・設備', size: [0.6, 0.36, 0.7], mount: 'ceiling', parts: [B(-0.3, -0.18, 0.02, 0.3, 0.18, 0.13, 'stainless'), B(-0.28, -0.16, 0, 0.28, 0.16, 0.02, 'light'), B(-0.01, -0.01, 0.13, 0.01, 0.01, 0.7, 'stainless')] },
  { id: 'bracket', name: 'ブラケットライト（防雨）', category: '照明・設備', size: [0.12, 0.12, 0.33], mount: 'wall', wallHeight: 2.0, parts: [B(-0.06, -0.02, 0, 0.06, 0.06, 0.33, 'steel-white'), B(-0.05, -0.06, 0.03, 0.05, -0.02, 0.3, 'light')] },
  { id: 'cassette-ac', name: '天井カセットエアコン', category: '照明・設備', size: [0.95, 0.95, 0.04], mount: 'ceiling', parts: [B(-0.475, -0.475, 0.01, 0.475, 0.475, 0.04, 'steel-white'), B(-0.2, -0.2, 0, 0.2, 0.2, 0.01, 'steel-gray'), ...[-0.4, 0.33].map((y) => B(-0.35, y, 0, 0.35, y + 0.07, 0.012, 'plastic-black'))] },
  { id: 'wall-ac', name: '壁掛けエアコン', category: '照明・設備', size: [0.8, 0.25, 0.3], mount: 'wall', wallHeight: 2.0, parts: [B(-0.4, -0.125, 0, 0.4, 0.125, 0.3, 'steel-white'), B(-0.38, -0.13, 0.02, 0.38, -0.125, 0.06, 'steel-gray')] },
  { id: 'outdoor-ac', name: 'エアコン室外機', category: '照明・設備', size: [0.9, 0.35, 0.7], mount: 'floor', parts: [B(-0.45, -0.15, 0.05, 0.45, 0.17, 0.7, 'steel-white'), B(-0.38, -0.16, 0.14, 0.12, -0.15, 0.62, 'plastic-black'), B(-0.4, -0.12, 0, -0.32, 0.14, 0.05, 'plastic-black'), B(0.32, -0.12, 0, 0.4, 0.14, 0.05, 'plastic-black')] },
  { id: 'blind', name: 'ブラインド（幅 1600）', category: '照明・設備', size: [1.6, 0.05, 1.2], mount: 'wall', wallHeight: 0.9, parts: [B(-0.8, -0.025, 1.12, 0.8, 0.025, 1.2, 'steel-white'), B(-0.79, -0.015, 0, 0.79, 0.015, 1.12, 'blind')] },
  // ---------------- 外構・点景 ----------------
  {
    id: 'car',
    name: '乗用車',
    category: '外構・点景',
    size: [1.75, 4.5, 1.5],
    mount: 'floor',
    parts: [
      B(-0.86, -2.25, 0.3, 0.86, 2.25, 0.85, 'car-white'),
      B(-0.78, -1.0, 0.85, 0.78, 1.5, 1.45, 'glass-mirror'),
      B(-0.76, -0.9, 1.44, 0.76, 1.4, 1.48, 'car-white'),
      ...[
        [-0.78, -1.4],
        [0.78, -1.4],
        [-0.78, 1.45],
        [0.78, 1.45],
      ].map(([x, y]) => B(x - 0.11, y - 0.33, 0, x + 0.11, y + 0.33, 0.62, 'tire')),
      B(-0.7, -2.26, 0.6, -0.45, -2.25, 0.72, 'light'),
      B(0.45, -2.26, 0.6, 0.7, -2.25, 0.72, 'light'),
    ],
  },
  {
    id: 'tree',
    name: '樹木（高さ 4m）',
    category: '外構・点景',
    size: [2.2, 2.2, 4.0],
    mount: 'floor',
    parts: [C(0, 0, 0.12, 0, 1.8, 'wood-walnut', 8), C(0, 0, 0.85, 1.4, 2.3, 'foliage', 10), C(0, 0, 1.1, 2.1, 3.2, 'foliage', 10), C(0, 0, 0.7, 3.0, 4.0, 'foliage', 10)],
  },
  { id: 'bulk-bag', name: 'フレコンバッグ（1m 角）', category: '外構・点景', size: [0.95, 0.95, 1.0], mount: 'floor', parts: [B(-0.47, -0.47, 0, 0.47, 0.47, 0.9, 'fabric-white'), B(-0.4, -0.4, 0.9, 0.4, 0.4, 0.97, 'fabric-white'), B(-0.04, -0.48, 0.6, 0.04, -0.47, 1.0, 'fabric-navy'), B(-0.04, 0.47, 0.6, 0.04, 0.48, 1.0, 'fabric-navy')] },
  { id: 'pallet', name: 'パレット', category: '外構・点景', size: [1.1, 1.1, 0.15], mount: 'floor', parts: [...[-0.5, 0, 0.5].map((x) => B(x - 0.05, -0.55, 0, x + 0.05, 0.55, 0.1, 'wood-light')), ...[-0.45, -0.22, 0, 0.22, 0.45].map((y) => B(-0.55, y - 0.05, 0.1, 0.55, y + 0.05, 0.15, 'wood-light'))] },
  { id: 'shrub', name: '低木（植え込み）', category: '外構・点景', size: [0.9, 0.9, 0.8], mount: 'floor', parts: [C(0, 0, 0.45, 0, 0.6, 'foliage', 10), C(0, 0, 0.32, 0.6, 0.8, 'foliage', 10)] },
  {
    id: 'person',
    name: '人（立ち姿・大きさの目安）',
    category: '外構・点景',
    size: [0.5, 0.3, 1.7],
    mount: 'floor',
    parts: [
      B(-0.15, -0.09, 0, -0.03, 0.09, 0.85, 'fabric-navy'),
      B(0.03, -0.09, 0, 0.15, 0.09, 0.85, 'fabric-navy'),
      B(-0.19, -0.11, 0.85, 0.19, 0.11, 1.42, 'fabric-gray'),
      B(-0.25, -0.06, 0.9, -0.19, 0.06, 1.4, 'fabric-gray'),
      B(0.19, -0.06, 0.9, 0.25, 0.06, 1.4, 'fabric-gray'),
      C(0, 0, 0.05, 1.42, 1.48, 'skin', 8),
      C(0, 0, 0.1, 1.48, 1.7, 'skin', 12),
    ],
  },
];

export const FURNITURE_CATEGORIES: FurnitureCategory[] = ['事務所', '住まい', 'キッチン・水まわり', '照明・設備', '外構・点景'];

export function getFurniture(id: string): FurnitureDef | undefined {
  return FURNITURE.find((f) => f.id === id);
}

/**
 * 家具の面（家具の座標、回転 rot・平行移動 pos をかけたローカル座標）。
 * pos は足元（天井付けは上面、壁付けは背面の下端）の位置。
 */
export function furnitureMesh(def: FurnitureDef, pos: Vector3, rot: number) {
  const points: Vector3[] = [];
  const faces: { outer: number[]; holes: number[][]; color: string }[] = [];
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  // 天井付けは上面を、壁付けは背面を基準にする
  const zOff = def.mount === 'ceiling' ? -def.size[2] : 0;
  const yOff = def.mount === 'wall' ? -def.size[1] / 2 : 0;
  // 家具の (x, y, z) → ローカル (東, 上, -北)
  const P = (x: number, y: number, z: number) => {
    const yy = y + yOff;
    const ex = x * c - yy * s;
    const ny = x * s + yy * c;
    return new Vector3(pos.x + ex, pos.y + z + zOff, pos.z - ny);
  };
  const quad = (ids: number[], mat: string) => faces.push({ outer: ids, holes: [], color: MAT_PREFIX + mat });
  for (const part of def.parts) {
    const base = points.length;
    if ('box' in part) {
      const [[x0, y0, z0], [x1, y1, z1]] = part.box;
      for (const z of [z0, z1]) points.push(P(x0, y0, z), P(x1, y0, z), P(x1, y1, z), P(x0, y1, z));
      const f = (a: number[]) => quad(a.map((i) => base + i), part.mat);
      f([0, 3, 2, 1]);
      f([4, 5, 6, 7]);
      f([0, 1, 5, 4]);
      f([1, 2, 6, 5]);
      f([2, 3, 7, 6]);
      f([3, 0, 4, 7]);
    } else {
      const { x, y, r, z0, z1, seg = 16 } = part.cyl;
      for (const z of [z0, z1])
        for (let i = 0; i < seg; i++) {
          const a = (i / seg) * Math.PI * 2;
          points.push(P(x + Math.cos(a) * r, y + Math.sin(a) * r, z));
        }
      quad(Array.from({ length: seg }, (_, i) => base + seg - 1 - i), part.mat);
      quad(Array.from({ length: seg }, (_, i) => base + seg + i), part.mat);
      for (let i = 0; i < seg; i++) {
        const j = (i + 1) % seg;
        quad([base + i, base + j, base + seg + j, base + seg + i], part.mat);
      }
    }
  }
  return { points, faces };
}

/** 家具をグループとしてモデルに置く。返り値はグループ ID */
export function placeFurniture(model: Model, def: FurnitureDef, pos: Vector3, rot: number, layer = '家具'): number | undefined {
  model.ensureLayer(layer);
  const { points, faces } = furnitureMesh(def, pos, rot);
  return model.addPolyFacesAsGroup(points, faces, def.name, layer);
}
