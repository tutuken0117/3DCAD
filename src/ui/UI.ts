import { Vector3 } from 'three';
import type { App } from '../App';
import { DEFAULT_LAYER } from '../core/Model';
import { formatArea, formatCoord, formatLength, getDisplayUnit, parseLength, setDisplayUnit } from '../core/units';
import { ZONES, formatDms } from '../geo/jprcs';
import type { DrawingImportOptions } from '../io/drawingImport';
import type { Drawing2D } from '../io/drawing2d';
import type { PointColorMode } from '../view/PointCloudManager';
import type { FaceStyle } from '../view/ModelRenderer';
import type { StandardView } from '../view/Viewport';
import { ICONS } from './icons';

export interface FormField {
  key: string;
  label: string;
  type: 'text' | 'number' | 'select' | 'checkbox';
  value: string | boolean;
  options?: [string, string][];
}

export interface FormOptions {
  description?: string;
  okLabel?: string;
  cancelLabel?: string;
}

type PanelId = 'entity' | 'layers' | 'geo' | 'pointclouds' | 'underlays' | 'help';

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  html = '',
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  if (html) el.innerHTML = html;
  return el;
}

/** 画面の部品（メニュー・ツールバー・パネル・ステータスバー・ダイアログ） */
export class UI {
  readonly viewportEl: HTMLDivElement;
  paintColor = '#c8a46e';

  private root: HTMLElement;
  private hintEl!: HTMLDivElement;
  private vcbLabelEl!: HTMLSpanElement;
  private vcbInput!: HTMLInputElement;
  private coordEl!: HTMLDivElement;
  private toolButtons = new Map<string, HTMLButtonElement>();
  private panelBodies = new Map<PanelId, HTMLDivElement>();
  private tabButtons = new Map<PanelId, HTMLButtonElement>();
  private currentPanel: PanelId = 'entity';
  private toastEl!: HTMLDivElement;
  private toastTimer: number | undefined;
  private modalOpen = 0;
  private fileInput!: HTMLInputElement;
  private undoBtn!: HTMLButtonElement;
  private contextEl!: HTMLDivElement;
  private redoBtn!: HTMLButtonElement;

  constructor(
    private app: App,
    root: HTMLElement,
  ) {
    this.root = root;
    root.classList.add('app');
    this.viewportEl = h('div', { class: 'viewport' });
  }

  // ------------------------------------------------------------------
  // 画面の構築
  // ------------------------------------------------------------------

