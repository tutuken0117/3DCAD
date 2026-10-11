import { Box3, Vector3 } from 'three';
import { ARViewer } from './ar/ARViewer';
import { History } from './core/History';
import { Model } from './core/Model';
import { Selection } from './core/Selection';
import { GeoReference } from './geo/GeoReference';
import { parseDxf, decodeDxf } from './io/dxf';
import type { Drawing2D } from './io/drawing2d';
import { extrudeLayer, importDrawing } from './io/drawingImport';
import { downloadBlob, exportDXF, exportGLB, exportOBJ, exportUSDZ } from './io/export';
import { parsePointCloud, parseTextPoints, detectPointCloudFormat } from './io/pointcloud';
import {
  clearAutosave,
  loadAutosave,
  parseProject,
  PROJECT_EXT,
  saveAutosave,
  type ProjectFile,
} from './io/project';
import { parseSfc } from './io/sxf';
import { loadImage, rasterizePdf, underlayFromRaster } from './io/underlayLoader';
import { CircleTool, LineTool, RectangleTool } from './tools/DrawTools';
import { CoordTool, OrbitTool, PanTool, TapeTool, UnderlayAdjustTool } from './tools/MiscTools';
import { EraserTool, MoveTool, PaintTool, PushPullTool, RotateTool } from './tools/ModifyTools';
import { SelectTool } from './tools/SelectTool';
import type { Tool } from './tools/Tool';
import { UI } from './ui/UI';
import { Inference } from './view/Inference';
import { ModelRenderer } from './view/ModelRenderer';
import { Overlay } from './view/Overlay';
import { PointCloudManager, type AxisOrder } from './view/PointCloudManager';
import { UnderlayManager, type Underlay } from './view/UnderlayManager';
import { Viewport } from './view/Viewport';
import type { UnderlayAdjustMode } from './tools/MiscTools';

/** アプリ全体をつなぐクラス */
export class App {
  readonly viewport: Viewport;
  readonly model = new Model();
  readonly history: History;
  readonly selection: Selection;
  readonly renderer: ModelRenderer;
  readonly geo = new GeoReference();
  readonly pointClouds: PointCloudManager;
  readonly underlays: UnderlayManager;
  readonly inference: Inference;
  readonly overlay: Overlay;
  readonly ui: UI;
  readonly ar: ARViewer;
  readonly tools = new Map<string, Tool>();
  tool!: Tool;
  projectName = '無題';

  private autosaveTimer: number | undefined;
  private pointCloudRefs: ProjectFile['pointClouds'] = [];

  constructor(root: HTMLElement) {
    this.ui = new UI(this, root);
    this.viewport = new Viewport(this.ui.viewportEl);
    this.history = new History(this.model);
    this.selection = new Selection(this.model);
    this.renderer = new ModelRenderer(this.viewport, this.model, this.selection);
    this.pointClouds = new PointCloudManager(this.viewport, this.geo);
    this.underlays = new UnderlayManager(this.viewport);
    this.inference = new Inference(this.viewport, this.model, this.renderer, this.pointClouds, this.underlays);
    this.overlay = new Overlay(this.viewport);
    this.ar = new ARViewer(this);

    for (const t of [
      new SelectTool(this),
      new LineTool(this),
      new RectangleTool(this),
      new CircleTool(this),
      new PushPullTool(this),
      new MoveTool(this),
      new RotateTool(this),
      new TapeTool(this),
      new EraserTool(this),
      new PaintTool(this),
      new CoordTool(this),
      new OrbitTool(this),
      new PanTool(this),
      new UnderlayAdjustTool(this),
    ]) {
      this.tools.set(t.def.id, t);
    }
    this.tool = this.tools.get('select')!;

    this.ui.build();
    this.bindInput();
    this.setTool('select');

    this.history.onChange(() => this.scheduleAutosave());
    this.model.onChange(() => {
      const g = this.model.activeGroup;
      this.ui.setContext(g ? (this.model.groups.get(g)?.name ?? null) : null);
    });
    this.geo.onChange(() => this.scheduleAutosave());
    this.underlays.onChange(() => this.scheduleAutosave());
  }

  // ------------------------------------------------------------------
  // ツール
  // ------------------------------------------------------------------

