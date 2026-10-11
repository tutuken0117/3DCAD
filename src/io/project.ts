import type { ModelData } from '../core/Model';
import type { GeoReferenceData } from '../geo/GeoReference';
import type { UnderlayData } from '../view/UnderlayManager';
import type { AxisOrder } from '../view/PointCloudManager';

export const PROJECT_EXT = '.3dcad.json';

/** プロジェクトファイル（.3dcad.json）の中身 */
export interface ProjectFile {
  app: '3DCAD';
  version: 1;
  savedAt: string;
  model: ModelData;
  geo: GeoReferenceData;
  underlays: UnderlayData[];
  /** 点群はサイズが大きいので参照情報のみ保存（開くときに再読み込み） */
  pointClouds: { name: string; georeferenced: boolean; axisOrder: AxisOrder; count: number }[];
  camera?: { position: number[]; target: number[] };
}

export function parseProject(text: string): ProjectFile {
  const data = JSON.parse(text) as ProjectFile;
  if (data.app !== '3DCAD' || !data.model) throw new Error('3DCAD のプロジェクトファイルではありません');
  return data;
}

// ---------------------------------------------------------------------------
// ブラウザ内の自動保存（IndexedDB）
// ---------------------------------------------------------------------------

const DB_NAME = '3dcad';
const STORE = 'autosave';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveAutosave(p: ProjectFile): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(p, 'current');
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export async function loadAutosave(): Promise<ProjectFile | null> {
  try {
    const db = await openDb();
    const res = await new Promise<ProjectFile | null>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get('current');
      req.onsuccess = () => resolve((req.result as ProjectFile) ?? null);
      req.onerror = () => reject(req.error);
    });
    db.close();
    return res;
  } catch {
    return null;
  }
}

export async function clearAutosave(): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete('current');
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
    db.close();
  } catch {
    /* 無視 */
  }
}
