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
  | 'shingle'
  | 'glass'
  | 'tile'
  | 'stone'
  | 'block'
  | 'panel'
  | 'gravel'
  | 'grass'
  | 'asphalt'
  | 'flooring'
  | 'plain';

export type MaterialCategory = '外壁' | '屋根' | '開口' | '床・地面' | '家具' | 'その他';

export interface MaterialDef {
  id: string;
  name: string;
  category: MaterialCategory;
  /** 基本色（テクスチャの色合い・書き出し時の色） */
  color: string;
  roughness: number;
  metalness: number;
  /** 不透明度（ガラスなど） */
  opacity?: number;
  pattern: MaterialPattern;
  /** テクスチャ 1 枚が覆う長さ (m) */
  tile: number;
  /** 利用者が作った材料 */
  custom?: boolean;
  /** 光る強さ（照明器具の発光面） */
  emissive?: number;
}

type Def = Omit<MaterialDef, 'id' | 'name' | 'category'>;
const m = (id: string, name: string, category: MaterialCategory, d: Def): MaterialDef => ({ id, name, category, ...d });
const dull = (color: string, pattern: MaterialPattern, tile: number, roughness = 0.85): Def => ({ color, pattern, tile, roughness, metalness: 0 });
const metal = (color: string, pattern: MaterialPattern, tile: number): Def => ({ color, pattern, tile, roughness: 0.42, metalness: 0.55 });

