import { Vector3 } from 'three';
import type { App } from '../App';
import { DEFAULT_LAYER } from '../core/Model';
import { formatArea, formatCoord, formatLength, getDisplayUnit, parseLength, setDisplayUnit } from '../core/units';
import { ZONES, formatDms } from '../geo/jprcs';
import type { DrawingImportOptions } from '../io/drawingImport';
import type { Drawing2D } from '../io/drawing2d';
import type { PointColorMode } from '../view/PointCloudManager';
import { VIEW_ANGLE, VIEW_LABEL, type SheetView } from '../view/SheetManager';
import type { SheetAdjustMode } from '../tools/MiscTools';
import type { SheetLineOptions } from '../io/sheetImport';
import type { FaceStyle } from '../view/ModelRenderer';
import type { StandardView } from '../view/Viewport';
import { ICONS } from './icons';
import { FINISH_PRESETS } from '../core/materials';
import { STYLE_LABEL, type RenderSettings } from '../view/Presentation';
import {
  exportCurrentImage,
  exportImagesZip,
  exportPdf,
  exportPptx,
  exportVideo,
  IMAGE_SIZES,
  type ImageSizeKey,
} from '../io/presentationExport';
import {
  addCustomMaterial,
  allMaterials,
  builtinMaterial,
  getMaterial,
  isMaterialModified,
  MAT_PREFIX,
  MATERIAL_CATEGORIES,
  materialOf,
  materialSettings,
  removeCustomMaterial,
  resetMaterial,
  setMaterialOverride,
  type MaterialCategory,
  type MaterialDef,
} from '../core/materials';
import { writeMaterialDefaults, writeSaveMode } from '../io/userSettings';
import { canPickLocation, saveMode } from '../io/saveFile';
import { FURNITURE, FURNITURE_CATEGORIES, type FurnitureCategory } from '../core/furniture';
import type { FurnitureTool } from '../tools/FurnitureTool';
import { furnitureThumb } from './furnitureThumb';
import { materialSwatch } from '../view/materialTextures';
import { isStandalone, promptInstall } from '../pwa';

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