  setTool(id: string): void {
    const next = this.tools.get(id);
    if (!next) return;
    this.tool?.deactivate();
    this.tool = next;
    next.activate();
    this.ui.setActiveTool(id);
    this.viewport.renderer.domElement.style.cursor = id === 'select' ? 'default' : id === 'orbit' || id === 'pan' ? 'grab' : 'crosshair';
  }

  /** 下図の調整ツールを開始 */
  adjustUnderlay(u: Underlay, mode: UnderlayAdjustMode): void {
    const t = this.tools.get('underlay-adjust') as UnderlayAdjustTool;
    t.target = u;
    t.mode = mode;
    this.setTool('underlay-adjust');
  }

  private bindInput(): void {
    const canvas = this.viewport.renderer.domElement;
    let pendingMove: PointerEvent | null = null;
    canvas.addEventListener('pointerdown', (e) => {
      canvas.focus();
      if (e.button === 0) this.tool.onPointerDown(e);
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!pendingMove) {
        requestAnimationFrame(() => {
          const ev = pendingMove;
          pendingMove = null;
          if (ev) this.tool.onPointerMove(ev);
        });
      }
      pendingMove = e;
    });
    canvas.addEventListener('pointerup', (e) => this.tool.onPointerUp(e));
    canvas.addEventListener('dblclick', (e) => this.tool.onDoubleClick(e));
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('pointerleave', () => this.overlay.showInference(null));

    // ファイルのドラッグ＆ドロップ
    const root = this.ui.viewportEl;
    root.addEventListener('dragover', (e) => {
      e.preventDefault();
      root.classList.add('drop');
    });
    root.addEventListener('dragleave', () => root.classList.remove('drop'));
    root.addEventListener('drop', (e) => {
      e.preventDefault();
      root.classList.remove('drop');
      for (const f of e.dataTransfer?.files ?? []) void this.openAnyFile(f);
    });