/** 最初から入っている材料 */
export const MATERIALS: MaterialDef[] = [
  // 外壁
  m('plaster-white', '白い塗り壁', '外壁', dull('#ece9e2', 'plaster', 2, 0.95)),
  m('plaster-beige', 'ベージュの塗り壁', '外壁', dull('#d9ccb3', 'plaster', 2, 0.95)),
  m('mortar-gray', 'モルタル（グレー）', '外壁', dull('#a9a8a3', 'plaster', 2, 0.95)),
  m('siding-white', '窯業系サイディング（白）', '外壁', dull('#e4e2dc', 'siding', 1.2)),
  m('siding-beige', '横張りサイディング（ベージュ）', '外壁', dull('#d9cdb6', 'siding', 1.2, 0.8)),
  m('siding-gray', 'サイディング（グレー）', '外壁', dull('#9ea2a5', 'siding', 1.2)),
  m('siding-navy', 'サイディング（紺）', '外壁', dull('#3f4a5c', 'siding', 1.2)),
  m('siding-woodgrain', '木目調サイディング', '外壁', dull('#9b7553', 'wood', 1.6, 0.8)),
  m('alc', 'ALC パネル', '外壁', dull('#d6d3cc', 'panel', 1.8, 0.9)),
  m('tile-brown', '外壁タイル（茶）', '外壁', dull('#8a5a3f', 'brick', 0.6)),
  m('tile-white', '外壁タイル（白）', '外壁', dull('#e3ded3', 'brick', 0.6)),
  m('tile-gray', '外壁タイル（グレー）', '外壁', dull('#8e8f8c', 'brick', 0.6)),
  m('brick-red', 'レンガ', '外壁', dull('#a5583c', 'brick', 0.9, 0.9)),
  m('stone-granite', '石張り（御影石）', '外壁', dull('#9a958c', 'stone', 1.6, 0.7)),
  m('concrete', 'コンクリート打放し', '外壁', dull('#b4b2ad', 'concrete', 1.8, 0.9)),
  m('block', 'コンクリートブロック', '外壁', dull('#a7a49c', 'block', 1.6, 0.95)),
  m('wood-cedar', '木の板張り', '外壁', dull('#a8794f', 'wood', 1.2, 0.8)),
  m('yakisugi', '焼杉', '外壁', dull('#2f2a27', 'wood', 1.2, 0.9)),
  m('galva-black', '黒いガルバリウム（縦張り）', '外壁', metal('#3a3d40', 'metal-vertical', 1.4)),
  m('galva-silver', 'ガルバリウム角波（シルバー）', '外壁', metal('#b8bdc2', 'metal-vertical', 1.0)),
  m('galva-white', 'ガルバリウム（白）', '外壁', metal('#e2e3e1', 'metal-vertical', 1.4)),
  m('galva-navy', 'ガルバリウム（ネイビー）', '外壁', metal('#2f3b4f', 'metal-vertical', 1.4)),
  m('metal-panel', '金属パネル（シルバー）', '外壁', metal('#c3c6c9', 'panel', 2.4)),
  // 屋根
  m('roof-galva', 'ガルバリウム屋根（立平・黒）', '屋根', metal('#4b5157', 'roof-metal', 1.8)),
  m('roof-galva-brown', 'ガルバリウム屋根（ブラウン）', '屋根', metal('#5a4a3e', 'roof-metal', 1.8)),
  m('roof-galva-green', 'ガルバリウム屋根（緑）', '屋根', metal('#4f6b5c', 'roof-metal', 1.8)),
  m('roof-folded', '折板屋根（シルバー）', '屋根', metal('#a9adb1', 'roof-metal', 0.9)),
  m('roof-tile', '瓦（いぶし銀）', '屋根', { color: '#555b62', roughness: 0.6, metalness: 0.1, pattern: 'roof-tile', tile: 1.2 }),
  m('roof-tile-red', '洋瓦（赤）', '屋根', dull('#a24f36', 'roof-tile', 1.2, 0.7)),
  m('roof-slate', 'スレート', '屋根', dull('#5d5f63', 'slate', 1.2, 0.75)),
  m('roof-shingle', 'アスファルトシングル', '屋根', dull('#4d4b48', 'shingle', 1.0, 0.9)),
  m('roof-flat', '陸屋根（防水シート）', '屋根', dull('#9a9d9f', 'concrete', 3)),
  // 開口
  m('glass', 'ガラス（青み）', '開口', { color: '#7fa6c4', roughness: 0.05, metalness: 0.2, opacity: 0.45, pattern: 'glass', tile: 2 }),
  m('glass-clear', '透明ガラス', '開口', { color: '#b8d2e0', roughness: 0.03, metalness: 0.1, opacity: 0.25, pattern: 'glass', tile: 2 }),
  m('glass-frosted', 'すりガラス', '開口', { color: '#e3e8eb', roughness: 0.6, metalness: 0, opacity: 0.85, pattern: 'plain', tile: 2 }),
  m('glass-mirror', '熱線反射ガラス', '開口', { color: '#4f6475', roughness: 0.05, metalness: 0.7, opacity: 0.8, pattern: 'glass', tile: 2 }),
  m('sash-black', 'サッシ（黒）', '開口', metal('#2b2d30', 'plain', 1)),
  m('sash-silver', 'サッシ（シルバー）', '開口', metal('#b9bcbf', 'plain', 1)),
  m('sash-white', 'サッシ（白）', '開口', metal('#eceae6', 'plain', 1)),
  m('sash-bronze', 'サッシ（ブロンズ）', '開口', metal('#5a4a3c', 'plain', 1)),
  m('door-wood', '木製ドア', '開口', dull('#8a5e3b', 'wood', 1.0, 0.7)),
  // 床・地面
  m('grass', '芝生', '床・地面', dull('#6f9a4c', 'grass', 2, 1)),
  m('asphalt', 'アスファルト', '床・地面', dull('#5a5c5e', 'asphalt', 3, 0.95)),
  m('concrete-floor', '土間コンクリート', '床・地面', dull('#bdbbb5', 'plaster', 3, 0.9)),
  m('paving', 'タイル・石張り', '床・地面', dull('#c9c2b5', 'tile', 1.2, 0.8)),
  m('stone-paving', '石畳', '床・地面', dull('#9d9a92', 'stone', 2, 0.85)),
  m('interlocking', 'インターロッキング', '床・地面', dull('#a8785c', 'block', 0.8, 0.9)),
  m('gravel', '砂利', '床・地面', dull('#b3aea4', 'gravel', 1.5, 1)),
  m('soil', '土', '床・地面', dull('#8b6f52', 'gravel', 2, 1)),
  m('deck', 'ウッドデッキ', '床・地面', dull('#8f6a46', 'flooring', 1.5, 0.75)),
  m('flooring', 'フローリング', '床・地面', dull('#b98b5e', 'flooring', 1.8, 0.6)),
  m('carpet', 'タイルカーペット', '床・地面', dull('#6b7280', 'tile', 1.0, 1)),
  // 家具・設備
  m('wood-light', '家具の木（明るい）', '家具', dull('#c9a77c', 'wood', 0.8, 0.6)),
  m('wood-walnut', '家具の木（ウォールナット）', '家具', dull('#5b3d2a', 'wood', 0.8, 0.6)),
  m('fabric-gray', '布（グレー）', '家具', dull('#8a8d91', 'plaster', 0.6, 1)),
  m('fabric-navy', '布（紺）', '家具', dull('#34405a', 'plaster', 0.6, 1)),
  m('fabric-beige', '布（ベージュ）', '家具', dull('#cbbca3', 'plaster', 0.6, 1)),
  m('fabric-white', '布（白・寝具）', '家具', dull('#efede8', 'plaster', 0.6, 1)),
  m('leather-black', '革（黒）', '家具', { color: '#232323', roughness: 0.45, metalness: 0, pattern: 'plain', tile: 1 }),
  m('steel-white', 'スチール（白）', '家具', { color: '#e9e9e6', roughness: 0.5, metalness: 0.2, pattern: 'plain', tile: 1 }),
  m('stainless', 'ステンレス', '家具', { color: '#c7cacc', roughness: 0.25, metalness: 0.9, pattern: 'plain', tile: 1 }),
  m('ceramic', '陶器（白）', '家具', { color: '#f4f4f2', roughness: 0.15, metalness: 0, pattern: 'plain', tile: 1 }),
  m('plastic-black', '樹脂（黒）', '家具', { color: '#2a2a2a', roughness: 0.5, metalness: 0, pattern: 'plain', tile: 1 }),
  m('screen', '画面（黒）', '家具', { color: '#111316', roughness: 0.1, metalness: 0.3, pattern: 'plain', tile: 1 }),
  m('blind', 'ブラインド（白）', '家具', dull('#ecebe6', 'siding', 0.25, 0.6)),
  m('light', '照明（光る面）', '家具', { color: '#fff6e2', roughness: 0.5, metalness: 0, pattern: 'plain', tile: 1, emissive: 1.4 }),
  m('foliage', '植栽（葉）', '家具', dull('#4d7a3a', 'grass', 0.8, 1)),
  m('car-white', '車体（白）', '家具', { color: '#e6e7e8', roughness: 0.25, metalness: 0.5, pattern: 'plain', tile: 1 }),
  m('tire', 'タイヤ', '家具', dull('#1b1b1b', 'plain', 1, 0.9)),
  m('skin', '人（肌）', '家具', dull('#d9b08c', 'plain', 1, 0.8)),
  m('plastic-white', '樹脂（白）', '家具', { color: '#f1f1ef', roughness: 0.45, metalness: 0, pattern: 'plain', tile: 1 }),
  m('fabric-red', '布（赤）', '家具', dull('#9b3b34', 'plaster', 0.6, 1)),
  m('fabric-green', '布（緑）', '家具', dull('#5b7a5a', 'plaster', 0.6, 1)),
  m('tatami', '畳', '家具', dull('#c9c08a', 'siding', 0.3, 0.9)),
  m('mirror', '鏡', '家具', { color: '#d9e1e6', roughness: 0.02, metalness: 1, pattern: 'plain', tile: 1 }),
  m('paint-yellow', '塗装（黄）', '家具', { color: '#e2b23a', roughness: 0.45, metalness: 0.2, pattern: 'plain', tile: 1 }),
  m('paint-orange', '塗装（オレンジ）', '家具', { color: '#e46a2b', roughness: 0.5, metalness: 0, pattern: 'plain', tile: 1 }),
  m('paint-red', '塗装（赤）', '家具', { color: '#c0392b', roughness: 0.4, metalness: 0.2, pattern: 'plain', tile: 1 }),
  m('paint-green', '塗装（緑）', '家具', { color: '#2f6b4f', roughness: 0.45, metalness: 0.2, pattern: 'plain', tile: 1 }),
  m('light-green', '誘導灯（緑の発光）', '家具', { color: '#3ccf6e', roughness: 0.5, metalness: 0, pattern: 'plain', tile: 1, emissive: 1.2 }),
  // その他
  m('white', '白（模型）', 'その他', dull('#f2f1ee', 'plain', 1, 0.9)),
  m('steel-gray', '鉄骨（グレー塗装）', 'その他', metal('#7d8287', 'plain', 1)),
  m('steel-black', '鉄部（黒塗装）', 'その他', metal('#26282b', 'plain', 1)),
];

