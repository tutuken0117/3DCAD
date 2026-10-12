// 古めのブラウザ（タブレット・現場の PC）でも動くよう、ポリフィル入りの legacy ビルドを使う
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
// 圧縮版は制御文字をそのまま含むため、配信しやすい非圧縮版を使う
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.mjs?url';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export interface RasterResult {
  dataUrl: string;
  widthPx: number;
  heightPx: number;
  /** 用紙サイズから求めた 1px あたりの用紙上の mm（PDF の場合） */
  paperMmPerPx?: number;
  pageCount?: number;
}

/** PDF の 1 ページを画像にする（線がつぶれないよう高解像度で） */
export async function rasterizePdf(buf: ArrayBuffer, pageNo = 1, maxPixels = 6000): Promise<RasterResult> {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buf) }).promise;
  const page = await doc.getPage(Math.min(Math.max(1, pageNo), doc.numPages));
  const base = page.getViewport({ scale: 1 }); // 1 unit = 1/72 inch
  const scale = Math.min(maxPixels / Math.max(base.width, base.height), 6);
  const vp = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(vp.width);
  canvas.height = Math.round(vp.height);
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvas, canvasContext: ctx, viewport: vp }).promise;
  const dataUrl = canvas.toDataURL('image/png');
  return {
    dataUrl,
    widthPx: canvas.width,
    heightPx: canvas.height,
    paperMmPerPx: 25.4 / 72 / scale,
    pageCount: doc.numPages,
  };
}

export async function loadImage(file: File): Promise<RasterResult> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
  const img = new Image();
  img.src = dataUrl;
  await img.decode();
  return { dataUrl, widthPx: img.naturalWidth, heightPx: img.naturalHeight };
}
