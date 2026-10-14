import { Vector3 } from 'three';
import type { App } from '../App';
import { formatDms } from '../geo/jprcs';
import { chooseSaveTarget } from './saveFile';
import type { SceneData } from '../view/Scenes';

/**
 * プレゼン資料の書き出し: 画像（ZIP）・PowerPoint・PDF・動画。
 * どれも「保存した視点（シーン）」を順に描画して作る。
 */

export type ImageSizeKey = 'hd' | 'fhd' | '4k' | 'a4';

export const IMAGE_SIZES: Record<ImageSizeKey, { label: string; width: number; height: number }> = {
  hd: { label: '1280 × 720（メール・Web 向け）', width: 1280, height: 720 },
  fhd: { label: '1920 × 1080（スライド向け・標準）', width: 1920, height: 1080 },
  '4k': { label: '3840 × 2160（印刷・大判向け）', width: 3840, height: 2160 },
  a4: { label: '3508 × 2480（A4 横・300dpi）', width: 3508, height: 2480 },
};

export interface ExportOptions {
  size: ImageSizeKey;
  transparent?: boolean;
  caption?: boolean;
}

const today = () => new Date().toLocaleDateString('ja-JP');

function canvasToBlob(c: HTMLCanvasElement, type = 'image/png', quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error('画像を作れませんでした'))), type, quality));
}

/** 書き出すシーン（無ければおすすめの視点を自動で作る） */
export function scenesForExport(app: App): SceneData[] {
  if (app.scenes.items.length) return app.scenes.items;
  app.autoScenes();
  return app.scenes.items;
}

/** シーンごとに描画（視点を一時的に移し、終わったら元に戻す） */
async function renderScenes(
  app: App,
  opt: ExportOptions,
  each: (canvas: HTMLCanvasElement, scene: SceneData, index: number) => Promise<void>,
  onProgress?: (i: number, n: number) => void,
): Promise<void> {
  const vp = app.viewport;
  const keepP = vp.camera.position.clone();
  const keepT = vp.controls.target.clone();
  const keepHidden = app.scenes.layerState?.get();
  const scenes = scenesForExport(app);
  const { width, height } = IMAGE_SIZES[opt.size];
  try {
    for (let i = 0; i < scenes.length; i++) {
      onProgress?.(i, scenes.length);
      const s = scenes[i];
      await app.scenes.goTo(s, false);
      const caption = opt.caption ? `${app.projectName}　${s.name}　${today()}` : undefined;
      const c = app.presentation.renderImage({ width, height, transparent: opt.transparent, caption });
      await each(c, s, i);
      // UI が固まらないよう 1 フレーム待つ
      await new Promise((r) => requestAnimationFrame(() => r(null)));
    }
  } finally {
    if (keepHidden) app.scenes.layerState?.set(keepHidden);
    vp.camera.position.copy(keepP);
    vp.controls.target.copy(keepT);
    vp.controls.update();
    vp.requestRender();
  }
}

