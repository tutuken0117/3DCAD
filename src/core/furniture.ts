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

export type FurnitureCategory = '事務所' | '住まい' | 'キッチン・水まわり' | '店舗・公共' | '照明・設備' | '外構・点景';

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
  // ================= 追加分 =================
  // ---- 事務所 ----
  {
    id: 'l-desk',
    name: 'L 字デスク',
    category: '事務所',
    size: [1.6, 1.4, 0.72],
    mount: 'floor',
    parts: [
      B(-0.8, -0.05, 0.69, 0.8, 0.7, 0.72, 'wood-light'),
      B(0.2, -0.7, 0.69, 0.8, -0.05, 0.72, 'wood-light'),
      B(-0.78, 0.0, 0, -0.75, 0.68, 0.69, 'steel-white'),
      B(0.75, -0.68, 0, 0.78, 0.68, 0.69, 'steel-white'),
      B(-0.75, 0.66, 0.2, 0.75, 0.68, 0.69, 'steel-white'),
    ],
  },
  {
    id: 'free-desk',
    name: 'フリーアドレスデスク（4 人）',
    category: '事務所',
    size: [2.4, 2.4, 1.0],
    mount: 'floor',
    parts: [
      B(-1.2, -0.6, 0.69, 1.2, 0.6, 0.72, 'plastic-white'),
      ...legs(2.4, 1.2, 0.69, 0.05, 'stainless'),
      B(-1.2, -0.01, 0.72, 1.2, 0.01, 1.05, 'fabric-gray'),
      ...move(officeChair, -0.6, -0.95, Math.PI).map((p) => p),
      ...move(officeChair, 0.6, -0.95, Math.PI),
      ...move(officeChair, -0.6, 0.95),
      ...move(officeChair, 0.6, 0.95),
    ],
  },
  { id: 'partition', name: 'ローパーティション（幅 1200）', category: '事務所', size: [1.2, 0.45, 1.2], mount: 'floor', parts: [B(-0.6, -0.025, 0.04, 0.6, 0.025, 1.2, 'fabric-gray'), B(-0.6, -0.2, 0, -0.55, 0.2, 0.04, 'stainless'), B(0.55, -0.2, 0, 0.6, 0.2, 0.04, 'stainless')] },
  {
    id: 'copier',
    name: '複合機（コピー機）',
    category: '事務所',
    size: [0.6, 0.7, 1.2],
    mount: 'floor',
    parts: [B(-0.3, -0.35, 0.05, 0.3, 0.35, 0.95, 'plastic-white'), B(-0.27, -0.3, 0, 0.27, 0.3, 0.05, 'plastic-black'), B(-0.25, -0.3, 0.95, 0.25, 0.3, 1.15, 'plastic-white'), B(-0.2, -0.36, 0.98, 0.05, -0.3, 1.12, 'screen'), B(-0.29, -0.355, 0.3, 0.29, -0.35, 0.32, 'steel-gray'), B(-0.29, -0.355, 0.55, 0.29, -0.35, 0.57, 'steel-gray')],
  },
  { id: 'umbrella-stand', name: '傘立て', category: '事務所', size: [0.45, 0.25, 0.55], mount: 'floor', parts: [B(-0.225, -0.125, 0, 0.225, 0.125, 0.03, 'stainless'), B(-0.225, -0.125, 0.5, 0.225, 0.125, 0.53, 'stainless'), ...legs(0.45, 0.25, 0.53, 0.02, 'stainless')] },
  {
    id: 'trash-3',
    name: 'ゴミ箱（分別 3 つ）',
    category: '事務所',
    size: [0.95, 0.35, 0.75],
    mount: 'floor',
    parts: [-0.32, 0, 0.32].flatMap((x, i) => [B(x - 0.15, -0.17, 0, x + 0.15, 0.17, 0.7, 'plastic-white'), B(x - 0.15, -0.17, 0.7, x + 0.15, 0.17, 0.75, ['paint-green', 'paint-yellow', 'paint-red'][i])]),
  },
  { id: 'water-server', name: 'ウォーターサーバー', category: '事務所', size: [0.3, 0.35, 1.3], mount: 'floor', parts: [B(-0.15, -0.17, 0, 0.15, 0.17, 0.95, 'plastic-white'), C(0, 0, 0.13, 0.95, 1.3, 'glass', 12), B(-0.1, -0.18, 0.5, 0.1, -0.17, 0.75, 'plastic-black')] },
  { id: 'bulletin', name: '掲示板（壁掛け）', category: '事務所', size: [1.2, 0.03, 0.9], mount: 'wall', wallHeight: 1.0, parts: [B(-0.6, -0.015, 0, 0.6, 0.015, 0.9, 'wood-light'), B(-0.57, -0.02, 0.03, 0.57, -0.015, 0.87, 'fabric-green')] },
  {
    id: 'pipe-chair',
    name: 'パイプ椅子',
    category: '事務所',
    size: [0.45, 0.5, 0.8],
    mount: 'floor',
    parts: [B(-0.2, -0.22, 0.42, 0.2, 0.18, 0.45, 'fabric-navy'), B(-0.19, 0.17, 0.55, 0.19, 0.2, 0.78, 'fabric-navy'), ...legs(0.42, 0.48, 0.42, 0.02, 'stainless'), B(-0.2, 0.2, 0.42, -0.18, 0.22, 0.8, 'stainless'), B(0.18, 0.2, 0.42, 0.2, 0.22, 0.8, 'stainless')],
  },
  { id: 'long-desk', name: '会議用長机（1800×450）', category: '事務所', size: [1.8, 0.45, 0.7], mount: 'floor', parts: [B(-0.9, -0.225, 0.67, 0.9, 0.225, 0.7, 'wood-light'), B(-0.85, -0.2, 0, -0.82, 0.2, 0.67, 'stainless'), B(0.82, -0.2, 0, 0.85, 0.2, 0.67, 'stainless'), B(-0.85, 0.2, 0.4, 0.85, 0.22, 0.67, 'wood-light')] },
  { id: 'lectern', name: '演台', category: '事務所', size: [0.9, 0.55, 1.05], mount: 'floor', parts: [B(-0.45, -0.25, 0, 0.45, 0.25, 0.95, 'wood-walnut'), B(-0.45, -0.3, 0.95, 0.45, 0.25, 1.05, 'wood-walnut'), C(0.2, -0.15, 0.01, 1.05, 1.4, 'plastic-black', 6)] },
  { id: 'coat-hanger', name: 'コートハンガー', category: '事務所', size: [0.5, 0.5, 1.75], mount: 'floor', parts: [C(0, 0, 0.25, 0, 0.03, 'steel-black', 12), C(0, 0, 0.02, 0.03, 1.75, 'steel-black', 8), B(-0.2, -0.01, 1.6, 0.2, 0.01, 1.62, 'steel-black'), B(-0.01, -0.2, 1.6, 0.01, 0.2, 1.62, 'steel-black')] },
  // ---- 住まい ----
  { id: 'sofa-2', name: 'ソファ（2 人掛け）', category: '住まい', size: [1.5, 0.85, 0.8], mount: 'floor', parts: sofa(1.5, 'fabric-beige') },
  { id: 'floor-table', name: '座卓', category: '住まい', size: [1.2, 0.75, 0.35], mount: 'floor', parts: [B(-0.6, -0.375, 0.31, 0.6, 0.375, 0.35, 'wood-walnut'), ...legs(1.2, 0.75, 0.31, 0.06, 'wood-walnut')] },
  {
    id: 'washitsu-6',
    name: '和室（畳 6 枚）',
    category: '住まい',
    size: [3.64, 2.73, 0.06],
    mount: 'floor',
    parts: [
      ...[
        [-1.365, -0.91, 0.91, 1.82],
        [-1.365, 0.91, 0.91, 1.82],
        [-0.455, -0.455, 1.82, 0.91],
        [-0.455, 0.455, 1.82, 0.91],
        [1.365, -0.91, 0.91, 1.82],
        [1.365, 0.91, 0.91, 1.82],
      ].map(([x, y, w, d]) => B(x - w / 2 + 0.003, y - d / 2 + 0.003, 0, x + w / 2 - 0.003, y + d / 2 - 0.003, 0.055, 'tatami')),
      B(-1.82, -1.365, 0, 1.82, 1.365, 0.05, 'fabric-green'),
    ],
  },
  {
    id: 'wardrobe',
    name: '洋服タンス',
    category: '住まい',
    size: [1.2, 0.6, 1.8],
    mount: 'floor',
    parts: [B(-0.6, -0.3, 0.05, 0.6, 0.3, 1.8, 'wood-light'), B(-0.58, -0.28, 0, 0.58, 0.28, 0.05, 'wood-walnut'), B(-0.003, -0.305, 0.07, 0.003, -0.3, 1.78, 'wood-walnut'), B(-0.06, -0.32, 0.9, -0.04, -0.3, 1.2, 'stainless'), B(0.04, -0.32, 0.9, 0.06, -0.3, 1.2, 'stainless')],
  },
  {
    id: 'chest',
    name: 'チェスト（4 段）',
    category: '住まい',
    size: [0.8, 0.45, 0.9],
    mount: 'floor',
    parts: [B(-0.4, -0.225, 0.05, 0.4, 0.225, 0.9, 'wood-light'), ...[0.08, 0.28, 0.48, 0.68].map((z) => B(-0.38, -0.23, z, 0.38, -0.225, z + 0.18, 'wood-walnut')), ...legs(0.78, 0.43, 0.05, 0.04, 'wood-walnut')],
  },
  {
    id: 'study-desk',
    name: '学習机＋椅子',
    category: '住まい',
    size: [1.0, 1.2, 1.1],
    mount: 'floor',
    parts: [
      ...move([B(-0.5, -0.3, 0.7, 0.5, 0.3, 0.73, 'wood-light'), B(-0.48, -0.28, 0, -0.45, 0.3, 0.7, 'wood-light'), B(0.15, -0.28, 0, 0.48, 0.3, 0.7, 'wood-light'), B(-0.5, 0.25, 0.73, 0.5, 0.3, 1.1, 'wood-light'), B(-0.48, 0.0, 0.95, 0.48, 0.25, 0.97, 'wood-light')], 0, 0.3),
      ...move(chair('fabric-red', 'stainless'), -0.1, -0.35, Math.PI),
    ],
  },
  { id: 'dresser', name: 'ドレッサー', category: '住まい', size: [0.8, 0.4, 1.5], mount: 'floor', parts: [B(-0.4, -0.2, 0.0, 0.4, 0.2, 0.72, 'wood-light'), B(-0.3, 0.15, 0.72, 0.3, 0.2, 1.5, 'wood-light'), B(-0.26, 0.145, 0.78, 0.26, 0.15, 1.45, 'mirror')] },
  {
    id: 'bookcase-wood',
    name: '本棚（木・幅 900）',
    category: '住まい',
    size: [0.9, 0.3, 1.8],
    mount: 'floor',
    parts: [
      B(-0.45, -0.15, 0, -0.43, 0.15, 1.8, 'wood-walnut'),
      B(0.43, -0.15, 0, 0.45, 0.15, 1.8, 'wood-walnut'),
      B(-0.43, 0.13, 0, 0.43, 0.15, 1.8, 'wood-walnut'),
      ...[0, 0.36, 0.72, 1.08, 1.44, 1.78].map((z) => B(-0.43, -0.15, z, 0.43, 0.13, z + 0.02, 'wood-walnut')),
      ...books(-0.42, 0.42, 0.0, 0.02),
      ...books(-0.42, 0.25, 0.0, 0.38),
      ...books(-0.1, 0.42, 0.0, 0.74),
      ...books(-0.42, 0.42, 0.0, 1.1),
    ],
  },
  { id: 'rug', name: 'ラグ（2000×1400）', category: '住まい', size: [2.0, 1.4, 0.012], mount: 'floor', parts: [B(-1.0, -0.7, 0, 1.0, 0.7, 0.012, 'fabric-beige')] },
  { id: 'floor-lamp', name: 'フロアスタンド', category: '住まい', size: [0.4, 0.4, 1.6], mount: 'floor', parts: [C(0, 0, 0.15, 0, 0.03, 'steel-black', 12), C(0, 0, 0.012, 0.03, 1.3, 'steel-black', 6), C(0, 0, 0.2, 1.3, 1.6, 'light', 14)] },
  { id: 'curtain', name: 'カーテン（窓幅 1800）', category: '住まい', size: [1.9, 0.12, 2.2], mount: 'wall', wallHeight: 0.05, parts: [B(-0.95, -0.03, 2.12, 0.95, 0.03, 2.2, 'steel-white'), ...Array.from({ length: 12 }, (_, i) => B(-0.95 + i * 0.158, -0.11 + (i % 2) * 0.04, 0, -0.95 + (i + 1) * 0.158, -0.05 + (i % 2) * 0.04, 2.12, 'fabric-beige'))] },
  { id: 'piano', name: 'アップライトピアノ', category: '住まい', size: [1.5, 0.75, 1.25], mount: 'floor', parts: [B(-0.75, -0.0, 0.0, 0.75, 0.3, 1.25, 'screen'), B(-0.72, -0.3, 0.65, 0.72, 0.0, 0.8, 'screen'), B(-0.7, -0.3, 0.72, 0.7, -0.1, 0.74, 'ceramic'), B(-0.75, -0.3, 0, -0.68, 0, 0.65, 'screen'), B(0.68, -0.3, 0, 0.75, 0, 0.65, 'screen'), B(-0.35, -0.75, 0, 0.35, -0.45, 0.48, 'screen')] },
  // ---- キッチン・水まわり ----
  { id: 'vanity', name: '洗面化粧台（幅 750）', category: 'キッチン・水まわり', size: [0.75, 0.55, 1.85], mount: 'floor', parts: [B(-0.375, -0.25, 0.05, 0.375, 0.3, 0.8, 'plastic-white'), B(-0.375, -0.275, 0.8, 0.375, 0.3, 0.85, 'ceramic'), B(-0.25, -0.18, 0.84, 0.25, 0.15, 0.852, 'stainless'), B(-0.375, 0.17, 0.85, 0.375, 0.3, 1.85, 'plastic-white'), B(-0.33, 0.165, 0.95, 0.33, 0.17, 1.75, 'mirror'), B(-0.003, -0.255, 0.07, 0.003, -0.25, 0.78, 'steel-gray')] },
  { id: 'bathtub', name: 'ユニットバス（1616）', category: 'キッチン・水まわり', size: [1.6, 1.6, 2.1], mount: 'floor', parts: [B(-0.8, 0.0, 0, 0.8, 0.8, 0.55, 'plastic-white'), B(-0.75, 0.05, 0.15, 0.75, 0.75, 0.56, 'ceramic'), B(-0.8, -0.8, 0, 0.8, 0, 0.02, 'paving'), B(-0.8, 0.78, 0.55, 0.8, 0.8, 2.1, 'plastic-white'), B(0.78, -0.8, 0.02, 0.8, 0.78, 2.1, 'plastic-white'), C(0.6, -0.4, 0.02, 0.9, 1.9, 'stainless', 6)] },
  { id: 'washer', name: '洗濯機（ドラム式）', category: 'キッチン・水まわり', size: [0.6, 0.65, 1.05], mount: 'floor', parts: [B(-0.3, -0.325, 0, 0.3, 0.325, 1.05, 'plastic-white'), B(-0.2, -0.33, 0.25, 0.2, -0.325, 0.65, 'glass'), B(-0.25, -0.33, 0.85, 0.1, -0.325, 0.98, 'screen')] },
  {
    id: 'cupboard',
    name: '食器棚（幅 1000）',
    category: 'キッチン・水まわり',
    size: [1.0, 0.45, 2.0],
    mount: 'floor',
    parts: [B(-0.5, -0.225, 0, 0.5, 0.225, 0.85, 'wood-light'), B(-0.5, -0.225, 0.85, 0.5, 0.225, 0.88, 'ceramic'), B(-0.5, 0.0, 0.88, 0.5, 0.225, 2.0, 'wood-light'), B(-0.48, -0.005, 1.0, 0.48, 0.0, 1.95, 'glass'), B(-0.003, -0.23, 0.05, 0.003, -0.225, 0.83, 'wood-walnut')],
  },
  { id: 'microwave-rack', name: 'レンジ台（電子レンジ付き）', category: 'キッチン・水まわり', size: [0.6, 0.45, 1.25], mount: 'floor', parts: [B(-0.3, -0.225, 0, 0.3, 0.225, 0.9, 'wood-light'), B(-0.25, -0.2, 0.9, 0.25, 0.2, 1.2, 'steel-white'), B(-0.2, -0.205, 0.95, 0.1, -0.2, 1.15, 'screen')] },
  { id: 'urinal', name: '小便器', category: 'キッチン・水まわり', size: [0.36, 0.38, 0.75], mount: 'wall', wallHeight: 0.4, parts: [B(-0.18, -0.38, 0.05, 0.18, 0.0, 0.7, 'ceramic'), B(-0.12, -0.36, 0.1, 0.12, -0.3, 0.55, 'plastic-white'), C(0, -0.1, 0.02, 0.7, 0.75, 'stainless', 6)] },
  { id: 'slop-sink', name: '掃除用流し', category: 'キッチン・水まわり', size: [0.6, 0.5, 1.1], mount: 'floor', parts: [B(-0.3, -0.25, 0.4, 0.3, 0.25, 0.75, 'ceramic'), B(-0.25, -0.2, 0, 0.25, 0.2, 0.4, 'ceramic'), C(0, 0.18, 0.02, 0.75, 1.1, 'stainless', 6)] },
  {
    id: 'counter-stools',
    name: 'カウンター＋スツール 3 脚',
    category: 'キッチン・水まわり',
    size: [1.8, 1.1, 1.05],
    mount: 'floor',
    parts: [B(-0.9, 0.0, 0, 0.9, 0.45, 1.0, 'wood-light'), B(-0.92, -0.15, 1.0, 0.92, 0.45, 1.04, 'wood-walnut'), ...[-0.6, 0, 0.6].flatMap((x) => [C(x, -0.45, 0.18, 0.7, 0.75, 'leather-black', 14), C(x, -0.45, 0.025, 0.0, 0.7, 'stainless', 8), C(x, -0.45, 0.2, 0, 0.02, 'stainless', 14)])],
  },
  // ---- 店舗・公共 ----
  {
    id: 'gondola',
    name: '商品棚（ゴンドラ・両面）',
    category: '店舗・公共',
    size: [0.9, 0.9, 1.5],
    mount: 'floor',
    parts: [B(-0.45, -0.02, 0, 0.45, 0.02, 1.5, 'steel-white'), ...[0.1, 0.45, 0.8, 1.15].flatMap((z) => [B(-0.45, -0.45, z, 0.45, -0.02, z + 0.02, 'steel-white'), B(-0.45, 0.02, z, 0.45, 0.45, z + 0.02, 'steel-white')]), ...[0.12, 0.47, 0.82].flatMap((z) => [...books(-0.43, 0.43, -0.25, z), ...books(-0.43, 0.43, 0.25, z)]), B(-0.45, -0.45, 0, 0.45, 0.45, 0.1, 'steel-white')],
  },
  { id: 'register', name: 'レジカウンター', category: '店舗・公共', size: [1.2, 0.6, 1.25], mount: 'floor', parts: [B(-0.6, -0.3, 0, 0.6, 0.3, 0.9, 'wood-walnut'), B(-0.62, -0.32, 0.9, 0.62, 0.3, 0.93, 'plastic-white'), B(-0.15, 0.0, 0.93, 0.15, 0.25, 1.0, 'plastic-black'), B(-0.12, 0.1, 1.0, 0.12, 0.13, 1.25, 'screen')] },
  { id: 'showcase', name: 'ショーケース（ガラス）', category: '店舗・公共', size: [1.2, 0.6, 1.0], mount: 'floor', parts: [B(-0.6, -0.3, 0, 0.6, 0.3, 0.4, 'wood-light'), B(-0.6, -0.3, 0.4, 0.6, 0.3, 1.0, 'glass-clear'), B(-0.58, -0.28, 0.65, 0.58, 0.28, 0.66, 'glass-clear')] },
  { id: 'waiting-bench', name: '待合ベンチ（3 人）', category: '店舗・公共', size: [1.6, 0.6, 0.8], mount: 'floor', parts: [...[-0.53, 0, 0.53].flatMap((x) => [B(x - 0.24, -0.25, 0.42, x + 0.24, 0.2, 0.47, 'fabric-navy'), B(x - 0.24, 0.17, 0.5, x + 0.24, 0.22, 0.8, 'fabric-navy')]), B(-0.8, -0.05, 0.36, 0.8, 0.05, 0.42, 'stainless'), B(-0.7, -0.25, 0, -0.65, 0.25, 0.36, 'stainless'), B(0.65, -0.25, 0, 0.7, 0.25, 0.36, 'stainless')] },
  {
    id: 'school-desk',
    name: '学校の机＋椅子',
    category: '店舗・公共',
    size: [0.65, 1.0, 0.8],
    mount: 'floor',
    parts: [...move([B(-0.325, -0.225, 0.68, 0.325, 0.225, 0.7, 'wood-light'), ...legs(0.65, 0.45, 0.68, 0.03, 'steel-gray')], 0, 0.25), ...move(chair('wood-light', 'steel-gray'), 0, -0.3, Math.PI)],
  },
  { id: 'vending', name: '自動販売機', category: '店舗・公共', size: [1.0, 0.75, 1.83], mount: 'floor', parts: [B(-0.5, -0.35, 0, 0.5, 0.4, 1.83, 'paint-red'), B(-0.45, -0.36, 0.95, 0.45, -0.35, 1.75, 'light'), B(-0.4, -0.36, 0.15, 0.2, -0.35, 0.35, 'plastic-black')] },
  { id: 'fire-extinguisher', name: '消火器（ボックス付き）', category: '店舗・公共', size: [0.3, 0.25, 0.75], mount: 'floor', parts: [B(-0.15, -0.12, 0, 0.15, 0.12, 0.08, 'paint-red'), C(0, 0, 0.08, 0.08, 0.6, 'paint-red', 12), C(0, 0, 0.02, 0.6, 0.72, 'plastic-black', 6)] },
  { id: 'exit-sign', name: '誘導灯（非常口）', category: '店舗・公共', size: [0.4, 0.05, 0.15], mount: 'wall', wallHeight: 2.2, parts: [B(-0.2, -0.05, 0, 0.2, 0, 0.15, 'steel-white'), B(-0.18, -0.055, 0.015, 0.18, -0.05, 0.135, 'light-green')] },
  // ---- 照明・設備 ----
  { id: 'pendant', name: 'ペンダントライト', category: '照明・設備', size: [0.38, 0.38, 0.9], mount: 'ceiling', parts: [C(0, 0, 0.05, 0.88, 0.9, 'steel-black', 10), C(0, 0, 0.006, 0.25, 0.88, 'steel-black', 6), C(0, 0, 0.19, 0.04, 0.25, 'steel-black', 16), C(0, 0, 0.16, 0.0, 0.04, 'light', 16)] },
  { id: 'ceiling-fan', name: 'シーリングファン', category: '照明・設備', size: [1.2, 1.2, 0.45], mount: 'ceiling', parts: [C(0, 0, 0.06, 0.3, 0.45, 'steel-black', 10), C(0, 0, 0.12, 0.2, 0.3, 'steel-black', 12), C(0, 0, 0.1, 0.15, 0.2, 'light', 12), B(-0.6, -0.06, 0.24, 0.6, 0.06, 0.25, 'wood-walnut'), B(-0.06, -0.6, 0.24, 0.06, 0.6, 0.25, 'wood-walnut')] },
  { id: 'floor-ac', name: '床置きエアコン', category: '照明・設備', size: [0.6, 0.35, 1.85], mount: 'floor', parts: [B(-0.3, -0.175, 0, 0.3, 0.175, 1.85, 'steel-white'), B(-0.25, -0.18, 1.4, 0.25, -0.175, 1.75, 'steel-gray'), B(-0.25, -0.18, 0.1, 0.25, -0.175, 0.5, 'steel-gray')] },
  { id: 'panel-board', name: '分電盤', category: '照明・設備', size: [0.5, 0.15, 0.7], mount: 'wall', wallHeight: 1.2, parts: [B(-0.25, -0.15, 0, 0.25, 0, 0.7, 'steel-white'), B(-0.02, -0.155, 0.3, 0.02, -0.15, 0.4, 'steel-gray')] },
  { id: 'vent-fan', name: '換気扇（壁付け）', category: '照明・設備', size: [0.35, 0.12, 0.35], mount: 'wall', wallHeight: 2.1, parts: [B(-0.175, -0.12, 0, 0.175, 0, 0.35, 'plastic-white'), ...[0.07, 0.14, 0.21, 0.28].map((z) => B(-0.15, -0.125, z, 0.15, -0.12, z + 0.02, 'steel-gray'))] },
  { id: 'ev-charger', name: 'EV 充電器（スタンド）', category: '照明・設備', size: [0.35, 0.3, 1.45], mount: 'floor', parts: [B(-0.15, -0.12, 0, 0.15, 0.12, 0.08, 'concrete'), B(-0.12, -0.08, 0.08, 0.12, 0.1, 1.45, 'plastic-white'), B(-0.08, -0.085, 1.0, 0.08, -0.08, 1.25, 'screen'), B(-0.17, -0.06, 0.6, -0.12, 0.06, 0.9, 'plastic-black')] },
  // ---- 外構・点景 ----
  {
    id: 'bicycle',
    name: '自転車',
    category: '外構・点景',
    size: [0.6, 1.75, 1.05],
    mount: 'floor',
    parts: [B(-0.02, -0.85, 0, 0.02, -0.2, 0.66, 'tire'), B(-0.02, 0.2, 0, 0.02, 0.85, 0.66, 'tire'), B(-0.015, -0.55, 0.3, 0.015, 0.55, 0.36, 'paint-green'), B(-0.015, 0.05, 0.36, 0.015, 0.1, 0.85, 'paint-green'), B(-0.06, 0.0, 0.85, 0.06, 0.2, 0.9, 'leather-black'), B(-0.3, -0.62, 0.95, 0.3, -0.58, 0.98, 'steel-black'), B(-0.015, -0.62, 0.36, 0.015, -0.58, 0.95, 'steel-black')],
  },
  {
    id: 'kei-truck',
    name: '軽トラック',
    category: '外構・点景',
    size: [1.48, 3.4, 1.8],
    mount: 'floor',
    parts: [
      B(-0.74, -1.7, 0.35, 0.74, -0.5, 1.8, 'car-white'),
      B(-0.7, -1.71, 1.05, 0.7, -1.69, 1.65, 'glass-mirror'),
      B(-0.74, -0.5, 0.55, 0.74, 1.7, 0.65, 'car-white'),
      B(-0.74, -0.5, 0.65, -0.7, 1.7, 0.95, 'car-white'),
      B(0.7, -0.5, 0.65, 0.74, 1.7, 0.95, 'car-white'),
      B(-0.74, 1.66, 0.65, 0.74, 1.7, 0.95, 'car-white'),
      ...[[-0.64, -1.1], [0.64, -1.1], [-0.64, 1.15], [0.64, 1.15]].map(([x, y]) => B(x - 0.08, y - 0.28, 0, x + 0.08, y + 0.28, 0.55, 'tire')),
    ],
  },
  {
    id: 'truck-2t',
    name: '2t トラック（平ボディ）',
    category: '外構・点景',
    size: [1.7, 4.7, 2.3],
    mount: 'floor',
    parts: [
      B(-0.85, -2.35, 0.45, 0.85, -0.85, 2.3, 'car-white'),
      B(-0.8, -2.36, 1.35, 0.8, -2.34, 2.1, 'glass-mirror'),
      B(-0.85, -0.85, 0.75, 0.85, 2.35, 0.85, 'steel-gray'),
      B(-0.85, -0.85, 0.85, -0.82, 2.35, 1.25, 'stainless'),
      B(0.82, -0.85, 0.85, 0.85, 2.35, 1.25, 'stainless'),
      B(-0.85, 2.32, 0.85, 0.85, 2.35, 1.25, 'stainless'),
      ...[[-0.72, -1.6], [0.72, -1.6], [-0.72, 1.4], [0.72, 1.4]].map(([x, y]) => B(x - 0.1, y - 0.36, 0, x + 0.1, y + 0.36, 0.72, 'tire')),
    ],
  },
  {
    id: 'packer',
    name: 'パッカー車（ごみ収集車）',
    category: '外構・点景',
    size: [1.9, 5.6, 2.6],
    mount: 'floor',
    parts: [
      B(-0.95, -2.8, 0.5, 0.95, -1.3, 2.4, 'car-white'),
      B(-0.9, -2.81, 1.4, 0.9, -2.79, 2.2, 'glass-mirror'),
      B(-0.95, -1.25, 0.8, 0.95, 2.2, 2.6, 'paint-green'),
      B(-0.95, 2.2, 0.6, 0.95, 2.8, 2.3, 'steel-gray'),
      B(-0.7, 2.79, 0.9, 0.7, 2.81, 1.6, 'plastic-black'),
      ...[[-0.8, -2.0], [0.8, -2.0], [-0.8, 1.2], [0.8, 1.2]].map(([x, y]) => B(x - 0.12, y - 0.42, 0, x + 0.12, y + 0.42, 0.84, 'tire')),
    ],
  },
  {
    id: 'roll-off',
    name: '脱着式コンテナ（アームロール用）',
    category: '外構・点景',
    size: [2.1, 4.2, 1.5],
    mount: 'floor',
    parts: [B(-1.05, -2.1, 0.1, 1.05, 2.1, 0.2, 'paint-green'), B(-1.05, -2.1, 0.2, -0.99, 2.1, 1.5, 'paint-green'), B(0.99, -2.1, 0.2, 1.05, 2.1, 1.5, 'paint-green'), B(-1.05, -2.1, 0.2, 1.05, -2.04, 1.5, 'paint-green'), B(-1.05, 2.04, 0.2, 1.05, 2.1, 1.5, 'paint-green'), B(-0.9, -2.1, 0, -0.75, 2.1, 0.1, 'steel-gray'), B(0.75, -2.1, 0, 0.9, 2.1, 0.1, 'steel-gray'), B(-0.1, -2.25, 1.0, 0.1, -2.1, 1.7, 'steel-gray')],
  },
  {
    id: 'container-20ft',
    name: '20ft コンテナ',
    category: '外構・点景',
    size: [2.44, 6.06, 2.59],
    mount: 'floor',
    parts: [B(-1.22, -3.03, 0, 1.22, 3.03, 2.59, 'galva-silver'), B(-1.18, -3.04, 0.1, -0.01, -3.03, 2.49, 'steel-gray'), B(0.01, -3.04, 0.1, 1.18, -3.03, 2.49, 'steel-gray')],
  },
  {
    id: 'forklift',
    name: 'フォークリフト',
    category: '外構・点景',
    size: [1.15, 3.2, 2.15],
    mount: 'floor',
    parts: [
      B(-0.55, -0.6, 0.25, 0.55, 1.5, 1.1, 'paint-yellow'),
      B(-0.55, 1.1, 0.25, 0.55, 1.6, 1.3, 'steel-gray'),
      B(-0.5, -0.4, 1.1, -0.46, 0.9, 2.15, 'steel-black'),
      B(0.46, -0.4, 1.1, 0.5, 0.9, 2.15, 'steel-black'),
      B(-0.5, -0.4, 2.1, 0.5, 0.9, 2.15, 'steel-black'),
      B(-0.25, 0.5, 1.1, 0.25, 0.9, 1.6, 'leather-black'),
      B(-0.45, -0.75, 0.1, 0.45, -0.62, 2.0, 'steel-black'),
      B(-0.35, -1.6, 0.05, -0.25, -0.75, 0.1, 'steel-gray'),
      B(0.25, -1.6, 0.05, 0.35, -0.75, 0.1, 'steel-gray'),
      ...[[-0.5, -0.3], [0.5, -0.3], [-0.5, 1.2], [0.5, 1.2]].map(([x, y]) => B(x - 0.1, y - 0.25, 0, x + 0.1, y + 0.25, 0.5, 'tire')),
    ],
  },
  { id: 'bench', name: 'ベンチ（屋外）', category: '外構・点景', size: [1.8, 0.6, 0.8], mount: 'floor', parts: [...[-0.2, -0.08, 0.04, 0.16].map((y) => B(-0.9, y, 0.42, 0.9, y + 0.1, 0.45, 'wood-light')), B(-0.9, 0.22, 0.5, 0.9, 0.27, 0.8, 'wood-light'), B(-0.8, -0.25, 0, -0.75, 0.27, 0.42, 'steel-black'), B(0.75, -0.25, 0, 0.8, 0.27, 0.42, 'steel-black')] },
  { id: 'planter', name: 'プランター（花壇）', category: '外構・点景', size: [1.2, 0.4, 0.75], mount: 'floor', parts: [B(-0.6, -0.2, 0, 0.6, 0.2, 0.4, 'concrete'), B(-0.56, -0.16, 0.4, 0.56, 0.16, 0.55, 'foliage'), ...[-0.4, -0.1, 0.2, 0.45].map((x) => C(x, 0, 0.1, 0.55, 0.75, 'fabric-red', 8))] },
  { id: 'storage-shed', name: '物置', category: '外構・点景', size: [1.8, 0.95, 2.05], mount: 'floor', parts: [B(-0.9, -0.45, 0, 0.9, 0.45, 1.95, 'galva-white'), B(-0.95, -0.5, 1.95, 0.95, 0.5, 2.05, 'galva-navy'), B(-0.003, -0.455, 0.05, 0.003, -0.45, 1.9, 'steel-gray')] },
  { id: 'bollard', name: '車止め', category: '外構・点景', size: [0.12, 0.12, 0.85], mount: 'floor', parts: [C(0, 0, 0.055, 0, 0.85, 'paint-yellow', 12), C(0, 0, 0.057, 0.65, 0.72, 'steel-black', 12)] },
  { id: 'street-light', name: '街路灯', category: '外構・点景', size: [0.6, 1.3, 5.0], mount: 'floor', parts: [C(0, 0, 0.12, 0, 0.5, 'steel-gray', 10), C(0, 0, 0.06, 0.5, 5.0, 'steel-gray', 10), B(-0.04, -1.2, 4.9, 0.04, 0, 4.98, 'steel-gray'), B(-0.18, -1.3, 4.82, 0.18, -0.8, 4.92, 'steel-gray'), B(-0.15, -1.25, 4.8, 0.15, -0.85, 4.82, 'light')] },
  { id: 'cone', name: 'カラーコーン', category: '外構・点景', size: [0.4, 0.4, 0.7], mount: 'floor', parts: [B(-0.19, -0.19, 0, 0.19, 0.19, 0.04, 'paint-orange'), C(0, 0, 0.12, 0.04, 0.3, 'paint-orange', 12), C(0, 0, 0.09, 0.3, 0.45, 'fabric-white', 12), C(0, 0, 0.06, 0.45, 0.7, 'paint-orange', 12)] },
  { id: 'garbage-station', name: 'ゴミステーション（箱型）', category: '外構・点景', size: [1.8, 0.9, 1.1], mount: 'floor', parts: [B(-0.9, -0.45, 0, 0.9, 0.45, 1.0, 'paint-green'), B(-0.92, -0.5, 1.0, 0.92, 0.47, 1.1, 'paint-green'), B(-0.85, -0.46, 0.1, 0.85, -0.45, 0.95, 'steel-gray')] },
  { id: 'conifer', name: '針葉樹（高さ 5m）', category: '外構・点景', size: [2.0, 2.0, 5.0], mount: 'floor', parts: [C(0, 0, 0.12, 0, 1.0, 'wood-walnut', 8), C(0, 0, 1.0, 0.8, 2.0, 'foliage', 10), C(0, 0, 0.8, 1.8, 3.0, 'foliage', 10), C(0, 0, 0.55, 2.8, 4.0, 'foliage', 10), C(0, 0, 0.3, 3.8, 5.0, 'foliage', 10)] },
  {
    id: 'child',
    name: '子ども（大きさの目安）',
    category: '外構・点景',
    size: [0.36, 0.22, 1.2],
    mount: 'floor',
    parts: [B(-0.1, -0.06, 0, -0.02, 0.06, 0.58, 'fabric-navy'), B(0.02, -0.06, 0, 0.1, 0.06, 0.58, 'fabric-navy'), B(-0.13, -0.08, 0.58, 0.13, 0.08, 0.98, 'fabric-red'), B(-0.18, -0.04, 0.62, -0.13, 0.04, 0.96, 'fabric-red'), B(0.13, -0.04, 0.62, 0.18, 0.04, 0.96, 'fabric-red'), C(0, 0, 0.085, 0.98, 1.2, 'skin', 12)],
  },

];

