import './style.css';
import { App } from './App';
import { setManifoldWasmUrl } from './core/profileSolid';
import manifoldWasmUrl from 'manifold-3d/manifold.wasm?url';
import { handleLaunch, setupPwa } from './pwa';

setManifoldWasmUrl(manifoldWasmUrl);

const root = document.getElementById('app')!;
const app = new App(root);
// 開発時のデバッグ用
(window as unknown as { app: App }).app = app;
setupPwa(app);
// ダブルクリックで開いたファイルがあればそれを開き、無ければ前回の続きを復元
void handleLaunch(app).then((opened) => {
  if (!opened) void app.restoreAutosave();
});
