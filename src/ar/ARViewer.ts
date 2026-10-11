import { Group, Matrix4, Mesh, MeshBasicMaterial, RingGeometry, Vector3 } from 'three';
import type { App } from '../App';
import { buildExportScene, exportUSDZ } from '../io/export';

/** iPhone / iPad（iPadOS は Mac として名乗るので touch で判定） */
export function isIOS(): boolean {
  const ua = navigator.userAgent;
  return /iPad|iPhone|iPod/.test(ua) || (ua.includes('Macintosh') && navigator.maxTouchPoints > 1);
}

export async function supportsWebXRAR(): Promise<boolean> {
  try {
    return !!(await navigator.xr?.isSessionSupported('immersive-ar'));
  } catch {
    return false;
  }
}

/**
 * 作ったモデルを AR で表示する。
 *  - iPhone / iPad: USDZ を生成して AR Quick Look で開く
 *  - Android（Chrome）: WebXR で床を検出してタップした場所に配置
 */
export class ARViewer {
  private session: XRSession | null = null;
  private hitSource: XRHitTestSource | null = null;
  private reticle: Mesh;
  private arGroup: Group | null = null;
  private placed = false;
  private overlay: HTMLDivElement;
  private scale = 1;
  private rotation = 0;
  private hidden: { obj: { visible: boolean }; visible: boolean }[] = [];
  private stopFrame: (() => void) | null = null;

  constructor(private app: App) {
    this.reticle = new Mesh(
      new RingGeometry(0.12, 0.16, 40).rotateX(-Math.PI / 2),
      new MeshBasicMaterial({ color: 0x2a9df4 }),
    );
    this.reticle.matrixAutoUpdate = false;
    this.reticle.visible = false;
    this.overlay = document.createElement('div');
    this.overlay.className = 'ar-overlay';
    this.overlay.innerHTML = `
      <div class="ar-msg">床にカメラを向けて、青い輪が出たらタップして配置</div>
      <div class="ar-buttons">
        <label>縮尺
          <select data-ar="scale">
            <option value="1">1:1（実寸）</option>
            <option value="0.1">1:10</option>
            <option value="0.02">1:50</option>
            <option value="0.01">1:100</option>
            <option value="0.002">1:500</option>
          </select>
        </label>
        <button data-ar="rotl">⟲ 15°</button>
        <button data-ar="rotr">⟳ 15°</button>
        <button data-ar="replace">置き直す</button>
        <button data-ar="exit" class="danger">AR を終了</button>
      </div>`;
    document.body.appendChild(this.overlay);
    this.overlay.addEventListener('beforexrselect', (e) => e.preventDefault());
    this.overlay.querySelector('[data-ar=exit]')!.addEventListener('click', () => this.end());
    this.overlay.querySelector('[data-ar=replace]')!.addEventListener('click', () => {
      this.placed = false;
      if (this.arGroup) this.arGroup.visible = false;
      this.setMsg('床にカメラを向けて、青い輪が出たらタップして配置');
    });
    this.overlay.querySelector('[data-ar=rotl]')!.addEventListener('click', () => this.rotate(15));
    this.overlay.querySelector('[data-ar=rotr]')!.addEventListener('click', () => this.rotate(-15));
    this.overlay.querySelector<HTMLSelectElement>('[data-ar=scale]')!.addEventListener('change', (e) => {
      this.scale = Number((e.target as HTMLSelectElement).value);
      if (this.arGroup) this.arGroup.scale.setScalar(this.scale);
    });
  }

  private setMsg(s: string): void {
    this.overlay.querySelector('.ar-msg')!.textContent = s;
  }

  private rotate(deg: number): void {
    this.rotation += (deg * Math.PI) / 180;
    if (this.arGroup) this.arGroup.rotation.y = this.rotation;
  }