export const MATERIAL_CATEGORIES: MaterialCategory[] = ['外壁', '屋根', '開口', '床・地面', '家具', 'その他'];

// ---------------------------------------------------------------------------
// 材料の設定（色・模様の大きさの変更と、自分で作った材料）
// ---------------------------------------------------------------------------

export interface MaterialOverride {
  color?: string;
  tile?: number;
  name?: string;
}

/** プロジェクト・既定値として保存する材料の設定 */
export interface MaterialSettings {
  overrides?: Record<string, MaterialOverride>;
  custom?: MaterialDef[];
}

const BUILTIN = new Map(MATERIALS.map((d) => [d.id, d]));
let overrides = new Map<string, MaterialOverride>();
let custom: MaterialDef[] = [];
let resolved = new Map<string, MaterialDef>();
const listeners = new Set<() => void>();

function rebuild(): void {
  resolved = new Map();
  for (const d of [...MATERIALS, ...custom]) resolved.set(d.id, { ...d, ...overrides.get(d.id) });
  for (const fn of listeners) fn();
}
rebuild();

/** 材料の設定が変わったら呼ばれる（描画の作り直し・保存） */
export function onMaterialsChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** 今使える材料（最初からある材料 + 自分で作った材料。色の変更を反映） */
export function allMaterials(): MaterialDef[] {
  return [...resolved.values()];
}

