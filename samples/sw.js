/*
 * オフラインで動かすためのサービスワーカー。
 * - インストール時に precache.json（ビルド時に生成）のファイルをすべて保存
 * - 画面（HTML）はネット優先（新しい版があればそれを使い、つながらなければ保存した版）
 * - それ以外（ファイル名に版が入った JS・CSS・wasm など）は保存した物を優先
 */
const VERSION = new URL(self.location).searchParams.get('v') || 'dev';
const CACHE = `3dcad-${VERSION}`;

self.addEventListener('install', (e) => {
  e.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      try {
        const list = await (await fetch('./precache.json', { cache: 'no-store' })).json();
        await cache.addAll(['./', ...list]);
      } catch (err) {
        // 一覧が無くても、使った物から順に保存されるので動く
        console.warn('precache failed', err);
      }
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    (async () => {
      for (const k of await caches.keys()) if (k.startsWith('3dcad-') && k !== CACHE) await caches.delete(k);
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  const isPage = req.mode === 'navigate';
  e.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      if (isPage) {
        try {
          const res = await fetch(req);
          if (res.ok) cache.put('./', res.clone());
          return res;
        } catch {
          return (await cache.match('./')) || Response.error();
        }
      }
      const hit = await cache.match(req, { ignoreSearch: true });
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok && res.type === 'basic') cache.put(req, res.clone());
      return res;
    })(),
  );
});
