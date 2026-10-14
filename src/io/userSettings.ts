import type { MaterialSettings } from '../core/materials';

/**
 * この端末だけの設定（ブラウザに保存）。
 * 読めない環境（プライベートモードなど）でも動くように、失敗は無視する。
 */

const KEY_MATERIALS = '3dcad.materialDefaults';
const KEY_SAVE_MODE = '3dcad.saveMode';

function read<T>(key: string): T | undefined {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : undefined;
  } catch {
    return undefined;
  }
}

function write(key: string, v: unknown): void {
  try {
    if (v === undefined) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(v));
  } catch {
    // 保存できなくても続ける
  }
}

/** 新しいプロジェクトで使う材料の設定（色の変更・自分の材料） */
export const readMaterialDefaults = () => read<MaterialSettings>(KEY_MATERIALS);
export const writeMaterialDefaults = (s: MaterialSettings | undefined) => write(KEY_MATERIALS, s);

/** 保存のしかた: 毎回場所を選ぶ / ダウンロードフォルダ */
export type SaveMode = 'ask' | 'download';
export const readSaveMode = () => read<SaveMode>(KEY_SAVE_MODE);
export const writeSaveMode = (m: SaveMode) => write(KEY_SAVE_MODE, m);