  /** 端末に合わせて AR を開始 */
  async start(): Promise<void> {
    if (this.app.model.faces.size === 0) {
      this.app.ui.toast('AR で表示する面がありません');
      return;
    }
    if (isIOS()) return this.startQuickLook();
    if (await supportsWebXRAR()) return this.startWebXR();
    this.app.ui.alert(
      'AR を開始できません',
      `この端末・ブラウザは Web AR に対応していません。<br>
       ・iPhone / iPad: Safari で開いてください（AR Quick Look）<br>
       ・Android: Chrome で開いてください（ARCore 対応端末, HTTPS 接続が必要）<br><br>
       「書き出し」から GLB / USDZ を保存して、他の AR アプリで開くこともできます。`,
    );
  }

  /** iOS: USDZ を生成して AR Quick Look で開く */
  async startQuickLook(): Promise<void> {
    this.app.ui.toast('AR 用データ（USDZ）を作成しています…');
    const blob = await exportUSDZ(this.app.model, { centerOnOrigin: true, includeEdges: false, scale: 1 });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.rel = 'ar';
    a.href = url;
    // AR Quick Look は <a rel="ar"> の子に img が必要
    a.appendChild(document.createElement('img'));
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }

  /** Android: WebXR の immersive-ar セッション */
  async startWebXR(): Promise<void> {
    const xr = navigator.xr!;
    const session = await xr.requestSession('immersive-ar', {
      requiredFeatures: ['hit-test'],
      optionalFeatures: ['dom-overlay', 'local-floor'],
      domOverlay: { root: this.overlay },
    } as XRSessionInit);
    this.session = session;
    const vp = this.app.viewport;
    const renderer = vp.renderer;
    renderer.xr.enabled = true;
    renderer.xr.setReferenceSpaceType('local');
    await renderer.xr.setSession(session);

    // 編集用の表示を隠して AR 用のモデルを追加
    this.hidden = [vp.helpersRoot, vp.underlayRoot, vp.pointCloudRoot, vp.modelRoot, vp.overlayRoot].map((o) => ({
      obj: o,
      visible: o.visible,
    }));
    for (const h of this.hidden) h.obj.visible = false;
    renderer.setClearAlpha(0);
    const { group } = buildExportScene(this.app.model, { centerOnOrigin: true, includeEdges: true, scale: 1 });
    this.arGroup = new Group();
    this.arGroup.add(group);
    this.arGroup.visible = false;
    this.arGroup.scale.setScalar(this.scale);
    vp.scene.add(this.arGroup, this.reticle);
    this.placed = false;
    this.overlay.classList.add('active');

    const viewerSpace = await session.requestReferenceSpace('viewer');
    this.hitSource = (await session.requestHitTestSource?.({ space: viewerSpace })) ?? null;

    session.addEventListener('select', () => {
      if (!this.reticle.visible || !this.arGroup) return;
      const m = new Matrix4().copy(this.reticle.matrix);
      const pos = new Vector3().setFromMatrixPosition(m);
      this.arGroup.position.copy(pos);
      this.arGroup.rotation.y = this.rotation;
      this.arGroup.visible = true;
      this.placed = true;
      this.reticle.visible = false;
      this.setMsg('配置しました。縮尺・回転を変えたり、置き直したりできます');
    });
    session.addEventListener('end', () => this.cleanup());

    this.stopFrame = vp.onFrame((_t, frame) => {
      if (!frame || !this.hitSource || this.placed) return;
      const refSpace = renderer.xr.getReferenceSpace();
      if (!refSpace) return;
      const hits = frame.getHitTestResults(this.hitSource);
      if (hits.length) {
        const pose = hits[0].getPose(refSpace);
        if (pose) {
          this.reticle.visible = true;
          this.reticle.matrix.fromArray(pose.transform.matrix);
        }
      } else {
        this.reticle.visible = false;
      }
    });
  }

  end(): void {
    this.session?.end();
  }

  private cleanup(): void {
    const vp = this.app.viewport;
    this.stopFrame?.();
    this.stopFrame = null;
    this.hitSource?.cancel();
    this.hitSource = null;
    this.session = null;
    for (const h of this.hidden) h.obj.visible = h.visible;
    if (this.arGroup) vp.scene.remove(this.arGroup);
    vp.scene.remove(this.reticle);
    this.arGroup = null;
    this.overlay.classList.remove('active');
    vp.renderer.xr.enabled = false;
    vp.renderer.setClearAlpha(1);
    vp.requestRender();
  }
}
