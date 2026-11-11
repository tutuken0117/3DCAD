// node peekcam2.mjs project.3dcad out.png x,y,z tx,ty,tz [x,y,z tx,ty,tz ...]（FOV は環境変数）
import { chromium } from 'playwright-core';
import fs from 'node:fs';
const [proj, out, ...cams] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1400, height: 850 } });
page.on('pageerror', (e) => console.log('ERR', e.message));
await page.goto('http://localhost:4173/');
await page.waitForTimeout(800);
await page.evaluate(async (t) => { await app.openAnyFile(new File([t], 'a.3dcad')); }, fs.readFileSync(proj, 'utf8'));
await page.waitForTimeout(1500);
await page.click('[data-act=present]');
await page.waitForTimeout(1500);
for (let i = 0; i < cams.length; i += 2) {
  const [x, y, z] = cams[i].split(',').map(Number);
  const [tx, ty, tz] = cams[i + 1].split(',').map(Number);
  await page.evaluate(([p, t, f]) => {
    const v = app.viewport;
    v.perspCamera.fov = f;
    v.perspCamera.updateProjectionMatrix();
    v.camera.position.set(p[0], p[2], -p[1]);
    v.controls.target.set(t[0], t[2], -t[1]);
    v.controls.update();
    v.requestRender();
  }, [[x, y, z], [tx, ty, tz], Number(process.env.FOV || 62)]);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: out.replace('.png', `-${i / 2}.png`), clip: { x: 0, y: 46, width: 1100, height: 769 } });
}
await browser.close();
