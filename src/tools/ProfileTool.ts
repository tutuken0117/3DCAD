import { Vector3 } from 'three';
import { intersectProfiles, verticalNormal, type Profile, type SolidResult } from '../core/profileSolid';
import { formatLength, parseLength } from '../core/units';
import { Overlay } from '../view/Overlay';
import { VIEW_LABEL } from '../view/SheetManager';
import { Tool, type ToolDef } from './Tool';

interface Pick {
  profile: Profile;
  label: string;
  /** 同じ図面・面を二重に選ばないための識別子 */
  key: string;
}

/**
 * 図面から立体: 平面図・立面図・断面図の外形をクリックして選ぶと、
 * それぞれを押し出した立体の重なり（共通部分）をモデルにする。
 *  - 平面図だけ → 高さを入力して押し出し
 *  - 平面図 + 南立面図 → 切妻屋根などの建物
 *  - 平面図 + 南立面図 + 東立面図 → 寄棟など
 */
export class ProfileTool extends Tool {
  readonly def: ToolDef = { id: 'profile', label: '図面から立体', key: 'K', icon: 'profile' };
  vcbLabel = '高さ / 奥行き';
  private picks: Pick[] = [];
  private result: SolidResult | null = null;
  private lastEvent: PointerEvent | null = null;
  private token = 0;
  private count = 1;

  hint(): string {
    if (!this.picks.length) {
      return '平面図・立面図・断面図の外形の内側をクリック（つながった図形全体の外形を選びます。Alt+クリックで線に囲まれた部屋・窓などの範囲。図面が重なって見えるときは Tab で奥の図面に切替。モデルの面も使えます）';
    }
    if (this.picks.length === 1) {
      return this.picks[0].profile.kind === 'plan'
        ? '続けて立面図・断面図の外形をクリックすると重なりを立体化。高さを入力して Enter ならそのまま押し出し'
        : '続けて平面図や別の立面図の外形をクリック。奥行きを入力して Enter ならそのまま押し出し';
    }
    return `${this.picks.map((p) => p.label).join(' × ')} — Enter かダブルクリックで作成（図面を追加も可、Backspace で 1 つ戻す、Esc で取消）`;
  }

  reset(): void {
    this.picks = [];
    this.result = null;
    this.token++;
    super.reset();
  }

  /** カーソル位置で選べる外形（手前から順に。選択済みのものは除く） */
  private candidates(e: { clientX: number; clientY: number; altKey: boolean }): Pick[] {
    const app = this.app;
    const rc = app.viewport.raycaster(e.clientX, e.clientY);
    const list: { pick: Pick; distance: number }[] = [];
    for (const h of app.sheets.hitAll(rc.ray, (s) => !!s.segments?.length)) {
      const s = h.sheet;
      const poly = app.sheets.pickOutline(s, h.uv, e.altKey ? 'region' : 'outer');
      if (!poly) continue;
      const outline = poly.map(([u, v]) => app.sheets.toWorld(s, u, v));
      const profile: Profile =
        s.view === 'plan' ? { kind: 'plan', outline } : { kind: 'vertical', outline, axis: app.sheets.axisU(s) };
      list.push({ pick: { profile, label: s.name || VIEW_LABEL[s.view], key: `sheet:${s.id}` }, distance: h.distance });
    }
    const faceHit = app.renderer.pickFace(rc);
    if (faceHit) {
      const m = app.model;
      const n = m.faceNormal(faceHit.faceId);
      const outline = m.facePoints(faceHit.faceId).map((p) => p.clone());
      const holes = m.faceHolePoints(faceHit.faceId).map((h) => h.map((p) => p.clone()));
      const key = `face:${faceHit.faceId}`;
      if (Math.abs(n.y) > 0.999) list.push({ pick: { profile: { kind: 'plan', outline, holes }, label: '面（水平）', key }, distance: faceHit.distance });
      else if (Math.abs(n.y) < 1e-6) {
        const axis = new Vector3(n.z, 0, -n.x).normalize();
        list.push({ pick: { profile: { kind: 'vertical', outline, holes, axis }, label: '面（鉛直）', key }, distance: faceHit.distance });
      }
    }
    return list
      .sort((a, b) => a.distance - b.distance)
      .map((x) => x.pick)
      .filter((p) => !this.picks.some((q) => q.key === p.key));
  }

  /** Tab で奥の図面に切り替えた回数 */
  private cycle = 0;
  private lastPos = { x: 0, y: 0 };

  private candidate(e: { clientX: number; clientY: number; altKey: boolean }): Pick | null {
    const list = this.candidates(e);
    if (!list.length) return null;
    return list[this.cycle % list.length];
  }

