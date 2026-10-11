import { Vector3 } from 'three';
import { formatCoord, formatLength, parseLength } from '../core/units';
import { formatDms } from '../geo/jprcs';
import type { Underlay } from '../view/UnderlayManager';
import { Tool, type ToolDef } from './Tool';

// ---------------------------------------------------------------------------
// メジャー
// ---------------------------------------------------------------------------

export class TapeTool extends Tool {
  readonly def: ToolDef = { id: 'tape', label: 'メジャー', key: 'T', icon: 'tape' };
  vcbLabel = '長さ';
  private start: Vector3 | null = null;

  hint(): string {
    return this.start ? '測る終点をクリック' : '測る始点をクリック（端点・点群にスナップします）';
  }

  reset(): void {
    this.start = null;
    super.reset();
  }

  private describe(a: Vector3, b: Vector3): string {
    const d = b.clone().sub(a);
    const horiz = Math.hypot(d.x, d.z);
    return `距離 ${formatLength(d.length())}　水平 ${formatLength(horiz)}　高低差 ${formatLength(d.y)}`;
  }

  onPointerMove(e: PointerEvent): void {
    const inf = this.infer(e, this.start ? { from: this.start } : {});
    if (this.start) {
      this.app.overlay.setRubberBand(this.start, inf.point, inf);
      this.app.ui.setVcbValue(formatLength(this.start.distanceTo(inf.point)));
      this.app.ui.setHint(this.describe(this.start, inf.point));
    }
  }

  onPointerDown(e: PointerEvent): void {
    if (e.button !== 0) return;
    const inf = this.infer(e, this.start ? { from: this.start } : {});
    if (!this.start) {
      this.start = inf.point.clone();
      this.updateStatus();
      return;
    }
    const msg = this.describe(this.start, inf.point);
    this.app.ui.toast(msg, 6000);
    this.start = null;
    this.app.overlay.setRubberBand(null);
  }
}

// ---------------------------------------------------------------------------
// 座標（公共座標の確認・既知点で位置合わせ）
// ---------------------------------------------------------------------------

export class CoordTool extends Tool {
  readonly def: ToolDef = { id: 'coord', label: '座標', key: 'I', icon: 'coord' };

  hint(): string {
    return '点をクリックすると公共座標（平面直角座標・緯度経度）を表示します。既知の座標を入力してモデルの位置を合わせることもできます';
  }

  onPointerMove(e: PointerEvent): void {
    this.infer(e);
  }

  async onPointerDown(e: PointerEvent): Promise<void> {
    if (e.button !== 0) return;
    const inf = this.infer(e);
    const p = inf.point.clone();
    const geo = this.app.geo;
    const pub = geo.toPublic(p);
    const ll = geo.toLatLon(p);
    const res = await this.app.ui.form(
      '座標',
      [
        { key: 'X', label: 'X（北）m', type: 'number', value: formatCoord(pub.X) },
        { key: 'Y', label: 'Y（東）m', type: 'number', value: formatCoord(pub.Y) },
        { key: 'H', label: '標高 H m', type: 'number', value: formatCoord(pub.H) },
      ],
      {
        description:
          `平面直角座標 第${geo.zone}系` +
          (ll ? `<br>緯度 ${formatDms(ll.lat)}（${ll.lat.toFixed(8)}）<br>経度 ${formatDms(ll.lon)}（${ll.lon.toFixed(8)}）` : '') +
          '<br><small>値を書き換えて「位置合わせ」を押すと、この点がその公共座標になるようにプロジェクト原点を移動します。モデルはそのままで、公共座標で読み込んだ点群はモデルに対して移動します。</small>',
        okLabel: '位置合わせ',
        cancelLabel: '閉じる',
      },
    );
    if (!res) return;
    const X = Number(res.X);
    const Y = Number(res.Y);
    const H = Number(res.H);
    if (![X, Y, H].every(Number.isFinite)) return;
    if (Math.abs(X - pub.X) < 1e-4 && Math.abs(Y - pub.Y) < 1e-4 && Math.abs(H - pub.H) < 1e-4) return;
    // p が (X, Y, H) になる原点: origin = known - local
    geo.setOrigin(X + p.z, Y - p.x, H - p.y);
    this.app.ui.toast('プロジェクト原点を更新しました');
  }
}

// ---------------------------------------------------------------------------
// 視点操作（トラックパッド・タッチ用）
// ---------------------------------------------------------------------------

export class OrbitTool extends Tool {
  readonly def: ToolDef = { id: 'orbit', label: 'オービット', key: 'O', icon: 'orbit' };
  hint(): string {
    return 'ドラッグで視点を回転。ホイールでズーム（マウスの中ボタンでも回転できます）';
  }
  activate(): void {
    super.activate();
    this.app.viewport.setNavigationMode('orbit');
  }
  deactivate(): void {
    super.deactivate();
    this.app.viewport.setNavigationMode('default');
  }
}

