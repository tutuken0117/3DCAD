import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { defineConfig, type Plugin } from 'vite';

const BUILD_ID = Date.now().toString(36);

/** samples/ 以下のファイル一覧（相対パス） */
function listFiles(dir: string, root = dir): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? listFiles(p, root) : [relative(root, p).split('\\').join('/')];
  });
}

/** オフライン用: サービスワーカーが最初に保存するファイルの一覧 precache.json を出力 */
function precache(): Plugin {
  return {
    name: 'precache-list',
    apply: 'build',
    generateBundle(_opt, bundle) {
      const files = [...Object.keys(bundle), ...listFiles('samples')].filter((f) => f !== 'sw.js' && !f.endsWith('.map'));
      this.emitFile({ type: 'asset', fileName: 'precache.json', source: JSON.stringify(files.map((f) => `./${f}`)) });
    },
  };
}

/**
 * npm run build:single → 1 つの HTML ファイルだけで動く版（ダブルクリックで開ける・オフライン）。
 * JS・CSS・wasm・PDF の worker をすべて埋め込む（scripts/make-single.mjs で仕上げ）。
 */
const single = process.env.SINGLE === '1';

export default defineConfig({
  base: './',
  // samples/ のファイルをそのまま配信（「サンプルを開く」・アイコン・manifest・サービスワーカー）
  publicDir: 'samples',
  define: { __BUILD_ID__: JSON.stringify(BUILD_ID) },
  plugins: single ? [] : [precache()],
  build: single
    ? {
        target: 'es2022',
        outDir: 'dist-single',
        assetsInlineLimit: () => true,
        cssCodeSplit: false,
        copyPublicDir: false,
        chunkSizeWarningLimit: 20000,
        rollupOptions: { output: { inlineDynamicImports: true } },
      }
    : {
        target: 'es2022',
        chunkSizeWarningLimit: 2000,
      },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
} as Parameters<typeof defineConfig>[0]);
