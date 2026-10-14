/**
 * 仕上げ材（マテリアル）の一覧。
 * 面の color に "mat:<id>" を入れると、その材料で描画・書き出しする。
 * テクスチャは view/materialTextures.ts で手続き的に生成する（画像ファイル不要）。
 */

export type MaterialPattern =
  | 'plaster'
  | 'siding'
  | 'brick'
  | 'concrete'
  | 'wood'
  | 'metal-vertical'
  | 'roof-metal'
  | 'roof-tile'
  | 'slate'
  | 'glass'
  | 'tile'
  | 'grass'
  | 'asphalt'
  | 'flooring'
  | 'plain';

export interface MaterialDef {
  id: string;
  name: string;
  category: '外壁' | '屋根' | '開口' | '床・地面' | 'その他';
  /** 基本色（テクスチャの色合い・書き出し時の色） */
  color: string;
  roughness: number;
  metalness: number;
  /** 不透明度（ガラスなど） */
  opacity?: number;
  pattern: MaterialPattern;
  /** テクスチャ 1 枚が覆う長さ (m) */
  tile: number;
}

export const MATERIALS: MaterialDef[] = [
  { id: 'plaster-white', name: '白い塗り壁', category: '外壁', color: '#ece9e2', roughness: 0.95, metalness: 0, pattern: 'plaster', tile: 2 },
  { id: 'siding-beige', name: '横張りサイディング', category: '外壁', color: '#d9cdb6', roughness: 0.8, metalness: 0, pattern: 'siding', tile: 1.2 },
  { id: 'siding-white', name: '窯業系サイディング（白）', category: '外壁', color: '#e4e2dc', roughness: 0.85, metalness: 0, pattern: 'siding', tile: 1.2 },
  { id: 'tile-brown', name: '外壁タイル（茶）', category: '外壁', color: '#8a5a3f', roughness: 0.85, metalness: 0, pattern: 'brick', tile: 0.6 },
  { id: 'brick-red', name: 'レンガ', category: '外壁', color: '#a5583c', roughness: 0.9, metalness: 0, pattern: 'brick', tile: 0.9 },
  { id: 'concrete', name: 'コンクリート打放し', category: '外壁', color: '#b4b2ad', roughness: 0.9, metalness: 0, pattern: 'concrete', tile: 1.8 },
  { id: 'wood-cedar', name: '木の板張り', category: '外壁', color: '#a8794f', roughness: 0.8, metalness: 0, pattern: 'wood', tile: 1.2 },
  { id: 'galva-black', name: '黒いガルバリウム（縦張り）', category: '外壁', color: '#3a3d40', roughness: 0.45, metalness: 0.5, pattern: 'metal-vertical', tile: 1.4 },
  { id: 'roof-galva', name: 'ガルバリウム屋根（立平）', category: '屋根', color: '#4b5157', roughness: 0.4, metalness: 0.55, pattern: 'roof-metal', tile: 1.8 },
  { id: 'roof-tile', name: '瓦', category: '屋根', color: '#555b62', roughness: 0.6, metalness: 0.1, pattern: 'roof-tile', tile: 1.2 },
  { id: 'roof-slate', name: 'スレート', category: '屋根', color: '#5d5f63', roughness: 0.75, metalness: 0, pattern: 'slate', tile: 1.2 },
  { id: 'roof-flat', name: '陸屋根（防水シート）', category: '屋根', color: '#9a9d9f', roughness: 0.85, metalness: 0, pattern: 'concrete', tile: 3 },
  { id: 'glass', name: 'ガラス', category: '開口', color: '#7fa6c4', roughness: 0.05, metalness: 0.2, opacity: 0.45, pattern: 'glass', tile: 2 },
  { id: 'sash-black', name: 'サッシ（黒）', category: '開口', color: '#2b2d30', roughness: 0.4, metalness: 0.6, pattern: 'plain', tile: 1 },
  { id: 'grass', name: '芝生', category: '床・地面', color: '#6f9a4c', roughness: 1, metalness: 0, pattern: 'grass', tile: 2 },
  { id: 'asphalt', name: 'アスファルト', category: '床・地面', color: '#5a5c5e', roughness: 0.95, metalness: 0, pattern: 'asphalt', tile: 3 },
  { id: 'paving', name: 'タイル・石張り', category: '床・地面', color: '#c9c2b5', roughness: 0.8, metalness: 0, pattern: 'tile', tile: 1.2 },
  { id: 'flooring', name: 'フローリング', category: '床・地面', color: '#b98b5e', roughness: 0.6, metalness: 0, pattern: 'flooring', tile: 1.8 },
  { id: 'white', name: '白（模型）', category: 'その他', color: '#f2f1ee', roughness: 0.9, metalness: 0, pattern: 'plain', tile: 1 },
];

const BY_ID = new Map(MATERIALS.map((m) => [m.id, m]));

export const MAT_PREFIX = 'mat:';

export function materialOf(color: string | undefined): MaterialDef | undefined {
  if (!color?.startsWith(MAT_PREFIX)) return undefined;
  return BY_ID.get(color.slice(MAT_PREFIX.length));
}

export function getMaterial(id: string): MaterialDef | undefined {
  return BY_ID.get(id);
}

/** 面の色指定（#rrggbb または mat:id）→ 表示用の基本色 */
export function baseColorOf(color: string | undefined, fallback: string): string {
  if (!color) return fallback;
  return materialOf(color)?.color ?? (color.startsWith('#') ? color : fallback);
}

/** おまかせ仕上げの組み合わせ */
export interface FinishPreset {
  id: string;
  name: string;
  wall: string;
  roof: string;
  flatRoof: string;
  opening: string;
  ground: string;
}

export const FINISH_PRESETS: FinishPreset[] = [
  { id: 'natural', name: 'ナチュラル（白い壁＋ガルバ屋根）', wall: 'plaster-white', roof: 'roof-galva', flatRoof: 'roof-flat', opening: 'glass', ground: 'paving' },
  { id: 'modern', name: 'モダン（黒い外壁＋木）', wall: 'galva-black', roof: 'roof-galva', flatRoof: 'roof-flat', opening: 'glass', ground: 'paving' },
  { id: 'japanese', name: '和風（白壁＋瓦）', wall: 'plaster-white', roof: 'roof-tile', flatRoof: 'roof-flat', opening: 'glass', ground: 'paving' },
  { id: 'warm', name: 'あたたかみ（サイディング＋スレート）', wall: 'siding-beige', roof: 'roof-slate', flatRoof: 'roof-flat', opening: 'glass', ground: 'grass' },
  { id: 'brick', name: 'レンガ', wall: 'brick-red', roof: 'roof-slate', flatRoof: 'roof-flat', opening: 'glass', ground: 'paving' },
  { id: 'concrete', name: 'コンクリート（土木・公共施設）', wall: 'concrete', roof: 'roof-flat', flatRoof: 'roof-flat', opening: 'glass', ground: 'asphalt' },
];