/** 色や模様の大きさを変える */
export function setMaterialOverride(id: string, o: MaterialOverride): void {
  const c = custom.find((d) => d.id === id);
  if (c) Object.assign(c, o);
  else overrides.set(id, { ...overrides.get(id), ...o });
  rebuild();
}

/** 最初の色に戻す */
export function resetMaterial(id: string): void {
  overrides.delete(id);
  rebuild();
}

export function isMaterialModified(id: string): boolean {
  return overrides.has(id);
}

export function builtinMaterial(id: string): MaterialDef | undefined {
  return BUILTIN.get(id);
}

/** 材料をもとに、新しい材料を作る */
export function addCustomMaterial(base: MaterialDef, name: string, color: string): MaterialDef {
  let n = custom.length + 1;
  while (resolved.has(`custom-${n}`)) n++;
  const d: MaterialDef = { ...base, id: `custom-${n}`, name, color, custom: true };
  custom.push(d);
  rebuild();
  return resolved.get(d.id)!;
}

export function removeCustomMaterial(id: string): void {
  custom = custom.filter((d) => d.id !== id);
  rebuild();
}

export function materialSettings(): MaterialSettings {
  return { overrides: Object.fromEntries(overrides), custom: custom.map((d) => ({ ...d })) };
}

export function loadMaterialSettings(s: MaterialSettings | undefined): void {
  overrides = new Map(Object.entries(s?.overrides ?? {}).filter(([id]) => BUILTIN.has(id)));
  custom = (s?.custom ?? []).map((d) => ({ ...d, custom: true }));
  rebuild();
}

export const MAT_PREFIX = 'mat:';

export function materialOf(color: string | undefined): MaterialDef | undefined {
  if (!color?.startsWith(MAT_PREFIX)) return undefined;
  return resolved.get(color.slice(MAT_PREFIX.length));
}

export function getMaterial(id: string): MaterialDef | undefined {
  return resolved.get(id);
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