export const FURNITURE_CATEGORIES: FurnitureCategory[] = ['事務所', '住まい', 'キッチン・水まわり', '店舗・公共', '照明・設備', '外構・点景'];

/** 部品の範囲 [min, max]（家具の座標） */
export function furnitureBounds(def: FurnitureDef): [V3, V3] {
  const min: V3 = [Infinity, Infinity, Infinity];
  const max: V3 = [-Infinity, -Infinity, -Infinity];
  for (const p of def.parts) {
    const [a, b]: [V3, V3] = 'box' in p ? p.box : [[p.cyl.x - p.cyl.r, p.cyl.y - p.cyl.r, p.cyl.z0], [p.cyl.x + p.cyl.r, p.cyl.y + p.cyl.r, p.cyl.z1]];
    for (let i = 0; i < 3; i++) {
      min[i] = Math.min(min[i], a[i]);
      max[i] = Math.max(max[i], b[i]);
    }
  }
  return [min, max];
}

// 表示する大きさは、部品の実際の範囲から決める（手で書いた値とのずれをなくす）
for (const def of FURNITURE) {
  const [a, b] = furnitureBounds(def);
  def.size = [0, 1, 2].map((i) => Math.round((b[i] - a[i]) * 100) / 100) as V3;
}

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
  // 天井付けは上面を、壁付けは背面（いちばん奥）を基準にする
  const [, bmax] = furnitureBounds(def);
  const zOff = def.mount === 'ceiling' ? -bmax[2] : 0;
  const yOff = def.mount === 'wall' ? -bmax[1] : 0;
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
