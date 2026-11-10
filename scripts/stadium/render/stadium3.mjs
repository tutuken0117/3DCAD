// 球場のモデルを開き、場面（視点）を登録して画像を撮り、プレゼン資料とプロジェクトを書き出す
import { chromium } from 'playwright-core';
import fs from 'node:fs';
const [proj, out, doExport] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1400, height: 850 }, acceptDownloads: true });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.addInitScript(() => localStorage.setItem('3dcad.saveMode', JSON.stringify('download')));
await page.goto('http://localhost:4173/');
await page.waitForTimeout(800);
await page.evaluate(async (t) => { await app.openAnyFile(new File([t], 'stadium.3dcad')); }, fs.readFileSync(proj, 'utf8'));
await page.waitForTimeout(1500);
await page.evaluate(() => { app.projectName = 'MAZDA Zoom-Zoom スタジアム広島（形状データ © OpenStreetMap contributors）'; });
await page.click('[data-act=present]');
await page.waitForTimeout(1500);
await page.evaluate(() => {
  app.scenes.load([]);
  app.autoScenes();
  const add = (name, p, t) => app.scenes.add({ name, position: p, target: t });
  const W = (x, y, z) => [x, z, -y];
  const eye = (name, from, to) => app.scenes.add({ name, position: W(...from), target: W(...to), fov: 62 });
  add('本塁側の上空から（南西）', W(-230, -170, 150), W(10, 0, 0));
  add('線路側の上空から（北東）', W(210, 190, 120), W(0, 0, 0));
  add('真上から', W(0, 0, 380), W(0, 0.01, 0));
  eye('本塁裏の上段から', [-84, -12.9, 19], [40, 3, 2]);
  eye('マウンドから外野を見る', [-26, -7.2, 1.8], [80, 3.5, 6]);
  eye('本塁から', [-44, -8.9, 1.6], [70, 3, 4]);
  eye('右翼スタンドから', [72, -60, 12], [-42, -8.7, 1]);
  eye('左翼スタンドから', [59, 65, 12], [-42, -8.7, 1]);
  add('外から（本塁側）', W(-190, 12, 25), W(-60, 4, 5));
  eye('正面砂かぶり席から', [-58, -10.3, 1.2], [20, 0, 1.5]);
  eye('一塁側の砂かぶり席とダッグアウト', [-20, -40, 3], [-40, -10, 0.5]);
  eye('三塁側の砂かぶり席とダッグアウト', [-25, 25, 3], [-45, -5, 0.5]);
  eye('外野砂かぶり席（レフトスタンド下・半地下）', [50, 62, 0.6], [5, 10, 1]);
  eye('レフトスタンド（ポール際から・ホームランライン）', [26, 56, 2.0], [70, 62, 4.5]);
  eye('レフトスタンド（グラウンドから）', [40, 30, 14], [58, 62, 3]);
  eye('センターとレフトの境目', [35.6, 10.3, 4], [75.4, 24.3, 3]);
  eye('ライトスタンドのフェンス', [28.7, -33.5, 4], [44.7, -67.8, 2]);
  eye('マウンド', [-30, -5, 3], [-22, -7, 0]);
  eye('びっくりテラス（一塁側）', [10, -70, 7], [28, -88, 2]);
  eye('パーティーデッキ（三塁側）', [5, 62, 7], [18, 77, 3]);
  eye('コンコース（三塁側）', [-25, 76, 9.9], [-70, 50, 9.6]);
  eye('内野 2 階席から', [-80, 40, 22], [0, 0, 2]);
});
await page.evaluate(() => app.makeThumbnails(app.scenes.items));
await page.evaluate(() => app.scenes.goTo(app.scenes.items[0], false));
await page.waitForTimeout(1500);
const names = await page.evaluate(() => app.scenes.items.map((s) => s.name));
console.log(names.map((n, i) => `${i + 1} ${n}`).join('\n'));
for (let i = 0; i < names.length; i++) {
  await page.evaluate((i) => app.scenes.goTo(app.scenes.items[i], false), i);
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${out}/view-${i + 1}.png`, clip: { x: 0, y: 46, width: 1100, height: 769 } });
}
if (doExport) {
  await page.evaluate(() => app.scenes.goTo(app.scenes.items[0], false));
  fs.writeFileSync(`${out}/マツダスタジアム.3dcad`, await page.evaluate(() => JSON.stringify(app.toProjectFile())));
  for (const [sel, fname] of [['[data-exp-pptx]', 'マツダスタジアム_プレゼン.pptx'], ['[data-exp-pdf]', 'マツダスタジアム_プレゼン.pdf']]) {
    const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 600000 }), page.click(sel)]);
    await dl.saveAs(`${out}/${fname}`);
    console.log(fname, fs.statSync(`${out}/${fname}`).size);
  }
}
console.log('errors', errors);
await browser.close();
