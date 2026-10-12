import './style.css';
import { App } from './App';
import { setManifoldWasmUrl } from './core/profileSolid';
import manifoldWasmUrl from 'manifold-3d/manifold.wasm?url';

setManifoldWasmUrl(manifoldWasmUrl);

const root = document.getElementById('app')!;
const app = new App(root);
// 開発時のデバッグ用
(window as unknown as { app: App }).app = app;
void app.restoreAutosave();
