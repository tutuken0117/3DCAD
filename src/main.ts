import './style.css';
import { App } from './App';

const root = document.getElementById('app')!;
const app = new App(root);
// 開発時のデバッグ用
(window as unknown as { app: App }).app = app;
void app.restoreAutosave();