  private showPreview(cand: Pick | null): void {
    const segs: [Vector3, Vector3][] = [];
    for (const p of this.picks) segs.push(...Overlay.outline(p.profile.outline));
    const dashed: [Vector3, Vector3][] = cand && !this.picks.some((p) => p.key === cand.key) ? Overlay.outline(cand.profile.outline) : [];
    if (this.result) {
      for (const f of this.result.faces) segs.push(...Overlay.outline(f.outer.map((i) => this.result!.points[i])));
    }
    this.app.overlay.setPreviewLines(segs, dashed);
  }

  onPointerMove(e: PointerEvent): void {
    if (Math.hypot(e.clientX - this.lastPos.x, e.clientY - this.lastPos.y) > 8) this.cycle = 0;
    this.lastPos = { x: e.clientX, y: e.clientY };
    this.lastEvent = e;
    const cand = this.candidate(e);
    if (cand) this.app.ui.setHint(`${cand.label} の外形　${this.picks.length ? '' : '（奥の図面を選ぶときは Tab）'}`);
    else this.updateStatus();
    this.showPreview(cand);
    this.app.overlay.showInference(null);
    if (!this.result) this.app.overlay.setPreviewFaces(cand ? [cand.profile.outline] : []);
  }

  onPointerDown(e: PointerEvent): void {
    if (e.button !== 0) return;
    const cand = this.candidate(e);
    if (!cand) {
      this.app.ui.toast('外形が見つかりません。図面（DXF/SXF の線）の閉じた図形の内側か、モデルの面をクリックしてください');
      return;
    }
    this.picks.push(cand);
    this.cycle = 0;
    this.updateStatus();
    void this.updateResult();
  }

  onDoubleClick(): void {
    if (this.picks.length >= 2) void this.commit();
  }

  /** 2 つ以上選んだら、重なりの立体をプレビュー */
  private async updateResult(): Promise<void> {
    const t = ++this.token;
    this.result = null;
    if (this.picks.length >= 2) {
      try {
        const r = await intersectProfiles(this.picks.map((p) => p.profile));
        if (t !== this.token) return;
        this.result = r;
        if (r) {
          this.app.overlay.setPreviewFaces(r.faces.map((f) => f.outer.map((i) => r.points[i])));
          this.app.ui.setVcbValue(`体積 ${r.volume.toFixed(2)} m³`);
        } else {
          this.app.overlay.setPreviewFaces([]);
          this.app.ui.toast('選んだ図形どうしが重なっていません。図面の位置合わせを確認してください');
        }
      } catch (err) {
        console.error(err);
        this.app.ui.toast('立体の計算に失敗しました');
      }
    }
    this.showPreview(null);
  }

  private async commit(length?: number): Promise<void> {
    if (!this.picks.length) return;
    let profiles = this.picks.map((p) => p.profile);
    if (length !== undefined) {
      if (profiles.length !== 1) return;
      const p = profiles[0];
      if (p.kind === 'plan') {
        const y0 = p.outline[0].y;
        profiles = [{ ...p, range: [Math.min(y0, y0 + length), Math.max(y0, y0 + length)] }];
      } else {
        // 立面図の奥（見る人と反対側）へ押し出す
        const d = p.outline[0].dot(verticalNormal(p.axis));
        profiles = [{ ...p, range: [Math.min(d, d - length), Math.max(d, d - length)] }];
      }
    } else if (profiles.length < 2) {
      this.app.ui.toast('立面図などをもう 1 つ選ぶか、高さ（奥行き）を入力してください');
      return;
    }
    const r = length === undefined && this.result ? this.result : await intersectProfiles(profiles);
    if (!r || !r.faces.length) {
      this.app.ui.toast('立体を作れませんでした（図形が重なっていない可能性があります）');
      return;
    }
    const gid = this.app.model.addPolyFacesAsGroup(r.points, r.faces, `立体${this.count++}`);
    if (gid === undefined) {
      this.app.ui.toast('立体を作れませんでした');
      return;
    }
    this.app.history.commit('図面から立体');
    const ents = this.app.model.groupEntities(gid);
    this.app.selection.set(ents.edges, ents.faces);
    this.app.ui.toast(`立体を作成しました（体積 ${r.volume.toFixed(2)} m³）。グループになっているので、ダブルクリックで中を編集できます`, 6000);
    this.reset();
  }

  onVcb(text: string): boolean {
    if (this.picks.length !== 1) return false;
    const len = parseLength(text);
    if (len === null || len === 0) return false;
    this.app.ui.setVcbValue(formatLength(len));
    void this.commit(len);
    return true;
  }

  onKeyDown(e: KeyboardEvent): boolean {
    if (e.key === 'Tab') {
      // 重なった図面のうち、奥のものに切り替え
      this.cycle++;
      if (this.lastEvent) this.onPointerMove(this.lastEvent);
      return true;
    }
    if (e.key === 'Enter') {
      void this.commit();
      return true;
    }
    if (e.key === 'Backspace' && this.picks.length) {
      this.picks.pop();
      this.updateStatus();
      void this.updateResult();
      return true;
    }
    return super.onKeyDown(e);
  }
}
