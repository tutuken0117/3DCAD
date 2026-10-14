import { downloadBlob } from './export';
import { readSaveMode, type SaveMode } from './userSettings';

/**
 * 保存場所を選んでファイルを書き出す。
 * - PC の Chrome / Edge: 「名前を付けて保存」の画面で場所と名前を選ぶ（前回のフォルダを覚える）
 * - スマホ・タブレット: 共有メニュー（「ファイルに保存」「ドライブに保存」・メール・LINE など）
 * - それ以外・設定が「ダウンロード」: ダウンロードフォルダへ
 *
 * 場所を選ぶ画面は「クリックした直後」しか開けないので、
 * 書き出しの処理（時間がかかる）より先に chooseSaveTarget を呼び、できたら write する。
 */

interface PickerType {
  description: string;
  accept: Record<string, string[]>;
}

interface WritableLike {
  write(b: Blob): Promise<void>;
  close(): Promise<void>;
}

export interface FileHandleLike {
  name: string;
  getFile(): Promise<File>;
  createWritable(): Promise<WritableLike>;
}

type SavePicker = (o: { suggestedName: string; types?: PickerType[]; id?: string; startIn?: string }) => Promise<FileHandleLike>;
type OpenPicker = (o: { types?: PickerType[]; id?: string; multiple?: boolean }) => Promise<FileHandleLike[]>;

const TYPES: Record<string, PickerType> = {
  '3dcad': { description: '3DCAD プロジェクト', accept: { 'application/json': ['.3dcad'] } },
  pptx: { description: 'PowerPoint', accept: { 'application/vnd.openxmlformats-officedocument.presentationml.presentation': ['.pptx'] } },
  pdf: { description: 'PDF', accept: { 'application/pdf': ['.pdf'] } },
  zip: { description: 'ZIP（画像）', accept: { 'application/zip': ['.zip'] } },
  png: { description: 'PNG 画像', accept: { 'image/png': ['.png'] } },
  mp4: { description: '動画（MP4）', accept: { 'video/mp4': ['.mp4'] } },
  webm: { description: '動画（WebM）', accept: { 'video/webm': ['.webm'] } },
  glb: { description: 'GLB（3D）', accept: { 'model/gltf-binary': ['.glb'] } },
  usdz: { description: 'USDZ（AR）', accept: { 'model/vnd.usdz+zip': ['.usdz'] } },
  obj: { description: 'OBJ（3D）', accept: { 'text/plain': ['.obj'] } },
  dxf: { description: 'DXF', accept: { 'application/dxf': ['.dxf'] } },
};

const extOf = (name: string) => name.slice(name.lastIndexOf('.') + 1).toLowerCase();

/** 場所と名前を選ぶ画面が使えるか（PC の Chrome / Edge） */
export function canPickLocation(): boolean {
  return typeof (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker === 'function' && window.top === window;
}

/** スマホ・タブレットの共有メニューでファイルを渡せるか */
function canShareFiles(): boolean {
  const n = navigator as Navigator & { canShare?: (d: { files: File[] }) => boolean };
  if (!n.canShare || !('share' in navigator)) return false;
  const mobile = window.matchMedia?.('(pointer: coarse)').matches;
  try {
    return !!mobile && n.canShare({ files: [new File(['x'], 'a.txt', { type: 'text/plain' })] });
  } catch {
    return false;
  }
}

export function saveMode(): SaveMode {
  return readSaveMode() ?? 'ask';
}

export interface SaveTarget {
  /** 保存したファイル名 */
  name: string;
  /** 上書き保存に使える（PC の Chrome / Edge で場所を選んだとき） */
  handle?: FileHandleLike;
  write(blob: Blob): Promise<void>;
}

/** 書き込み先のファイルに書く */
export async function writeHandle(handle: FileHandleLike, blob: Blob): Promise<void> {
  const w = await handle.createWritable();
  await w.write(blob);
  await w.close();
}

/**
 * 保存先を決める。取りやめたら null。
 * group: 前回のフォルダを覚える単位（'project' / 'export'）
 */
export async function chooseSaveTarget(filename: string, opt: { group?: string; ask?: boolean } = {}): Promise<SaveTarget | null> {
  const ask = opt.ask ?? saveMode() === 'ask';
  if (ask && canPickLocation()) {
    const picker = (window as unknown as { showSaveFilePicker: SavePicker }).showSaveFilePicker;
    const t = TYPES[extOf(filename)];
    try {
      const handle = await picker({ suggestedName: filename, types: t ? [t] : undefined, id: `3dcad-${opt.group ?? 'export'}`, startIn: 'documents' });
      return { name: handle.name, handle, write: (b) => writeHandle(handle, b) };
    } catch (e) {
      if ((e as Error).name === 'AbortError') return null;
      // 画面を開けなかった（時間切れなど）ときはダウンロードにする
      console.warn('保存場所を選べませんでした', e);
    }
  }
  if (ask && canShareFiles()) {
    return {
      name: filename,
      async write(b) {
        const file = new File([b], filename, { type: b.type || 'application/octet-stream' });
        try {
          await navigator.share({ files: [file], title: filename });
        } catch (e) {
          // 共有を閉じた → 保存しない。共有できなかった（時間切れ）→ ダウンロード
          if ((e as Error).name === 'AbortError') throw Object.assign(new Error('保存を取りやめました'), { name: 'AbortError' });
          downloadBlob(b, filename);
        }
      },
    };
  }
  return { name: filename, write: async (b) => downloadBlob(b, filename) };
}

/** 開くファイルを選ぶ（上書き保存できるよう、ファイルの場所も覚える）。使えなければ null */
export async function pickOpenFile(): Promise<{ file: File; handle: FileHandleLike } | null | undefined> {
  const picker = (window as unknown as { showOpenFilePicker?: OpenPicker }).showOpenFilePicker;
  if (typeof picker !== 'function' || window.top !== window) return undefined;
  try {
    const [handle] = await picker({
      id: '3dcad-project',
      types: [{ description: '3DCAD プロジェクト', accept: { 'application/json': ['.3dcad', '.json'] } }],
    });
    return { file: await handle.getFile(), handle };
  } catch (e) {
    if ((e as Error).name === 'AbortError') return null;
    return undefined;
  }
}
