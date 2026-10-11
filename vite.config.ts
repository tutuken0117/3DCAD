import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  // samples/ のファイルをそのまま配信（「サンプルを開く」で使う）
  publicDir: 'samples',
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 2000,
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
} as Parameters<typeof defineConfig>[0]);