const safeName = (s: string) => s.replace(/[\\/:*?"<>|\s]+/g, '_');

/** 今の視点を 1 枚の画像に */
export async function exportCurrentImage(app: App, opt: ExportOptions): Promise<boolean> {
  const { width, height } = IMAGE_SIZES[opt.size];
  const target = await chooseSaveTarget(`${safeName(app.projectName)}_${width}x${height}.png`);
  if (!target) return false;
  const caption = opt.caption ? `${app.projectName}　${today()}` : undefined;
  const c = app.presentation.renderImage({ width, height, transparent: opt.transparent, caption });
  await target.write(await canvasToBlob(c));
  return true;
}

/** すべてのシーンの画像を ZIP で */
export async function exportImagesZip(app: App, opt: ExportOptions, onProgress?: (i: number, n: number) => void): Promise<boolean> {
  const target = await chooseSaveTarget(`${safeName(app.projectName)}_画像.zip`);
  if (!target) return false;
  const { default: JSZip } = await import('jszip');
  const zip = new JSZip();
  await renderScenes(
    app,
    opt,
    async (c, s, i) => {
      zip.file(`${String(i + 1).padStart(2, '0')}_${safeName(s.name)}.png`, await canvasToBlob(c));
    },
    onProgress,
  );
  await target.write(await zip.generateAsync({ type: 'blob' }));
  return true;
}

/** 建物の概要（資料の表紙・概要ページ用） */
export function projectSummary(app: App): { label: string; value: string }[] {
  const box = app.model.boundingBox();
  const rows: { label: string; value: string }[] = [];
  if (!box.isEmpty()) {
    const s = box.getSize(new Vector3());
    rows.push({ label: '大きさ（東西 × 南北 × 高さ）', value: `${s.x.toFixed(2)} m × ${s.z.toFixed(2)} m × ${s.y.toFixed(2)} m` });
    const c = box.getCenter(new Vector3());
    const geo = app.geo;
    if (geo.originSet) {
      const p = geo.toPublic(c);
      rows.push({ label: `位置（平面直角座標 第${geo.zone}系）`, value: `X ${p.X.toFixed(3)}  Y ${p.Y.toFixed(3)}` });
      const ll = geo.toLatLon(c);
      if (ll) rows.push({ label: '緯度・経度', value: `${formatDms(ll.lat)}  ${formatDms(ll.lon)}` });
    }
  }
  const st = app.presentation.settings;
  const h = Math.floor(st.hour);
  rows.push({ label: '光の条件', value: `${st.month}月${st.day}日 ${h}:${String(Math.round((st.hour - h) * 60)).padStart(2, '0')} の太陽` });
  rows.push({ label: '作成日', value: today() });
  return rows;
}

/** PowerPoint（.pptx）: 表紙 → シーンごとの画像 → 概要 */
export async function exportPptx(app: App, opt: ExportOptions, onProgress?: (i: number, n: number) => void): Promise<boolean> {
  const target = await chooseSaveTarget(`${safeName(app.projectName)}.pptx`);
  if (!target) return false;
  const { default: PptxGenJS } = await import('pptxgenjs');
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE'; // 13.33 × 7.5 inch (16:9)
  pptx.title = app.projectName;
  const font = 'Yu Gothic';
  const W = 13.333;
  const H = 7.5;

  const images: { data: string; name: string }[] = [];
  await renderScenes(app, { ...opt, caption: false }, async (c, s) => {
    images.push({ data: c.toDataURL('image/jpeg', 0.92), name: s.name });
  }, onProgress);

  // 表紙: 1 枚目の画像を背景に
  const cover = pptx.addSlide();
  if (images[0]) cover.addImage({ data: images[0].data, x: 0, y: 0, w: W, h: H });
  cover.addShape(pptx.ShapeType.rect, { x: 0, y: H - 2.2, w: W, h: 2.2, fill: { color: '1F2A35', transparency: 15 } });
  cover.addText(app.projectName, { x: 0.6, y: H - 2.0, w: W - 1.2, h: 1.0, fontFace: font, fontSize: 36, bold: true, color: 'FFFFFF' });
  cover.addText(`完成イメージ　${today()}`, { x: 0.6, y: H - 1.05, w: W - 1.2, h: 0.6, fontFace: font, fontSize: 16, color: 'DDE6EE' });

  // シーンごと: 画像を全面に、左下に名前
  images.forEach((img, i) => {
    const sl = pptx.addSlide();
    sl.addImage({ data: img.data, x: 0, y: 0, w: W, h: H });
    sl.addShape(pptx.ShapeType.rect, { x: 0.4, y: H - 1.0, w: Math.min(6.5, 1.4 + img.name.length * 0.28), h: 0.6, fill: { color: 'FFFFFF', transparency: 12 } });
    sl.addText(`${i + 1}. ${img.name}`, { x: 0.55, y: H - 1.0, w: 6.3, h: 0.6, fontFace: font, fontSize: 16, bold: true, color: '1F2A35' });
  });

  // 概要
  const sum = pptx.addSlide();
  sum.background = { color: 'F4F6F8' };
  sum.addText('概要', { x: 0.6, y: 0.4, w: 6, h: 0.8, fontFace: font, fontSize: 28, bold: true, color: '1F2A35' });
  const rows = projectSummary(app).map((r) => [
    { text: r.label, options: { bold: true, color: '1F2A35', fill: { color: 'E6ECF1' } } },
    { text: r.value, options: { color: '1F2A35' } },
  ]);
  sum.addTable(rows, { x: 0.6, y: 1.4, w: 7.4, colW: [3.0, 4.4], fontFace: font, fontSize: 13, border: { type: 'solid', pt: 0.5, color: 'C9D2DA' } });
  if (images[1] ?? images[0]) sum.addImage({ data: (images[1] ?? images[0]).data, x: 8.3, y: 1.4, w: 4.6, h: 2.59 });
  sum.addText('3DCAD で作成', { x: 0.6, y: H - 0.7, w: 6, h: 0.4, fontFace: font, fontSize: 10, color: '6B7885' });

  const blob = (await pptx.write({ outputType: 'blob' })) as Blob;
  await target.write(blob);
  return true;
}

/** PDF（A4 横）: 表紙 → シーンごと */
export async function exportPdf(app: App, opt: ExportOptions, onProgress?: (i: number, n: number) => void): Promise<boolean> {
  const target = await chooseSaveTarget(`${safeName(app.projectName)}.pdf`);
  if (!target) return false;
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const W = 297;
  const H = 210;
  let first = true;
  await renderScenes(app, { ...opt, caption: true }, async (c) => {
    if (!first) doc.addPage();
    first = false;
    const img = c.toDataURL('image/jpeg', 0.92);
    const ar = c.width / c.height;
    let w = W - 20;
    let h = w / ar;
    if (h > H - 20) {
      h = H - 20;
      w = h * ar;
    }
    doc.addImage(img, 'JPEG', (W - w) / 2, (H - h) / 2, w, h);
  }, onProgress);
  // jsPDF の標準フォントは日本語が出ないため、シーン名などは画像内の文字（右下）で入れている
  await target.write(doc.output('blob'));
  return true;
}

/** 動画: シーンを順にめぐる（なめらかなカメラ移動） */
export async function exportVideo(app: App, onProgress?: (i: number, n: number) => void): Promise<boolean> {
  const vp = app.viewport;
  const r = vp.renderer;
  if (!('MediaRecorder' in window) || !r.domElement.captureStream) throw new Error('このブラウザは動画の書き出しに対応していません');
  const types = ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm'];
  const mime = types.find((t) => MediaRecorder.isTypeSupported(t)) ?? '';
  const target = await chooseSaveTarget(`${safeName(app.projectName)}_ウォークスルー.${mime.includes('mp4') ? 'mp4' : 'webm'}`);
  if (!target) return false;
  const scenes = scenesForExport(app);
  const W = 1280;
  const H = 720;
  const prevPR = r.getPixelRatio();
  r.setPixelRatio(1);
  r.setSize(W, H, false);
  const cam = vp.camera;
  if ('isPerspectiveCamera' in cam) {
    cam.aspect = W / H;
    cam.updateProjectionMatrix();
  }
  const stream = r.domElement.captureStream(30);
  const rec = new MediaRecorder(stream, mime ? { mimeType: mime, videoBitsPerSecond: 8_000_000 } : undefined);
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const stopped = new Promise((res) => (rec.onstop = res));
  const keepP = vp.camera.position.clone();
  const keepT = vp.controls.target.clone();
  const keepHidden = app.scenes.layerState?.get();
  const wait = (ms: number) =>
    new Promise<void>((res) => {
      const t0 = performance.now();
      const tick = () => {
        vp.requestRender();
        if (performance.now() - t0 >= ms) res();
        else requestAnimationFrame(tick);
      };
      tick();
    });
  try {
    await app.scenes.goTo(scenes[0], false);
    rec.start();
    await wait(1200);
    for (let i = 1; i < scenes.length; i++) {
      onProgress?.(i, scenes.length);
      await app.scenes.goTo(scenes[i], true, 2600);
      await wait(1200);
    }
    rec.stop();
    await stopped;
  } finally {
    r.setPixelRatio(prevPR);
    vp.refreshSize();
    if (keepHidden) app.scenes.layerState?.set(keepHidden);
    vp.camera.position.copy(keepP);
    vp.controls.target.copy(keepT);
    vp.controls.update();
  }
  await target.write(new Blob(chunks, { type: rec.mimeType || 'video/webm' }));
  return true;
}
