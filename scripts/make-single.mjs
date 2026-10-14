/**
 * dist-single を 1 つの HTML にまとめる。
 *   node scripts/make-single.mjs <出力.html> [埋め込むプロジェクト.3dcad] [表示名]
 * - JS・CSS をページに埋め込む（file:// でも動く）
 * - サンプル図面とアイコンを埋め込み、fetch('./xxx') で読めるようにする
 * - プロジェクトを渡すと、開いたときにそのプロジェクトを表示する
 */
import fs from 'node:fs';
import path from 'node:path';

const [out, project, title] = process.argv.slice(2);
const dir = 'dist-single';
let html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');

// CSS
html = html.replace(/<link rel="stylesheet"[^>]*href="\.\/(assets\/[^"]+\.css)"[^>]*>/g, (_, f) => `<style>${fs.readFileSync(path.join(dir, f), 'utf8')}</style>`);
// JS（モジュール 1 本）
let mainJs = '';
html = html.replace(/<script type="module"[^>]*src="\.\/(assets\/[^"]+\.js)"[^>]*><\/script>/g, (_, f) => {
  mainJs = fs.readFileSync(path.join(dir, f), 'utf8');
  return '<!--APP-->';
});
if (!mainJs) throw new Error('main script not found');
// manifest は 1 ファイル版では使わない
html = html.replace(/<link rel="manifest"[^>]*>\s*/g, '');
// アイコンを data URL に
const icon = (f) => `data:${f.endsWith('.svg') ? 'image/svg+xml' : 'image/png'};base64,${fs.readFileSync(path.join('samples', f)).toString('base64')}`;
html = html.replace(/href="\.\/(icons\/[^"]+)"/g, (_, f) => `href="${icon(f)}"`);

// サンプルを埋め込み、fetch で返す
const files = {};
for (const f of fs.readdirSync('samples')) {
  if (/\.(dxf|xyz)$/i.test(f)) files[f] = fs.readFileSync(path.join('samples', f)).toString('base64');
}
const shim = `<script>
(() => {
  const files = ${JSON.stringify(files)};
  const orig = window.fetch.bind(window);
  window.fetch = (input, init) => {
    const url = typeof input === 'string' ? input : input.url;
    const name = decodeURIComponent(url.split('/').pop().split('?')[0]);
    if (files[name] && !/^(https?|data|blob):/.test(url.replace(location.href, ''))) {
      const bin = Uint8Array.from(atob(files[name]), (c) => c.charCodeAt(0));
      return Promise.resolve(new Response(bin));
    }
    return orig(input, init);
  };
})();
</script>`;
let auto = '';
if (project) {
  const text = fs.readFileSync(project, 'utf8');
  auto = `<script>window.__AUTO_OPEN = { name: ${JSON.stringify(path.basename(project))}, text: ${JSON.stringify(text).replace(/<\/script/gi, '<\\/script')} };</script>`;
}
if (title) html = html.replace(/<title>[^<]*<\/title>/, `<title>${title}</title>`);
const app = `<script type="module">${mainJs.replace(/<\/script/gi, '<\\/script')}</script>`;
html = html.replace('<!--APP-->', () => shim + auto + app);
fs.writeFileSync(out, html);
console.log(out, (fs.statSync(out).size / 1024 / 1024).toFixed(1) + ' MB');
