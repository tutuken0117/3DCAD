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
// ダブルクリックで開いたファイルがあればそれを開く。無ければ新規（前回の続きは「開く ▾」から）
void handleLaunch(app);
