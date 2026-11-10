// 1 ファイル版（file://）を開いて、埋め込んだプロジェクトが読み込まれることを確かめる
import { chromium } from 'playwright-core';
const [html] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--allow-file-access-from-files'] });
const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto('file://' + html);
for (let i = 0; i < 60; i++) {
  await page.waitForTimeout(1000);
  const n = await page.evaluate(() => (window.app ? app.model.faces.size : 0)).catch(() => 0);
  if (n > 0) break;
}
console.log('project faces', await page.evaluate(() => app.model.faces.size), 'scenes', await page.evaluate(() => app.scenes.items.length));
console.log('errors', errors);
await browser.close();