    window.addEventListener('keydown', (e) => this.onKeyDown(e));
    window.addEventListener('keyup', (e) => this.tool.onKeyUp(e));
  }

  private onKeyDown(e: KeyboardEvent): void {
    const target = e.target as HTMLElement;
    const inInput = target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.tagName === 'TEXTAREA';
    if (inInput && !target.classList.contains('vcb-input')) return;
    if (this.ui.isModalOpen()) return;
    const ctrl = e.ctrlKey || e.metaKey;

    if (ctrl) {
      const k = e.key.toLowerCase();
      if (k === 'z' && !e.shiftKey) return (e.preventDefault(), this.undo());
      if (k === 'y' || (k === 'z' && e.shiftKey)) return (e.preventDefault(), this.redo());
      if (k === 's') return (e.preventDefault(), this.saveProject());
      if (k === 'o') return (e.preventDefault(), this.ui.pickFile('open'));
      if (k === 'a' && !inInput) return (e.preventDefault(), this.selection.selectAll());
      if (k === 'g' && !e.shiftKey) return (e.preventDefault(), this.makeGroupFromSelection());
      if (k === 'g' && e.shiftKey) return (e.preventDefault(), this.explodeSelectedGroup());
    }
    if (inInput) return;

    // 選択ツールで Esc → グループの編集を終了
    if (e.key === 'Escape' && this.tool.def.id === 'select' && this.model.activeGroup) {
      this.exitGroup();
      return;
    }
    // ツール固有のキー（Esc、矢印、Shift、Ctrl など）
    if (this.tool.onKeyDown(e)) {
      e.preventDefault();
      return;
    }
    if (ctrl || e.altKey) return;

    // 数字を打ち始めたら数値入力ボックスへ
    if (/^[0-9.\-+]$/.test(e.key) && this.tool.vcbLabel) {
      e.preventDefault();
      this.ui.startVcbTyping(e.key);
      return;
    }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      this.deleteSelection();
      return;
    }
    if (e.key === 'Z' && e.shiftKey) return this.zoomExtents();
    const shortcuts: Record<string, string> = {
      ' ': 'select',
      l: 'line',
      r: 'rect',
      c: 'circle',
      p: 'pushpull',
      m: 'move',
      q: 'rotate',
      t: 'tape',
      e: 'eraser',
      b: 'paint',
      i: 'coord',
      o: 'orbit',
      h: 'pan',
    };
    const id = shortcuts[e.key.toLowerCase()];
    if (id && !e.shiftKey) {
      e.preventDefault();
      this.setTool(id);
    }
  }

  submitVcb(text: string): void {
    if (!text.trim()) return;
    if (!this.tool.onVcb(text)) this.ui.toast('入力を解釈できませんでした');
  }

  // ------------------------------------------------------------------
  // 編集
  // ------------------------------------------------------------------

  undo(): void {
    this.tool.reset();
    const label = this.history.undo();
    if (label) this.ui.toast(`元に戻す: ${label}`);
  }

  redo(): void {
    this.tool.reset();
    const label = this.history.redo();
    if (label) this.ui.toast(`やり直し: ${label}`);
  }

  deleteSelection(): void {
    if (this.selection.isEmpty) return;
    for (const id of this.selection.faces) this.model.removeFace(id);
    for (const id of this.selection.edges) this.model.removeEdge(id);
    this.model.removeUnusedVertices();
    this.selection.clear();
    this.history.commit('削除');
  }

  /** 選択した面を押し出す（数値指定） */
  extrudeSelection(distance: number): void {
    const faces = [...this.selection.faces];
    if (!faces.length) return;
    for (const id of faces) {
      if (this.model.faces.has(id)) this.model.pushPull(id, distance, { keepBase: faces.length > 1 });
    }
    this.selection.clear();
    this.history.commit('押し出し');
  }

  // ------------------------------------------------------------------
  // グループ
  // ------------------------------------------------------------------

  /**
   * クリックした要素を、今の編集階層での選択単位に広げる。
   * 編集中の階層の外にあるグループは丸ごと 1 つとして扱う。
   */
  expandPick(ent: { edge?: number; face?: number }): { edges: number[]; faces: number[]; group: number } {
    const m = this.model;
    const g = ent.face !== undefined ? m.groupOfFace(ent.face) : ent.edge !== undefined ? m.groupOfEdge(ent.edge) : -1;
    if (g < 0) return { edges: [], faces: [], group: 0 };
    if (g === m.activeGroup) {
      return { edges: ent.edge !== undefined ? [ent.edge] : [], faces: ent.face !== undefined ? [ent.face] : [], group: g };
    }
    if (g !== 0) return { ...m.groupEntities(g), group: g };
    // グループ編集中に外側（グループ外）のものは選べない
    return { edges: [], faces: [], group: 0 };
  }

  /** 選択中のものがすべて 1 つのグループなら、その ID */
  selectedGroup(): number | undefined {
    const m = this.model;
    const gs = new Set<number>();
    for (const id of this.selection.faces) gs.add(m.groupOfFace(id));
    for (const id of this.selection.edges) gs.add(m.groupOfEdge(id));
    if (gs.size !== 1) return undefined;
    const g = [...gs][0];
    return g && g !== m.activeGroup ? g : undefined;
  }

  makeGroupFromSelection(): void {
    if (this.selection.isEmpty) return this.ui.toast('グループにする物を選択してください');
    if (this.model.activeGroup) return this.ui.toast('グループの中でさらにグループを作ることはまだできません');
    const gid = this.model.makeGroup(this.selection.edges, this.selection.faces);
    if (gid === undefined) return;
    this.history.commit('グループ作成');
    const ents = this.model.groupEntities(gid);
    this.selection.set(ents.edges, ents.faces);
    this.ui.toast('グループにしました。ダブルクリックで中を編集できます');
  }

  explodeSelectedGroup(): void {
    const g = this.selectedGroup();
    if (!g) return;
    this.model.explodeGroup(g);
    this.history.commit('グループ分解');
    this.selection.clear();
  }

  enterGroup(gid: number): void {
    if (!this.model.groups.has(gid)) return;
    this.tool.reset();
    this.model.activeGroup = gid;
    this.selection.clear();
    this.model.emitChange();
    this.ui.setContext(this.model.groups.get(gid)!.name);
  }

  exitGroup(): void {
    if (!this.model.activeGroup) return;
    const gid = this.model.activeGroup;
    this.model.activeGroup = 0;
    const ents = this.model.groupEntities(gid);
    this.selection.set(ents.edges, ents.faces);
    this.model.emitChange();
    this.ui.setContext(null);
  }

  extrudeLayer(layer: string, height: number): void {
    const n = extrudeLayer(this.model, layer, height);
    this.history.commit(`レイヤー押し出し: ${layer}`);
    this.ui.toast(`${n} 個の面を押し出しました`);
  }

  zoomExtents(): void {
    const box = this.model.boundingBox();
    for (const b of this.pointClouds.boundingBoxes()) box.union(b);
    for (const u of this.underlays.items) if (u.visible) box.union(new Box3().setFromObject(u.mesh));
    if (box.isEmpty()) box.set(new Vector3(-5, 0, -5), new Vector3(5, 3, 5));
    this.viewport.zoomToBox(box);
  }

  // ------------------------------------------------------------------
  // ファイル
  // ------------------------------------------------------------------

  async openAnyFile(file: File): Promise<void> {
    const name = file.name.toLowerCase();
    try {
      if (name.endsWith('.json') || name.endsWith('.3dcad')) return await this.openProject(file);
      if (name.endsWith('.dxf') || name.endsWith('.sfc')) return await this.importDrawingFile(file);
      if (name.endsWith('.pdf') || /\.(png|jpe?g|webp|gif|bmp)$/.test(name)) return await this.importUnderlayFile(file);
      if (detectPointCloudFormat(name)) return await this.importPointCloudFile(file);
      if (name.endsWith('.p21') || name.endsWith('.dwg') || name.endsWith('.jww')) {
        this.ui.alert(
          '未対応の形式',
          `${file.name} は直接読み込めません。<br>発注図面を CAD（または SXF ブラウザ・Jw_cad など）で <b>DXF</b> か <b>SFC</b> に変換してから読み込んでください。PDF なら下図として読み込めます。`,
        );
        return;
      }
      this.ui.toast(`対応していないファイルです: ${file.name}`);
    } catch (err) {
      console.error(err);
      this.ui.alert('読み込みエラー', String((err as Error).message ?? err));
    }
  }

  async newProject(): Promise<void> {
    if (!this.model.isEmpty() && !(await this.ui.confirm('新規作成', '現在のモデルを破棄して新規作成しますか？', '新規作成'))) return;
    this.tool.reset();
    this.model.clear();
    for (const c of [...this.pointClouds.clouds]) this.pointClouds.remove(c);
    void this.underlays.load([]);
    this.geo.load({});
    this.history.reset();
    this.projectName = '無題';
    this.ui.refreshAll();
    void clearAutosave();
  }

  toProjectFile(): ProjectFile {
    const cam = this.viewport.camera;
    return {
      app: '3DCAD',
      version: 1,
      savedAt: new Date().toISOString(),
      model: this.model.toJSON(),
      geo: this.geo.toJSON(),
      underlays: this.underlays.toJSON(),
      pointClouds: [
        ...this.pointClouds.clouds.map((c) => ({
          name: c.name,
          georeferenced: c.options.georeferenced,
          axisOrder: c.options.axisOrder,
          count: c.raw.count,
        })),
        ...this.pointCloudRefs.filter((r) => !this.pointClouds.clouds.some((c) => c.name === r.name)),
      ],
      camera: { position: cam.position.toArray(), target: this.viewport.controls.target.toArray() },
    };
  }

  async loadProjectFile(p: ProjectFile): Promise<void> {
    this.tool.reset();
    this.geo.load(p.geo);
    this.model.load(p.model);
    await this.underlays.load(p.underlays ?? []);
    this.pointCloudRefs = p.pointClouds ?? [];
    this.history.reset();
    if (p.camera) {
      this.viewport.camera.position.fromArray(p.camera.position);
      this.viewport.controls.target.fromArray(p.camera.target);
      this.viewport.controls.update();
    }
    this.ui.refreshAll();
    const missing = this.pointCloudRefs.filter((r) => !this.pointClouds.clouds.some((c) => c.name === r.name));
    if (missing.length) {
      this.ui.toast(`点群は保存されていません。必要なら再度読み込んでください: ${missing.map((m) => m.name).join(', ')}`, 8000);
    }
  }

  async openProject(file: File): Promise<void> {
    const p = parseProject(await file.text());
    this.projectName = file.name.replace(/\.3dcad\.json$|\.json$|\.3dcad$/i, '');
    await this.loadProjectFile(p);
    this.ui.toast(`開きました: ${file.name}`);
  }

  saveProject(): void {
    const json = JSON.stringify(this.toProjectFile());
    downloadBlob(new Blob([json], { type: 'application/json' }), `${this.projectName}${PROJECT_EXT}`);
    this.ui.toast(
      window.top !== window
        ? 'この埋め込み表示ではファイルを保存できない場合があります（作業はブラウザ内に自動保存されます）'
        : 'プロジェクトを保存しました',
    );
  }

  private scheduleAutosave(): void {
    clearTimeout(this.autosaveTimer);
    this.autosaveTimer = window.setTimeout(() => {
      saveAutosave(this.toProjectFile()).catch((e) => console.warn('自動保存に失敗', e));
    }, 1500);
  }

  async restoreAutosave(): Promise<void> {
    const p = await loadAutosave();
    if (!p || (p.model.faces.length === 0 && p.model.edges.length === 0)) return;
    const when = new Date(p.savedAt).toLocaleString('ja-JP');
    if (await this.ui.confirm('前回の作業を復元', `${when} に自動保存されたデータがあります。復元しますか？`, '復元する', '新規で始める')) {
      await this.loadProjectFile(p);
      this.zoomExtents();
    }
  }

  // ---- サンプル ----

  /** サンプルの配置図（公共座標の DXF）と点群を読み込んで立体化する */
  async loadSample(): Promise<void> {
    try {
      this.ui.toast('サンプルを読み込んでいます…');
      const [dxfBuf, xyzText] = await Promise.all([
        fetch('./sample_plan_jgd2011_9kei.dxf').then((r) => r.arrayBuffer()),
        fetch('./sample_ground_jgd2011_9kei.xyz').then((r) => r.text()),
      ]);
      this.tool.reset();
      this.geo.setZone(9);
      const drawing = parseDxf(decodeDxf(dxfBuf));
      importDrawing(this.model, this.geo, drawing, {
        unitToMeters: 1,
        georeferenced: true,
        elevation: 12,
        layers: new Set(drawing.layers.map((l) => l.name)),
        faceLayers: new Set(['建物外形', '擁壁']),
      });
      extrudeLayer(this.model, '建物外形', 6);
      extrudeLayer(this.model, '擁壁', 1.2);
      this.history.commit('サンプル読み込み');
      const raw = parseTextPoints(xyzText);
      this.pointClouds.add('サンプル地盤点群.xyz', raw, { georeferenced: true, axisOrder: 'EN' });
      this.ui.refreshAll();
      this.zoomExtents();
      this.ui.toast('サンプル: 公共座標（第9系）の配置図を 6m で押し出し、地盤の点群と重ねました', 7000);
    } catch (err) {
      this.ui.alert('サンプルを読み込めません', String((err as Error).message ?? err));
    }
  }

  // ---- 2D 図面 ----

  async importDrawingFile(file: File): Promise<void> {
    const name = file.name.toLowerCase();
    const buf = await file.arrayBuffer();
    let drawing: Drawing2D;
    let sxfScale = 1;
    if (name.endsWith('.sfc')) {
      const res = await this.ui.form('SXF(SFC) の読み込み', [
        { key: 'scale', label: '図面の縮尺 1/', type: 'number', value: '100' },
      ], { description: 'SFC の座標は用紙上の mm です。図面の縮尺を入力してください（例: 1/500 なら 500）。' });
      if (!res) return;
      sxfScale = Number(res.scale) || 1;
      drawing = parseSfc(new TextDecoder('shift_jis').decode(buf), sxfScale);
    } else {
      drawing = parseDxf(decodeDxf(buf));
    }
    const opts = await this.ui.drawingImportDialog(file.name, drawing);
    if (!opts) return;
    this.tool.reset();
    const res = importDrawing(this.model, this.geo, drawing, opts);
    this.history.commit(`図面読み込み: ${file.name}`);
    this.ui.refreshAll();
    this.zoomExtents();
    this.ui.toast(`読み込み完了: エッジ ${res.edges} 本・面 ${res.faces} 枚。「レイヤー」パネルの「押し出し」で一括立体化できます`, 8000);
    if (res.faces > 0) this.ui.showPanel('layers');
  }

  // ---- 下図（PDF・画像） ----

  async importUnderlayFile(file: File): Promise<void> {
    const isPdf = file.name.toLowerCase().endsWith('.pdf');
    let page = 1;
    if (isPdf) {
      const res = await this.ui.form('PDF を下図として読み込み', [
        { key: 'page', label: 'ページ', type: 'number', value: '1' },
        { key: 'scale', label: '図面の縮尺 1/', type: 'number', value: '100' },
      ], { description: '縮尺を入れると用紙サイズから実寸に合わせて配置します。あとで「縮尺合わせ」で 2 点間の寸法から補正できます。' });
      if (!res) return;
      page = Number(res.page) || 1;
      this.ui.toast('PDF を変換しています…');
      const raster = await rasterizePdf(await file.arrayBuffer(), page);
      const t = this.viewport.controls.target;
      const data = underlayFromRaster(file.name, raster, Number(res.scale) || 1, { x: t.x, z: t.z });
      await this.underlays.add(data);
    } else {
      const raster = await loadImage(file);
      const t = this.viewport.controls.target;
      // 画像は縮尺不明なので幅 20m 程度で配置し、あとで縮尺合わせ
      const data = underlayFromRaster(file.name, raster, 1, { x: t.x, z: t.z });
      data.metersPerPixel = 20 / raster.widthPx;
      await this.underlays.add(data);
    }
    this.zoomExtents();
    this.ui.showPanel('underlays');
    this.ui.toast('下図を配置しました。「縮尺合わせ」で寸法の分かる 2 点を指定してください', 8000);
  }

  // ---- 点群 ----

  async importPointCloudFile(file: File): Promise<void> {
    const opts = await this.ui.form(
      `点群の読み込み: ${file.name}`,
      [
        {
          key: 'georef',
          label: '座標',
          type: 'select',
          value: 'public',
          options: [
            ['public', '公共座標（平面直角座標）としてそのまま配置'],
            ['local', 'ローカル座標（点群の中心を原点に置く）'],
          ],
        },
        {
          key: 'order',
          label: '列の並び',
          type: 'select',
          value: 'EN',
          options: [
            ['EN', 'x=東(Y), y=北(X)  … LAS・GIS の標準'],
            ['NE', 'x=北(X), y=東(Y)  … 測量の XY 順'],
          ],
        },
        { key: 'max', label: '表示する最大点数（万点）', type: 'number', value: '300' },
      ],
      {
        description: `プロジェクトは平面直角座標 第${this.geo.zone}系です（「座標系」パネルで変更）。点群スコープなど他のソフトで作った点群も、同じ公共座標であればモデルと重なります。`,
      },
    );
    if (!opts) return;
    this.ui.toast('点群を読み込んでいます…');
    const buf = await file.arrayBuffer();
    const raw = parsePointCloud(file.name, buf, { maxPoints: Math.max(1, Number(opts.max) || 300) * 10000 });
    this.pointClouds.add(file.name, raw, {
      georeferenced: opts.georef === 'public',
      axisOrder: opts.order as AxisOrder,
    });
    this.zoomExtents();
    this.ui.refreshAll();
    this.ui.showPanel('pointclouds');
    this.ui.toast(
      `${raw.format}: ${raw.count.toLocaleString()} 点を表示（全 ${raw.totalCount.toLocaleString()} 点）。点群の点にスナップして作図できます`,
      8000,
    );
  }

  // ---- 書き出し ----

  async exportAs(kind: 'glb' | 'usdz' | 'obj' | 'obj-local' | 'dxf' | 'dxf-local'): Promise<void> {
    const base = this.projectName;
    try {
      switch (kind) {
        case 'glb':
          downloadBlob(await exportGLB(this.model, this.geo, { centerOnOrigin: true, includeEdges: false, scale: 1 }), `${base}.glb`);
          break;
        case 'usdz':
          downloadBlob(await exportUSDZ(this.model, { centerOnOrigin: true, includeEdges: false, scale: 1 }), `${base}.usdz`);
          break;
        case 'obj':
        case 'obj-local':
          downloadBlob(new Blob([exportOBJ(this.model, this.geo, kind === 'obj')], { type: 'text/plain' }), `${base}.obj`);
          break;
        case 'dxf':
        case 'dxf-local':
          downloadBlob(new Blob([exportDXF(this.model, this.geo, kind === 'dxf')], { type: 'application/dxf' }), `${base}.dxf`);
          break;
      }
    } catch (err) {
      console.error(err);
      this.ui.alert('書き出しエラー', String((err as Error).message ?? err));
    }
  }
}