  build(): void {
    const app = this.app;
    const header = h('header', { class: 'topbar' });
    header.innerHTML = `
      <div class="brand">3DCAD <small>β</small></div>
      <div class="menu">
        <button data-act="new">新規</button>
        <button data-act="open">開く</button>
        <button data-act="save">保存</button>
        <div class="dropdown">
          <button class="primary">読み込み ▾</button>
          <div class="dropdown-menu">
            <button data-act="import-drawing">発注図面（DXF / SXF）…</button>
            <button data-act="import-underlay">下図（PDF / 画像）…</button>
            <button data-act="import-pc">点群（LAS / PLY / XYZ / CSV）…</button>
            <hr>
            <button data-act="sample">サンプル（配置図＋点群）を開く</button>
          </div>
        </div>
        <div class="dropdown">
          <button>書き出し ▾</button>
          <div class="dropdown-menu">
            <button data-exp="glb">GLB（AR・Web 用、公共座標情報つき）</button>
            <button data-exp="usdz">USDZ（iPhone の AR 用）</button>
            <hr>
            <button data-exp="obj">OBJ（公共座標・点群ソフト用）</button>
            <button data-exp="obj-local">OBJ（ローカル座標）</button>
            <button data-exp="dxf">DXF 3D（公共座標）</button>
            <button data-exp="dxf-local">DXF 3D（ローカル座標）</button>
          </div>
        </div>
        <span class="sep"></span>
        <button data-act="undo" title="元に戻す (Ctrl+Z)" class="icon">${ICONS.undo}</button>
        <button data-act="redo" title="やり直し (Ctrl+Y)" class="icon">${ICONS.redo}</button>
        <span class="sep"></span>
        <div class="dropdown">
          <button>表示 ▾</button>
          <div class="dropdown-menu">
            <button data-view="iso">等角（標準）</button>
            <button data-view="top">平面（上から）</button>
            <button data-view="front">正面（南から）</button>
            <button data-view="right">右側面（東から）</button>
            <button data-view="back">背面（北から）</button>
            <button data-view="left">左側面（西から）</button>
            <hr>
            <button data-act="ortho">平行投影 / 透視投影 切替</button>
            <button data-act="zoom">全体表示（Shift+Z）</button>
            <hr>
            <button data-style="shaded">面: 標準</button>
            <button data-style="layer">面: レイヤーの色</button>
            <button data-style="xray">面: 透過（X 線）</button>
            <button data-style="wireframe">面: 非表示（ワイヤー）</button>
          </div>
        </div>
        <button data-act="zoom" class="icon" title="全体表示 (Shift+Z)">${ICONS.zoom}</button>
      </div>
      <button class="ar-button" data-act="ar">${ICONS.ar}<span>AR で見る</span></button>`;
    this.root.appendChild(header);

    const main = h('div', { class: 'main' });
    const toolbar = h('nav', { class: 'toolbar' });
    const groups = [
      ['select'],
      ['line', 'rect', 'circle'],
      ['pushpull', 'move', 'rotate'],
      ['tape', 'eraser', 'paint', 'coord'],
      ['orbit', 'pan'],
    ];
    for (const g of groups) {
      const grp = h('div', { class: 'tool-group' });
      for (const id of g) {
        const t = app.tools.get(id)!;
        const b = h(
          'button',
          { class: 'tool', title: `${t.def.label}（${t.def.key}）`, 'data-tool': id },
          `${ICONS[t.def.icon] ?? ''}<span>${t.def.label}</span>`,
        );
        b.addEventListener('click', () => app.setTool(id));
        this.toolButtons.set(id, b);
        grp.appendChild(b);
      }
      toolbar.appendChild(grp);
    }
    const colorRow = h('div', { class: 'tool-group color-row' });
    const color = h('input', { type: 'color', value: this.paintColor, title: 'ペイントの色' }) as HTMLInputElement;
    color.addEventListener('input', () => (this.paintColor = color.value));
    colorRow.appendChild(color);
    toolbar.appendChild(colorRow);

    const side = h('aside', { class: 'sidepanel' });
    const tabs = h('div', { class: 'tabs' });
    const panels: [PanelId, string][] = [
      ['entity', '情報'],
      ['layers', 'レイヤー'],
      ['geo', '座標系'],
      ['pointclouds', '点群'],
      ['underlays', '下図'],
      ['help', '使い方'],
    ];
    for (const [id, label] of panels) {
      const tb = h('button', { class: 'tab' }, label);
      tb.addEventListener('click', () => this.showPanel(id));
      tabs.appendChild(tb);
      this.tabButtons.set(id, tb);
      const body = h('div', { class: 'panel-body' });
      this.panelBodies.set(id, body);
    }
    side.appendChild(tabs);
    for (const b of this.panelBodies.values()) side.appendChild(b);

    main.append(toolbar, this.viewportEl, side);
    this.root.appendChild(main);

    const status = h('footer', { class: 'statusbar' });
    this.hintEl = h('div', { class: 'hint' });
    this.coordEl = h('div', { class: 'coords' });
    const vcb = h('div', { class: 'vcb' });
    this.vcbLabelEl = h('span', { class: 'vcb-label' });
    this.vcbInput = h('input', { class: 'vcb-input', type: 'text', spellcheck: 'false', autocomplete: 'off' }) as HTMLInputElement;
    this.vcbInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const v = this.vcbInput.value;
        this.vcbInput.value = '';
        this.vcbInput.blur();
        this.app.viewport.renderer.domElement.focus();
        this.app.submitVcb(v);
      } else if (e.key === 'Escape') {
        this.vcbInput.value = '';
        this.vcbInput.blur();
      }
      e.stopPropagation();
    });
    vcb.append(this.vcbLabelEl, this.vcbInput);
    status.append(this.hintEl, this.coordEl, vcb);
    this.root.appendChild(status);

    this.contextEl = h('div', { class: 'context-banner' });
    this.contextEl.addEventListener('click', () => app.exitGroup());
    this.viewportEl.appendChild(this.contextEl);

    this.toastEl = h('div', { class: 'toast' });
    this.root.appendChild(this.toastEl);

    this.fileInput = h('input', { type: 'file', style: 'display:none' }) as HTMLInputElement;
    this.fileInput.addEventListener('change', () => {
      const f = this.fileInput.files?.[0];
      this.fileInput.value = '';
      if (f) void app.openAnyFile(f);
    });
    this.root.appendChild(this.fileInput);

    // メニューの動作
    header.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest('button');
      if (!b) return;
      const act = b.dataset.act;
      if (act === 'new') void app.newProject();
      if (act === 'sample') void app.loadSample();
      if (act === 'open') this.pickFile('open');
      if (act === 'save') app.saveProject();
      if (act === 'import-drawing') this.pickFile('drawing');
      if (act === 'import-underlay') this.pickFile('underlay');
      if (act === 'import-pc') this.pickFile('pointcloud');
      if (act === 'undo') app.undo();
      if (act === 'redo') app.redo();
      if (act === 'zoom') app.zoomExtents();
      if (act === 'ortho') {
        app.viewport.setOrtho(!app.viewport.isOrtho);
        this.toast(app.viewport.isOrtho ? '平行投影' : '透視投影');
      }
      if (act === 'ar') void app.ar.start();
      if (b.dataset.exp) void app.exportAs(b.dataset.exp as Parameters<App['exportAs']>[0]);
      if (b.dataset.view) app.viewport.setStandardView(b.dataset.view as StandardView);
      if (b.dataset.style) app.renderer.setFaceStyle(b.dataset.style as FaceStyle);
      // ドロップダウンを閉じる
      if (b.closest('.dropdown-menu')) (document.activeElement as HTMLElement | null)?.blur();
    });
    this.undoBtn = header.querySelector('[data-act=undo]')!;
    this.redoBtn = header.querySelector('[data-act=redo]')!;
    app.history.onChange(() => this.updateUndo());
    this.updateUndo();

    // 状態が変わったらパネルを更新
    app.model.onChange(() => this.refreshPanel(['entity', 'layers']));
    app.selection.onChange(() => this.refreshPanel(['entity']));
    app.geo.onChange(() => this.refreshPanel(['geo']));
    app.pointClouds.onChange(() => this.refreshPanel(['pointclouds']));
    app.underlays.onChange(() => this.refreshPanel(['underlays']));
    this.showPanel('entity');
    this.refreshAll();
  }

  private updateUndo(): void {
    this.undoBtn.disabled = !this.app.history.canUndo;
    this.redoBtn.disabled = !this.app.history.canRedo;
  }

  pickFile(kind: 'open' | 'drawing' | 'underlay' | 'pointcloud'): void {
    const accept = {
      open: '.json,.3dcad',
      drawing: '.dxf,.sfc,.p21',
      underlay: '.pdf,.png,.jpg,.jpeg,.webp',
      pointcloud: '.las,.laz,.ply,.xyz,.txt,.csv,.pts,.asc',
    }[kind];
    this.fileInput.accept = accept;
    this.fileInput.click();
  }

  // ------------------------------------------------------------------
  // ステータスバー
  // ------------------------------------------------------------------

  setHint(text: string): void {
    if (this.hintEl) this.hintEl.textContent = text;
  }

  setVcbLabel(text: string): void {
    if (!this.vcbLabelEl) return;
    this.vcbLabelEl.textContent = text;
    this.vcbInput.parentElement!.style.visibility = text ? 'visible' : 'hidden';
  }

  setVcbValue(text: string): void {
    if (this.vcbInput && document.activeElement !== this.vcbInput) this.vcbInput.placeholder = text;
  }

  startVcbTyping(firstChar: string): void {
    this.vcbInput.value = firstChar;
    this.vcbInput.focus();
  }

  setCursorPosition(p: Vector3): void {
    if (!this.coordEl) return;
    const geo = this.app.geo;
    const pub = geo.toPublic(p);
    this.coordEl.innerHTML = `<span title="公共座標（平面直角座標 第${geo.zone}系）">X ${formatCoord(pub.X)}　Y ${formatCoord(pub.Y)}　H ${formatCoord(pub.H)}</span>`;
  }

  /** グループ編集中の表示（null で非表示） */
  setContext(groupName: string | null): void {
    if (!this.contextEl) return;
    this.contextEl.style.display = groupName ? 'block' : 'none';
    this.contextEl.textContent = groupName ? `グループ「${groupName}」を編集中 — ここをクリックか Esc で終了` : '';
    this.app.tool?.updateStatus();
  }

  setActiveTool(id: string): void {
    for (const [tid, b] of this.toolButtons) b.classList.toggle('active', tid === id);
  }

  setPaintColor(c: string): void {
    this.paintColor = c;
    const input = this.root.querySelector<HTMLInputElement>('.color-row input');
    if (input) input.value = c;
  }

  toast(msg: string, ms = 3000): void {
    if (!this.toastEl) return;
    this.toastEl.textContent = msg;
    this.toastEl.classList.add('show');
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toastEl.classList.remove('show'), ms);
  }

  // ------------------------------------------------------------------
  // ダイアログ
  // ------------------------------------------------------------------

  isModalOpen(): boolean {
    return this.modalOpen > 0;
  }

  private modal(title: string, body: HTMLElement, buttons: [string, string][]): Promise<string | null> {
    this.modalOpen++;
    return new Promise((resolve) => {
      const backdrop = h('div', { class: 'modal-backdrop' });
      const box = h('div', { class: 'modal' });
      box.appendChild(h('h2', {}, esc(title)));
      box.appendChild(body);
      const row = h('div', { class: 'modal-buttons' });
      const close = (v: string | null) => {
        backdrop.remove();
        this.modalOpen--;
        resolve(v);
      };
      buttons.forEach(([id, label], i) => {
        const b = h('button', { class: i === 0 ? 'primary' : '' }, esc(label));
        b.addEventListener('click', () => close(id));
        row.appendChild(b);
      });
      box.appendChild(row);
      backdrop.appendChild(box);
      backdrop.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') close(null);
        if (e.key === 'Enter' && (e.target as HTMLElement).tagName !== 'BUTTON') close(buttons[0][0]);
        e.stopPropagation();
      });
      this.root.appendChild(backdrop);
      (box.querySelector('input,select,button.primary') as HTMLElement | null)?.focus();
    });
  }

  async alert(title: string, html: string): Promise<void> {
    await this.modal(title, h('div', { class: 'modal-text' }, html), [['ok', 'OK']]);
  }

  async confirm(title: string, html: string, ok = 'OK', cancel = 'キャンセル'): Promise<boolean> {
    return (await this.modal(title, h('div', { class: 'modal-text' }, html), [['ok', ok], ['cancel', cancel]])) === 'ok';
  }

  async form(title: string, fields: FormField[], opt: FormOptions = {}): Promise<Record<string, string | boolean> | null> {
    const body = h('div', { class: 'form' });
    if (opt.description) body.appendChild(h('p', { class: 'modal-text' }, opt.description));
    const inputs = new Map<string, HTMLInputElement | HTMLSelectElement>();
    for (const f of fields) {
      const row = h('label', { class: 'form-row' });
      row.appendChild(h('span', {}, esc(f.label)));
      let input: HTMLInputElement | HTMLSelectElement;
      if (f.type === 'select') {
        input = h('select');
        for (const [v, l] of f.options ?? []) {
          const o = h('option', { value: v }, esc(l));
          if (v === f.value) o.selected = true;
          input.appendChild(o);
        }
      } else if (f.type === 'checkbox') {
        input = h('input', { type: 'checkbox' }) as HTMLInputElement;
        input.checked = !!f.value;
      } else {
        input = h('input', { type: 'text', inputmode: f.type === 'number' ? 'decimal' : 'text' }) as HTMLInputElement;
        input.value = String(f.value);
      }
      inputs.set(f.key, input);
      row.appendChild(input);
      body.appendChild(row);
    }
    const res = await this.modal(title, body, [
      ['ok', opt.okLabel ?? 'OK'],
      ['cancel', opt.cancelLabel ?? 'キャンセル'],
    ]);
    if (res !== 'ok') return null;
    const out: Record<string, string | boolean> = {};
    for (const [k, el] of inputs) out[k] = el instanceof HTMLInputElement && el.type === 'checkbox' ? el.checked : el.value;
    return out;
  }

  /** 2D 図面の読み込み設定 */
  async drawingImportDialog(fileName: string, d: Drawing2D): Promise<DrawingImportOptions | null> {
    const body = h('div', { class: 'form' });
    const w = d.max[0] - d.min[0];
    const hgt = d.max[1] - d.min[1];
    // 単位の推定: 座標が大きく（数万）図面幅も大きければ mm、公共座標っぽければ m
    const guessUnit = d.unitHint ?? (Math.max(Math.abs(d.min[0]), Math.abs(d.min[1])) > 1000 && w < 5000 ? 'm' : w > 2000 ? 'mm' : 'm');
    const looksPublic = Math.max(Math.abs(d.min[0]), Math.abs(d.min[1])) > 1000 && guessUnit === 'm';
    body.innerHTML = `
      <p class="modal-text">${esc(d.source)}: 線 ${d.paths.length.toLocaleString()} 本、文字 ${d.texts.length} 個<br>
      範囲: ${w.toLocaleString(undefined, { maximumFractionDigits: 2 })} × ${hgt.toLocaleString(undefined, { maximumFractionDigits: 2 })}（図面単位）
      ${d.warnings.length ? `<br><span class="warn">${d.warnings.map(esc).join('<br>')}</span>` : ''}</p>
      <label class="form-row"><span>図面の単位</span>
        <select data-k="unit">
          <option value="0.001" ${guessUnit === 'mm' ? 'selected' : ''}>mm</option>
          <option value="0.01" ${guessUnit === 'cm' ? 'selected' : ''}>cm</option>
          <option value="1" ${guessUnit === 'm' ? 'selected' : ''}>m</option>
        </select></label>
      <label class="form-row"><span>座標</span>
        <select data-k="geo">
          <option value="local" ${looksPublic ? '' : 'selected'}>ローカル（図面の左下を原点に）</option>
          <option value="public" ${looksPublic ? 'selected' : ''}>公共座標（図面の X=東, Y=北 の平面直角座標）</option>
        </select></label>
      <label class="form-row"><span>配置する高さ（標高 m）</span><input data-k="elev" type="text" value="0"></label>
      <p class="modal-text"><b>画層</b>（「面」にチェックした画層は、線で囲まれた部分に自動で面を張ります。外形線・構造物の画層を選ぶと、あとで押し出すだけで 3D になります。寸法線・文字・ハッチングの画層は外すのがおすすめです）</p>
      <div class="layer-table">
        <div class="layer-head"><span>読込</span><span>面</span><span>画層</span><span>数</span></div>
        ${d.layers
          .map(
            (l, i) => `<label class="layer-line">
              <input type="checkbox" data-layer="${i}" checked>
              <input type="checkbox" data-face="${i}" ${/寸法|DIM|文字|TEXT|ハッチ|HATCH|旗|引出|注記|図枠|枠/i.test(l.name) ? '' : 'checked'}>
              <span><i class="swatch" style="background:${l.color}"></i>${esc(l.name)}</span>
              <span>${l.count}</span></label>`,
          )
          .join('')}
      </div>`;
    const res = await this.modal(`図面の読み込み: ${fileName}`, body, [
      ['ok', '読み込む'],
      ['cancel', 'キャンセル'],
    ]);
    if (res !== 'ok') return null;
    const q = (k: string) => body.querySelector<HTMLInputElement | HTMLSelectElement>(`[data-k=${k}]`)!.value;
    const layers = new Set<string>();
    const faceLayers = new Set<string>();
    d.layers.forEach((l, i) => {
      if (body.querySelector<HTMLInputElement>(`[data-layer="${i}"]`)!.checked) layers.add(l.name);
      if (body.querySelector<HTMLInputElement>(`[data-face="${i}"]`)!.checked) faceLayers.add(l.name);
    });
    return {
      unitToMeters: Number(q('unit')),
      georeferenced: q('geo') === 'public',
      elevation: Number(q('elev')) || 0,
      layers,
      faceLayers,
    };
  }

  // ------------------------------------------------------------------
  // サイドパネル
  // ------------------------------------------------------------------

  showPanel(id: PanelId): void {
    this.currentPanel = id;
    for (const [pid, body] of this.panelBodies) body.style.display = pid === id ? 'block' : 'none';
    for (const [pid, b] of this.tabButtons) b.classList.toggle('active', pid === id);
    this.refreshPanel([id]);
  }

  refreshAll(): void {
    this.refreshPanel(['entity', 'layers', 'geo', 'pointclouds', 'underlays', 'help']);
  }

  private refreshPanel(ids: PanelId[]): void {
    for (const id of ids) {
      // 非表示のパネルは表示時に描き直す
      if (id !== this.currentPanel) continue;
      const body = this.panelBodies.get(id);
      if (!body) continue;
      // 入力中の要素があれば描き直さない（入力が消えるため）
      if (body.contains(document.activeElement) && (document.activeElement as HTMLElement).tagName === 'INPUT') continue;
      switch (id) {
        case 'entity':
          this.renderEntity(body);
          break;
        case 'layers':
          this.renderLayers(body);
          break;
        case 'geo':
          this.renderGeo(body);
          break;
        case 'pointclouds':
          this.renderPointClouds(body);
          break;
        case 'underlays':
          this.renderUnderlays(body);
          break;
        case 'help':
          this.renderHelp(body);
          break;
      }
    }
  }

  private renderEntity(body: HTMLDivElement): void {
    const { model, selection } = this.app;
    if (selection.isEmpty) {
      body.innerHTML = `
        <h3>モデル</h3>
        <dl class="kv">
          <dt>面</dt><dd>${model.faces.size.toLocaleString()}</dd>
          <dt>エッジ</dt><dd>${model.edges.size.toLocaleString()}</dd>
          <dt>レイヤー</dt><dd>${model.layers.size}</dd>
          <dt>グループ</dt><dd>${model.groups.size}</dd>
        </dl>
        <p class="muted">選択ツール（スペースキー）で面やエッジをクリックすると、ここに情報が表示されます。</p>
        <h3>表示単位</h3>
        <select data-unit>
          <option value="mm" ${getDisplayUnit() === 'mm' ? 'selected' : ''}>mm</option>
          <option value="m" ${getDisplayUnit() === 'm' ? 'selected' : ''}>m</option>
        </select>`;
      body.querySelector<HTMLSelectElement>('[data-unit]')!.addEventListener('change', (e) => {
        setDisplayUnit((e.target as HTMLSelectElement).value as 'mm' | 'm');
        this.toast(`入力・表示の単位: ${getDisplayUnit()}（数値の後ろに m / mm を付けて指定もできます）`);
      });
      return;
    }
    let area = 0;
    for (const id of selection.faces) area += model.faceArea(id);
    let len = 0;
    for (const id of selection.edges) {
      const e = model.edges.get(id);
      if (e) len += model.pos(e.a).distanceTo(model.pos(e.b));
    }
    const layerOpts = [...model.layers.keys()].map((n) => `<option value="${esc(n)}">${esc(n)}</option>`).join('');
    const gid = this.app.selectedGroup();
    const group = gid ? model.groups.get(gid) : undefined;
    body.innerHTML = `
      ${
        group
          ? `<h3>グループ</h3>
        <div class="row"><input data-gname value="${esc(group.name)}"><button data-grename>名前を変更</button></div>
        <div class="row"><button data-genter class="primary">中を編集</button><button data-gexplode>グループ解除</button></div>
        <p class="muted">グループは他の物とくっつきません。中を編集するにはダブルクリック。</p>`
          : model.activeGroup
            ? ''
            : `<div class="row"><button data-gmake>グループにする（Ctrl+G）</button></div>`
      }
      <h3>選択中</h3>
      <dl class="kv">
        <dt>面</dt><dd>${selection.faces.size}</dd>
        <dt>面積の合計</dt><dd>${formatArea(area)}</dd>
        <dt>エッジ</dt><dd>${selection.edges.size}</dd>
        <dt>長さの合計</dt><dd>${formatLength(len)}</dd>
      </dl>
      ${
        selection.faces.size
          ? `<h3>押し出し</h3>
        <div class="row"><input data-extrude type="text" placeholder="例: 3000（mm）"><button data-do-extrude>押し出す</button></div>
        <p class="muted">選択した面をまとめて同じ高さで立体にします。マイナスで下向き。</p>
        <div class="row"><button data-reverse>面の向きを反転</button></div>`
          : ''
      }
      <h3>レイヤーを変更</h3>
      <div class="row"><select data-layer>${layerOpts}</select><button data-set-layer>移動</button></div>
      <div class="row"><button data-delete class="danger">削除（Delete）</button></div>`;
    body.querySelector('[data-do-extrude]')?.addEventListener('click', () => {
      const v = parseLength(body.querySelector<HTMLInputElement>('[data-extrude]')!.value);
      if (v === null || v === 0) return this.toast('高さを入力してください');
      this.app.extrudeSelection(v);
    });
    body.querySelector('[data-reverse]')?.addEventListener('click', () => {
      for (const id of selection.faces) model.reverseFace(id);
      this.app.history.commit('面の反転');
    });
    body.querySelector('[data-set-layer]')!.addEventListener('click', () => {
      const name = body.querySelector<HTMLSelectElement>('[data-layer]')!.value;
      for (const id of selection.faces) {
        const f = model.faces.get(id);
        if (f) f.layer = name;
      }
      for (const id of selection.edges) {
        const e = model.edges.get(id);
        if (e) e.layer = name;
      }
      this.app.history.commit('レイヤー変更');
    });
    body.querySelector('[data-delete]')!.addEventListener('click', () => this.app.deleteSelection());
    body.querySelector('[data-gmake]')?.addEventListener('click', () => this.app.makeGroupFromSelection());
    body.querySelector('[data-gexplode]')?.addEventListener('click', () => this.app.explodeSelectedGroup());
    body.querySelector('[data-genter]')?.addEventListener('click', () => gid && this.app.enterGroup(gid));
    body.querySelector('[data-grename]')?.addEventListener('click', () => {
      const name = body.querySelector<HTMLInputElement>('[data-gname]')!.value.trim();
      if (!group || !name) return;
      group.name = name;
      this.app.history.commit('グループ名の変更');
    });
  }

  private renderLayers(body: HTMLDivElement): void {
    const { model } = this.app;
    const counts = new Map<string, { faces: number; hfaces: number; edges: number }>();
    for (const l of model.layers.keys()) counts.set(l, { faces: 0, hfaces: 0, edges: 0 });
    for (const f of model.faces.values()) {
      const c = counts.get(f.layer);
      if (!c) continue;
      c.faces++;
      if (Math.abs(model.faceNormal(f).y) > 0.999) c.hfaces++;
    }
    for (const e of model.edges.values()) {
      const c = counts.get(e.layer);
      if (c) c.edges++;
    }
    body.innerHTML = `
      <h3>レイヤー（タグ）</h3>
      <p class="muted">◉ = 新しく描く図形のレイヤー。図面の画層ごとに「押し出し」で一括して立体にできます。</p>
      <div class="layers">
        ${[...model.layers.values()]
          .map((l) => {
            const c = counts.get(l.name)!;
            return `<div class="layer-item" data-name="${esc(l.name)}">
              <input type="radio" name="cur-layer" ${model.currentLayer === l.name ? 'checked' : ''} title="現在のレイヤー">
              <input type="checkbox" data-vis ${l.visible ? 'checked' : ''} title="表示">
              <input type="color" value="${l.color}" title="色（表示 →「面: レイヤーの色」で反映）">
              <span class="layer-name" title="${esc(l.name)}">${esc(l.name)}</span>
              <span class="muted small">${c.faces}面 ${c.edges}線</span>
              ${c.hfaces ? '<button data-extrude title="水平な面を一括で押し出し">押し出し</button>' : ''}
              ${l.name !== DEFAULT_LAYER ? '<button data-del title="レイヤーを削除（中身はレイヤー 0 へ）">×</button>' : ''}
            </div>`;
          })
          .join('')}
      </div>
      <div class="row"><input data-new placeholder="新しいレイヤー名"><button data-add>追加</button></div>`;
    body.querySelectorAll<HTMLDivElement>('.layer-item').forEach((row) => {
      const name = row.dataset.name!;
      const layer = model.layers.get(name)!;
      row.querySelector<HTMLInputElement>('input[type=radio]')!.addEventListener('change', () => (model.currentLayer = name));
      row.querySelector<HTMLInputElement>('[data-vis]')!.addEventListener('change', (e) => {
        layer.visible = (e.target as HTMLInputElement).checked;
        model.emitChange();
      });
      row.querySelector<HTMLInputElement>('input[type=color]')!.addEventListener('change', (e) => {
        layer.color = (e.target as HTMLInputElement).value;
        this.app.history.commit('レイヤーの色');
      });
      row.querySelector('[data-extrude]')?.addEventListener('click', async () => {
        const res = await this.form(`「${name}」を押し出し`, [
          { key: 'h', label: '高さ（mm、m 付きも可。マイナスで下向き）', type: 'text', value: '3000' },
        ]);
        const v = res ? parseLength(String(res.h)) : null;
        if (v) this.app.extrudeLayer(name, v);
      });
      row.querySelector('[data-del]')?.addEventListener('click', () => {
        for (const f of model.faces.values()) if (f.layer === name) f.layer = DEFAULT_LAYER;
        for (const e of model.edges.values()) if (e.layer === name) e.layer = DEFAULT_LAYER;
        model.layers.delete(name);
        if (model.currentLayer === name) model.currentLayer = DEFAULT_LAYER;
        this.app.history.commit('レイヤー削除');
      });
    });
    body.querySelector('[data-add]')!.addEventListener('click', () => {
      const input = body.querySelector<HTMLInputElement>('[data-new]')!;
      const name = input.value.trim();
      if (!name) return;
      model.ensureLayer(name);
      model.currentLayer = name;
      this.app.history.commit('レイヤー追加');
    });
  }

  private renderGeo(body: HTMLDivElement): void {
    const geo = this.app.geo;
    const ll = geo.toLatLon(new Vector3());
    body.innerHTML = `
      <h3>公共座標系</h3>
      <label class="form-row"><span>平面直角座標系</span>
        <select data-zone>
          ${ZONES.map((z) => `<option value="${z.zone}" ${z.zone === geo.zone ? 'selected' : ''}>第${z.zone}系 — ${esc(z.area)}</option>`).join('')}
        </select></label>
      <p class="muted">測地系 JGD2011（EPSG:${6668 + geo.zone}）。点群・図面・書き出しファイルはこの座標系で扱います。</p>
      <h3>プロジェクト原点</h3>
      <p class="muted">モデルの (0,0,0) が置かれる公共座標です。${geo.originSet ? '' : '<b>未設定</b>（最初に公共座標の点群・図面を読み込むと自動で設定されます）'}</p>
      <label class="form-row"><span>X（北）m</span><input data-x value="${formatCoord(geo.originX)}"></label>
      <label class="form-row"><span>Y（東）m</span><input data-y value="${formatCoord(geo.originY)}"></label>
      <label class="form-row"><span>標高 H m</span><input data-h value="${formatCoord(geo.originH)}"></label>
      <div class="row"><button data-apply class="primary">原点を設定</button></div>
      ${ll ? `<p class="muted">原点の緯度経度: ${formatDms(ll.lat)} / ${formatDms(ll.lon)}</p>` : ''}
      <p class="muted">座標ツール（I）で点をクリックし、既知の座標（基準点・測点）を入力すると、その点に合わせて原点を設定できます。</p>
      <h3>軸の向き</h3>
      <p class="muted"><span style="color:#d8312a">■ 赤</span> = 東（Y）、<span style="color:#2aa84a">■ 緑</span> = 北（X）、<span style="color:#2a64d8">■ 青</span> = 上（標高 H）</p>`;
    body.querySelector<HTMLSelectElement>('[data-zone]')!.addEventListener('change', (e) => {
      geo.setZone(Number((e.target as HTMLSelectElement).value));
    });
    body.querySelector('[data-apply]')!.addEventListener('click', () => {
      const v = (k: string) => Number(body.querySelector<HTMLInputElement>(`[data-${k}]`)!.value);
      const [x, y, hh] = [v('x'), v('y'), v('h')];
      if (![x, y, hh].every(Number.isFinite)) return this.toast('数値を入力してください');
      geo.setOrigin(x, y, hh);
      this.toast('原点を設定しました');
    });
  }

  private renderPointClouds(body: HTMLDivElement): void {
    const pcm = this.app.pointClouds;
    body.innerHTML = `
      <h3>点群</h3>
      ${pcm.clouds.length ? '' : '<p class="muted">「読み込み → 点群」またはファイルをドラッグ＆ドロップ。対応: LAS（非圧縮）, PLY, XYZ / TXT / CSV / PTS。</p>'}
      ${pcm.clouds
        .map(
          (c) => `<div class="pc-item" data-id="${c.id}">
            <div class="row"><input type="checkbox" data-vis ${c.points.visible ? 'checked' : ''}><b class="grow" title="${esc(c.name)}">${esc(c.name)}</b><button data-del>×</button></div>
            <div class="muted small">${esc(c.raw.format)} / ${c.raw.count.toLocaleString()} 点 / ${c.options.georeferenced ? '公共座標' : 'ローカル'}</div>
            <label class="form-row"><span>色</span><select data-color>
              ${(
                [
                  ['rgb', 'RGB（点の色）'],
                  ['elevation', '標高で色分け'],
                  ['intensity', '反射強度'],
                  ['single', '単色'],
                ] as [PointColorMode, string][]
              )
                .map(([v, l]) => `<option value="${v}" ${c.colorMode === v ? 'selected' : ''}>${l}</option>`)
                .join('')}
            </select></label>
          </div>`,
        )
        .join('')}
      <label class="form-row"><span>点の大きさ</span><input type="range" min="1" max="8" step="0.5" value="${pcm.pointSize}" data-size></label>
      <label class="form-row"><span>点群にスナップ</span><input type="checkbox" data-snap ${this.app.inference.pointCloudSnap ? 'checked' : ''}></label>
      <p class="muted">点群の点にスナップしながら線・長方形・プッシュ/プルを使うと、現況に合わせてモデルを作れます。</p>`;
    body.querySelectorAll<HTMLDivElement>('.pc-item').forEach((row) => {
      const c = pcm.clouds.find((x) => x.id === Number(row.dataset.id))!;
      row.querySelector<HTMLInputElement>('[data-vis]')!.addEventListener('change', (e) => pcm.setVisible(c, (e.target as HTMLInputElement).checked));
      row.querySelector('[data-del]')!.addEventListener('click', () => pcm.remove(c));
      row.querySelector<HTMLSelectElement>('[data-color]')!.addEventListener('change', (e) =>
        pcm.setColorMode(c, (e.target as HTMLSelectElement).value as PointColorMode),
      );
    });
    body.querySelector<HTMLInputElement>('[data-size]')!.addEventListener('input', (e) => pcm.setPointSize(Number((e.target as HTMLInputElement).value)));
    body.querySelector<HTMLInputElement>('[data-snap]')!.addEventListener('change', (e) => (this.app.inference.pointCloudSnap = (e.target as HTMLInputElement).checked));
  }

  private renderUnderlays(body: HTMLDivElement): void {
    const um = this.app.underlays;
    body.innerHTML = `
      <h3>下図（発注図面の PDF・画像）</h3>
      ${um.items.length ? '' : '<p class="muted">「読み込み → 下図」で PDF や画像を地面に敷き、線・長方形ツールでなぞって 3D 化できます。DXF / SXF がある場合はそちらの方が正確です。</p>'}
      ${um.items
        .map(
          (u) => `<div class="pc-item" data-id="${u.id}">
            <div class="row"><input type="checkbox" data-vis ${u.visible ? 'checked' : ''}><b class="grow" title="${esc(u.name)}">${esc(u.name)}</b><button data-del>×</button></div>
            <div class="muted small">幅 ${formatLength(u.widthPx * u.metersPerPixel, 'm')} × 奥行 ${formatLength(u.heightPx * u.metersPerPixel, 'm')}</div>
            <label class="form-row"><span>不透明度</span><input type="range" min="0.1" max="1" step="0.05" value="${u.opacity}" data-op></label>
            <label class="form-row"><span>高さ（m）</span><input data-elev value="${u.elevation}"></label>
            <div class="btn-grid">
              <button data-mode="scale">縮尺合わせ（2点）</button>
              <button data-mode="move">移動</button>
              <button data-mode="rotate">回転</button>
              <button data-mode="known">既知座標に合わせる</button>
            </div>
          </div>`,
        )
        .join('')}`;
    body.querySelectorAll<HTMLDivElement>('.pc-item').forEach((row) => {
      const u = um.items.find((x) => x.id === Number(row.dataset.id))!;
      row.querySelector<HTMLInputElement>('[data-vis]')!.addEventListener('change', (e) => {
        u.visible = (e.target as HTMLInputElement).checked;
        um.apply(u);
      });
      row.querySelector('[data-del]')!.addEventListener('click', () => um.remove(u));
      row.querySelector<HTMLInputElement>('[data-op]')!.addEventListener('input', (e) => {
        u.opacity = Number((e.target as HTMLInputElement).value);
        um.apply(u);
      });
      row.querySelector<HTMLInputElement>('[data-elev]')!.addEventListener('change', (e) => {
        u.elevation = Number((e.target as HTMLInputElement).value) || 0;
        um.apply(u);
      });
      row.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach((b) =>
        b.addEventListener('click', () => this.app.adjustUnderlay(u, b.dataset.mode as 'scale' | 'move' | 'rotate' | 'known')),
      );
    });
  }

  private renderHelp(body: HTMLDivElement): void {
    body.innerHTML = `
      <h3>発注図面から 3D を作る</h3>
      <ol class="steps">
        <li>「座標系」で平面直角座標の系番号を選ぶ</li>
        <li>「読み込み → 発注図面」で DXF / SXF(SFC) を開く（公共座標の図面ならそのまま位置が合います）</li>
        <li>外形線の画層に「面」のチェックを入れて読み込む</li>
        <li>「レイヤー」パネルの「押し出し」で高さを入れて一括立体化</li>
        <li>細かい所はプッシュ/プル（P）で面を引っ張って調整</li>
        <li>「AR で見る」で現地・会議室で確認</li>
      </ol>
      <p class="muted">PDF しかない場合は「下図」として読み込み、縮尺合わせをしてから線（L）・長方形（R）でなぞります。</p>
      <h3>基本操作（SketchUp と同じ）</h3>
      <table class="keys">
        <tr><td>中ボタンドラッグ</td><td>視点の回転</td></tr>
        <tr><td>Shift+中 / 右ドラッグ</td><td>パン（平行移動）</td></tr>
        <tr><td>ホイール</td><td>ズーム（カーソル位置へ）</td></tr>
        <tr><td>Space</td><td>選択</td></tr>
        <tr><td>L / R / C</td><td>線 / 長方形 / 円</td></tr>
        <tr><td>P</td><td>プッシュ/プル</td></tr>
        <tr><td>M / Q</td><td>移動（Ctrl でコピー） / 回転</td></tr>
        <tr><td>T / I</td><td>メジャー / 座標</td></tr>
        <tr><td>E / B</td><td>消しゴム / ペイント</td></tr>
        <tr><td>O / H</td><td>オービット / パン（トラックパッド用）</td></tr>
        <tr><td>Ctrl+G / Ctrl+Shift+G</td><td>グループ化 / グループ解除</td></tr>
        <tr><td>ダブルクリック（グループ）</td><td>グループの中を編集（Esc で終了）</td></tr>
        <tr><td>Shift+Z</td><td>全体表示</td></tr>
        <tr><td>Ctrl+Z / Ctrl+Y</td><td>元に戻す / やり直し</td></tr>
        <tr><td>Esc</td><td>操作の取り消し</td></tr>
        <tr><td>→ ← ↑</td><td>赤(東西) / 緑(南北) / 青(高さ) 方向にロック</td></tr>
        <tr><td>Shift（作図中）</td><td>今の方向にロック</td></tr>
      </table>
      <h3>穴・開口のあけ方</h3>
      <p class="muted">面の内側に長方形（R）や円（C）を描くと、その部分が面に刻み込まれます。プッシュ/プルで押し込むと凹み、反対側の面まで押し込む（壁の厚さぶん）と貫通して開口になります。引き出すと出っ張りになります。</p>
      <h3>グループ</h3>
      <p class="muted">選択して Ctrl+G でグループにすると、他の物とくっつかず、まとめて移動・コピーできます。ダブルクリックで中を編集します。</p>
      <h3>寸法の入力</h3>
      <p class="muted">作図中にそのまま数字を打って Enter（右下の欄に入ります）。単位は mm。「1.5m」のように単位も付けられます。長方形は「3000,2000」。プッシュ/プル直後に数字を打つと押し出し量を修正できます。</p>
      <h3>推定（スナップ）の色</h3>
      <p class="muted"><span style="color:#00b050">●</span> 端点　<span style="color:#00b8d9">●</span> 中点　<span style="color:#e0301e">●</span> エッジ上　<span style="color:#2a64d8">●</span> 面上　<span style="color:#ff8c00">●</span> 点群</p>`;
  }
}