export class PanTool extends Tool {
  readonly def: ToolDef = { id: 'pan', label: 'パン', key: 'H', icon: 'pan' };
  hint(): string {
    return 'ドラッグで視点を平行移動（Shift+中ボタン・右ボタンでも可）';
  }
  activate(): void {
    super.activate();
    this.app.viewport.setNavigationMode('pan');
  }
  deactivate(): void {
    super.deactivate();
    this.app.viewport.setNavigationMode('default');
  }
}

// ---------------------------------------------------------------------------
// 下図の位置・縮尺合わせ
// ---------------------------------------------------------------------------

export type UnderlayAdjustMode = 'scale' | 'move' | 'rotate' | 'known';

export class UnderlayAdjustTool extends Tool {
  readonly def: ToolDef = { id: 'underlay-adjust', label: '下図調整', key: '', icon: 'underlay' };
  vcbLabel = '実寸';
  target: Underlay | null = null;
  mode: UnderlayAdjustMode = 'scale';
  private p1: Vector3 | null = null;
  private p2: Vector3 | null = null;

  hint(): string {
    switch (this.mode) {
      case 'scale':
        return this.p1
          ? '寸法の分かっている 2 点目をクリック → 実寸を入力'
          : '縮尺合わせ: 下図上で寸法の分かっている 1 点目をクリック（例: 寸法線の端）';
      case 'move':
        return this.p1 ? '移動先をクリック' : '下図の移動: 基準点をクリック';
      case 'rotate':
        return !this.p1 ? '下図の回転: 回転の中心をクリック' : !this.p2 ? '基準方向をクリック' : '回転後の方向をクリック';
      case 'known':
        return '座標の分かっている点（基準点・測点など）を下図上でクリック → 公共座標を入力';
    }
  }

  reset(): void {
    this.p1 = null;
    this.p2 = null;
    super.reset();
  }

  onPointerMove(e: PointerEvent): void {
    const inf = this.infer(e, this.p1 ? { from: this.p1 } : {});
    if (this.p1) this.app.overlay.setRubberBand(this.p1, inf.point, inf);
    if (this.mode === 'rotate' && this.p1 && this.p2) {
      this.app.overlay.setPreviewLines([], [[this.p1, this.p2]]);
    }
  }

  async onPointerDown(e: PointerEvent): Promise<void> {
    if (e.button !== 0 || !this.target) return;
    const u = this.target;
    const inf = this.infer(e, this.p1 ? { from: this.p1 } : {});
    const p = inf.point.clone();
    const um = this.app.underlays;
    if (this.mode === 'known') {
      const geo = this.app.geo;
      const cur = geo.toPublic(p);
      const res = await this.app.ui.form('この点の公共座標', [
        { key: 'X', label: 'X（北）m', type: 'number', value: formatCoord(cur.X) },
        { key: 'Y', label: 'Y（東）m', type: 'number', value: formatCoord(cur.Y) },
      ]);
      if (res) {
        const target = geo.toLocal({ X: Number(res.X), Y: Number(res.Y), H: geo.toPublic(p).H });
        um.translate(u, p, target);
        this.app.ui.toast('下図を移動しました');
      }
      this.done();
      return;
    }
    if (!this.p1) {
      this.p1 = p;
      this.updateStatus();
      return;
    }
    if (this.mode === 'move') {
      um.translate(u, this.p1, p);
      this.done();
      return;
    }
    if (this.mode === 'rotate') {
      if (!this.p2) {
        this.p2 = p;
        this.updateStatus();
        return;
      }
      const a1 = Math.atan2(-(this.p2.z - this.p1.z), this.p2.x - this.p1.x);
      const a2 = Math.atan2(-(p.z - this.p1.z), p.x - this.p1.x);
      um.rotate(u, this.p1, a2 - a1);
      this.done();
      return;
    }
    // scale
    this.p2 = p;
    const cur = Math.hypot(p.x - this.p1.x, p.z - this.p1.z);
    const res = await this.app.ui.form('縮尺合わせ', [
      { key: 'len', label: '2 点間の実際の長さ（mm、m 付きも可）', type: 'text', value: String(Math.round(cur * 1000)) },
    ]);
    const len = res ? parseLength(String(res.len), 'mm') : null;
    if (len && len > 0) {
      um.calibrateScale(u, this.p1, this.p2, len);
      this.app.ui.toast(`縮尺を合わせました（${formatLength(len)}）`);
    }
    this.done();
  }

  private done(): void {
    this.reset();
    this.app.setTool('select');
  }
}