type PanelId = 'entity' | 'layers' | 'geo' | 'pointclouds' | 'sheets' | 'furniture' | 'present' | 'help';

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
  paintColor = 'mat:plaster-white';

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
  private paintSwatch!: HTMLButtonElement;
  private paletteEl: HTMLDivElement | null = null;
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
      <button class="panel-toggle icon" data-act="panel" title="パネルを開く/閉じる">☰</button>
      <button class="menu-toggle" data-act="menu" title="メニュー">メニュー ▾</button>
      <div class="menu">
        <button data-act="new">新規</button>
        <div class="dropdown">
          <button>開く ▾</button>
          <div class="dropdown-menu">
            <button data-act="open">ファイルを開く… <small>Ctrl+O</small></button>
            <button data-act="restore">前回の続きを開く（自動保存）</button>
          </div>
        </div>
        <div class="dropdown">
          <button>保存 ▾</button>
          <div class="dropdown-menu">
            <button data-act="save">保存（上書き） <small>Ctrl+S</small></button>
            <button data-act="save-as">名前を付けて保存（場所を選ぶ）… <small>Ctrl+Shift+S</small></button>
            <hr>
            <button data-act="save-mode-ask" class="save-mode">毎回、保存する場所を選ぶ</button>
            <button data-act="save-mode-download" class="save-mode">ダウンロードフォルダに保存</button>
          </div>
        </div>
        <div class="dropdown">
          <button class="primary">読み込み ▾</button>
          <div class="dropdown-menu">
            <button data-act="import-sheet">図面（平面図・立面図・断面図）… <small>DXF / SXF / JWW / PDF / 画像</small></button>
            <button data-act="import-pc">点群（LAS / PLY / XYZ / CSV）…</button>
            <hr>
            <button data-act="sample-house">サンプル: 住宅（平面図＋立面図 → 立体）</button>
            <button data-act="sample">サンプル: 配置図＋点群（公共座標）</button>
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
            <button data-act="fullview">モデルだけを全画面で表示</button>
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
      <button class="install-button" data-act="install" hidden title="デスクトップのアプリとしてインストール（専用ウィンドウ・オフラインで起動）">${ICONS.install}<span>アプリにする</span></button>
      <button class="icon fullview-button" data-act="fullview" title="モデルだけを全画面で表示">${ICONS.expand}</button>
      <button class="present-button" data-act="present">${ICONS.present}<span>プレゼン資料を作る</span></button>
      <button class="ar-button" data-act="ar">${ICONS.ar}<span>AR で見る</span></button>`;
    this.root.appendChild(header);

    const main = h('div', { class: 'main' });
    const toolbar = h('nav', { class: 'toolbar' });
    const groups = [
      ['select'],
      ['line', 'rect', 'circle'],
      ['pushpull', 'profile', 'move', 'rotate'],
      ['tape', 'eraser', 'paint', 'coord'],
      ['orbit', 'pan', 'walk'],
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
    this.paintSwatch = h('button', { class: 'paint-swatch', title: '塗る材料・色を選ぶ' }) as HTMLButtonElement;
    this.paintSwatch.addEventListener('click', () => this.togglePalette());
    colorRow.appendChild(this.paintSwatch);
    toolbar.appendChild(colorRow);

    const side = h('aside', { class: 'sidepanel' });
    const tabs = h('div', { class: 'tabs' });
    const panels: [PanelId, string][] = [
      ['entity', '情報'],
      ['layers', 'レイヤー'],
      ['geo', '座標系'],
      ['pointclouds', '点群'],
      ['sheets', '図面'],
      ['furniture', '家具'],
      ['present', 'プレゼン'],
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
    this.buildTouchBar();
    this.buildContextMenu();

    this.toastEl = h('div', { class: 'toast' });
    this.root.appendChild(this.toastEl);

    this.fileInput = h('input', { type: 'file', style: 'display:none' }) as HTMLInputElement;
    this.fileInput.addEventListener('change', () => {
      const f = this.fileInput.files?.[0];
      this.fileInput.value = '';
      if (f) void app.openAnyFile(f);
    });
    this.root.appendChild(this.fileInput);

    // ドロップダウン: タップで開閉（iPad の Safari はボタンにフォーカスが移らないため）
    header.querySelectorAll<HTMLDivElement>('.dropdown').forEach((dd) => {
      dd.querySelector(':scope > button')!.addEventListener('click', (e) => {
        e.stopPropagation();
        const open = !dd.classList.contains('open');
        header.querySelectorAll('.dropdown.open').forEach((x) => x.classList.remove('open'));
        dd.classList.toggle('open', open);
      });
    });
    document.addEventListener('click', () => header.querySelectorAll('.dropdown.open').forEach((x) => x.classList.remove('open')));
    // 3D 画面を触ったらパネル（ドロワー）を閉じる
    this.viewportEl.addEventListener('pointerdown', () => this.root.classList.remove('panel-open'));

    // メニューの動作
    header.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest('button');
      if (!b) return;
      const act = b.dataset.act;
      if (act === 'new') void app.newProject();
      if (act === 'sample') void app.loadSample();
      if (act === 'sample-house') void app.loadHouseSample();
      if (act === 'panel') this.root.classList.toggle('panel-open');
      if (act === 'menu') {
        e.stopPropagation();
        header.classList.toggle('menu-open');
        return;
      }
      // スマホのメニュー: 項目を選んだら閉じる（分類の見出しは閉じない）
      if (b.closest('.menu') && !(b.parentElement?.classList.contains('dropdown') && !b.closest('.dropdown-menu'))) header.classList.remove('menu-open');
      if (act === 'open') void app.openProjectDialog();
      if (act === 'restore') void app.restoreAutosave();
      if (act === 'save') void app.saveProject();
      if (act === 'save-as') void app.saveProject(true);
      if (act === 'save-mode-ask' || act === 'save-mode-download') {
        writeSaveMode(act === 'save-mode-ask' ? 'ask' : 'download');
        this.refreshSaveMode();
        this.toast(
          act === 'save-mode-ask'
            ? canPickLocation()
              ? '保存・書き出しのたびに、保存する場所と名前を選びます'
              : 'スマホ・タブレットでは共有メニュー（「ファイルに保存」など）から保存先を選びます'
            : '保存・書き出しはダウンロードフォルダに保存します',
          6000,
        );
      }
      if (act === 'import-sheet') this.pickFile('sheet');
      if (act === 'import-pc') this.pickFile('pointcloud');
      if (act === 'undo') app.undo();
      if (act === 'redo') app.redo();
      if (act === 'zoom') app.zoomExtents();
      if (act === 'ortho') {
        app.viewport.setOrtho(!app.viewport.isOrtho);
        this.toast(app.viewport.isOrtho ? '平行投影' : '透視投影');
      }
      if (act === 'ar') void app.ar.start();
      if (act === 'install') void promptInstall(app);
      if (act === 'fullview') this.setModelOnly(true);
      if (act === 'present') {
        if (app.presentation.active) app.exitPresentation();
        else app.enterPresentation();
      }
      if (b.dataset.exp) void app.exportAs(b.dataset.exp as Parameters<App['exportAs']>[0]);
      if (b.dataset.view) app.viewport.setStandardView(b.dataset.view as StandardView);
      if (b.dataset.style) app.renderer.setFaceStyle(b.dataset.style as FaceStyle);
      // ドロップダウンを閉じる
      if (b.closest('.dropdown-menu')) {
        (document.activeElement as HTMLElement | null)?.blur();
        b.closest('.dropdown')?.classList.remove('open');
      }
    });
    this.undoBtn = header.querySelector('[data-act=undo]')!;
    this.refreshSaveMode();
    // ブラウザの全画面を Esc で抜けたら、モデルだけの表示も終える
    document.addEventListener('fullscreenchange', () => {
      if (!document.fullscreenElement && this.root.classList.contains('model-only')) this.setModelOnly(false);
    });
    this.redoBtn = header.querySelector('[data-act=redo]')!;
    app.history.onChange(() => this.updateUndo());
    this.updateUndo();

    // 状態が変わったらパネルを更新
    app.model.onChange(() => this.refreshPanel(['entity', 'layers']));
    app.selection.onChange(() => this.refreshPanel(['entity']));
    app.geo.onChange(() => this.refreshPanel(['geo']));
    app.pointClouds.onChange(() => this.refreshPanel(['pointclouds']));
    app.sheets.onChange(() => this.refreshPanel(['sheets']));
    app.scenes.onChange(() => this.refreshPanel(['present']));
    this.showPanel('entity');
    this.refreshAll();
    this.updatePaintSwatch();
  }

  private updateUndo(): void {
    this.undoBtn.disabled = !this.app.history.canUndo;
    this.redoBtn.disabled = !this.app.history.canRedo;
  }

  pickFile(kind: 'open' | 'sheet' | 'pointcloud'): void {
    const accept = {
      open: '.json,.3dcad',
      sheet: '.dxf,.sfc,.jww,.pdf,.png,.jpg,.jpeg,.webp',
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
    this.updatePaintSwatch();
  }

  private updatePaintSwatch(): void {
    if (!this.paintSwatch) return;
    const def = materialOf(this.paintColor);
    this.paintSwatch.style.background = def ? `url(${materialSwatch(def)}) center/cover` : this.paintColor;
    this.paintSwatch.title = `塗る材料・色: ${def ? def.name : this.paintColor}（クリックで選ぶ）`;
  }

  /** 材料パレットで開いている分類 */
  private paletteCat: MaterialCategory | '色' = '外壁';

  /** 材料パレット（ペイントツール用） */
  togglePalette(show?: boolean): void {
    if (!this.paletteEl) {
      const el = h('div', { class: 'material-palette' });
      el.addEventListener('click', (e) => this.onPaletteClick(e));
      el.addEventListener('input', (e) => this.onPaletteInput(e, false));
      el.addEventListener('change', (e) => this.onPaletteInput(e, true));
      this.viewportEl.appendChild(el);
      this.paletteEl = el;
      this.renderPalette();
    }
    const visible = show ?? this.paletteEl.style.display !== 'block';
    if (visible) {
      // 今の材料の分類を開く
      const cur = materialOf(this.paintColor);
      this.paletteCat = cur ? cur.category : this.paintColor.startsWith('#') ? '色' : this.paletteCat;
      this.renderPalette();
    }
    this.paletteEl.style.display = visible ? 'block' : 'none';
  }

  /** パレットの中身を作り直す */
  renderPalette(): void {
    const el = this.paletteEl;
    if (!el) return;
    const cur = materialOf(this.paintColor);
    const cats: (MaterialCategory | '色')[] = [...MATERIAL_CATEGORIES, '色'];
    const list = allMaterials().filter((m) => m.category === this.paletteCat);
    const scroll = el.querySelector('.palette-body')?.scrollTop ?? 0;
    el.innerHTML = `
      <div class="palette-head"><b>材料・色を選ぶ</b><button data-close title="閉じる">×</button></div>
      <div class="palette-tabs">${cats.map((c) => `<button data-cat="${c}" class="${c === this.paletteCat ? 'active' : ''}">${esc(c)}</button>`).join('')}</div>
      <div class="palette-body">
      ${
        this.paletteCat === '色'
          ? `<div class="palette-colors">
          ${['#f4f2ea', '#ffffff', '#d9d4c7', '#9aa3ab', '#4a4f55', '#2b2d30', '#c8a46e', '#8c5a3c', '#a33b2b', '#d9a441', '#5f8f4e', '#3e6e9e']
            .map((c) => `<button data-col="${c}" style="background:${c}" title="${c}" class="${this.paintColor === c ? 'active' : ''}"></button>`)
            .join('')}
          <input type="color" data-custom value="${this.paintColor.startsWith('#') ? this.paintColor : '#c8a46e'}" title="好きな色">
        </div>
        <p class="muted small">模様のない単色で塗ります。模様つきの材料の色を変えたいときは、材料を選んで下の「色」を変えてください。</p>`
          : `<div class="palette-grid">
          ${list
            .map(
              (m) =>
                `<button data-mat="${m.id}" title="${esc(m.name)}" class="${cur?.id === m.id ? 'active' : ''}"><img src="${materialSwatch(m)}" alt=""><span>${m.custom ? '★ ' : ''}${esc(m.name)}${isMaterialModified(m.id) ? ' *' : ''}</span></button>`,
            )
            .join('')}
        </div>`
      }
      ${cur && cur.category === this.paletteCat ? this.materialEditorHtml(cur) : ''}
      </div>
      <div class="row"><button data-apply class="primary">選択中の面に塗る</button></div>
      <p class="muted small">選んでから面をクリックすると塗れます。選択中の面にまとめて塗ることもできます。</p>`;
    const body = el.querySelector('.palette-body');
    if (body) body.scrollTop = scroll;
  }

  private materialEditorHtml(m: MaterialDef): string {
    const base = builtinMaterial(m.id);
    return `<div class="material-editor" data-edit="${m.id}">
      <div class="editor-title"><img src="${materialSwatch(m)}" alt=""><b>${esc(m.name)}</b></div>
      <label class="form-row"><span>名前</span><input data-ed-name value="${esc(m.name)}"></label>
      <label class="form-row"><span>色</span><input type="color" data-ed-color value="${m.color}"></label>
      <label class="form-row"><span>模様の大きさ</span><select data-ed-tile>
        ${[0.5, 0.75, 1, 1.5, 2]
          .map((k) => {
            const t = Math.round((base?.tile ?? m.tile) * k * 100) / 100;
            return `<option value="${t}" ${Math.abs(t - m.tile) < 0.005 ? 'selected' : ''}>${k === 1 ? '標準' : `${k} 倍`}（${t} m）</option>`;
          })
          .join('')}
        ${[0.5, 0.75, 1, 1.5, 2].some((k) => Math.abs((base?.tile ?? m.tile) * k - m.tile) < 0.005) ? '' : `<option selected value="${m.tile}">${m.tile} m</option>`}
      </select></label>
      <div class="row wrap">
        ${base && isMaterialModified(m.id) ? '<button data-ed-reset>最初の色・名前に戻す</button>' : ''}
        <button data-ed-copy>これをもとに新しい材料を作る</button>
        ${m.custom ? '<button data-ed-del class="danger">この材料を削除</button>' : ''}
      </div>
      <div class="row wrap"><button data-ed-default>今の材料の設定を、新しいプロジェクトでも使う</button></div>
      <p class="muted small">色を変えると、この材料を塗ったすべての面が変わります。設定はプロジェクトに保存されます。</p>
    </div>`;
  }

  private onPaletteClick(e: Event): void {
    const b = (e.target as HTMLElement).closest('button');
    if (!b) return;
    const app = this.app;
    const editing = (b.closest('[data-edit]') as HTMLElement | null)?.dataset.edit;
    if (b.dataset.close !== undefined) return this.togglePalette(false);
    if (b.dataset.apply !== undefined) return app.paintSelection(this.paintColor);
    if (b.dataset.cat) {
      this.paletteCat = b.dataset.cat as MaterialCategory | '色';
      return this.renderPalette();
    }
    if (editing) {
      const m = getMaterial(editing)!;
      if (b.dataset.edReset !== undefined) resetMaterial(editing);
      if (b.dataset.edCopy !== undefined) {
        const d = addCustomMaterial(m, `${m.name.replace(/^★ /, '')}（コピー）`, m.color);
        this.setPaintColor(MAT_PREFIX + d.id);
        this.toast('新しい材料を作りました。名前と色を変えてください');
      }
      if (b.dataset.edDel !== undefined) {
        removeCustomMaterial(editing);
        this.setPaintColor(MAT_PREFIX + 'plaster-white');
      }
      if (b.dataset.edDefault !== undefined) {
        writeMaterialDefaults(materialSettings());
        this.toast('この端末で新しく作るプロジェクトでも、今の材料の色と自分の材料を使います');
      }
      return this.renderPalette();
    }
    const v = b.dataset.mat ? MAT_PREFIX + b.dataset.mat : b.dataset.col;
    if (!v) return;
    this.setPaintColor(v);
    this.renderPalette();
    if (app.tool.def.id !== 'paint') app.setTool('paint');
  }

  /** 色・名前・大きさの変更（final=false はドラッグ中。描き直しは軽く、パレットは作り直さない） */
  private onPaletteInput(e: Event, final: boolean): void {
    const t = e.target as HTMLInputElement;
    if (t.dataset.custom !== undefined) {
      this.setPaintColor(t.value);
      if (this.app.tool.def.id !== 'paint') this.app.setTool('paint');
      return;
    }
    const id = (t.closest('[data-edit]') as HTMLElement | null)?.dataset.edit;
    if (!id) return;
    if (t.dataset.edColor !== undefined) setMaterialOverride(id, { color: t.value });
    else if (t.dataset.edTile !== undefined) setMaterialOverride(id, { tile: Number(t.value) });
    else if (t.dataset.edName !== undefined) {
      if (!final) return;
      setMaterialOverride(id, { name: t.value.trim() || '自分の材料' });
    } else return;
    this.setPaintColor(MAT_PREFIX + id);
    if (final) this.renderPalette();
  }

  private fullviewBar: HTMLDivElement | null = null;

  /**
   * モデルだけを全画面で表示（メニュー・パネル・ツールを隠す）。スマホなど小さな画面向け。
   * 右上の小さなボタンで「全体表示」「立ち位置」「戻る」だけ使える。
   */
  setModelOnly(on: boolean): void {
    const app = this.app;
    this.root.classList.toggle('model-only', on);
    this.root.classList.remove('panel-open');
    if (on) {
      if (!this.fullviewBar) {
        const bar = h('div', { class: 'fullview-bar' });
        bar.innerHTML = `
          <button data-fv="zoom" title="全体を表示">${ICONS.zoom}</button>
          <button data-fv="walk" title="立ち位置（床をタップしてそこに立つ）">${ICONS.walk}</button>
          <button data-fv="exit" class="fv-exit" title="全画面を終わる">✕ 戻る</button>`;
        bar.addEventListener('click', (e) => {
          const b = (e.target as HTMLElement).closest('button');
          if (!b) return;
          if (b.dataset.fv === 'zoom') app.zoomExtents();
          if (b.dataset.fv === 'walk') {
            if (app.tool.def.id === 'walk') app.setTool('select');
            else app.setTool('walk');
            b.classList.toggle('on', app.tool.def.id === 'walk');
            if (app.tool.def.id !== 'walk') app.viewport.setNavigationMode(app.presentation.active ? 'orbit' : 'default');
          }
          if (b.dataset.fv === 'exit') this.setModelOnly(false);
        });
        this.viewportEl.appendChild(bar);
        this.fullviewBar = bar;
      }
      this.fullviewBar.hidden = false;
      // 指 1 本で回せるように（立ち位置のときはそのまま）
      if (app.tool.def.id !== 'walk') app.viewport.setNavigationMode('orbit');
      document.documentElement.requestFullscreen?.().catch(() => {});
      this.toast('モデルだけを表示しています。右上の「✕ 戻る」で元に戻ります', 4000);
    } else {
      if (this.fullviewBar) this.fullviewBar.hidden = true;
      if (app.tool.def.id === 'walk') app.setTool('select');
      app.viewport.setNavigationMode(app.presentation.active ? 'orbit' : 'default');
      if (document.fullscreenElement) void document.exitFullscreen?.().catch(() => {});
    }
    app.viewport.refreshSize();
  }

  /** 保存のしかたの選択状態（メニューの ✓） */
  refreshSaveMode(): void {
    const mode = saveMode();
    this.root.querySelectorAll<HTMLButtonElement>('.save-mode').forEach((b) => {
      const on = b.dataset.act === `save-mode-${mode}`;
      b.classList.toggle('checked', on);
      b.textContent = `${on ? '✓ ' : '　 '}${b.textContent!.replace(/^(✓ |　 )/, '')}`;
    });
  }

  /** 「アプリにする」ボタンの表示（ブラウザがインストールできると知らせてきたとき） */
  setInstallable(on: boolean): void {
    const b = this.root.querySelector<HTMLButtonElement>('[data-act=install]');
    if (b) b.hidden = !on || isStandalone();
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

  /**
   * 図面の読み込み設定。
   * 図面シート（平面図・立面図・断面図として配置）か、平面図の線をモデルに取り込むかを選ぶ。
   */
  async sheetImportDialog(
    fileName: string,
    d: Drawing2D | null,
    isPdf: boolean,
    presetView?: SheetView,
  ): Promise<{
    mode: 'sheet' | 'model';
    name: string;
    view: SheetView;
    lines?: SheetLineOptions;
    model?: DrawingImportOptions;
    page: number;
    scale: number;
  } | null> {
    const guess: SheetView =
      presetView ??
      (/断面|section|sect/i.test(fileName)
        ? 'section'
        : /南|south/i.test(fileName)
          ? 'south'
          : /北|north/i.test(fileName)
            ? 'north'
            : /東|east/i.test(fileName)
              ? 'east'
              : /西|west/i.test(fileName)
                ? 'west'
                : /立面|elev/i.test(fileName)
                  ? 'south'
                  : 'plan');
    const views = Object.entries(VIEW_LABEL) as [SheetView, string][];
    const body = h('div', { class: 'form' });
    const viewSelect = `<label class="form-row"><span>図面の種類</span><select data-k="view">
        ${views.map(([v, l]) => `<option value="${v}" ${v === guess ? 'selected' : ''}>${l}</option>`).join('')}
      </select></label>`;
    const nameRow = `<label class="form-row"><span>名前</span><input data-k="name" type="text" value="${esc(fileName.replace(/\.[^.]+$/, ''))}"></label>`;
    if (!d) {
      body.innerHTML = `
        <p class="modal-text">${isPdf ? 'PDF' : '画像'}を図面シート（下図）として配置します。線・長方形ツールでなぞったり、プッシュ/プルで高さを合わせたりできます。</p>
        ${nameRow}${viewSelect}
        ${
          isPdf
            ? `<label class="form-row"><span>ページ</span><input data-k="page" type="text" value="1"></label>
               <label class="form-row"><span>図面の縮尺 1/</span><input data-k="scale" type="text" value="100"></label>
               <p class="muted">縮尺を入れると用紙サイズから実寸で配置します。あとで「縮尺合わせ」で寸法の分かる 2 点から補正できます。</p>`
            : '<p class="muted">画像は縮尺が分からないので幅 20m で置きます。配置後に「縮尺合わせ」をしてください。</p>'
        }`;
    } else {
      const w = d.max[0] - d.min[0];
      const hgt = d.max[1] - d.min[1];
      const guessUnit = d.unitHint ?? (Math.max(Math.abs(d.min[0]), Math.abs(d.min[1])) > 1000 && w < 5000 ? 'm' : w > 2000 ? 'mm' : 'm');
      const looksPublic = Math.max(Math.abs(d.min[0]), Math.abs(d.min[1])) > 1000 && guessUnit === 'm';
      const noise = /寸法|DIM|文字|TEXT|ハッチ|HATCH|旗|引出|注記|図枠|枠|表題/i;
      body.innerHTML = `
        <p class="modal-text">${esc(d.source)}: 線 ${d.paths.length.toLocaleString()} 本、文字 ${d.texts.length} 個　範囲 ${w.toLocaleString(undefined, { maximumFractionDigits: 2 })} × ${hgt.toLocaleString(undefined, { maximumFractionDigits: 2 })}（図面単位）
        ${d.warnings.length ? `<br><span class="warn">${d.warnings.map(esc).join('<br>')}</span>` : ''}</p>
        <label class="form-row"><span>取り込み方</span><select data-k="mode">
          <option value="sheet" selected>図面シートとして配置（外形から立体化・スナップ用）</option>
          <option value="model">平面図の線をモデルに取り込む（面を張ってレイヤーごとに押し出し）</option>
        </select></label>
        ${nameRow}${viewSelect}
        <label class="form-row"><span>図面の単位</span>
          <select data-k="unit">
            <option value="0.001" ${guessUnit === 'mm' ? 'selected' : ''}>mm</option>
            <option value="0.01" ${guessUnit === 'cm' ? 'selected' : ''}>cm</option>
            <option value="1" ${guessUnit === 'm' ? 'selected' : ''}>m</option>
          </select></label>
        <label class="form-row" data-plan-only><span>座標（平面図）</span>
          <select data-k="geo">
            <option value="local" ${looksPublic ? '' : 'selected'}>ローカル（図面の左下を原点に）</option>
            <option value="public" ${looksPublic ? 'selected' : ''}>公共座標（図面の X=東, Y=北 の平面直角座標）</option>
          </select></label>
        <label class="form-row" data-plan-only><span>置く高さ（標高 m）</span><input data-k="elev" type="text" value="0"></label>
        <p class="muted">立面図・断面図は建物（平面図）の横に自動で立てて配置し、図面の一番下を高さ 0（GL）に置きます。</p>
        <p class="modal-text"><b>画層</b>（寸法・文字・ハッチングは外すと外形が取りやすくなります。「面」はモデルに取り込む場合だけ使います）</p>
        <div class="layer-table">
          <div class="layer-head"><span>読込</span><span>面</span><span>画層</span><span>数</span></div>
          ${d.layers
            .map(
              (l, i) => `<label class="layer-line">
                <input type="checkbox" data-layer="${i}" ${noise.test(l.name) ? '' : 'checked'}>
                <input type="checkbox" data-face="${i}" ${noise.test(l.name) || /通り|芯|GL|基準/i.test(l.name) ? '' : 'checked'}>
                <span><i class="swatch" style="background:${l.color}"></i>${esc(l.name)}</span>
                <span>${l.count}</span></label>`,
            )
            .join('')}
        </div>`;
      const sync = () => {
        const isPlan = body.querySelector<HTMLSelectElement>('[data-k=view]')!.value === 'plan';
        body.querySelectorAll<HTMLElement>('[data-plan-only]').forEach((el) => (el.style.display = isPlan ? '' : 'none'));
      };
      body.querySelector('[data-k=view]')!.addEventListener('change', sync);
      sync();
    }
    const res = await this.modal(`図面の読み込み: ${fileName}`, body, [
      ['ok', '読み込む'],
      ['cancel', 'キャンセル'],
    ]);
    if (res !== 'ok') return null;
    const q = (k: string) => body.querySelector<HTMLInputElement | HTMLSelectElement>(`[data-k=${k}]`)?.value ?? '';
    const view = q('view') as SheetView;
    const out = {
      mode: (q('mode') || 'sheet') as 'sheet' | 'model',
      name: q('name') || fileName,
      view,
      page: Number(q('page')) || 1,
      scale: Number(q('scale')) || 100,
    } as NonNullable<Awaited<ReturnType<UI['sheetImportDialog']>>>;
    if (d) {
      const layers = new Set<string>();
      const faceLayers = new Set<string>();
      d.layers.forEach((l, i) => {
        if (body.querySelector<HTMLInputElement>(`[data-layer="${i}"]`)!.checked) layers.add(l.name);
        if (body.querySelector<HTMLInputElement>(`[data-face="${i}"]`)!.checked) faceLayers.add(l.name);
      });
      const unitToMeters = Number(q('unit'));
      const georeferenced = view === 'plan' && q('geo') === 'public';
      const elevation = view === 'plan' ? Number(q('elev')) || 0 : 0;
      out.lines = { unitToMeters, layers, georeferenced, elevation };
      out.model = { unitToMeters, layers, georeferenced, elevation, faceLayers };
    }
    return out;
  }

  // ------------------------------------------------------------------
  // タブレット用の操作ボタン・右クリックメニュー
  // ------------------------------------------------------------------

  /** キーボードの無いタブレットでも操作できるよう、画面上に Esc / Enter などのボタンを出す */
  private buildTouchBar(): void {
    const app = this.app;
    const bar = h('div', { class: 'touchbar' });
    const items: [string, string, () => void][] = [
      ['取消', 'Esc（操作の取り消し）', () => (app.tool.def.id === 'select' && app.model.activeGroup ? app.exitGroup() : app.tool.reset())],
      ['確定', 'Enter（図面から立体などの確定）', () => app.tool.onKeyDown(new KeyboardEvent('keydown', { key: 'Enter' }))],
      ['元に戻す', 'Ctrl+Z', () => app.undo()],
      ['削除', '選択を削除', () => app.deleteSelection()],
      ['回転', '視点の回転（1 本指ドラッグ）', () => app.setTool(app.tool.def.id === 'orbit' ? 'select' : 'orbit')],
      ['全体', '全体表示', () => app.zoomExtents()],
    ];
    for (const [label, title, fn] of items) {
      const b = h('button', { title }, esc(label));
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        fn();
      });
      bar.appendChild(b);
    }
    this.viewportEl.appendChild(bar);
  }

  /** PC: 右クリック（ドラッグしなかった場合）でメニュー。右ドラッグはパン */
  private buildContextMenu(): void {
    const app = this.app;
    const menu = h('div', { class: 'context-menu' });
    this.viewportEl.appendChild(menu);
    const close = () => (menu.style.display = 'none');
    let down: { x: number; y: number } | null = null;
    this.viewportEl.addEventListener('pointerdown', (e) => {
      close();
      if (e.button === 2) down = { x: e.clientX, y: e.clientY };
    });
    this.viewportEl.addEventListener('pointerup', (e) => {
      if (e.button !== 2 || !down) return;
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4;
      down = null;
      if (moved) return;
      const sel = app.selection;
      const g = app.selectedGroup();
      const items: [string, (() => void) | null][] = [
        ['全体表示', () => app.zoomExtents()],
        ['すべて選択', () => sel.selectAll()],
        ['選択を解除', sel.isEmpty ? null : () => sel.clear()],
        ['削除', sel.isEmpty ? null : () => app.deleteSelection()],
        ['グループにする', sel.isEmpty || app.model.activeGroup ? null : () => app.makeGroupFromSelection()],
        ['グループの中を編集', g ? () => app.enterGroup(g) : null],
        ['グループを解除', g ? () => app.explodeSelectedGroup() : null],
        ['グループの編集を終了', app.model.activeGroup ? () => app.exitGroup() : null],
        [
          '面の向きを反転',
          sel.faces.size
            ? () => {
                for (const id of sel.faces) app.model.reverseFace(id);
                app.history.commit('面の反転');
              }
            : null,
        ],
      ];
      menu.innerHTML = '';
      for (const [label, fn] of items) {
        const b = h('button', {}, esc(label));
        if (!fn) b.disabled = true;
        else
          b.addEventListener('click', () => {
            close();
            fn();
          });
        menu.appendChild(b);
      }
      const p = app.viewport.toCanvas(e.clientX, e.clientY);
      const r = this.viewportEl.getBoundingClientRect();
      menu.style.display = 'block';
      menu.style.left = `${Math.min(p.x, r.width - 200)}px`;
      menu.style.top = `${Math.min(p.y, r.height - menu.offsetHeight - 8)}px`;
    });
    window.addEventListener('keydown', (e) => e.key === 'Escape' && close());
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
    this.refreshPanel(['entity', 'layers', 'geo', 'pointclouds', 'sheets', 'furniture', 'present', 'help']);
  }

  private refreshPanel(ids: PanelId[]): void {
    for (const id of ids) {
      // 非表示のパネルは表示時に描き直す
      if (id !== this.currentPanel) continue;
      const body = this.panelBodies.get(id);
      if (!body) continue;
      // 入力中の要素があれば描き直さない（入力が消えるため）
      const ae = document.activeElement as HTMLInputElement | null;
      if (ae && body.contains(ae) && ae.tagName === 'INPUT' && (ae.type === 'text' || ae.type === '')) continue;
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
        case 'sheets':
          this.renderSheets(body);
          break;
        case 'furniture':
          this.renderFurniture(body);
          break;
        case 'present':
          this.renderPresent(body);
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

  private renderSheets(body: HTMLDivElement): void {
    const sm = this.app.sheets;
    const views = Object.entries(VIEW_LABEL) as [SheetView, string][];
    body.innerHTML = `
      <h3>図面シート</h3>
      <div class="row"><button data-add class="primary">図面を読み込む…</button><button data-sample>サンプル</button></div>
      ${
        sm.items.length
          ? ''
          : `<p class="muted">平面図は地面に、立面図・断面図は建物の横に立てて配置します。DXF / SXF / JWW の線にはスナップでき、
             「図面から立体」ツール（K）で外形をクリックしていくと、重なった部分が立体になります。PDF・画像は下図としてなぞれます。</p>`
      }
      ${sm.items
        .map(
          (s) => `<div class="pc-item" data-id="${s.id}">
            <div class="row"><input type="checkbox" data-vis ${s.visible ? 'checked' : ''} title="表示"><b class="grow" title="${esc(s.name)}">${esc(s.name)}</b><button data-del title="削除">×</button></div>
            <label class="form-row"><span>種類</span><select data-view>
              ${views.map(([v, l]) => `<option value="${v}" ${s.view === v ? 'selected' : ''}>${l}</option>`).join('')}
            </select></label>
            <div class="muted small">${s.segments ? `線 ${(s.segments.length / 4).toLocaleString()} 本` : '画像'}　${formatLength(s.width * s.scale, 'm')} × ${formatLength(s.height * s.scale, 'm')}</div>
            ${s.image ? `<label class="form-row"><span>不透明度</span><input type="range" min="0.1" max="1" step="0.05" value="${s.opacity}" data-op></label>` : ''}
            <div class="btn-grid">
              <button data-mode="move" title="図面の基準点をクリック → 合わせ先をクリック">位置合わせ</button>
              <button data-mode="height" title="GL などの点をクリックして高さを指定">高さ合わせ（GL）</button>
              <button data-mode="scale" title="寸法の分かる 2 点で縮尺を補正">縮尺合わせ</button>
              <button data-mode="rotate">回転</button>
              ${s.view === 'plan' ? '<button data-mode="known">既知座標に合わせる</button>' : ''}
              <button data-flip title="図面の左右の向きを 180° 反転（北立面⇔南立面など）">向きを反転</button>
            </div>
          </div>`,
        )
        .join('')}`;
    body.querySelector('[data-add]')!.addEventListener('click', () => this.pickFile('sheet'));
    body.querySelector('[data-sample]')!.addEventListener('click', () => void this.app.loadHouseSample());
    body.querySelectorAll<HTMLDivElement>('.pc-item').forEach((row) => {
      const s = sm.items.find((x) => x.id === Number(row.dataset.id))!;
      row.querySelector<HTMLInputElement>('[data-vis]')!.addEventListener('change', (e) => {
        s.visible = (e.target as HTMLInputElement).checked;
        sm.apply(s);
      });
      row.querySelector('[data-del]')!.addEventListener('click', () => sm.remove(s));
      row.querySelector<HTMLInputElement>('[data-op]')?.addEventListener('input', (e) => {
        s.opacity = Number((e.target as HTMLInputElement).value);
        sm.apply(s);
      });
      row.querySelector<HTMLSelectElement>('[data-view]')!.addEventListener('change', (e) => {
        // 種類を変えたら向きを付け直し、建物の横に置き直す
        s.view = (e.target as HTMLSelectElement).value as SheetView;
        s.angle = (VIEW_ANGLE[s.view] * Math.PI) / 180;
        if (s.view !== 'plan') sm.autoPlace(s, this.app.sheets.boundingBox((x) => x.visible && x.view === 'plan' && x !== s).union(this.app.model.boundingBox()));
        else s.origin = [s.origin[0], 0, s.origin[2]];
        sm.apply(s);
      });
      row.querySelector('[data-flip]')!.addEventListener('click', () => {
        const c = sm.toWorld(s, s.width / 2, s.height / 2);
        sm.rotate(s, c, Math.PI);
      });
      row.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach((b) =>
        b.addEventListener('click', () => this.app.adjustSheet(s, b.dataset.mode as SheetAdjustMode)),
      );
    });
  }

  /** プレゼン表示に入った／出た */
  setPresenting(on: boolean): void {
    this.root.classList.toggle('presenting', on);
    const b = this.root.querySelector<HTMLButtonElement>('[data-act=present] span');
    if (b) b.textContent = on ? '編集に戻る' : 'プレゼン資料を作る';
    if (on) {
      this.showPanel('present');
      this.root.classList.add('panel-open');
      this.setHint('左ドラッグで視点を回す・右ドラッグで移動・ホイールでズーム。右の「プレゼン」パネルで ① 見た目 → ② 視点 → ③ 書き出し');
    } else {
      this.app.tool.updateStatus();
    }
  }

  private renderPresent(body: HTMLDivElement): void {
    const app = this.app;
    const p = app.presentation;
    const st = p.settings;
    if (!p.active) {
      body.innerHTML = `
        <h3>プレゼン資料を作る</h3>
        <p class="muted">作った 3D モデルを、写真のような画像・白模型・スケッチ風の絵にして、PowerPoint・PDF・画像・動画で書き出せます。初めてでも 3 つの手順で完成します。</p>
        <ol class="steps"><li>見た目を選ぶ</li><li>視点を決める（自動でも作れます）</li><li>書き出す</li></ol>
        <div class="row"><button data-start class="primary">はじめる</button></div>`;
      body.querySelector('[data-start]')!.addEventListener('click', () => app.enterPresentation());
      return;
    }
    const sun = p.sun();
    const hh = Math.floor(st.hour);
    const mm = Math.round((st.hour - hh) * 60);
    const styles = Object.entries(STYLE_LABEL) as [RenderSettings['style'], { name: string; desc: string }][];
    const sizes = Object.entries(IMAGE_SIZES) as [ImageSizeKey, { label: string }][];
    body.innerHTML = `
      <h3><span class="step-no">1</span>見た目を選ぶ</h3>
      <div class="style-cards">
        ${styles
          .map(
            ([id, s]) => `<button class="style-card ${st.style === id ? 'active' : ''}" data-style-pick="${id}">
              <b>${s.name}</b><span>${s.desc}</span></button>`,
          )
          .join('')}
      </div>
      ${
        st.style === 'real'
          ? `<label class="form-row"><span>おまかせ仕上げ</span><select data-preset>
              ${FINISH_PRESETS.map((f) => `<option value="${f.id}">${esc(f.name)}</option>`).join('')}
            </select></label>
            <div class="row"><button data-finish class="primary">壁・屋根・窓に材料を付ける</button><button data-paint>手で塗る</button></div>
            <p class="muted small">面の向きから外壁・屋根・窓（押し込んだ開口）・地面を自動で判定します。選択中の面があればその面だけ。あとから「手で塗る」で個別に変えられます。</p>`
          : ''
      }
      <label class="form-row"><span>日時（日本時間）</span>
        <span class="row tight">
          <select data-month>${Array.from({ length: 12 }, (_, i) => `<option value="${i + 1}" ${st.month === i + 1 ? 'selected' : ''}>${i + 1}月</option>`).join('')}</select>
          <select data-day>${[1, 5, 10, 15, 20, 21, 25].map((d) => `<option value="${d}" ${st.day === d ? 'selected' : ''}>${d}日</option>`).join('')}</select>
        </span></label>
      <label class="form-row"><span>時刻 <b data-time>${hh}:${String(mm).padStart(2, '0')}</b></span>
        <input type="range" min="6" max="18" step="0.25" value="${st.hour}" data-hour></label>
      <p class="muted small">太陽の高さ ${sun.altitude.toFixed(0)}°・方位 ${sun.azimuth.toFixed(0)}°（モデルの位置の緯度経度で計算）${sun.altitude < 4 ? '　<b>太陽が沈んでいます</b>' : ''}</p>
      <div class="row wrap">
        <button data-preset-time="4,20,10">春の朝</button>
        <button data-preset-time="6,21,12">夏の昼</button>
        <button data-preset-time="10,15,15.5">秋の午後</button>
        <button data-preset-time="12,21,12">冬至の昼</button>
      </div>
      <label class="form-row"><span>地面</span><select data-ground>
        ${[
          ['grass', '芝生'],
          ['paving', '舗装（タイル）'],
          ['plain', '無地'],
          ['none', 'なし'],
        ]
          .map(([v, l]) => `<option value="${v}" ${st.ground === v ? 'selected' : ''}>${l}</option>`)
          .join('')}
      </select></label>
      <div class="checks">
        <label><input type="checkbox" data-opt="shadows" ${st.shadows ? 'checked' : ''}> 影</label>
        <label><input type="checkbox" data-opt="edges" ${st.edges ? 'checked' : ''}> 線を表示</label>
        <label><input type="checkbox" data-opt="high" ${st.high ? 'checked' : ''}> 高品質（陰影を強調）</label>
        <label><input type="checkbox" data-opt="showPointClouds" ${st.showPointClouds ? 'checked' : ''}> 点群</label>
        <label><input type="checkbox" data-opt="showSheets" ${st.showSheets ? 'checked' : ''}> 図面</label>
        <label><input type="checkbox" data-opt="interiorLights" ${st.interiorLights !== false ? 'checked' : ''}> 室内の照明を点ける</label>
      </div>

      <h3><span class="step-no">2</span>視点を決める</h3>
      <div class="row wrap"><button data-auto class="primary">おすすめの視点を自動で作る</button><button data-add>今の視点を追加</button></div>
      <div class="row wrap"><button data-walk class="${app.tool.def.id === 'walk' ? 'primary' : ''}">${app.tool.def.id === 'walk' ? '立ち位置モードを終わる' : '立ち位置を選ぶ（中に入って見る）'}</button></div>
      <div class="row wrap"><button data-open-furniture>家具・設備を置く…</button></div>
      <p class="muted small">「立ち位置を選ぶ」→ 床をクリックするとそこに立ち、ドラッグでその場から見回せます（外に出ません）。ホイールや ↑↓ で歩き、気に入ったら「今の視点を追加」。</p>
      <p class="muted small">画面を左ドラッグで回し、ホイールで寄って、気に入った角度で「今の視点を追加」。視点はレイヤーの表示も覚えるので、「レイヤー」で屋根を隠してから追加すると中が見える視点になります。</p>
      <div class="scene-list">
        ${app.scenes.items
          .map(
            (sc, i) => `<div class="scene-item" data-id="${sc.id}">
              <button class="scene-thumb" data-go title="この視点を見る">${sc.thumbnail ? `<img src="${sc.thumbnail}" alt="">` : '<span>▶</span>'}</button>
              <div class="scene-meta">
                <input data-name value="${esc(sc.name)}" aria-label="シーン名">
                ${sc.hiddenLayers?.length ? `<span class="muted small">非表示: ${esc(sc.hiddenLayers.join('・'))}</span>` : ''}
                <div class="row tight">
                  <button data-up title="前へ" ${i === 0 ? 'disabled' : ''}>↑</button>
                  <button data-down title="後へ" ${i === app.scenes.items.length - 1 ? 'disabled' : ''}>↓</button>
                  <button data-update title="今の視点で上書き">更新</button>
                  <button data-del title="削除">×</button>
                </div>
              </div>
            </div>`,
          )
          .join('')}
      </div>

      <h3><span class="step-no">3</span>書き出す</h3>
      <label class="form-row"><span>画像の大きさ</span><select data-size>
        ${sizes.map(([k, v]) => `<option value="${k}" ${k === this.exportSize ? 'selected' : ''}>${v.label}</option>`).join('')}
      </select></label>
      <div class="checks">
        <label><input type="checkbox" data-caption ${this.exportCaption ? 'checked' : ''}> 右下に名前と日付を入れる</label>
        <label><input type="checkbox" data-transparent ${this.exportTransparent ? 'checked' : ''}> 背景を透明に（画像のみ）</label>
      </div>
      <div class="export-grid">
        <button data-exp-pptx class="primary">PowerPoint（.pptx）</button>
        <button data-exp-pdf>PDF</button>
        <button data-exp-zip>全視点の画像（ZIP）</button>
        <button data-exp-png>今の画面を画像に</button>
        <button data-exp-video>動画（視点をめぐる）</button>
        <button data-slideshow>スライドショー</button>
      </div>
      <p class="muted small">視点が 1 つも無いときは、おすすめの視点を自動で作ってから書き出します。プロジェクト名（ファイル名）は「保存」時の名前です: <b>${esc(app.projectName)}</b></p>
      <div class="row"><button data-exit>編集に戻る</button></div>`;

    const $ = <T extends HTMLElement>(sel: string) => body.querySelector<T>(sel);
    body.querySelectorAll<HTMLButtonElement>('[data-style-pick]').forEach((b) =>
      b.addEventListener('click', () => {
        const style = b.dataset.stylePick as RenderSettings['style'];
        // 白模型は線があると形が読みやすい。リアルは線なしが自然
        app.updateRender({ style, edges: style === 'white' });
        this.refreshPanel(['present']);
      }),
    );
    $('[data-finish]')?.addEventListener('click', () => app.applyAutoFinish($<HTMLSelectElement>('[data-preset]')!.value));
    $('[data-paint]')?.addEventListener('click', () => app.setTool('paint'));
    const setTime = () => {
      app.updateRender({
        month: Number($<HTMLSelectElement>('[data-month]')!.value),
        day: Number($<HTMLSelectElement>('[data-day]')!.value),
        hour: Number($<HTMLInputElement>('[data-hour]')!.value),
      });
    };
    $('[data-month]')!.addEventListener('change', () => (setTime(), this.refreshPanel(['present'])));
    $('[data-day]')!.addEventListener('change', () => (setTime(), this.refreshPanel(['present'])));
    $<HTMLInputElement>('[data-hour]')!.addEventListener('input', (e) => {
      const v = Number((e.target as HTMLInputElement).value);
      const h = Math.floor(v);
      $('[data-time]')!.textContent = `${h}:${String(Math.round((v - h) * 60)).padStart(2, '0')}`;
      setTime();
    });
    $('[data-hour]')!.addEventListener('change', () => this.refreshPanel(['present']));
    body.querySelectorAll<HTMLButtonElement>('[data-preset-time]').forEach((b) =>
      b.addEventListener('click', () => {
        const [m, d, h] = b.dataset.presetTime!.split(',').map(Number);
        app.updateRender({ month: m, day: d, hour: h });
        this.refreshPanel(['present']);
      }),
    );
    $<HTMLSelectElement>('[data-ground]')!.addEventListener('change', (e) => app.updateRender({ ground: (e.target as HTMLSelectElement).value as RenderSettings['ground'] }));
    body.querySelectorAll<HTMLInputElement>('[data-opt]').forEach((c) =>
      c.addEventListener('change', () => app.updateRender({ [c.dataset.opt!]: c.checked } as Partial<RenderSettings>)),
    );
    $('[data-auto]')!.addEventListener('click', () => app.autoScenes());
    $('[data-add]')!.addEventListener('click', () => app.addCurrentScene());
    body.querySelectorAll<HTMLDivElement>('.scene-item').forEach((row) => {
      const sc = app.scenes.items.find((x) => x.id === Number(row.dataset.id))!;
      row.querySelector('[data-go]')!.addEventListener('click', () => void app.scenes.goTo(sc));
      row.querySelector<HTMLInputElement>('[data-name]')!.addEventListener('change', (e) => {
        sc.name = (e.target as HTMLInputElement).value.trim() || sc.name;
        app.scenes.emit();
      });
      row.querySelector('[data-up]')!.addEventListener('click', () => app.scenes.move(sc, -1));
      row.querySelector('[data-down]')!.addEventListener('click', () => app.scenes.move(sc, 1));
      row.querySelector('[data-del]')!.addEventListener('click', () => app.scenes.remove(sc));
      row.querySelector('[data-update]')!.addEventListener('click', () => {
        const cam = app.viewport.camera.position;
        const t = app.viewport.controls.target;
        sc.position = [cam.x, cam.y, cam.z];
        sc.target = [t.x, t.y, t.z];
        sc.hiddenLayers = app.scenes.layerState?.get();
        void app.makeThumbnails([sc]);
      });
    });
    $<HTMLSelectElement>('[data-size]')!.addEventListener('change', (e) => (this.exportSize = (e.target as HTMLSelectElement).value as ImageSizeKey));
    $<HTMLInputElement>('[data-caption]')!.addEventListener('change', (e) => (this.exportCaption = (e.target as HTMLInputElement).checked));
    $<HTMLInputElement>('[data-transparent]')!.addEventListener('change', (e) => (this.exportTransparent = (e.target as HTMLInputElement).checked));
    const opts = () => ({ size: this.exportSize, caption: this.exportCaption, transparent: this.exportTransparent });
    const run = (label: string, fn: (progress: (i: number, n: number) => void) => Promise<boolean>) => async () => {
      if (app.model.isEmpty()) return this.toast('モデルがありません');
      try {
        // 保存場所を選ぶ画面は、クリック直後に開く（fn の最初）
        const done = await fn((i, n) => this.toast(`${label}を作成しています… ${i + 1} / ${n}`, 60000));
        this.toast(done ? `${label}を書き出しました` : '書き出しを取りやめました');
      } catch (err) {
        if ((err as Error).name === 'AbortError') return this.toast('書き出しを取りやめました');
        console.error(err);
        this.alert('書き出しエラー', esc(String((err as Error).message ?? err)));
      }
    };
    $('[data-exp-pptx]')!.addEventListener('click', run('PowerPoint', (pr) => exportPptx(app, opts(), pr)));
    $('[data-exp-pdf]')!.addEventListener('click', run('PDF', (pr) => exportPdf(app, opts(), pr)));
    $('[data-exp-zip]')!.addEventListener('click', run('画像', (pr) => exportImagesZip(app, opts(), pr)));
    $('[data-exp-png]')!.addEventListener('click', run('画像', () => exportCurrentImage(app, opts())));
    $('[data-exp-video]')!.addEventListener('click', run('動画', (pr) => exportVideo(app, pr)));
    $('[data-slideshow]')!.addEventListener('click', () => this.startSlideshow());
    $('[data-open-furniture]')?.addEventListener('click', () => this.showPanel('furniture'));
    $('[data-walk]')?.addEventListener('click', () => {
      if (app.tool.def.id === 'walk') {
        app.setTool('select');
        app.viewport.setNavigationMode('orbit');
      } else app.setTool('walk');
      this.refreshPanel(['present']);
    });
    $('[data-exit]')!.addEventListener('click', () => app.exitPresentation());
  }

  exportSize: ImageSizeKey = 'fhd';
  exportCaption = true;
  exportTransparent = false;

  /** スライドショー: 全画面で視点を順に見せる（会議でそのまま説明できる） */
  startSlideshow(): void {
    const app = this.app;
    if (!app.scenes.items.length) app.autoScenes();
    const scenes = app.scenes.items;
    if (!scenes.length) return this.toast('視点がありません');
    let i = 0;
    const overlay = h('div', { class: 'slideshow-ui' });
    overlay.innerHTML = `
      <div class="slide-caption"></div>
      <div class="slide-controls">
        <button data-prev title="前へ（←）">◀</button>
        <span data-count></span>
        <button data-next title="次へ（→・スペース）">▶</button>
        <button data-end title="終了（Esc）">終了</button>
      </div>`;
    this.viewportEl.appendChild(overlay);
    this.root.classList.add('slideshow');
    app.viewport.refreshSize();
    const show = (k: number, animate = true) => {
      i = (k + scenes.length) % scenes.length;
      overlay.querySelector('.slide-caption')!.textContent = scenes[i].name;
      overlay.querySelector('[data-count]')!.textContent = `${i + 1} / ${scenes.length}`;
      void app.scenes.goTo(scenes[i], animate, 1600);
    };
    const end = () => {
      overlay.remove();
      this.root.classList.remove('slideshow');
      window.removeEventListener('keydown', onKey, true);
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
      setTimeout(() => app.viewport.refreshSize(), 50);
    };
    const onKey = (e: KeyboardEvent) => {
      if (['ArrowRight', ' ', 'PageDown', 'Enter'].includes(e.key)) show(i + 1);
      else if (['ArrowLeft', 'PageUp', 'Backspace'].includes(e.key)) show(i - 1);
      else if (e.key === 'Escape') end();
      else return;
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener('keydown', onKey, true);
    overlay.querySelector('[data-next]')!.addEventListener('click', () => show(i + 1));
    overlay.querySelector('[data-prev]')!.addEventListener('click', () => show(i - 1));
    overlay.querySelector('[data-end]')!.addEventListener('click', end);
    void this.root.requestFullscreen?.().catch(() => undefined).finally(() => app.viewport.refreshSize());
    show(0, false);
  }

  private furnitureCat: FurnitureCategory = '事務所';

  /** 家具・設備の一覧（選ぶと「家具を置く」ツールになる） */
  private renderFurniture(body: HTMLDivElement): void {
    const app = this.app;
    const tool = app.tools.get('furniture') as FurnitureTool;
    const active = app.tool === tool ? tool.current?.id : undefined;
    body.innerHTML = `
      <h3>家具・設備を置く</h3>
      <p class="muted small">選んでから 3D 画面をクリックすると置けます。床・壁（背中を壁に付ける）・天井（照明など）に合わせて置き、R キーで 90° 回します。置いた物はグループなので、移動・回転ツールで動かせます。色は「ペイント」で変えられます。</p>
      <div class="palette-tabs">${FURNITURE_CATEGORIES.map((c) => `<button data-fcat="${c}" class="${c === this.furnitureCat ? 'active' : ''}">${esc(c)}</button>`).join('')}</div>
      <div class="furniture-grid">
        ${FURNITURE.filter((f) => f.category === this.furnitureCat)
          .map(
            (f) => `<button data-furn="${f.id}" class="${active === f.id ? 'active' : ''}" title="${esc(f.name)}">
            ${furnitureThumb(f)}
            <span>${esc(f.name)}</span>
            <small>${f.size.map((v) => Math.round(v * 1000)).join('×')}</small>
          </button>`,
          )
          .join('')}
      </div>
      ${active ? '<div class="row"><button data-fstop>置くのを終わる（Esc）</button></div>' : ''}`;
    body.querySelectorAll<HTMLButtonElement>('[data-fcat]').forEach((b) =>
      b.addEventListener('click', () => {
        this.furnitureCat = b.dataset.fcat as FurnitureCategory;
        this.renderFurniture(body);
      }),
    );
    body.querySelectorAll<HTMLButtonElement>('[data-furn]').forEach((b) =>
      b.addEventListener('click', () => {
        if (app.tool !== tool) app.setTool('furniture');
        tool.setFurniture(b.dataset.furn!);
        this.renderFurniture(body);
        // スマホ・タブレットではパネルを閉じて置く場所を見せる
        this.root.classList.remove('panel-open');
      }),
    );
    body.querySelector('[data-fstop]')?.addEventListener('click', () => {
      app.setTool('select');
      this.renderFurniture(body);
    });
  }

  private renderHelp(body: HTMLDivElement): void {
    body.innerHTML = `
      <h3 id="install-help">デスクトップのアプリとして使う</h3>
      ${
        isStandalone()
          ? '<p class="muted">アプリとして起動しています。ネットにつながっていなくても使えます。</p>'
          : `<ol class="steps">
        <li>PC の <b>Chrome</b> か <b>Edge</b> でこのページを開く</li>
        <li>右上の「アプリにする」、またはアドレスバー右端の <b>インストール</b> アイコン（画面に↓の印）を押す</li>
        <li>「インストール」を押すと、専用のウィンドウで開き、デスクトップ・スタートメニュー（Mac は Launchpad）に <b>3DCAD</b> のアイコンができます</li>
        <li>タスクバー（Mac は Dock）のアイコンを右クリック →「タスクバーにピン留め」（Mac は「Dock に追加」）でいつでも起動</li>
      </ol>
      <p class="muted">インストール後は、ネットにつながっていなくても起動でき、.3dcad・.jww・.dxf ファイルをダブルクリック（または「プログラムから開く → 3DCAD」）で開けます。</p>
      <h4>スマホ・タブレット</h4>
      <ul class="steps">
        <li><b>iPhone・iPad</b>: Safari でこのページを開き、下（iPad は上）の共有ボタン（□に↑）→「ホーム画面に追加」→「追加」</li>
        <li><b>Android</b>: Chrome で開き、右上の「︙」→「アプリをインストール」（または「ホーム画面に追加」）</li>
      </ul>
      <p class="muted">ホーム画面の 3DCAD アイコンから、アドレスバーのない全画面で起動します。上の操作は「メニュー」、パネルは ☰ から。</p>
      <div class="row"><button data-install-help class="primary">アプリにする</button></div>`
      }
      <h3>1 ファイル版（すぐ開ける・オフライン）</h3>
      <p class="muted">インストールしなくても、1 つの HTML ファイルをダブルクリックするだけで使えます（インターネット不要。USB メモリで持ち運んだり、メールで渡したりもできます）。</p>
      <div class="row"><a class="button-link" href="./3DCAD.html" download="3DCAD.html">1 ファイル版をダウンロード（約 9MB）</a></div>
      <h3>起動と自動保存</h3>
      <p class="muted">起動すると毎回新規（空）で始まります。作業は自動でブラウザに保存されているので、続きをするときは「開く ▾」→「前回の続きを開く（自動保存）」。保存したファイルは「開く ▾」→「ファイルを開く」。</p>
      <h3>保存する場所</h3>
      <p class="muted">「保存 ▾」の「名前を付けて保存」で場所と名前を選べます（PC の Chrome・Edge）。一度保存すると「保存（Ctrl+S）」は同じファイルに上書きします。スマホでは共有メニューの「ファイルに保存」「ドライブに保存」などから保存先を選びます。毎回選ばずにダウンロードフォルダへ保存したいときは「保存 ▾」→「ダウンロードフォルダに保存」。</p>
      <h3>プレゼン資料を作る（初めてでも 3 ステップ）</h3>
      <ol class="steps">
        <li>右上の「プレゼン資料を作る」を押す</li>
        <li><b>見た目を選ぶ</b>: リアル（材料と太陽の光・影）／白模型／スケッチ。リアルは「壁・屋根・窓に材料を付ける」で自動で仕上げ</li>
        <li><b>視点を決める</b>: 「おすすめの視点を自動で作る」で鳥瞰・人の目線・真上がそろう。好きな角度は「今の視点を追加」</li>
        <li><b>書き出す</b>: PowerPoint・PDF・画像（ZIP）・動画、または「スライドショー」でそのまま会議で説明</li>
      </ol>
      <p class="muted">日時を変えると、その日・その時刻の太陽の位置で影が付きます（モデルの位置の緯度経度で計算。日影の検討にも）。</p>
      <h3>室内を見る（立ち位置）</h3>
      <ol class="steps">
        <li>左の「立ち位置」（G キー）、またはプレゼンの「立ち位置を選ぶ」を押す</li>
        <li>床をクリック（タップ）すると、そこに目の高さ 1.6m で立ちます（壁をクリックするとその手前に）</li>
        <li>ドラッグでその場から見回す（オービットと違って外に出ません）。ホイール・↑↓で前後に歩き、←→で向きを変える（Shift+←→ で横歩き）。壁の手前で止まります</li>
        <li>数字を打つと目の高さを変えられます（例: 1200 で座った目線）。気に入ったら「今の視点を追加」</li>
      </ol>
      <h3>家具・設備を置く</h3>
      <p class="muted">「家具」パネルで選んで 3D 画面をクリック。床・壁（背中を壁に付ける）・天井（照明・エアコン）に合わせて置き、R キーで 90° 回します。照明器具はプレゼンの「室内の照明を点ける」で実際に光ります。</p>
      <h3>平面図・立面図・断面図から 3D を作る</h3>
      <ol class="steps">
        <li>「読み込み → 図面」で平面図を開く（DXF / SXF / JWW / PDF / 画像）。地面に水平に置かれます</li>
        <li>同じように立面図・断面図を開き、種類（南立面など）を選ぶ。建物の横に自動で立てて配置されます</li>
        <li>ずれていれば「図面」パネルの「位置合わせ」で通り芯や角を合わせ、「高さ合わせ」で GL を 0 に</li>
        <li><b>図面から立体（K）</b>: 平面図の外形 → 立面図の外形 の順にクリックして Enter。重なった部分が屋根付きの立体になります（東立面も加えると寄棟）</li>
        <li>平面図だけなら、外形をクリックして高さを入力 → Enter で押し出し</li>
        <li>細かい所は、図面の線にスナップしながら線・長方形・プッシュ/プルで仕上げる（立面図の窓の位置に長方形を描いて押し込むと開口）</li>
      </ol>
      <p class="muted">試すには「読み込み → サンプル: 住宅」。PDF・画像の図面は線を拾えないので、なぞって作図します。</p>
      <h3>タブレットでの操作</h3>
      <p class="muted">1 本指でツール操作、2 本指でズーム・パン。視点を回すときは右下の「回転」。Esc・Enter の代わりに「取消」「確定」ボタン。数値は右下の入力欄をタップして入力。メニューの ☰ でパネルを開きます。</p>
      <h3>基本操作（SketchUp と同じ）</h3>
      <table class="keys">
        <tr><td>中ボタンドラッグ</td><td>視点の回転</td></tr>
        <tr><td>Shift+中 / 右ドラッグ</td><td>パン（平行移動）</td></tr>
        <tr><td>ホイール</td><td>ズーム（カーソル位置へ）</td></tr>
        <tr><td>Space</td><td>選択</td></tr>
        <tr><td>L / R / C</td><td>線 / 長方形 / 円</td></tr>
        <tr><td>P</td><td>プッシュ/プル</td></tr>
        <tr><td>K</td><td>図面から立体（外形をクリック → Enter）</td></tr>
        <tr><td>右クリック</td><td>メニュー（削除・グループ化など）</td></tr>
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
    body.querySelector('[data-install-help]')?.addEventListener('click', () => void promptInstall(this.app));
  }
}
