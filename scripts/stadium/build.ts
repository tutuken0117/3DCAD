/**
 * MAZDA Zoom-Zoom スタジアム広島の 3D モデル。
 * 形と高さは OpenStreetMap の 3D 建物データ（国土交通省の建物データ等をもとに入力された building:part、約 470 部分）から。
 * 座標: 球場中心付近 (34.3919, 132.4846) を原点に、東 +X・北 +Y（m）。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import Module from 'manifold-3d';
import { Vector3 } from 'three';
import { Model } from '../../src/core/Model';
import { meshToFaces } from '../../src/core/meshToFaces';
import { getFurniture, placeFurniture } from '../../src/core/furniture';
import { glyphs, textRings } from './text';

type Item = { id: string; tags: Record<string, string>; outer?: [number, number][][]; inner?: [number, number][][]; line?: [number, number][] | null; point?: [number, number] };
const [src, src2, out] = process.argv.slice(2);
const items: Item[] = JSON.parse(readFileSync(src, 'utf8'));
// 球場の中の細かいデータ（通路の階段など）
const inner: Item[] = JSON.parse(readFileSync(src2, 'utf8'));

const num = (v: string | undefined) => {
  if (!v) return undefined;
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : undefined;
};

const main = async () => {
  const M = await Module();
  M.setup();
  const { Manifold, CrossSection } = M;
  type Mf = InstanceType<typeof Manifold>;
  type Cs = InstanceType<typeof CrossSection>;
  const ccw = (p: [number, number][]) => {
    let a = 0;
    for (let i = 0; i < p.length; i++) a += p[i][0] * p[(i + 1) % p.length][1] - p[(i + 1) % p.length][0] * p[i][1];
    return a < 0 ? [...p].reverse() : p;
  };
  const shape = (it: Item): Cs | null => {
    if (!it.outer?.length) return null;
    let c = new CrossSection(it.outer.map((r) => ccw(r)), 'NonZero');
    if (it.inner?.length) c = c.subtract(new CrossSection(it.inner.map((r) => ccw(r)), 'NonZero'));
    return c.isEmpty() ? null : c;
  };
  const ext = (c: Cs, z0: number, z1: number): Mf => c.extrude(Math.max(0.01, z1 - z0)).translate([0, 0, z0]);
  const union = (l: Mf[]) => (l.length ? Manifold.union(l) : null);

  const model = new Model();
  const fromM = (x: number, y: number, z: number) => new Vector3(x, z, -y);
  type Rule = (n: Vector3, c: Vector3) => string;
  const add = (s: Mf | null, name: string, layer: string, rule: Rule | string) => {
    if (!s || s.isEmpty()) return;
    model.ensureLayer(layer);
    const mesh = s.getMesh();
    const np = mesh.numProp;
    const pts: Vector3[] = [];
    for (let i = 0; i < mesh.vertProperties.length; i += np) pts.push(fromM(mesh.vertProperties[i], mesh.vertProperties[i + 1], mesh.vertProperties[i + 2]));
    const tris: [number, number, number][] = [];
    for (let i = 0; i < mesh.triVerts.length; i += 3) tris.push([mesh.triVerts[i], mesh.triVerts[i + 1], mesh.triVerts[i + 2]]);
    const gid = model.addPolyFacesAsGroup(pts, meshToFaces(pts, tris), name, layer);
    if (!gid) return;
    for (const fid of model.groupEntities(gid).faces) {
      const f = model.faces.get(fid)!;
      const ps = model.facePoints(f);
      const c = ps.reduce((a, p) => a.add(p), new Vector3()).divideScalar(ps.length);
      const n = model.faceNormal(f);
      const r = typeof rule === 'string' ? rule : rule(new Vector3(n.x, -n.z, n.y), new Vector3(c.x, -c.z, c.y));
      f.color = r.startsWith('#') ? r : 'mat:' + r;
    }
  };

  // ---- 文字・広告の板 ----
  type P2 = [number, number];
  const deg = (r: number) => (r * 180) / Math.PI;
  /** t = 見る人から見て右向き。表（見る人の側）は n = (t1, -t0) */
  const nOf = (t: P2): P2 => [t[1], -t[0]];
  const deco = new Map<string, Mf[]>();
  const pushDeco = (name: string, color: string, s: Mf | null) => {
    if (!s || s.isEmpty()) return;
    const k = name + '|' + color;
    if (!deco.has(k)) deco.set(k, []);
    deco.get(k)!.push(s);
  };
  /** 平面の形 cs（x 右・y 上）を、点 p・高さ zc に、右向き t の壁へ貼る（壁から off 離し、厚さ th） */
  const place = (cs: Cs, p: P2, zc: number, t: P2, off: number, th: number): Mf => {
    const n = nOf(t);
    return cs.extrude(th).rotate([90, 0, 0]).rotate([0, 0, deg(Math.atan2(t[1], t[0]))]).translate([p[0] + n[0] * off, p[1] + n[1] * off, zc]);
  };
  /** 1 行の文字（中心が原点）。字の高さ size、幅は maxW まで */
  const textCs = (s: string, size: number, maxW = 1e9): Cs | null => {
    const r = textRings(s);
    if (!r || !r.rings.length) return null;
    const cs = new CrossSection(r.rings, 'NonZero');
    if (cs.isEmpty()) return null;
    const b = cs.bounds();
    const w = b.max[0] - b.min[0];
    const hh = b.max[1] - b.min[1];
    const k = Math.min(size / hh, maxW / w);
    return cs.translate([-(b.min[0] + b.max[0]) / 2, -(b.min[1] + b.max[1]) / 2]).scale(k);
  };
  const rect = (w: number, h: number) => CrossSection.square([w, h], true);
  /** 広告の板（背景色 bg・文字色 fg） */
  const adBoard = (p: P2, zc: number, t: P2, w: number, h: number, bg: string, fg: string, text: string, off = 0.02, name = '広告') => {
    pushDeco(name, bg, place(rect(w, h), p, zc, t, off, 0.05));
    const tc = textCs(text, h * 0.6, w * 0.86);
    if (tc) pushDeco(name + 'の文字', fg, place(tc, p, zc, t, off + 0.05, 0.02));
  };
  /** 折れ線（壁の前のふち）。at(s) で位置と向き */
  const polyline = (pts: P2[]) => {
    const L = [0];
    for (let i = 1; i < pts.length; i++) L.push(L[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    const len = L[L.length - 1];
    const at = (s: number): { p: P2; t: P2 } => {
      let i = 1;
      while (i < pts.length - 1 && L[i] < s) i++;
      const a = pts[i - 1];
      const b = pts[i];
      const l = Math.max(1e-6, L[i] - L[i - 1]);
      const f = (s - L[i - 1]) / l;
      return { p: [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f], t: [(b[0] - a[0]) / l, (b[1] - a[1]) / l] };
    };
    return { pts, len, at };
  };
  /** 曲がった壁に沿わせて 1 文字ずつ貼る（ベースラインの高さ z0、字の大きさ size） */
  const textAlong = (pl: ReturnType<typeof polyline>, sMid: number, z0: number, size: number, str: string, off: number, th: number, name: string, color: string, italic = 0) => {
    const gs = glyphs(str);
    const W = gs.reduce((a, g) => a + g.adv, 0) * size;
    let s = sMid - W / 2;
    for (const g of gs) {
      const sc = s + (g.adv * size) / 2;
      s += g.adv * size;
      if (!g.rings.length) continue;
      const rings = italic ? g.rings.map((r) => r.map(([x, y]) => [x + italic * y, y] as [number, number])) : g.rings;
      const cs = new CrossSection(rings, 'NonZero').translate([-g.adv / 2, 0]).scale(size);
      if (cs.isEmpty()) continue;
      const { p, t } = pl.at(sc);
      pushDeco(name, color, place(cs, p, z0, t, off, th));
    }
  };

  // ---- 球場の範囲 ----
  const stadium = items.find((i) => i.tags.leisure === 'stadium' && i.tags.sport === 'baseball')!;
  const stadiumCs = shape(stadium)!;
  const sb = stadiumCs.bounds();
  const inBox = (p: [number, number], m = 25) => p[0] > sb.min[0] - m && p[0] < sb.max[0] + m && p[1] > sb.min[1] - m && p[1] < sb.max[1] + m;
  const centroid = (it: Item): [number, number] => {
    const r = it.outer![0];
    return [r.reduce((a, p) => a + p[0], 0) / r.length, r.reduce((a, p) => a + p[1], 0) / r.length];
  };

  // ---- 部品（building:part）の立体化 ----
  /** skillion（片流れ）: 高い側 h、roof:direction（北から時計回り・下る向き）へ roof:height だけ下がる */
  const slope = (c: Cs, z0: number, h: number, rh: number, dirDeg: number, steps?: number): Mf | null => {
    const a = (dirDeg * Math.PI) / 180;
    const d: [number, number] = [Math.sin(a), Math.cos(a)];
    const q: [number, number] = [-d[1], d[0]];
    const poly = c.toPolygons().flat();
    if (!poly.length) return null;
    const ss = poly.map((p) => p[0] * d[0] + p[1] * d[1]);
    const s0 = Math.min(...ss);
    const s1 = Math.max(...ss);
    const L = Math.max(0.01, s1 - s0);
    if (steps && steps > 1) {
      // 段々（観客席）: 帯 j は高さ h - j*rh/n
      const pieces: Mf[] = [];
      for (let j = 0; j < steps; j++) {
        const cut = s0 + ((j + 1) * L) / steps + (j === steps - 1 ? 1 : 0);
        const rect = (sa: number, sb2: number): Cs => {
          const pts: [number, number][] = [
            [sa * d[0] - 500 * q[0], sa * d[1] - 500 * q[1]],
            [sb2 * d[0] - 500 * q[0], sb2 * d[1] - 500 * q[1]],
            [sb2 * d[0] + 500 * q[0], sb2 * d[1] + 500 * q[1]],
            [sa * d[0] + 500 * q[0], sa * d[1] + 500 * q[1]],
          ];
          return new CrossSection([ccw(pts)], 'Positive');
        };
        const part = c.intersect(rect(s0 - 1, cut));
        if (part.isEmpty()) continue;
        const top = h - (j * rh) / steps;
        if (top - z0 > 0.02) pieces.push(ext(part, z0, top));
      }
      return union(pieces);
    }
    const solid = ext(c, z0, h);
    if (rh <= 0.01) return solid;
    // z <= h - rh*(s - s0)/L を残す
    const k = rh / L;
    const nrm: [number, number, number] = [-k * d[0], -k * d[1], -1];
    const len = Math.hypot(...nrm);
    return solid.trimByPlane([nrm[0] / len, nrm[1] / len, nrm[2] / len], -(h + k * s0) / len);
  };

  // ---- グラウンド ----
  const pitch = items.find((i) => i.tags.leisure === 'pitch' && i.tags.sport === 'baseball')!;
  const smooth = (ring: [number, number][], iters = 3): [number, number][] => {
    let r = ring;
    for (let k = 0; k < iters; k++) {
      const o: [number, number][] = [];
      const n2 = r.length;
      for (let i = 0; i < n2; i++) {
        const p0 = r[(i + n2 - 1) % n2];
        const p1 = r[i];
        const p2 = r[(i + 1) % n2];
        const a1 = Math.atan2(p1[1] - p0[1], p1[0] - p0[0]);
        const a2 = Math.atan2(p2[1] - p1[1], p2[0] - p1[0]);
        const turn = Math.abs(((a2 - a1 + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
        if (turn > 0.01 && turn < 0.6) {
          o.push([p1[0] * 0.75 + p0[0] * 0.25, p1[1] * 0.75 + p0[1] * 0.25], [p1[0] * 0.75 + p2[0] * 0.25, p1[1] * 0.75 + p2[1] * 0.25]);
        } else o.push(p1);
      }
      r = o;
    }
    return r;
  };
  pitch.outer = pitch.outer!.map((r) => smooth(r));
  const pitchCs = shape(pitch)!;
  // スタンドの内側（グラウンド全体）は土、その上に芝
  add(ext(pitchCs, -0.025, 0.0), '天然芝', 'グラウンド', 'grass');
  // 本塁の位置: マウンドから 18.44m、外野の芝の重心と反対向き
  const ring0 = pitch.outer![0];
  let A = 0, gx = 0, gy = 0;
  for (let i = 0; i < ring0.length; i++) {
    const [x0, y0] = ring0[i];
    const [x1, y1] = ring0[(i + 1) % ring0.length];
    const a = x0 * y1 - x1 * y0;
    A += a; gx += (x0 + x1) * a; gy += (y0 + y1) * a;
  }
  gx /= 3 * A; gy /= 3 * A;
  const mr = pitch.inner![0];
  const mound: [number, number] = [mr.reduce((a, p) => a + p[0], 0) / mr.length, mr.reduce((a, p) => a + p[1], 0) / mr.length];
  const dl = Math.hypot(gx - mound[0], gy - mound[1]);
  const cf: [number, number] = [(gx - mound[0]) / dl, (gy - mound[1]) / dl];
  const home: [number, number] = [mound[0] - cf[0] * 18.44, mound[1] - cf[1] * 18.44];
  const rot = (v: [number, number], deg: number): [number, number] => {
    const a = (deg * Math.PI) / 180;
    return [v[0] * Math.cos(a) - v[1] * Math.sin(a), v[0] * Math.sin(a) + v[1] * Math.cos(a)];
  };
  const at = (dir: [number, number], r: number): [number, number] => [home[0] + dir[0] * r, home[1] + dir[1] * r];
  const d1 = rot(cf, -45); // 一塁線（右）
  const d3 = rot(cf, 45); // 三塁線（左）
  // ベース: 38.1cm 角・厚さ 5cm。一塁・三塁はフェア地域の内側に置き（角が塁線上）、二塁は中心を塁の位置に
  const B = 27.43;
  const angD1 = (Math.atan2(d1[1], d1[0]) * 180) / Math.PI;
  const bag = (c: [number, number]) => Manifold.cube([0.381, 0.381, 0.05], true).rotate([0, 0, angD1]).translate([c[0], c[1], 0.025]);
  const p1 = at(d1, B);
  const p3 = at(d3, B);
  const p2 = at(cf, B * Math.SQRT2);
  const h = 0.1905;
  const bags = Manifold.union([
    bag([p1[0] - d1[0] * h + d3[0] * h, p1[1] - d1[1] * h + d3[1] * h]),
    bag(p2),
    bag([p3[0] - d3[0] * h + d1[0] * h, p3[1] - d3[1] * h + d1[1] * h]),
  ]);
  // ホームプレート: 五角形（幅 43.2cm・奥行き 43.2cm、とがった角が捕手側）
  const ux = cf;
  const uy: [number, number] = [-cf[1], cf[0]];
  const hp: [number, number][] = [[0, 0], [0.216, 0.216], [0.432, 0.216], [0.432, -0.216], [0.216, -0.216]].map(([a, b2]) => [home[0] + ux[0] * a + uy[0] * b2, home[1] + ux[1] * a + uy[1] * b2] as [number, number]);
  const plate = new CrossSection([ccw(hp)], 'Positive').extrude(0.02);
  // 投手板の前から本塁までの白線（バッターボックス 1.83m×1.22m、本塁から 15.2cm 離す）
  const boxL = (side: number) => {
    const o = side * (0.216 + 0.152 + 0.61);
    const pts: [number, number][] = [[-0.915 + 0.216, o - 0.61], [0.915 + 0.216, o - 0.61], [0.915 + 0.216, o + 0.61], [-0.915 + 0.216, o + 0.61]].map(([a, b2]) => [home[0] + ux[0] * a + uy[0] * b2, home[1] + ux[1] * a + uy[1] * b2] as [number, number]);
    const outer = new CrossSection([ccw(pts)], 'Positive');
    return outer.subtract(outer.offset(-0.075, 'Square')).extrude(0.01);
  };
  // 本塁まわりの座標（a: 投手の方へ、b: 三塁側へ）で長方形
  const PR = (a0: number, a1: number, b0: number, b1: number) =>
    new CrossSection([ccw([[a0, b0], [a1, b0], [a1, b1], [a0, b1]].map(([a, b2]) => [home[0] + ux[0] * a + uy[0] * b2, home[1] + ux[1] * a + uy[1] * b2] as [number, number]))], 'Positive');
  /** 2 点を結ぶ幅 w の白線 */
  const seg = (p0: P2, p1: P2, w = 0.075) => {
    const L = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
    const tx = (p1[0] - p0[0]) / L;
    const ty = (p1[1] - p0[1]) / L;
    const nx = -ty * w / 2;
    const ny = tx * w / 2;
    return new CrossSection([ccw([[p0[0] + nx, p0[1] + ny], [p1[0] + nx, p1[1] + ny], [p1[0] - nx, p1[1] - ny], [p0[0] - nx, p0[1] - ny]])], 'Positive');
  };
  // キャッチャーボックス: 幅 43 インチ（1.09m）、バッターボックスの後ろの線から 8 フィート（2.44m）
  const aBack = -0.915 + 0.216;
  const cb = 1.092 / 2;
  const catcherBox = CrossSection.union([
    PR(aBack - 2.44, aBack, cb - 0.075, cb),
    PR(aBack - 2.44, aBack, -cb, -cb + 0.075),
    PR(aBack - 2.44, aBack - 2.44 + 0.075, -cb, cb),
  ]).extrude(0.01);
  add(Manifold.union([bags, plate, boxL(1), boxL(-1), catcherBox]), 'ベース・ホームプレート・バッターボックス・キャッチャーボックス', 'グラウンド', 'white');
  const lineTo = (dir: [number, number], len: number) => {
    const L2 = len;
    const ang = (Math.atan2(dir[1], dir[0]) * 180) / Math.PI;
    return Manifold.cube([L2, 0.1, 0.02]).translate([0, -0.05, 0.005]).rotate([0, 0, ang]).translate([home[0], home[1], 0]);
  };
  // ファウルラインはバッターボックスの中とホームプレートの所には引かない
  const boxesSolid = ext(CrossSection.union([PR(-0.699, 1.131, 0.368, 1.588), PR(-0.699, 1.131, -1.588, -0.368), PR(-0.1, 0.5, -0.3, 0.3)]), -1, 1);
  add(Manifold.union([lineTo(d1, 100), lineTo(d3, 101)]).subtract(boxesSolid), 'ファウルライン', 'グラウンド', 'white');
  // コーチャーボックス（塁線から 15 フィート＝4.57m 外、長さ 20 フィート＝6.1m、本塁側の端に 10 フィート＝3.05m の線）
  // スリーフットライン（一塁線の外 3 フィート＝0.914m、本塁から 45 フィート＝13.72m〜一塁）
  const marks: Cs[] = [];
  for (const [dl2, sg] of [[d1, -90], [d3, 90]] as [P2, number][]) {
    const f = rot(dl2, sg); // 塁線からファウル地域の方
    const P = (a: number, o: number): P2 => [home[0] + dl2[0] * a + f[0] * o, home[1] + dl2[1] * a + f[1] * o];
    marks.push(seg(P(19.8, 4.57), P(25.9, 4.57)), seg(P(19.8, 4.57), P(19.8, 7.62)), seg(P(25.9, 4.57), P(25.9, 7.62))); // 両端とも 3.05m の線
    if (sg < 0) marks.push(seg(P(13.72, 0.914), P(B, 0.914)), seg(P(13.72, 0), P(13.72, 0.914)));
  }
  add(ext(CrossSection.union(marks), 0, 0.01), 'コーチャーボックス・スリーフットライン', 'グラウンド', 'white');
  // ファウルポール（黄）
  add(Manifold.union([Manifold.cylinder(25, 0.3, 0.3, 12).translate([...at(d1, 100.4), 0]), Manifold.cylinder(25, 0.3, 0.3, 12).translate([...at(d3, 101.4), 0])]), 'ファウルポール', 'グラウンド', 'paint-yellow');
  console.log('home', home, 'cf', cf);

  // ================= 細部 =================
  let lfPit: Cs | null = null;
  let podiumPit: Cs | null = null;
  const FC: [number, number] = [home[0] + cf[0] * 45, home[1] + cf[1] * 45]; // フィールドの中心付近
  // グラウンドのすぐ外（芝のふちから 20m 以内）にあって、グラウンドの方を向いた低い縦の面
  const inRings = (rings: [number, number][][], x: number, y: number) => rings.some((r) => {
    let ins = false;
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const [xi, yi] = r[i];
      const [xj, yj] = r[j];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) ins = !ins;
    }
    return ins;
  });
  const fieldRings = pitchCs.offset(20, 'Round', 2, 64).toPolygons();
  const playRings = pitchCs.offset(10, 'Round', 2, 64).toPolygons(); // 芝＋土・ウォーニングトラック（ポール際の角を含む）
  // 面の 4m 前がグラウンド（芝から 10m 以内）なら、グラウンドから見える面（横を向いたスタンドの端の壁も含む）
  const fieldWall = (nn: Vector3, cc: Vector3) =>
    Math.abs(nn.z) < 0.3 && cc.z < 6 && inRings(fieldRings, cc.x, cc.y) && inRings(playRings, cc.x + nn.x * 4, cc.y + nn.y * 4);
  const azOf = (p: [number, number]) => ((Math.atan2(p[0] - home[0], p[1] - home[1]) * 180) / Math.PI + 360) % 360; // 本塁からの方位（北 0・時計回り）
  const angDiff = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180);
  const put = (id: string, x: number, y: number, z: number, rotDeg: number, layer = '家具') => {
    const def = getFurniture(id);
    if (!def) throw new Error('no furniture ' + id);
    placeFurniture(model, def, new Vector3(x, z, -y), (rotDeg * Math.PI) / 180, layer);
  };
  const pointIn = (c: Cs, p: [number, number]) => !c.intersect(CrossSection.square([0.02, 0.02], true).translate(p)).isEmpty();
  /** 方向 d（単位ベクトル）の座標で sa〜sb の帯 */
  const band = (d: [number, number], sa: number, sb2: number): Cs => {
    const q: [number, number] = [-d[1], d[0]];
    const pts: [number, number][] = [
      [sa * d[0] - 600 * q[0], sa * d[1] - 600 * q[1]],
      [sb2 * d[0] - 600 * q[0], sb2 * d[1] - 600 * q[1]],
      [sb2 * d[0] + 600 * q[0], sb2 * d[1] + 600 * q[1]],
      [sa * d[0] + 600 * q[0], sa * d[1] + 600 * q[1]],
    ];
    return new CrossSection([ccw(pts)], 'Positive');
  };
  // 通路（階段）: OSM の highway=steps（観客席の中の「北 1」「南 23」など）を幅 1.1m の帯に
  const aisleSegs: Cs[] = [];
  for (const it of inner) {
    if (it.tags.highway !== 'steps' || !it.line) continue;
    const lv = it.tags.level ?? '';
    if (!['2', '5', '1;2', '4', '4;5', '2;4'].includes(lv)) continue;
    for (let k = 0; k + 1 < it.line.length; k++) {
      const [ax, ay] = it.line[k];
      const [bx, by] = it.line[k + 1];
      const L = Math.hypot(bx - ax, by - ay);
      if (L < 0.05) continue;
      const ux = (bx - ax) / L;
      const uy = (by - ay) / L;
      const w = 0.55;
      aisleSegs.push(new CrossSection([ccw([[ax - uy * w - ux * 0.3, ay + ux * w - uy * 0.3], [bx - uy * w + ux * 0.3, by + ux * w + uy * 0.3], [bx + uy * w + ux * 0.3, by - ux * w + uy * 0.3], [ax + uy * w - ux * 0.3, ay - ux * w - uy * 0.3]])], 'Positive'));
    }
  }
  const aisles = aisleSegs.length ? CrossSection.union(aisleSegs) : new CrossSection([], 'Positive');
  console.log('aisle segments', aisleSegs.length);

  type Seat = { it: Item; c: Cs; z0: number; h: number; rh: number; dir: number; az: number; dist: number };
  const seatsAll: Seat[] = [];
  const treads: Mf[] = [];
  const seatBlocks: Mf[] = [];
  const tatami: Mf[] = [];
  const frontFences: Mf[] = [];
  const terraces: { name: string; solids: Mf[] }[] = [];
  /** 観客席: 段（蹴上げ・踏面）と、段ごとの座席（座面＋背もたれ）。通路は座席を抜く */
  const seatBowl = (s: Seat, mode: 'seats' | 'tatami' | 'terrace', terraceName = '') => {
    const a = (s.dir * Math.PI) / 180;
    const d: [number, number] = [Math.sin(a), Math.cos(a)];
    const poly = s.c.toPolygons().flat();
    const ss = poly.map((p) => p[0] * d[0] + p[1] * d[1]);
    const s0 = Math.min(...ss);
    const s1 = Math.max(...ss);
    const L = Math.max(0.01, s1 - s0);
    const n = mode === 'terrace' ? Math.max(2, Math.round(s.rh / 0.9)) : Math.max(2, Math.round(L / 0.85));
    const D = L / n;
    const tsol: Mf[] = [];
    // グラウンドに面した 1 階スタンドは、前面を濃い緑のフェンスにする（地図データの壁の色 #3a5b56）
    const outfieldStand = Math.abs(((s.az - azOf(at(cf, 50)) + 540) % 360) - 180) < 47 && s.dist > 85;
    const hasFence = (mode === 'seats' || mode === 'terrace') && s.z0 < 1 && !outfieldStand; // 地図データに色がない区画（両翼のファウル側）も同じ濃い緑に
    if (hasFence) {
      const fb = s.c.intersect(band(d, s0 + L - 0.3, s0 + L + 1));
      if (!fb.isEmpty()) frontFences.push(ext(fb, s.z0, s.h - s.rh + 0.45));
    }
    for (let j = 0; j < n; j++) {
      const top = s.h - (j * s.rh) / n;
      const piece = s.c.intersect(band(d, j === 0 ? s0 - 1 : s0 + j * D, s0 + (j + 1) * D + (j === n - 1 ? (hasFence ? -0.3 : 1) : 0)));
      if (piece.isEmpty() || top - s.z0 < 0.02) continue;
      // 鯉桟敷は最上段だけ（公式座席図）。それより下は普通の座席
      const m = mode === 'tatami' && j >= Math.max(3, Math.round(n * 0.3)) ? 'seats' : mode;
      (m === 'seats' ? treads : tsol).push(ext(piece, s.z0, top));
      if (m === 'seats' && D > 0.6) {
        const sb = s0 + j * D;
        const seat = s.c.intersect(band(d, sb + 0.1, sb + Math.min(0.55, D - 0.25))).subtract(aisles);
        const back = s.c.intersect(band(d, sb + 0.05, sb + 0.13)).subtract(aisles);
        if (!seat.isEmpty()) seatBlocks.push(ext(seat, top, top + 0.42));
        if (!back.isEmpty()) seatBlocks.push(ext(back, top + 0.42, top + 0.82));
      }
      if (m === 'tatami') {
        // 掘りごたつ式の座卓（2m おき）
        const mid = s0 + (j + 0.5) * D;
        const q: [number, number] = [-d[1], d[0]];
        const qs = poly.map((p) => p[0] * q[0] + p[1] * q[1]);
        for (let t = Math.min(...qs) + 1.2; t < Math.max(...qs) - 1; t += 2.2) {
          const p: [number, number] = [d[0] * mid + q[0] * t, d[1] * mid + q[1] * t];
          if (pointIn(s.c, p)) tatami.push(Manifold.cube([0.9, 0.45, 0.3], true).rotate([0, 0, (Math.atan2(q[1], q[0]) * 180) / Math.PI]).translate([p[0], p[1], top + 0.15]));
        }
      }
      if (mode === 'terrace') {
        const mid = s0 + (j + 0.5) * D;
        const q: [number, number] = [-d[1], d[0]];
        const qs = poly.map((p) => p[0] * q[0] + p[1] * q[1]);
        for (let t = Math.min(...qs) + 1.6; t < Math.max(...qs) - 1.4; t += 3.2) {
          const p: [number, number] = [d[0] * mid + q[0] * t, d[1] * mid + q[1] * t];
          if (pointIn(s.c, p) && D > 2.2) put('dining-set', p[0], p[1], top, s.dir + 90);
        }
      }
    }
    if (mode === 'tatami') tatami.push(...tsol);
    if (mode === 'terrace') terraces.push({ name: terraceName, solids: tsol });
  };
  const parts = items.filter((i) => (i.tags['building:part'] || i.tags.building) && i.outer?.length);
  const partItems = parts.filter((i) => i.tags['building:part'] && inBox(centroid(i)));
  // 部品を含む外形（building だけで building:part なし）は描かない
  const partCentroids = partItems.map(centroid);
  const outlineOnly = (it: Item) => {
    const c = shape(it);
    if (!c) return true;
    const poly = c.toPolygons();
    const inside = (p: [number, number]) => poly.some((r) => {
      let ins = false;
      for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
        const [xi, yi] = r[i];
        const [xj, yj] = r[j];
        if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) ins = !ins;
      }
      return ins;
    });
    return partCentroids.some(inside);
  };

  const groups = new Map<string, { solids: Mf[]; rule: Rule | string; layer: string }>();
  const push = (key: string, layer: string, rule: Rule | string, s: Mf | null) => {
    if (!s) return;
    let g = groups.get(key);
    if (!g) groups.set(key, (g = { solids: [], rule, layer }));
    g.solids.push(s);
  };
  // OSM の色: ピンク（#d46585）は観客席の赤い座席として赤に
  const hex = (v: string | undefined) => {
    if (!v || !/^#[0-9a-f]{6}$/i.test(v)) return undefined;
    const h = v.toLowerCase();
    if (h === '#a6716d') return 'siding-red'; // 外壁の赤茶色の波板（写真）
    return h === '#d46585' ? 'paint-red' : h;
  };

  let nSeat = 0;
  for (const it of partItems) {
    if (it.id === 'r8829147') continue; // 砂かぶり席として後で作る
    if (['r8829162', 'r8927650', 'r8927651', 'r8927652'].includes(it.id) || /^r88291(6[3-9]|7[0-6])$/.test(it.id)) continue; // レフトスタンドは後で作る
    const t = it.tags;
    const c = shape(it);
    if (!c) continue;
    const h = num(t.height) ?? (num(t['building:levels']) ?? 1) * 3.2;
    const rh = num(t['roof:height']) ?? 0;
    const minH = num(t.min_height) ?? (t['building:part'] === 'steps' && t['roof:shape'] === 'skillion' && !t.min_height ? 0 : 0);
    const dir = num(t['roof:direction']);
    if (t['tower:type'] === 'lighting') {
      push('照明塔の照明', '照明塔', 'light', ext(c, minH, h));
      continue;
    }
    if (t['building:part'] === 'steps') {
      const n = Math.max(2, Math.round(rh / (num(t['step:height']) ?? 0.15)));
      push('観客席（段々）', 'スタンド', (nn, cc) => (nn.z > 0.5 ? 'paint-red' : fieldWall(nn, cc) && cc.z < 2.5 ? '#3a5b56' : 'concrete'), slope(c, minH, h, rh, dir ?? 0, Math.min(n, 60)));
      nSeat++;
      continue;
    }
    const sk = t['roof:shape'] === 'skillion' && dir !== undefined && rh > 0;
    if (sk && t.building !== 'roof' && rh >= 0.8) {
      // 観客席か: 低い方（roof:direction）がグラウンドの方を向いていて、勾配が急
      const cc = centroid(it);
      const toF = ((Math.atan2(FC[0] - cc[0], FC[1] - cc[1]) * 180) / Math.PI + 360) % 360;
      const a2 = (dir! * Math.PI) / 180;
      const ss2 = c.toPolygons().flat().map((p) => p[0] * Math.sin(a2) + p[1] * Math.cos(a2));
      const L2 = Math.max(...ss2) - Math.min(...ss2);
      if (angDiff(dir!, toF) < 75 && rh / L2 > 0.12) {
        seatsAll.push({ it, c, z0: minH, h, rh, dir: dir!, az: azOf(cc), dist: Math.hypot(cc[0] - home[0], cc[1] - home[1]) });
        nSeat++;
        continue;
      }
    }
    const s = sk ? slope(c, minH, h, rh, dir!) : ext(c, minH, h);
    const roofC = hex(t['roof:colour']);
    const wallC = hex(t['building:colour']);
    const glass = t['building:material'] === 'glass';
    const isRoof = t.building === 'roof';
    const key = `${isRoof ? '屋根' : '建物'}|${roofC ?? ''}|${wallC ?? ''}|${glass}`;
    push(key, isRoof ? '屋根・ひさし' : 'スタンド', (nn, cc) => {
      if (!isRoof && !glass && minH < 1 && fieldWall(nn, cc)) return '#3a5b56'; // グラウンドに面した低い壁はフェンスと同じ濃い緑（ガラスの記者席・上の階は除く）
      if (nn.z > 0.3) return roofC ?? (isRoof ? 'galva-silver' : 'concrete');
      if (nn.z < -0.3) return isRoof ? 'steel-white' : 'concrete';
      return glass ? 'glass' : wallC ?? (isRoof ? 'steel-white' : 'concrete');
    }, s);
  }
  // ---- 観客席の割り当て（公開の座席案内から: 位置はおおよそ）----
  // 方位: 本塁から北 0・時計回り
  const az3 = azOf(at(d3, 50));
  const az1 = azOf(at(d1, 50));
  const lower = (x: Seat) => x.z0 < 1 && x.dist < 105;
  const pick = (f: (x: Seat) => boolean, by: (x: Seat) => number) => seatsAll.filter(f).sort((p, q) => by(p) - by(q))[0];
  // びっくりテラス（内野 1 階・一塁側、BBQ）: 一塁側 1 階席のうち一番ライト寄り
  const bikkuri = pick((x) => lower(x) && angDiff(x.az, az1) < 30 && x.dist > 40, (x) => angDiff(x.az, az1));
  // パーティーデッキ（内野 1 階・三塁側）: 三塁側 1 階席のうち一番レフト寄り
  const pdeck = pick((x) => lower(x) && angDiff(x.az, az3) < 30 && x.dist > 40, (x) => angDiff(x.az, az3));
  // 鯉桟敷（三塁側・内野指定席 B の上）: 三塁側 1 階席の最上段寄りの区画
  // 鯉桟敷（公式座席図 13）: パーティーデッキ内野のとなり、レフト寄りの 3 区画の最上段
  const kois = seatsAll.filter((x) => lower(x) && x !== pdeck && x.dist > 40 && angDiff(x.az, az3) < 40).sort((p, q2) => angDiff(p.az, az3) - angDiff(q2.az, az3)).slice(0, 3);
  const koi = kois[0];
  console.log('special', bikkuri?.it.id, pdeck?.it.id, koi?.it.id);
  for (const x of seatsAll) {
    if (x === bikkuri) seatBowl(x, 'terrace', 'びっくりテラス（一塁側 1 階・BBQ 席）');
    else if (x === pdeck) seatBowl(x, 'terrace', 'パーティーデッキ（三塁側 1 階）');
    else if (kois.includes(x)) seatBowl(x, 'tatami');
    else seatBowl(x, 'seats');
  }
  // 名前のある席の名前を、その区画に付ける
  const named = seatsAll.filter((x) => x.it.tags.name).map((x) => x.it.tags.name);
  console.log('named seats', named);
  const seatRings = seatsAll.length ? CrossSection.union(seatsAll.map((x) => x.c)).toPolygons() : [];
  add(union(treads), '観客席の段（コンクリート）', 'スタンド', (n, c) => {
    if (n.z > 0.5) return 'mortar-gray';
    // スタンドの外側のふち（面の 0.4m 前がスタンドの外）でグラウンドから見える面はラバーと同じ濃い緑。段の立ち上がり（前が次の段）はコンクリート
    return fieldWall(n, c) && !inRings(seatRings, c.x + n.x * 0.4, c.y + n.y * 0.4) ? '#3a5b56' : 'concrete';
  });
  add(union(seatBlocks), '座席（赤）', 'スタンド', 'paint-red');
  add(union(frontFences), 'スタンド前面のフェンス（濃い緑）', 'スタンド', '#3a5b56');
  add(union(tatami), '鯉桟敷（畳・掘りごたつ）', 'スタンド', (n) => (n.z > 0.5 ? 'tatami' : 'wood-light'));
  for (const t of terraces) add(union(t.solids), t.name, 'スタンド', (n) => (n.z > 0.5 ? 'deck' : '#3a5b56')); // 段の立ち上がりはフェンスと同じ濃い緑

  // ---- 砂かぶり席（グラウンドの高さ・正面と一・三塁側）とダッグアウト ----
  {
    const fronts = seatsAll.filter((x) => x.z0 < 1).map((x) => x.c);
    const podium = partItems.find((i) => i.id === 'r8829147'); // 本塁裏〜一・三塁側の前の低い台（高さ 2m）= 砂かぶり席の場所
    if (fronts.length && podium) {
      const U = CrossSection.union(fronts);
      const keep = shape(podium)!;
      const off = (o: number) => U.offset(o, 'Round', 2, 64);
      // ダッグアウト（一塁側・三塁側。本塁から 28〜42m のあたりの席の前）
      const dug: Cs[] = [];
      const dugSolids: Mf[] = [];
      const dugRoof: Mf[] = [];
      const dugRail: Mf[] = [];
      const dugBench: Mf[] = [];
      const dugRack: Mf[] = [];
      const camWall: Mf[] = [];
      const dugBanner: Mf[] = [];
      const dugMesh: Mf[] = [];
      const dugNet: Mf[] = [];
      const dugPole: Mf[] = [];
      const dugChair: Mf[] = [];
      const pressWall: Mf[] = [];
      const pressRoof: Mf[] = [];
      const pressDesk: Mf[] = [];
      const front = CrossSection.union(partItems.filter((i) => (num(i.tags.min_height) ?? 0) < 1 && !i.tags['tower:type']).map((i) => shape(i)).filter((x): x is Cs => !!x)).offset(1.5, 'Round', 2, 64).toPolygons();
      const inFront = (p: [number, number]) => front.some((r) => {
        let ins = false;
        for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
          const [xi, yi] = r[i];
          const [xj, yj] = r[j];
          if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) ins = !ins;
        }
        return ins;
      });
      for (const [dl2, sgn] of [[d1, 1], [d3, -1]] as [[number, number], number][]) {
        // 線から外側へ進んで席の前に当たる所
        const out2 = rot(dl2, sgn * -90);
        const base0 = at(dl2, 21);
        let t = 3;
        while (t < 40 && !inFront([base0[0] + out2[0] * t, base0[1] + out2[1] * t])) t += 0.25;
        if (t >= 40) { console.log('dugout not found', sgn); continue; }
        // t はスタンドの前のふちの 1.5m 手前。ベンチはふちから奥へ 4m（グラウンドにはみ出さない）
        const cx = base0[0] + out2[0] * (t + 1.5 + 2.0);
        const cy = base0[1] + out2[1] * (t + 1.5 + 2.0);
        const ang = (Math.atan2(dl2[1], dl2[0]) * 180) / Math.PI;
        // ダッグアウト（ベンチ）: 長さ 18m・奥行き 4m、床はグラウンドより 0.9m 低い（Wikipedia: 内野最前列は約 90cm 掘り込み）
        const LEN = 18;
        const DEP = 4;
        const R = (w: number, h: number, along: number, outw: number) =>
          CrossSection.square([w, h], true).rotate(ang).translate([cx + dl2[0] * along + out2[0] * outw, cy + dl2[1] * along + out2[1] * outw]);
        const foot = R(LEN, DEP, 0, 0);
        dug.push(foot);
        const FL = -0.9;
        dugSolids.push(ext(foot, FL - 0.15, FL)); // 床
        dugSolids.push(ext(R(LEN, 0.3, 0, DEP / 2 - 0.15), FL, 1.55)); // 奥の壁
        dugSolids.push(ext(R(0.3, DEP, -LEN / 2 + 0.15, 0), FL, 1.55), ext(R(0.3, DEP, LEN / 2 - 0.15, 0), FL, 1.55)); // 両端の壁
        dugSolids.push(ext(R(LEN - 0.6, 0.2, 0, -DEP / 2 + 0.1), FL, 0.0)); // 前（グラウンドの高さまで）
        dugRoof.push(ext(R(LEN + 0.4, DEP * 0.85, 0, DEP * 0.075), 1.35, 1.6)); // 屋根（グラウンドから 1.35m。写真: 前の開口は大人の胸くらい）
        dugRail.push(ext(R(LEN - 0.6, 0.06, 0, -DEP / 2 + 0.1), 0.95, 1.02)); // 手すり
        for (let k = -4; k <= 4; k++) dugRail.push(ext(R(0.06, 0.06, k * 2, -DEP / 2 + 0.1), 0.0, 1.35)); // 屋根を支える細い柱
        dugBench.push(ext(R(LEN - 2.4, 0.4, 0, DEP / 2 - 0.62), FL, FL + 0.41)); // 椅子の台
        dugRack.push(ext(R(3, 0.3, -LEN / 2 + 2.2, DEP / 2 - 0.45), FL, FL + 1.3), ext(R(2, 0.3, LEN / 2 - 2, DEP / 2 - 0.45), FL, FL + 1.5)); // バットラック・ヘルメット棚
        // 両端の階段（2 段）
        for (const e of [-1, 1]) {
          dugSolids.push(ext(R(1.2, 1.4, e * (LEN / 2 - 0.9), -DEP / 2 + 0.7), FL, FL + 0.3), ext(R(1.2, 0.7, e * (LEN / 2 - 0.9), -DEP / 2 + 0.35), FL, FL + 0.6));
        }
        // カメラマン席（ダッグアウトの外野寄りの横・写真）: 床 -0.9m の掘り込み。前はグラウンドから 0.9m の緑の塀（がんばれ!カープ SOGO）、
        // 中に明るい灰色のカメラ台（階段付き）、後ろ半分だけ灰色の屋根、奥の壁に緑のロッカーと棚
        {
          const PB = R(12, 3.2, LEN / 2 + 0.4 + 6, -0.4);
          dug.push(PB);
          dugSolids.push(ext(PB, FL - 0.15, FL));
          pressWall.push(ext(R(12, 0.25, LEN / 2 + 0.4 + 6, -0.4 + 1.475), FL, 1.2), ext(R(0.25, 3.2, LEN / 2 + 0.4 + 0.125, -0.4), FL, 1.2), ext(R(0.25, 3.2, LEN / 2 + 0.4 + 12 - 0.125, -0.4), FL, 1.2));
          camWall.push(ext(R(12, 0.25, LEN / 2 + 0.4 + 6, -0.4 - 1.475), FL, 0.9)); // 前の塀（グラウンドから 0.9m、その上は開いている）
          {
            const tF2: P2 = [out2[1], -out2[0]];
            const C2 = (along: number, outw: number): P2 => [cx + dl2[0] * along + out2[0] * outw, cy + dl2[1] * along + out2[1] * outw];
            const tc = textCs('がんばれ!カープ   SOGO', 0.42, 8);
            if (tc) pushDeco('カメラマン席の前の広告（白文字）', 'white', place(tc, C2(LEN / 2 + 0.4 + 6, -0.4 - 1.6), 0.45, tF2, 0.01, 0.02));
          }
          pressRoof.push(ext(R(12.4, 1.7, LEN / 2 + 0.4 + 6, -0.4 + 0.85), 1.05, 1.2)); // 後ろ半分だけの屋根
          pressWall.push(ext(R(5, 0.5, LEN / 2 + 0.4 + 4, -0.4 + 1.1), FL, FL + 1.3)); // ロッカー
          pressDesk.push(ext(R(9, 1.3, LEN / 2 + 0.4 + 7, -0.4 - 0.3), FL, FL + 0.6), ext(R(0.8, 0.6, LEN / 2 + 0.4 + 2.1, -0.4 - 0.3), FL, FL + 0.3)); // カメラ台と階段
        }
        // 写真（ベンチ）: 屋根の前の縁に白い MIZUNO、前の手すりに緑の帯の広告（デオデオ / DEODEO）と下の金網、
        // 屋根の上に客席を守る防球ネット（黒い細い柱と黒いネット）、中は緑の 1 人掛けの椅子
        {
          const tF: P2 = [out2[1], -out2[0]]; // 正面（グラウンド）から見て右向き
          const C = (along: number, outw: number): P2 => [cx + dl2[0] * along + out2[0] * outw, cy + dl2[1] * along + out2[1] * outw];
          const roofFront = -DEP * 0.35;
          for (let a = -LEN / 2 + 2.5; a < LEN / 2 - 1; a += 4.5) {
            const tc = textCs('MIZUNO', 0.24, 2.4);
            if (tc) pushDeco('ベンチの屋根の広告（白文字）', 'white', place(tc, C(a, roofFront), 1.47, tF, 0.01, 0.02));
          }
          // 前の手すりの帯（0.75〜1.05m）と下の金網
          dugBanner.push(place(rect(LEN - 0.6, 0.3), C(0, -DEP / 2 + 0.1), 0.9, tF, 0.04, 0.04));
          dugMesh.push(place(rect(LEN - 0.6, 0.75), C(0, -DEP / 2 + 0.1), 0.375, tF, 0.0, 0.02));
          for (let a = -LEN / 2 + 1.8, i = 0; a < LEN / 2 - 1; a += 3.2, i++) {
            const tc = textCs(i % 2 ? 'DEODEO' : 'デオデオ', 0.2, 2.6);
            if (tc) pushDeco('ベンチ前の広告（白文字）', 'white', place(tc, C(a, -DEP / 2 + 0.1), 0.9, tF, 0.09, 0.02));
          }
          // 屋根の上の防球ネット（屋根の前の縁・高さ 1.6〜4.4m・柱 3m おき）
          dugNet.push(place(rect(LEN + 0.4, 2.8), C(0, roofFront + 0.1), 3.0, tF, 0, 0.02));
          for (let a = -LEN / 2; a <= LEN / 2 + 0.01; a += 3) {
            const pp = C(a, roofFront + 0.1);
            dugPole.push(Manifold.cylinder(2.9, 0.04, 0.04, 8).translate([pp[0], pp[1], 1.6]));
          }
          // 1 人掛けの椅子（緑）
          for (let a = -LEN / 2 + 1.6; a < LEN / 2 - 1.4; a += 0.62) {
            const pp = C(a, DEP / 2 - 0.62);
            dugChair.push(Manifold.cube([0.5, 0.45, 0.08], true).rotate([0, 0, ang]).translate([pp[0], pp[1], FL + 0.45]));
            const pb = C(a, DEP / 2 - 0.4);
            dugChair.push(Manifold.cube([0.5, 0.06, 0.45], true).rotate([0, 0, ang]).translate([pb[0], pb[1], FL + 0.72]));
          }
        }
        console.log('dugout', sgn, t);
      }
      const dugU = CrossSection.union(dug);
      add(union(dugSolids), 'ダッグアウト（ベンチ）の床・壁・階段', 'スタンド', (n) => (n.z > 0.5 ? 'mortar-gray' : '#3a5b56')); // 写真: 壁は緑
      add(union(dugRoof), 'ダッグアウトの屋根', 'スタンド', (n) => (n.z > 0.5 ? 'galva-white' : '#3a5b56'));
      add(union(dugRail), 'ダッグアウトの手すり', 'スタンド', 'steel-white');
      add(union(dugBench), 'ダッグアウトの椅子の台', 'スタンド', 'concrete');
      add(union(dugChair), 'ダッグアウトの椅子（緑）', 'スタンド', '#2f6f4e');
      add(union(pressWall), 'カメラマン席の壁', 'スタンド', '#3a5b56');
      add(union(pressRoof), 'カメラマン席の屋根（灰色）', 'スタンド', '#7d8488');
      add(union(pressDesk), 'カメラマン席のカメラ台', 'スタンド', '#c9ccc8');
      add(union(dugBanner), 'ベンチ前の手すりの広告の帯', 'スタンド', '#22553f');
      add(union(dugMesh), 'ベンチ前の金網', 'スタンド', 'net-black');
      add(union(dugNet), 'ベンチ上の防球ネット', 'スタンド', 'net-black');
      add(union(dugPole), 'ベンチ上の防球ネットの柱', 'スタンド', '#24282a');
      add(union(dugRack), 'バットラック・ヘルメット棚', 'スタンド', 'wood-walnut');
      add(union(camWall), 'カメラマン席の前の塀', 'スタンド', '#3a5b56');
      podiumPit = dugU;
      // 台（高さ 2m）を、スタンド側が高くグラウンド側が低い段々の席にする（1 段 0.95m・蹴上げ 0.33m）
      const W = 0.95;
      const sk2: Mf[] = [];
      const st2: Mf[] = [];
      let used = off(0);
      // スタンド側から下がり、最前列はグラウンドより低い（最前列の観客の胸がグラウンドの高さ）
      // ネット裏（本塁の真後ろ）は席ではなく舞台のような平地（航空写真: 本塁裏の三角形の平らな所）
      const SW = 17;
      const stageCs = new CrossSection([ccw([home, at(rot(cf, 180 - SW), 45), at(rot(cf, 180), 46), at(rot(cf, 180 + SW), 45)])], 'Positive').intersect(keep).subtract(dugU);
      for (let k = 0; k < 10; k++) {
        const ringK = off((k + 1) * W).subtract(off(k * W)).intersect(keep).subtract(dugU).subtract(stageCs);
        if (ringK.isEmpty()) continue;
        const top = Math.max(-0.75, 1.85 - k * 0.33);
        st2.push(ext(ringK, -1.1, top));
        const seat = off(k * W + 0.55).subtract(off(k * W + 0.1)).intersect(keep).subtract(dugU).subtract(aisles).subtract(stageCs);
        const back = off(k * W + 0.13).subtract(off(k * W + 0.05)).intersect(keep).subtract(dugU).subtract(aisles).subtract(stageCs);
        if (!seat.isEmpty()) sk2.push(ext(seat, top, top + 0.42));
        if (!back.isEmpty()) sk2.push(ext(back, top + 0.42, top + 0.82));
        used = off((k + 1) * W);
      }
      // 席の前（グラウンド側）の通路
      const rest = keep.subtract(used).subtract(dugU).subtract(stageCs);
      if (!stageCs.isEmpty()) {
        // 写真: 本塁の真後ろは緑の低い建物（窓のある部屋）。屋根は平ら（舞台のような平地・高さ 2.2m）。前とフェンスの間は通路（床 -0.9m）
        const frontPts: P2[] = [];
        for (let a = 180 + SW; a >= 180 - SW - 1e-6; a -= 1) {
          const dd = rot(cf, a);
          let r = 6;
          while (r < 45 && !pointIn(keep, at(dd, r))) r += 0.25;
          frontPts.push(at(dd, r + 2.4));
        }
        const near = new CrossSection([ccw([home, ...frontPts])], 'Positive');
        const box = stageCs.subtract(near);
        const walk = stageCs.intersect(near);
        add(ext(box, -1.1, 2.2), 'ネット裏の建物（緑・屋根は平地）', 'スタンド', (n) => (n.z > 0.5 ? '#8a8f92' : '#3a5b56'));
        if (!walk.isEmpty()) add(ext(walk, -1.1, -0.9), 'ネット裏の建物の前の通路', 'スタンド', 'mortar-gray');
        // 窓（黒い格子）と広告（RYOBI）
        const plF = polyline(frontPts);
        const wins: Mf[] = [];
        for (let s2 = 1.6; s2 < plF.len - 1.2; s2 += 3.2) {
          const { p, t } = plF.at(s2);
          wins.push(place(rect(2.2, 1.3), p, 0.6, t, 0.0, 0.04));
        }
        add(union(wins), 'ネット裏の建物の窓', 'スタンド', '#1d2224');
        for (const f of [0.18, 0.82]) {
          const { p, t } = plF.at(plF.len * f);
          pushDeco('ネット裏の広告（白文字）', 'white', place(textCs('RYOBI', 0.4, 2.2)!, p, 1.7, t, 0.03, 0.02));
        }
      }
      if (!rest.isEmpty()) st2.push(ext(rest, -1.1, -0.9));
      podiumPit = (podiumPit ? podiumPit.add(keep) : keep);
      add(union(st2), '砂かぶり席の段（正面・一塁側・三塁側）', 'スタンド', (n) => (n.z > 0.5 ? 'mortar-gray' : 'concrete'));
      add(union(sk2), '砂かぶり席の座席（正面砂かぶり・内野砂かぶり・緑の座席）', 'スタンド', '#2f6f4e');
      // 前のフェンス（ラバー）とネット: 台のグラウンド側のふち
      const fence = keep.offset(0.12, 'Round', 2, 64).subtract(keep).subtract(off(0.5)).subtract(dugU.offset(0.2));
      add(ext(fence, -0.9, 0.9), '砂かぶり席の前のフェンス（グラウンドから 0.9m）', 'スタンド', '#3a5b56');
      // バックネット（写真）: 高さ 20m 余りの上のワイヤーから大きな黒いネットを砂かぶり席の前のフェンスまで垂らす。柱はなく、
      // ワイヤーは両端を一塁側・三塁側の 2 階スタンドの屋根へ、途中を本塁裏の屋根から斜めのワイヤーで吊る。ネットには細い縦のワイヤーが入る
      const NETR = 45;
      const keepO = keep.offset(0.06, 'Round');
      /** 本塁から向き a（センターから三塁側へ +）で、ネットの帯（フェンス）に当たる所 */
      const netAt = (a: number): P2 | null => {
        const dd = rot(cf, a);
        let r = 8;
        while (r < NETR && !pointIn(keepO, at(dd, r))) r += 0.4;
        if (r >= NETR) return null;
        while (r > 6 && pointIn(keepO, at(dd, r - 0.05))) r -= 0.05;
        return at(dd, r - 0.02);
      };
      const cable = (a: [number, number, number], b: [number, number, number], r: number) =>
        Manifold.hull([
          [a[0] - r, a[1] - r, a[2] - r], [a[0] + r, a[1] + r, a[2] + r], [a[0] - r, a[1] + r, a[2]], [a[0] + r, a[1] - r, a[2]],
          [b[0] - r, b[1] - r, b[2] - r], [b[0] + r, b[1] + r, b[2] + r], [b[0] - r, b[1] + r, b[2]], [b[0] + r, b[1] - r, b[2]],
        ]);
      // ネットの端（ダッグアウトの本塁寄りの端あたり）
      const SPAN = 95;
      const samples: { p: P2; f: number }[] = [];
      for (let a = 180 - SPAN; a <= 180 + SPAN + 1e-6; a += 2.5) {
        const pp = netAt(a);
        if (pp) samples.push({ p: pp, f: (a - (180 - SPAN)) / (2 * SPAN) });
      }
      const HT = 24.0; // 柱の所のワイヤーの高さ
      const SAG = 3.5; // 真ん中のたわみ
      const hOf = (f: number) => HT - SAG * 4 * f * (1 - f);
      const netSolids: Mf[] = [];
      const netWire: Mf[] = [];
      for (let k = 0; k + 1 < samples.length; k++) {
        const A1 = samples[k];
        const B1 = samples[k + 1];
        const L = Math.hypot(B1.p[0] - A1.p[0], B1.p[1] - A1.p[1]);
        if (L > 6) continue; // フェンスが切れている所（ダッグアウト）
        const tt: P2 = [(B1.p[0] - A1.p[0]) / L, (B1.p[1] - A1.p[1]) / L];
        const mid: P2 = [(A1.p[0] + B1.p[0]) / 2, (A1.p[1] + B1.p[1]) / 2];
        const ha = hOf(A1.f);
        const hb = hOf(B1.f);
        netSolids.push(place(new CrossSection([ccw([[-L / 2, 0.9], [L / 2, 0.9], [L / 2, hb], [-L / 2, ha]])], 'Positive'), mid, 0, tt, -0.015, 0.03));
        netWire.push(cable([A1.p[0], A1.p[1], ha], [B1.p[0], B1.p[1], hb], 0.04)); // 上のワイヤー
        if (k % 3 === 0) netWire.push(cable([A1.p[0], A1.p[1], 0.9], [A1.p[0], A1.p[1], ha], 0.02)); // 縦のワイヤー
      }
      // 柱はない（写真）。上のワイヤーの両端は、一塁側・三塁側の 2 階スタンドの屋根の前のふちへ斜めに引っ張り、
      // 途中は本塁裏の屋根から吊る
      const roofAnchor = at(rot(cf, 180), 58);
      const RZ = 27.5;
      for (const [e, sg] of [[samples[0], -1], [samples[samples.length - 1], 1]] as [{ p: P2; f: number } | undefined, number][]) {
        if (!e) continue;
        // 2 階スタンドの屋根（地図データの屋根・25m 以上）のうち、狙った向きにいちばん近い前のふちの点
        const want = 180 + sg * (SPAN + 16);
        let an: [number, number, number] | null = null;
        let bestD = Infinity;
        for (const it of partItems) {
          if (it.tags.building !== 'roof' || (num(it.tags.min_height) ?? 0) < 24) continue;
          for (const v of it.outer![0]) {
            const vx = v[0] - home[0];
            const vy = v[1] - home[1];
            const a2 = deg(Math.atan2(cf[0] * vy - cf[1] * vx, cf[0] * vx + cf[1] * vy));
            const da = Math.abs(((a2 - want + 540) % 360) - 180);
            const dd = Math.hypot(vx, vy);
            if (da < 7 && dd < bestD) { bestD = dd; an = [v[0], v[1], num(it.tags.height) ?? 25.5]; }
          }
        }
        if (!an) { const q = at(rot(cf, want), 62); an = [q[0], q[1], 25.5]; }
        netWire.push(cable([e.p[0], e.p[1], HT], an, 0.05));
        console.log('net anchor', sg, an.map((x) => x.toFixed(1)).join(','));
        // ネットの端の縦のワイヤー
        netWire.push(cable([e.p[0], e.p[1], 0.9], [e.p[0], e.p[1], HT], 0.03));
      }
      for (const f of [0.2, 0.35, 0.5, 0.65, 0.8]) {
        const e = samples.reduce((b2, x) => (Math.abs(x.f - f) < Math.abs(b2.f - f) ? x : b2), samples[0]);
        if (e) netWire.push(cable([e.p[0], e.p[1], hOf(e.f)], [roofAnchor[0], roofAnchor[1], RZ], 0.04));
      }
      add(union(netSolids), 'バックネット（ネット）', 'スタンド', 'net-black');
      add(union(netWire), 'バックネットのワイヤー', 'スタンド', '#2a2d2e');
      console.log('backnet samples', samples.length);
      // ネクストバッターズサークル（直径 1.52m）: 本塁とダッグアウトの間
      const odc: Mf[] = [];
      const odcRing: Mf[] = [];
      for (const [dl2, sgn] of [[d1, 1], [d3, -1]] as [P2, number][]) {
        const out2 = rot(dl2, sgn * -90);
        const base0 = at(dl2, 9);
        let t = 2;
        while (t < 30 && !inFront([base0[0] + out2[0] * t, base0[1] + out2[1] * t])) t += 0.25;
        const o = Math.min(t - 0.3, 9.5);
        const c0: P2 = [base0[0] + out2[0] * o, base0[1] + out2[1] * o];
        odc.push(Manifold.cylinder(0.01, 0.68, 0.68, 48).translate([c0[0], c0[1], -0.02]));
        odcRing.push(Manifold.cylinder(0.01, 0.76, 0.76, 48).subtract(Manifold.cylinder(0.03, 0.68, 0.68, 48).translate([0, 0, -0.01])).translate([c0[0], c0[1], -0.02]));
        console.log('on-deck circle', sgn, o.toFixed(1));
      }
      add(union(odc), 'ネクストバッターズサークル', 'グラウンド', '#b3122e');
      add(union(odcRing), 'ネクストバッターズサークルの白線', 'グラウンド', 'white');
    }
  }

  // ---- レフトスタンド 1 階（半地下の外野砂かぶり席・パーティー席）----
  {
    const lfDeck = partItems.find((i) => i.id === 'r8829162');
    if (lfDeck) {
      // レフトスタンド = 前の緑の帯（地図データ r8829163〜176）＋後ろのデッキ（r8829162）。
      // ホームランライン = 緑の帯のグラウンド側のふち。フェンスの断面は地図データの r8927650/51 と同じ
      // （0〜0.25m 台・0.25〜2.25m 開口（ネット）・2.25〜3.82m ラバー、上端 3.82m に黄色の線）
      const bandIds = Array.from({ length: 14 }, (_, k) => 'r' + (8829163 + k));
      const G = CrossSection.union(partItems.filter((i) => bandIds.includes(i.id)).map((i) => shape(i)!).filter(Boolean));
      const c = shape(lfDeck)!;
      const S = G.add(c);
      // 帯の向き（ほぼ直線）に直交して、グラウンドの方へ向く単位ベクトル u
      const gc = partItems.filter((i) => bandIds.includes(i.id)).map(centroid);
      const ta = gc[0];
      const tb = gc[gc.length - 1];
      const tl = Math.hypot(tb[0] - ta[0], tb[1] - ta[1]);
      let u: [number, number] = [-(tb[1] - ta[1]) / tl, (tb[0] - ta[0]) / tl];
      const mid = [(ta[0] + tb[0]) / 2, (ta[1] + tb[1]) / 2];
      if (u[0] * (FC[0] - mid[0]) + u[1] * (FC[1] - mid[1]) < 0) u = [-u[0], -u[1]];
      const q: [number, number] = [-u[1], u[0]];
      const polyS = S.toPolygons().flat();
      const qq = polyS.map((p) => p[0] * q[0] + p[1] * q[1]);
      const su = polyS.map((p) => p[0] * u[0] + p[1] * u[1]);
      const qMin = Math.min(...qq);
      const qMax = Math.max(...qq);
      const sMin = Math.min(...su);
      const sMax = Math.max(...su);
      // 前のふちからの奥行き t の範囲
      const Zt = (t: number) => (t <= 0 ? S.subtract(S) : S.subtract(S.translate([-u[0] * t, -u[1] * t])));
      const ringO = (a: number, b: number) => Zt(b).subtract(Zt(a));
      const behind = (o: number) => S.subtract(Zt(o));
      // ===== レフトスタンド（座席図・写真・航空写真に合わせて）=====
      // ・外野フェンスは芝のふちから 4.1m（ウォーニングトラック）。ポール際で本塁から 101m、センター 121m（公表 101m／122m）
      // ・フェンスの後ろに外野スタンド（L649〜L811）: フェンス天端（3.6m）の高さから 1 列 0.85m・0.3m ずつ上る。
      //   テラスの帯（地図データの緑の帯）はまっすぐ、フェンスは曲線なので、ポール際 6 列 → 中ほど 12 列 → センター寄り 25 列
      // ・ポール際 18m は 1 層目の外野砂かぶり席（L901〜L931、A〜G の 7 列、グラウンドより低い）。フェンスの下半分は金網
      // ・帯の上が 3 層目（7.5m）のプレミアムテラス（前面ガラス）・コージーテラス、奥がパーティデッキ
      const WT = 4.1;
      const F0 = WT + 0.3; // フェンスの後ろの面（芝から）
      const HR = 3.6;
      const T3 = 7.5;
      const outGrass = new CrossSection([ccw(pitch.outer!.slice().sort((a2, b2) => b2.length - a2.length)[0])], 'Positive');
      const offPitch = (o: number) => outGrass.offset(o, 'Round', 2, 96);
      // 本塁からの角度（センター方向から三塁側へ +）の扇
      const fan = (a0: number, a1: number) => {
        const pts: [number, number][] = [home];
        for (let a = a0; a <= a1 + 1e-6; a += 0.5) {
          const dd = rot(cf, a);
          pts.push([home[0] + dd[0] * 260, home[1] + dd[1] * 260]);
        }
        return new CrossSection([ccw(pts)], 'Positive');
      };
      const A_END = 12.5; // スタンドの中堅側の端（その先はバックスクリーン横の別の席）
      const A_POLE = 45.6;
      // 帯の前のふち・後ろのふち（帯はまっすぐなので u 方向の位置で決まる）
      const bandPoly = G.toPolygons().flat();
      const bs = bandPoly.map((p) => p[0] * u[0] + p[1] * u[1]);
      const sF = Math.max(...bs);
      const sR = Math.min(...bs);
      const fieldOfRear = band(u, sR, sF + 400);
      const underBand = band(u, sR, sF);
      // 内野の芝のふちは対象外（本塁から 95m より外だけ）。芝は外野の大きい 1 枚だけを使う
      const farOnly = CrossSection.circle(400, 8).translate(home).subtract(CrossSection.circle(95, 128).translate(home));
      const LFW = fan(A_END, A_POLE).intersect(farOnly);
      const SKW = fan(35.5, A_POLE).intersect(farOnly); // ポール際 18m（外野砂かぶり席の区間）
      // ① フェンス
      const fenceR = offPitch(F0).subtract(offPitch(WT)).intersect(LFW);
      const fenceSK = fenceR.intersect(SKW);
      const fenceN = fenceR.subtract(SKW);
      // 外野は 1 本の連続したフェンス（写真）。芝のふちから 4.1m・高さ 3.6m（黄色のホームランライン）
      const OF = fan(-45.6, A_POLE).intersect(farOnly.add(CrossSection.circle(400, 8).translate(home).subtract(CrossSection.circle(80, 96).translate(home))));
      const fenceAll = offPitch(F0).subtract(offPitch(WT)).intersect(OF).subtract(SKW);
      // フェンスの後ろとスタンドの前のすき間（スタンドの前のふちが芝から 4.5〜6m と場所で違う）は、フェンスと同じ高さの壁でふさぐ
      const lowParts = partItems.filter((i) => (num(i.tags.min_height) ?? 0) < 1 && !i.tags['tower:type']).map((i) => shape(i)).filter((x2): x2 is Cs => !!x2);
      const standsU = lowParts.length ? CrossSection.union(lowParts) : fenceAll.subtract(fenceAll);
      const gap = offPitch(F0 + 2.2).subtract(offPitch(F0)).intersect(OF).subtract(SKW).subtract(LFW).subtract(standsU);
      add(Manifold.union([ext(fenceAll.subtract(LFW).add(fenceN), -0.1, HR), ext(fenceSK, -1.3, 0.25), ext(fenceSK, 1.8, HR)]), '外野フェンス（ラバー・連続）', 'スタンド', '#3a5b56');
      if (!gap.isEmpty()) add(ext(gap, -0.1, HR - 0.05), 'フェンスの裏（スタンドとのすき間）', 'スタンド', (n) => (n.z > 0.5 ? 'concrete' : '#3a5b56'));
      {
        // ライトポールの外（ファウル地域）もフェンスはウォーニングトラックに沿って切れずに続き、スタンドの前につながる（航空写真: くぼみはない）。レフト側はスタンドの前がそのままフェンス
        const EXT = fan(-62, -45.6).intersect(CrossSection.circle(400, 8).translate(home).subtract(CrossSection.circle(70, 96).translate(home)));
        const stO = standsU.offset(0.02, 'Square');
        const fenceExt = offPitch(F0).subtract(offPitch(WT)).intersect(EXT).subtract(stO);
        const fillExt = offPitch(F0 + 14).subtract(offPitch(F0)).intersect(EXT).subtract(stO).subtract(SKW).subtract(LFW);
        add(ext(fenceExt, -0.1, HR), 'ポールの外のフェンス（ラバー）', 'スタンド', '#3a5b56');
        if (!fillExt.isEmpty()) add(ext(fillExt, -0.1, HR - 0.05), 'ポールの外のフェンスの裏', 'スタンド', (n) => (n.z > 0.5 ? 'concrete' : '#3a5b56'));
      }
      {
        const c0 = rot(cf, A_END - 0.3);
        const c1 = rot(cf, A_END + 0.02);
        const cap = new CrossSection([ccw([[home[0] + c0[0] * 96, home[1] + c0[1] * 96], [home[0] + c0[0] * 220, home[1] + c0[1] * 220], [home[0] + c1[0] * 220, home[1] + c1[1] * 220], [home[0] + c1[0] * 96, home[1] + c1[1] * 96]])], 'Positive')
          .intersect(offPitch(F0 + 40).subtract(offPitch(WT)))
          .intersect(fieldOfRear);
        if (!cap.isEmpty()) add(ext(cap, -0.1, 6.0), 'レフトスタンドのセンター側の壁', 'スタンド', '#3a5b56');
      }
      add(ext(fenceSK, 0.25, 1.8), 'フェンスの金網（外野砂かぶり席の前）', 'スタンド', 'glass-clear');
      // ポール際（外野砂かぶり席の前）もラバーの上にネットフェンス、最上部に黄色のライン
      add(ext(fenceSK.subtract(fenceSK.offset(-0.13, 'Round')), HR, HR + 2.25), 'ポール際のネットフェンス', 'スタンド', 'net-black');
      add(ext(fenceSK, HR + 2.25, HR + 2.37), 'ホームランライン（ポール際・黄色）', 'スタンド', 'paint-yellow');
      // ---- 外野フェンスの広告（写真の並び: SUNSTAR GUM・クマヒラ・ユウベル・福屋・キリンビバレッジ…）----
      {
        const ringF = offPitch(WT).toPolygons().sort((a2, b2) => b2.length - a2.length)[0];
        const angOf = (p: P2) => deg(Math.atan2(cf[0] * (p[1] - home[1]) - cf[1] * (p[0] - home[0]), cf[0] * (p[0] - home[0]) + cf[1] * (p[1] - home[1])));
        const pts = ringF.filter((p) => Math.hypot(p[0] - home[0], p[1] - home[1]) > 85 && angOf(p) < 35.2 && angOf(p) > -44.5).sort((a2, b2) => angOf(b2) - angOf(a2));
        const pl = polyline(pts);
        // 写真の並び（白い文字・フェンスの緑の上に直接）
        // レフト側（左）→ ライト側（右）の順（写真のパノラマ）
        const SP = ['SUNSTAR', 'クマヒラ', 'ユウベル', '福屋', 'キリンビバレッジ', '石窯 タカキベーカリー', 'BAKURAO', 'フマキラー', '中國新聞', '東洋証券', 'SUZUKI', '大和興産', '五洋建設', 'DUSKIN', '章栄不動産', 'NOHMI 能美防災', 'ヘルストロン'];
        let k = 0;
        let s2 = 3;
        while (s2 < pl.len - 3) {
          const txt = SP[k % SP.length];
          const adv = glyphs(txt).reduce((a, g) => a + g.adv, 0);
          const size = Math.min(1.5, 11 / Math.max(adv, 0.1));
          const W = adv * size;
          const { p } = pl.at(s2 + W / 2);
          if (Math.abs(angOf(p)) < 8) { s2 += 2; continue; } // バックスクリーンの前は広告なし
          if (s2 + W > pl.len - 2) break;
          textAlong(pl, s2 + W / 2, 1.35, size, txt, 0.01, 0.025, '外野フェンスの広告（白文字）', 'white');
          k++;
          s2 += W + 2.2;
        }
        // ラバーフェンスの上のネットフェンス（写真）: 高さ 2.2m、黒い細い支柱 4m おき、最上部は黄色の管（ホームランライン）。バックスクリーンの前も続ける
        const netF: Mf[] = [];
        const netP: Mf[] = [];
        const netTop: Mf[] = [];
        let prevP: P2 | null = null;
        for (let s3 = 0; s3 <= pl.len; s3 += 2) {
          const { p, t } = pl.at(Math.min(s3, pl.len - 0.01));
          const nn = nOf(t);
          const q2: P2 = [p[0] - nn[0] * 0.15, p[1] - nn[1] * 0.15];
          if (prevP) {
            const L = Math.hypot(q2[0] - prevP[0], q2[1] - prevP[1]);
            const tt: P2 = [(q2[0] - prevP[0]) / L, (q2[1] - prevP[1]) / L];
            const mid: P2 = [(q2[0] + prevP[0]) / 2, (q2[1] + prevP[1]) / 2];
            netF.push(place(rect(L, 2.2), mid, HR + 0.08 + 1.1, tt, -0.01, 0.02));
            netTop.push(place(rect(L + 0.05, 0.12), mid, HR + 2.3, tt, -0.06, 0.12)); // いちばん上は黄色（打球を見やすく）
          }
          if (Math.round(s3) % 4 === 0) netP.push(Manifold.cylinder(2.25, 0.035, 0.035, 8).translate([q2[0], q2[1], HR + 0.05]));
          prevP = q2;
        }
        add(union(netF), '外野のネットフェンス（ラバーフェンスの上）', 'スタンド', 'net-black');
        add(union(netP), 'ネットフェンスの支柱', 'スタンド', '#24282a');
        add(union(netTop), 'ホームランライン（ネットフェンスの最上部・黄色）', 'スタンド', 'paint-yellow');
        console.log('fence ads', k, 'fence len', pl.len.toFixed(0));
      }
      // ② 外野スタンド（2 層目）
      const Stand = offPitch(F0 + 40).subtract(offPitch(F0)).intersect(LFW).intersect(fieldOfRear);
      const tr: Mf[] = [];
      const se: Mf[] = [];
      let nRows = 0;
      for (let j = 0; j < 32; j++) {
        const oa = F0 + j * 0.85;
        const ob = oa + 0.85;
        const ring = offPitch(ob).subtract(offPitch(oa)).intersect(Stand);
        if (ring.isEmpty()) break;
        nRows = j + 1;
        const top = Math.min(HR + 0.1 + 0.3 * j, 8.0);
        const open = ring.subtract(underBand);
        const cov = ring.intersect(underBand);
        const z0 = (r: Cs) => [r.intersect(SKW), r.subtract(SKW)] as const;
        for (const [part, t] of [[open, top], [cov, Math.min(top, 5.3)]] as [Cs, number][]) {
          if (part.isEmpty()) continue;
          const [sk, other] = z0(part);
          if (!sk.isEmpty()) tr.push(ext(sk, 3.2, t));
          if (!other.isEmpty()) tr.push(ext(other, -0.1, t));
          const seat = offPitch(ob - 0.1).subtract(offPitch(ob - 0.55)).intersect(part).subtract(aisles);
          const back = offPitch(ob - 0.05).subtract(offPitch(ob - 0.13)).intersect(part).subtract(aisles);
          if (!seat.isEmpty()) se.push(ext(seat, t, t + 0.42));
          if (!back.isEmpty()) se.push(ext(back, t + 0.42, t + 0.82));
        }
      }
      add(union(tr), 'レフト外野スタンドの段', 'スタンド', (n) => (n.z > 0.5 ? 'mortar-gray' : 'concrete'));
      add(union(se), 'レフト外野スタンドの座席', 'スタンド', 'paint-red');
      // 通路の手すり（スタンドの後ろ、帯の下の奥の壁）
      add(ext(band(u, sR - 0.3, sR).intersect(LFW).intersect(offPitch(F0 + 40)), -0.1, 6.0), 'スタンド後ろの壁', 'スタンド', 'concrete');
      // ③ 1 層目: 外野砂かぶり席（7 列、前の列ほど低い）
      const sk1: Mf[] = [];
      const sk1s: Mf[] = [];
      const SKA = Stand.intersect(SKW);
      for (let k = 0; k < 7; k++) {
        const oa = F0 + 0.3 + k * 0.9;
        const ob = oa + 0.9;
        const ring = offPitch(ob).subtract(offPitch(oa)).intersect(SKA);
        if (ring.isEmpty()) continue;
        const top = -1.0 + 0.3 * k;
        sk1.push(ext(ring, -1.3, top));
        const seat = offPitch(ob - 0.1).subtract(offPitch(ob - 0.55)).intersect(ring);
        const back = offPitch(ob - 0.05).subtract(offPitch(ob - 0.13)).intersect(ring);
        if (!seat.isEmpty()) sk1s.push(ext(seat, top, top + 0.42));
        if (!back.isEmpty()) sk1s.push(ext(back, top + 0.42, top + 0.82));
      }
      sk1.push(ext(offPitch(F0 + 0.3).subtract(offPitch(F0)).intersect(SKA), -1.3, -1.2));
      add(union(sk1), '外野砂かぶり席（1 層目・現 すごいびっくりテラス）の段', 'スタンド', (n) => (n.z > 0.5 ? 'mortar-gray' : 'concrete'));
      add(union(sk1s), '外野砂かぶり席の座席', 'スタンド', 'paint-red');
      // その奥（デッキの下）: ちょっとびっくりテラス（テーブル席・L601〜L631）
      const yel = c.intersect(SKW).offset(-0.8, 'Round');
      for (let t = qMin; t < qMax; t += 3.2) {
        for (let s2 = sR - 1.6; s2 > sR - 14; s2 -= 3.0) {
          const p: [number, number] = [u[0] * s2 + q[0] * t, u[1] * s2 + q[1] * t];
          if (pointIn(yel, p)) put('dining-set', p[0], p[1], 0, (Math.atan2(u[0], u[1]) * 180) / Math.PI);
        }
      }
      // ④ 帯（3 層目の床）: 下面 6.0、前面に広告の帯、床 7.5、前のふちにガラス
      const bandC = G.intersect(LFW.add(fan(A_END - 6, A_END)));
      add(ext(bandC, 6.0, T3), '3 層目の床（帯）', 'スタンド', (n) => (n.z > 0.5 ? 'deck' : 'concrete'));
      const bandFront = bandC.subtract(bandC.translate([-u[0] * 0.25, -u[1] * 0.25]));
      add(ext(bandFront, 6.0, T3), 'レフトスタンドの広告の帯（千福・中国電力・CGC…）', 'スタンド', 'white');
      add(ext(bandFront, T3, T3 + 1.1), 'プレミアムテラスの前面ガラス', 'スタンド', 'glass-clear');
      {
        // 帯の広告の文字（千福・中国電力・CGC…）
        const BA: [string, string][] = [['千福', '#1a1a1a'], ['中国電力', '#0067b0'], ['CGC', '#00913a'], ['広島ガス', '#0067b0'], ['アサヒスーパードライ', '#c8102e'], ['もみじ銀行', '#e4007f']];
        const tq: P2 = [-u[1], u[0]];
        let k = 0;
        for (let t = qMin + 4; t < qMax - 3; t += 8.5) {
          // 帯の前のふち（この位置で帯に当たるところ）
          let sx = sF + 0.5;
          while (sx > sF - 4 && !pointIn(bandC, [u[0] * sx + tq[0] * t, u[1] * sx + tq[1] * t])) sx -= 0.1;
          if (sx <= sF - 4) continue;
          const p: P2 = [u[0] * (sx + 0.05) + tq[0] * t, u[1] * (sx + 0.05) + tq[1] * t];
          const [txt, col] = BA[k++ % BA.length];
          const tc = textCs(txt, 0.9, 7.0);
          if (tc) pushDeco('レフトスタンドの帯の広告', col, place(tc, p, (6.0 + T3) / 2, tq, 0.005, 0.03));
        }
        console.log('band ads', k, 'q', qMin.toFixed(1), qMax.toFixed(1));
      }
      // プレミアムテラス（クッション付きシート 2 列）とコージーテラス（2 段の木製ベンチ・テーブル）
      const ringB = (a: number, b: number) => bandC.intersect(band(u, sF - b, sF - a));
      const pt: Mf[] = [];
      for (let j = 0; j < 2; j++) {
        const z0 = T3 + j * 0.3;
        const oa = 0.5 + j * 0.9;
        if (j > 0) pt.push(ext(ringB(oa, oa + 0.9), T3, z0));
        pt.push(ext(ringB(oa + 0.35, oa + 0.8).subtract(aisles), z0, z0 + 0.45), ext(ringB(oa + 0.72, oa + 0.8).subtract(aisles), z0 + 0.45, z0 + 0.9));
      }
      add(union(pt), 'プレミアムテラス（クッション付きシート）', 'スタンド', (n) => (n.z > 0.5 ? 'fabric-red' : 'leather-black'));
      const ct: Mf[] = [];
      ct.push(ext(ringB(2.6, 9), T3, T3 + 0.4));
      ct.push(ext(ringB(2.8, 3.2), T3 + 0.4, T3 + 0.85), ext(ringB(3.6, 4.2), T3 + 0.4, T3 + 1.12));
      add(union(ct), 'コージーテラス（2 段の木製ベンチ・テーブル）', 'スタンド', (n) => (n.z > 0.5 ? 'wood-light' : 'wood-walnut'));
      // 帯を支える柱（スタンドの中に立つ・写真の柱）
      const cols: Mf[] = [];
      for (let t = qMin + 2; t < qMax; t += 7.5) {
        const p: [number, number] = [u[0] * (sF - 0.6) + q[0] * t, u[1] * (sF - 0.6) + q[1] * t];
        if (pointIn(bandC, p)) cols.push(Manifold.cube([0.5, 0.5, 6.0], true).translate([p[0], p[1], 3.0]));
      }
      add(union(cols), '帯を支える柱', 'スタンド', 'steel-white');
      // ⑤ 奥のデッキ（パーティデッキ・7.5m）とその下の壁
      add(ext(c, 7.1, T3), 'パーティデッキの床', 'スタンド', (n) => (n.z > 0.5 ? 'deck' : 'concrete'));
      const deckWall = c.subtract(c.offset(-0.3, 'Round')).subtract(band(u, sR - 0.5, sF + 1));
      add(ext(deckWall, 0, 7.1), 'デッキの下の壁', 'スタンド', 'concrete');
      add(ext(c.subtract(c.offset(-0.2, 'Round')).subtract(band(u, sR - 0.5, sF + 1)), T3, T3 + 1.1), 'デッキの手すり', 'スタンド', 'steel-white');
      const terrace = c.offset(-1.2, 'Round');
      for (let t = qMin + 2; t < qMax - 2; t += 3.6) {
        for (let s2 = sR - 2.5; s2 > sR - 16; s2 -= 3.4) {
          const p: [number, number] = [u[0] * s2 + q[0] * t, u[1] * s2 + q[1] * t];
          if (pointIn(terrace, p)) put('dining-set', p[0], p[1], T3, (Math.atan2(u[0], u[1]) * 180) / Math.PI);
        }
      }
      console.log('LF stand rows', nRows, 'band s', sF.toFixed(1), sR.toFixed(1));
      lfPit = fenceSK.add(offPitch(F0 + 0.3 + 7 * 0.9).subtract(offPitch(WT)).intersect(SKA.add(fenceSK)));
    }
  }

  // ---- パーティーフロア（一塁側・中 2 階）----
  {
    const decks = partItems.filter((i) => ['r9168210', 'r9168213'].includes(i.id));
    for (const it of decks) {
      const [x, y] = centroid(it);
      const toF = (Math.atan2(FC[0] - x, FC[1] - y) * 180) / Math.PI;
      put('dining-set', x, y, 8.29, toF);
    }
    console.log('party floor tables', decks.length);
  }

  // ---- コンコース（1 階席の最後部・幅 内野 12m／外野 8m）の売店 ----
  {
    const conc = partItems.find((i) => i.id === 'r1740909');
    if (conc) {
      const cc = shape(conc)!;
      const rooms = partItems
        .filter((i) => i !== conc && (num(i.tags.min_height) ?? 0) < 11 && (num(i.tags.height) ?? 0) > 8.6)
        .map((i) => shape(i))
        .filter((x): x is Cs => !!x);
      const roomU = rooms.length ? CrossSection.union(rooms) : null;
      const outerRing = conc.outer!.slice().sort((a, b) => b.length - a.length)[0];
      const colors = ['paint-red', 'paint-yellow', 'fabric-navy', 'white', 'paint-green'];
      const booths: Record<string, Mf[]> = {};
      const counters: Mf[] = [];
      let acc = 0;
      let k = 0;
      for (let i = 0; i < outerRing.length; i++) {
        const [ax, ay] = outerRing[i];
        const [bx, by] = outerRing[(i + 1) % outerRing.length];
        const L = Math.hypot(bx - ax, by - ay);
        for (let t = (10 - acc) % 10; t < L; t += 10) {
          const ux = (bx - ax) / L;
          const uy = (by - ay) / L;
          // 内向き（球場の中心の方）
          let nx = -uy;
          let ny = ux;
          const px = ax + ux * t;
          const py = ay + uy * t;
          if (nx * (0 - px) + ny * (0 - py) < 0) {
            nx = -nx;
            ny = -ny;
          }
          const c2: [number, number] = [px + nx * 1.6, py + ny * 1.6];
          const foot = CrossSection.square([3.4, 2.4], true).rotate((Math.atan2(uy, ux) * 180) / Math.PI).translate(c2);
          if (cc.intersect(foot).area() < foot.area() * 0.95) continue;
          if (roomU && !roomU.intersect(foot).isEmpty()) continue;
          {
            const vx = c2[0] - FC[0];
            const vy = c2[1] - FC[1];
            const aa = (Math.atan2(cf[0] * vy - cf[1] * vx, cf[0] * vx + cf[1] * vy) * 180) / Math.PI; // センター方向から（三塁側が +）
            const ok = Math.abs(aa) > 150 || (aa < -95 && aa > -150) || (aa > 105 && aa < 125) || Math.abs(aa) < 12;
            if (!ok) continue;
          }
          const col = colors[k++ % colors.length];
          (booths[col] ??= []).push(ext(foot, 8.29, 11.0));
          // カウンターと庇（内側へ）
          const cnt = CrossSection.square([3.0, 0.5], true).rotate((Math.atan2(uy, ux) * 180) / Math.PI).translate([c2[0] + nx * 1.45, c2[1] + ny * 1.45]);
          counters.push(ext(cnt, 8.29, 9.35));
          const aw = CrossSection.square([3.4, 0.9], true).rotate((Math.atan2(uy, ux) * 180) / Math.PI).translate([c2[0] + nx * 1.6, c2[1] + ny * 1.6]);
          counters.push(ext(aw, 10.6, 10.75));
        }
        acc = (acc + L) % 10;
      }
      for (const [col, l] of Object.entries(booths)) add(union(l), 'コンコースの売店', 'コンコース', (n) => (n.z > 0.5 ? 'galva-white' : col));
      add(union(counters), '売店のカウンター・庇', 'コンコース', 'stainless');
      console.log('booths', k);
    }
  }

  // 2 階スタンドの屋根の上の太陽光パネル（濃い青・1.7m おきの列）
  {
    const panels: Mf[] = [];
    for (const it of partItems) {
      if (it.tags.building !== 'roof' || (num(it.tags.min_height) ?? 0) < 24) continue;
      const c = shape(it);
      if (!c) continue;
      const h = num(it.tags.height) ?? 25.25;
      const [x, y] = centroid(it);
      const l = Math.hypot(x - home[0], y - home[1]);
      const d: P2 = [(x - home[0]) / l, (y - home[1]) / l];
      const inner = c.offset(-0.4, 'Square');
      if (inner.isEmpty()) continue;
      const rows: Cs[] = [];
      for (let s2 = l - 30; s2 < l + 30; s2 += 1.7) rows.push(band(d, s2, s2 + 1.55));
      const pv = inner.intersect(CrossSection.union(rows));
      if (!pv.isEmpty()) panels.push(ext(pv, h + 0.05, h + 0.12));
    }
    add(union(panels), '太陽光パネル（2 階スタンドの屋根）', '屋根・ひさし', (n) => (n.z > 0.5 ? '#1e3354' : 'steel-white'));
    console.log('solar roofs', panels.length);
  }
  // 照明塔の柱（照明の箱の下・高さ 39.5m まで）
  for (const it of partItems.filter((i) => i.tags['tower:type'] === 'lighting')) {
    const [x, y] = centroid(it);
    // 写真の形: 照明の板を 2 本の太い脚（下ほど開く）で支え、後ろから 1 本の支柱で突っ張る
    const H0 = num(it.tags.min_height) ?? 39.5;
    const ring = it.outer![0];
    let ax = 1;
    let ay = 0;
    let best = 0;
    for (let i = 0; i < ring.length; i++) {
      const [x0, y0] = ring[i];
      const [x1, y1] = ring[(i + 1) % ring.length];
      const L = Math.hypot(x1 - x0, y1 - y0);
      if (L > best) {
        best = L;
        ax = (x1 - x0) / L;
        ay = (y1 - y0) / L;
      }
    }
    // 板の向き（板に直交してグラウンドから離れる方）
    let bx = -ay;
    let by = ax;
    if (bx * (FC[0] - x) + by * (FC[1] - y) > 0) {
      bx = -bx;
      by = -by;
    }
    const half = Math.max(2.5, best / 2 - 1.5);
    const P3 = (s2: number, back: number, z: number): [number, number, number] => [x + ax * s2 + bx * back, y + ay * s2 + by * back, z];
    const leg = (top: [number, number, number], bot: [number, number, number], rt: number, rb: number) =>
      Manifold.hull([
        [top[0] - rt, top[1] - rt, top[2]], [top[0] + rt, top[1] - rt, top[2]], [top[0] - rt, top[1] + rt, top[2]], [top[0] + rt, top[1] + rt, top[2]],
        [bot[0] - rb, bot[1] - rb, bot[2]], [bot[0] + rb, bot[1] - rb, bot[2]], [bot[0] - rb, bot[1] + rb, bot[2]], [bot[0] + rb, bot[1] + rb, bot[2]],
      ]);
    const tw: Mf[] = [];
    for (const sg of [-1, 1]) tw.push(leg(P3(sg * half, 0.6, H0 + 0.5), P3(sg * (half + 3.0), 1.5, 0), 0.45, 0.8));
    tw.push(leg(P3(0, 1.0, H0 * 0.62), P3(0, 13, 0), 0.35, 0.6)); // 後ろの支柱
    tw.push(leg(P3(-half - 1.4, 1.1, H0 * 0.6), P3(half + 1.4, 1.1, H0 * 0.6), 0.35, 0.35)); // 横はり
    tw.push(leg(P3(-half - 0.3, 0.7, H0 + 0.3), P3(half + 0.3, 0.7, H0 + 0.3), 0.3, 0.3)); // 板を受けるはり
    for (let z = 8; z < H0 - 2; z += 8) {
      // 脚に付いた点検はしご（片側の脚の外側）
      const r = z / H0;
      const sx = -(half + 3.0 * (1 - r)) - 0.9;
      tw.push(leg(P3(sx, 1.5 - 0.9 * r, z + 0.05), P3(sx, 1.5 - 0.9 * r, z - 8 + 0.05), 0.08, 0.08));
    }
    push('照明塔（鉄骨）', '照明塔', 'steel-white', Manifold.union(tw));
  }
  for (const [key, g] of groups) {
    const name = key.startsWith('屋根') ? '屋根・ひさし' : key.startsWith('建物') ? 'スタンド・コンコース' : key;
    add(union(g.solids), name, g.layer, g.rule);
  }

  // ---- スコアボード（センター後方）: 写真に合わせて
  //   上: 濃い灰色の大きな板（地図データ r8829180・17.2〜25.7m）。上の段に広告（三井住友海上・広島銀行・時計・セブン-イレブン・DISCO）、
  //       左右に縦の看板（アサヒビール・広島市信用組合）、真ん中に LED（選手・得点・B S O・両チームの打順）
  //   その下: 下の箱（r8829134）の上部に広告の段（東亜地所・西川ゴム工業・KIRIN 一番搾り・ムロオ・kitagawa）
  //   緑の箱（バックスクリーン）に you me ゆめタウン、上に 5 本の旗
  {
    const sbItem = partItems.find((i) => i.id === 'r8829180');
    if (sbItem) {
      const ring = sbItem.outer![0];
      const c = centroid(sbItem);
      const l0 = Math.hypot(home[0] - c[0], home[1] - c[1]);
      const n0: P2 = [(home[0] - c[0]) / l0, (home[1] - c[1]) / l0];
      const t0: P2 = [-n0[1], n0[0]];
      const fr = ring.filter((p) => (p[0] - c[0]) * n0[0] + (p[1] - c[1]) * n0[1] > 0).sort((a2, b2) => (a2[0] * t0[0] + a2[1] * t0[1]) - (b2[0] * t0[0] + b2[1] * t0[1]));
      const A0 = fr[0];
      const B0 = fr[fr.length - 1];
      const L = Math.hypot(B0[0] - A0[0], B0[1] - A0[1]);
      const t: P2 = [(B0[0] - A0[0]) / L, (B0[1] - A0[1]) / L];
      const n = nOf(t);
      const off0 = Math.max(0, ...ring.map((p) => (p[0] - A0[0]) * n[0] + (p[1] - A0[1]) * n[1]));
      const S = (s2: number): P2 => [A0[0] + t[0] * s2, A0[1] + t[1] * s2];
      // 下の箱の範囲（板の座標 s）
      const low = partItems.find((i) => i.id === 'r8829134');
      const lowS = low ? low.outer![0].map((p) => (p[0] - A0[0]) * t[0] + (p[1] - A0[1]) * t[1]) : [8.9, 40.3];
      const LS0 = Math.min(...lowS);
      const LS1 = Math.max(...lowS);
      const Z0 = 17.2;
      const Z1 = 25.7;
      const GRAY = '#3c3e40';
      const panel = (s0: number, s1: number, z0: number, z1: number, off: number, th: number, name: string, color: string) =>
        pushDeco(name, color, place(rect(s1 - s0, z1 - z0), S((s0 + s1) / 2), (z0 + z1) / 2, t, off0 + off, th));
      const txt = (str: string, sc: number, zc: number, size: number, maxW: number, color: string, off = 0.12, name = 'スコアボードの表示') => {
        const tc = textCs(str, size, maxW);
        if (tc) pushDeco(name, color, place(tc, S(sc), zc, t, off0 + off, 0.02));
      };
      /** 縦書き（1 文字ずつ上から） */
      const vtxt = (str: string, sc: number, zTop: number, zBot: number, w: number, color: string, off = 0.12, name = 'スコアボードの表示') => {
        const chars = [...str];
        const step = (zTop - zBot) / chars.length;
        chars.forEach((ch, i) => {
          let tc = textCs(ch, Math.min(step * 0.82, w), w);
          if (!tc) return;
          if (ch === 'ー') tc = tc.rotate(90);
          pushDeco(name, color, place(tc, S(sc), zTop - step * (i + 0.5), t, off0 + off, 0.02));
        });
      };
      // 板（濃い灰色）
      panel(0, L, Z0, Z1, 0, 0.06, 'スコアボードの板（濃い灰色）', GRAY);
      // 上の段の広告
      const ZH0 = 24.0;
      panel(0.3, L - 0.3, ZH0 - 0.06, ZH0 - 0.02, 0.06, 0.02, 'スコアボードの区切り', '#9a9ea2');
      txt('三井住友海上', 9.5, 24.85, 1.05, 10, 'white', 0.08, 'スコアボードの広告（白文字）');
      txt('広島銀行', 19.5, 24.85, 1.05, 7, 'white', 0.08, 'スコアボードの広告（白文字）');
      pushDeco('スコアボードの広告（白文字）', 'white', place(CrossSection.circle(0.55, 32).subtract(CrossSection.circle(0.45, 32)), S(24.2), 24.85, t, off0 + 0.08, 0.02)); // 時計
      txt('セブン-イレブン', 30.5, 24.85, 1.0, 9, 'white', 0.08, 'スコアボードの広告（白文字）');
      txt('DISCO', 39.5, 24.85, 0.95, 6, 'white', 0.08, 'スコアボードの広告（白文字）');
      const small = ['焙煎ごぼう茶 あじかん', 'JA 農とあゆむ', 'JAバンク広島', 'DAISO'];
      small.forEach((v, i) => txt(v, 9 + i * 9.5, 23.55, 0.5, 8, 'white', 0.08, 'スコアボードの広告（白文字）'));
      // 左右の縦の看板
      vtxt('アサヒビール', 2.0, Z1 - 0.6, Z0 + 0.5, 2.0, 'white', 0.08, 'スコアボードの広告（白文字）');
      vtxt('広島市信用組合', L - 2.0, Z1 - 0.6, Z0 + 0.5, 1.6, 'white', 0.08, 'スコアボードの広告（白文字）');
      // LED（黒）
      const E0 = 3.9;
      const E1 = L - 3.9;
      const ZE0 = Z0 + 0.6;
      const ZE1 = 23.1;
      panel(E0, E1, ZE0, ZE1, 0.06, 0.04, 'スコアボードの LED（黒）', '#0d0f11');
      // 選手の表示（左）
      const P0 = E0 + 0.4;
      panel(P0, P0 + 6.2, ZE1 - 1.0, ZE1 - 0.25, 0.1, 0.01, 'スコアボードの LED（白い帯）', '#e9ecef');
      txt('P 才木 浩人', P0 + 3.1, ZE1 - 0.62, 0.5, 5.6, '#111111', 0.12);
      txt('投球数 98  奪三振 4', P0 + 3.1, ZE1 - 1.45, 0.42, 5.8, 'white');
      panel(P0, P0 + 6.2, ZE1 - 2.6, ZE1 - 1.85, 0.1, 0.01, 'スコアボードの LED（赤い帯）', '#d0202e');
      txt('4 末包 昇大', P0 + 3.1, ZE1 - 2.22, 0.5, 5.6, 'white', 0.12);
      txt('AVG .291  HR 2  RBI 4', P0 + 3.1, ZE1 - 3.05, 0.4, 5.8, 'white');
      txt('本日 3打数 2安打', P0 + 3.1, ZE1 - 3.85, 0.45, 5.8, 'white');
      txt('第2号 2ラン', P0 + 3.1, ZE1 - 4.55, 0.45, 5.8, '#ffd400');
      // 得点（1〜9 回・R H E）
      const G0 = P0 + 6.8;
      const colX = (i: number) => G0 + 1.6 + i * 0.95;
      const rheX = (i: number) => G0 + 1.6 + 9 * 0.95 + 0.3 + i * 1.0;
      panel(G0, rheX(2) + 0.6, ZE1 - 0.95, ZE1 - 0.3, 0.1, 0.01, 'スコアボードの LED（灰色の帯）', '#4a4f55');
      for (let i = 0; i < 9; i++) txt(String(i + 1), colX(i), ZE1 - 0.62, 0.45, 0.8, 'white');
      ['R', 'H', 'E'].forEach((ch, i) => txt(ch, rheX(i), ZE1 - 0.62, 0.45, 0.8, 'white'));
      const rows: [string, string, string[], string[]][] = [
        ['T', '#f5c400', ['0', '0', '0', '1', '0', '0', '0', '0', ''], ['1', '5', '1']],
        ['C', '#d0202e', ['2', '0', '0', '3', '0', '0', '1', '', ''], ['6', '11', '0']],
      ];
      rows.forEach(([lg, lc, inn, rhe], r) => {
        const zr = ZE1 - 1.75 - r * 1.25;
        panel(G0 + 0.15, G0 + 1.05, zr - 0.45, zr + 0.45, 0.1, 0.01, 'スコアボードの LED（チームの印）', lc);
        txt(lg, G0 + 0.6, zr, 0.6, 0.8, r === 0 ? '#111111' : 'white', 0.12);
        inn.forEach((v, i) => v && txt(v, colX(i), zr, 0.8, 0.8, 'white'));
        rhe.forEach((v, i) => txt(v, rheX(i), zr, 0.8, 0.95, 'white'));
      });
      // B・S・O（中央下）
      const lamps: [string, string, number][] = [['B', '#22c55e', 3], ['S', '#facc15', 2], ['O', '#ef4444', 2]];
      const bx = rheX(0) - 1.4;
      lamps.forEach(([ch, col, nl], r) => {
        const zr = ZE0 + 1.5 - r * 0.55;
        txt(ch, bx, zr, 0.4, 0.5, 'white');
        for (let k = 0; k < 3; k++) pushDeco(k < nl - 1 ? 'スコアボードのランプ（点灯）' : 'スコアボードのランプ', k < nl - 1 ? col : '#2d3136', place(CrossSection.circle(0.2, 16), S(bx + 0.6 + k * 0.5), zr, t, off0 + 0.11, 0.02));
      });
      // 両チームの打順（右・縦書きの名前 9 人ずつ）
      const O0 = rheX(2) + 1.2;
      const OW = (E1 - 0.3 - O0 - 1.2) / 9;
      const teams: [string, string, string[]][] = [
        ['阪神', '#f5c400', ['近本', '中野', '森下', '佐藤輝', '大山', '前川', '坂本', '小幡', '才木']],
        ['広島', '#d0202e', ['中村奨', '菊池', '小園', '末包', '坂倉', 'モンテロ', 'ファビアン', '矢野', '森下']],
      ];
      teams.forEach(([nm, col, names], r) => {
        const zt = ZE1 - 0.3 - r * 2.55;
        panel(O0, O0 + 1.0, zt - 2.3, zt, 0.1, 0.01, 'スコアボードの LED（チームの印）', col);
        vtxt(nm, O0 + 0.5, zt - 0.15, zt - 2.15, 0.8, r === 0 ? '#111111' : 'white');
        names.forEach((v, i) => {
          const x = O0 + 1.2 + (i + 0.5) * OW;
          txt(String(i + 1), x, zt - 0.3, 0.36, OW * 0.8, '#ffd400');
          vtxt(v, x, zt - 0.6, zt - 2.3, OW * 0.75, 'white');
        });
      });
      // LED の下の細い帯の広告
      txt('エネコム   MEGA EGG', 8, Z0 + 0.3, 0.32, 8, 'white', 0.08, 'スコアボードの広告（白文字）');
      txt('NTT Data', LS0 + 9, Z0 + 0.3, 0.32, 4, 'white', 0.08, 'スコアボードの広告（白文字）');
      // 下の広告の段（下の箱の上部）
      const ZA0 = 13.9;
      const ZA1 = Z0 - 0.05;
      panel(LS0, LS1, ZA0, ZA1, 0, 0.06, 'スコアボードの板（濃い灰色）', GRAY);
      const W3 = (LS1 - LS0) / 3;
      const za = (ZA0 + ZA1) / 2;
      txt('春日野 東亜地所', LS0 + W3 / 2, za + 0.75, 0.95, W3 - 1, 'white', 0.08, 'スコアボードの広告（白文字）');
      txt('nishikawa 西川ゴム工業', LS0 + W3 / 2, za - 0.75, 0.85, W3 - 1, 'white', 0.08, 'スコアボードの広告（白文字）');
      panel(LS0 + W3 + 0.4, LS0 + 2 * W3 - 0.4, ZA0 + 0.35, ZA1 - 0.35, 0.06, 0.02, 'スコアボードの広告（白い板）', '#f2f2f2');
      txt('KIRIN', LS0 + 1.5 * W3, za + 0.85, 0.5, W3, '#111111', 0.1);
      txt('一番搾り', LS0 + 1.5 * W3, za - 0.35, 1.3, W3 - 1.4, '#111111', 0.1);
      txt('食品の低温輸送 ムロオ', LS0 + 2.5 * W3, za + 0.75, 0.85, W3 - 1, 'white', 0.08, 'スコアボードの広告（白文字）');
      panel(LS0 + 2 * W3 + 0.6, LS1 - 0.6, za - 1.3, za - 0.2, 0.06, 0.02, 'スコアボードの広告（白い板）', '#f2f2f2');
      txt('kitagawa', LS0 + 2.5 * W3, za - 0.75, 0.75, W3 - 2, '#1f3c88', 0.1);
      // 緑の箱の you me ゆめタウン（左右）
      for (const sc of [LS0 + 2.6, LS1 - 2.6]) {
        const box = rect(2.9, 2.6).subtract(rect(2.65, 2.35));
        pushDeco('バックスクリーンの広告（白文字）', 'white', place(box, S(sc), 11.4, t, off0 + 0.02, 0.02));
        txt('you', sc, 11.95, 0.75, 2.4, 'white', 0.04, 'バックスクリーンの広告（白文字）');
        txt('me', sc, 10.9, 0.75, 2.4, 'white', 0.04, 'バックスクリーンの広告（白文字）');
        txt('ゆめタウン', sc, 9.4, 0.55, 2.8, 'white', 0.04, 'バックスクリーンの広告（白文字）');
      }
      // 上の旗（5 本）
      const flagPoles: Mf[] = [];
      const flags: [number, string, string?][] = [[10, '#f5c400', '#111111'], [15.5, '#1f6b3a'], [20.5, '#ffffff', '#d0202e'], [26.5, '#e9e4dc', '#d0202e'], [31.5, '#1d2a5c']];
      flags.forEach(([sc, c1, c2], i) => {
        const H = 25.7 + (i === 2 ? 8.5 : 7.0);
        const pp = S(sc);
        const nb: P2 = [n[0] * (off0 - 1.2), n[1] * (off0 - 1.2)];
        flagPoles.push(Manifold.cylinder(H - 25.7, 0.07, 0.07, 10).translate([pp[0] + nb[0], pp[1] + nb[1], 25.7]));
        const fz = H - 0.75;
        pushDeco('スコアボード上の旗', c1, place(rect(1.9, 1.25), S(sc + 0.95), fz, t, off0 - 1.2, 0.02));
        if (c2 && i === 0) for (const dz of [-0.35, 0.05, 0.45]) pushDeco('スコアボード上の旗（模様）', c2, place(rect(1.9, 0.14), S(sc + 0.95), fz + dz - 0.05, t, off0 - 1.2 + 0.02, 0.01));
        if (c2 && i > 0) pushDeco('スコアボード上の旗（模様）', c2, place(CrossSection.circle(0.36, 24), S(sc + 0.95), fz, t, off0 - 1.2 + 0.02, 0.01));
      });
      add(union(flagPoles), 'スコアボード上の旗竿', '広告・看板', 'steel-white');
      // 裏側（球場の外・東向き）の看板（写真）: 灰色の板に「mazda」「ようこそ、ときめく広島へ。」と斜体の球場名 3 段、上に照明
      {
        const offB0 = Math.min(...ring.map((p) => (p[0] - A0[0]) * n[0] + (p[1] - A0[1]) * n[1])); // 裏の面（負）
        // 上の段の裏（r8829181）はさらに後ろへ出ているので、看板はいちばん後ろの面にそろえ、その間は灰色の板でふさぐ
        const back2 = partItems.find((i) => i.id === 'r8829181');
        const offB = Math.min(offB0, ...(back2 ? back2.outer![0].map((p) => (p[0] - A0[0]) * n[0] + (p[1] - A0[1]) * n[1]) : []));
        const tB: P2 = [-t[0], -t[1]]; // 裏から見て右向き
        const SB = (s2: number): P2 => [A0[0] + t[0] * s2 + n[0] * offB, A0[1] + t[1] * s2 + n[1] * offB];
        const bp = (s0: number, s1: number, z0: number, z1: number, off: number, th: number, name: string, color: string) =>
          pushDeco(name, color, place(rect(Math.abs(s1 - s0), z1 - z0), SB((s0 + s1) / 2), (z0 + z1) / 2, tB, off, th));
        const bt = (str: string, sc: number, zc: number, size: number, maxW: number, color: string, italic = 0) => {
          const r = textRings(str);
          if (!r) return;
          const rings = italic ? r.rings.map((q) => q.map(([x, y]) => [x + italic * y, y] as [number, number])) : r.rings;
          let cs = new CrossSection(rings, 'NonZero');
          const b = cs.bounds();
          const k = Math.min(size / (b.max[1] - b.min[1]), maxW / (b.max[0] - b.min[0]));
          cs = cs.translate([-(b.min[0] + b.max[0]) / 2, -(b.min[1] + b.max[1]) / 2]).scale(k);
          pushDeco('スコアボード裏の看板（白文字）', color, place(cs, SB(sc), zc, tB, 0.08, 0.03));
        };
        pushDeco('スコアボード裏の看板（灰色）', '#6b6f73', place(rect(L, Z1 - Z0), [A0[0] + t[0] * (L / 2) + n[0] * offB0, A0[1] + t[1] * (L / 2) + n[1] * offB0], (Z0 + Z1) / 2, tB, 0, offB0 - offB + 0.06));
        void bp;
        const mid = L / 2;
        bt('ようこそ、ときめく広島へ。', mid + 2, Z1 - 1.4, 1.3, 30, 'white');
        bt('mazda', L - 4.5, Z1 - 1.4, 0.9, 5, 'white');
        bt('MAZDA', mid, Z1 - 3.3, 1.3, 12, 'white', 0.25);
        bt('zoom-zoom', mid, Z1 - 4.9, 1.3, 20, 'white', 0.25);
        bt('スタジアム広島', mid, Z1 - 6.5, 1.3, 20, 'white', 0.25);
        const lp: Mf[] = [];
        for (let s2 = 3; s2 < L - 2; s2 += 4.2) {
          const pp = SB(s2);
          const nb: P2 = [-n[0] * 0.5, -n[1] * 0.5];
          lp.push(Manifold.cylinder(1.6 + (Math.round(s2) % 2) * 1.2, 0.05, 0.05, 8).translate([pp[0] - nb[0] * 2, pp[1] - nb[1] * 2, Z1]));
          lp.push(Manifold.cube([0.5, 0.35, 0.3], true).translate([pp[0] + nb[0], pp[1] + nb[1], Z1 + 0.5]));
        }
        add(union(lp), 'スコアボード裏の照明', '広告・看板', 'steel-white');
      }
      console.log('scoreboard', L.toFixed(1), off0.toFixed(2), 'low', LS0.toFixed(1), LS1.toFixed(1));
    }
  }
  // ---- 正面入口（本塁裏・西側）の球場名: 赤茶色の外壁の、入口の上の開口のさらに上に 3 段（MAZDA / zoom-zoom / スタジアム広島）
  {
    // 外壁の外側の面（地図データ r8880509・r8917892・r8917893 の西の辺。北から南へ）
    const facade: P2[] = [[-109.62, 14.47], [-110.55, 10.74], [-111.37, 6.59], [-111.97, 2.41], [-112.34, -1.79], [-112.52, -6.07], [-112.44, -10.23], [-112.3, -11.6], [-112.2, -14.4], [-111.8, -17.3], [-111.6, -18.6], [-110.9, -22.8], [-110.0, -26.9], [-108.8, -31.0], [-107.4, -35.0], [-105.9, -38.9], [-104.1, -42.7]];
    const pl = polyline(facade);
    // 入口の真ん中（y ≈ -14.4）
    let sc = 0;
    for (let s2 = 0; s2 < pl.len; s2 += 0.1) if (Math.abs(pl.at(s2).p[1] + 14.4) < Math.abs(pl.at(sc).p[1] + 14.4)) sc = s2;
    textAlong(pl, sc, 12.75, 1.55, 'MAZDA', 0.03, 0.18, '正面入口の球場名', 'white', 0.22);
    textAlong(pl, sc, 11.45, 1.75, 'zoom-zoom', 0.03, 0.18, '正面入口の球場名', 'white', 0.22);
    textAlong(pl, sc, 10.15, 1.1, 'スタジアム広島', 0.03, 0.18, '正面入口の球場名', 'white', 0.22);
    // 文字の影（写真では文字の下に濃い影）
    textAlong(pl, sc + 0.12, 12.63, 1.55, 'MAZDA', 0.02, 0.02, '正面入口の球場名（影）', '#5a2a26', 0.22);
    textAlong(pl, sc + 0.12, 11.33, 1.75, 'zoom-zoom', 0.02, 0.02, '正面入口の球場名（影）', '#5a2a26', 0.22);
    textAlong(pl, sc + 0.12, 10.03, 1.1, 'スタジアム広島', 0.02, 0.02, '正面入口の球場名（影）', '#5a2a26', 0.22);
    // 入口の上の赤い帯と「広島市民球場」の小さな看板（ガラスの下）
    const bandPts: Mf[] = [];
    for (let s2 = 0; s2 + 1 < pl.len; s2 += 1) {
      const a2 = pl.at(s2);
      bandPts.push(place(rect(1.05, 0.35), [a2.p[0] + a2.t[0] * 0.5, a2.p[1] + a2.t[1] * 0.5], 4.2, a2.t, 0.02, 0.05));
    }
    add(union(bandPts), '正面入口の赤い帯', '広告・看板', '#b3122e');
    const ps = pl.at(sc);
    pushDeco('正面入口の看板', '#b3122e', place(rect(3.4, 0.7), ps.p, 4.2, ps.t, 0.08, 0.05));
    const tc = textCs('広島市民球場', 0.45, 3.0);
    if (tc) pushDeco('正面入口の看板の文字', 'white', place(tc, ps.p, 4.2, ps.t, 0.13, 0.02));
    console.log('gate sign', pl.len.toFixed(1), sc.toFixed(1));
  }
  for (const [k, l] of deco) {
    const [name, color] = k.split('|');
    const t0 = Date.now();
    const u2 = union(l);
    const t1 = Date.now();
    add(u2, name, '広告・看板', color);
    console.log('deco', name, color, l.length, 'tris', u2?.numTri(), 'union', t1 - t0, 'add', Date.now() - t1, 'ms');
  }

  // マウンド（芝の内側の穴のうち円いもの）
  for (const r of pitch.inner ?? []) {
    const xs = r.map((p) => p[0]);
    const ys = r.map((p) => p[1]);
    const w = Math.max(...xs) - Math.min(...xs);
    if (w > 4 && w < 7) {
      const layers: Mf[] = [ext(new CrossSection([ccw(r)], 'Positive'), -0.03, 0.0)];
      const N = 10;
      for (let k = 0; k < N; k++) {
        const t0 = k / N;
        const rad = 2.74 * Math.cos((t0 * Math.PI) / 2) ** 0.8 + 0.5 * t0; // 上は平らに近い（プレートの周り 0.5m）
        layers.push(Manifold.cylinder(0.25 / N, rad, rad, 48).translate([mound[0], mound[1], (0.25 * k) / N]));
      }
      add(Manifold.union(layers), 'マウンド', 'グラウンド', 'soil');
      add(Manifold.cube([0.61, 0.15, 0.03], true).rotate([0, 0, (Math.atan2(cf[1], cf[0]) * 180) / Math.PI + 90]).translate([mound[0], mound[1], 0.26]), 'ピッチャープレート', 'グラウンド', 'white');
    }
  }

  // 球場の地面（土）。レフトスタンド下の半地下の席の所は掘り下げる
  let groundCs = stadiumCs;
  if (lfPit) groundCs = groundCs.subtract(lfPit);
  if (podiumPit) groundCs = groundCs.subtract(podiumPit);
  // 芝の下には土を置かない（遠くから見たときに芝と土がちらつくのを防ぐ）
  groundCs = groundCs.subtract(pitchCs);
  add(ext(groundCs, -0.6, -0.025), '球場の地面（土）', 'グラウンド', 'soil');
  if (lfPit) add(ext(lfPit, -0.8, -0.7), 'レフトスタンド下の床', 'グラウンド', 'concrete');
  // ---- 周辺 ----
  add(Manifold.cube([700, 700, 0.5]).translate([-350, -350, -0.56]).subtract(ext(stadiumCs, -2, 1)), '周辺の地面', '周辺', 'paving');
  const ctx: Mf[] = [];
  for (const it of parts) {
    if (partItems.includes(it) || it.tags['building:part']) continue;
    const c0 = centroid(it);
    if (Math.hypot(c0[0], c0[1]) > 330) continue;
    if (inBox(c0, 5) && outlineOnly(it)) continue;
    if (inBox(c0, 5) && !it.tags.height && !it.tags['building:levels']) continue;
    const c = shape(it);
    if (!c) continue;
    const h = num(it.tags.height) ?? (num(it.tags['building:levels']) ?? 2) * 3.2;
    ctx.push(ext(c, num(it.tags.min_height) ?? 0, h));
  }
  add(union(ctx), '周辺の建物', '周辺', (n) => (n.z > 0.5 ? 'roof-flat' : 'mortar-gray'));
  // 線路
  const rails: Mf[] = [];
  for (const it of items) {
    if (it.tags.railway !== 'rail' || !it.line) continue;
    const pts = it.line;
    for (let i = 0; i + 1 < pts.length; i++) {
      const [ax, ay] = pts[i];
      const [bx, by] = pts[i + 1];
      const L = Math.hypot(bx - ax, by - ay);
      if (L < 0.05 || Math.hypot(ax, ay) > 340) continue;
      const ang = Math.atan2(by - ay, bx - ax);
      rails.push(Manifold.cube([L + 0.3, 3.0, 0.35]).translate([0, -1.5, -0.05]).rotate([0, 0, (ang * 180) / Math.PI]).translate([ax, ay, 0]));
    }
  }
  add(union(rails), '線路（道床）', '周辺', (n) => (n.z > 0.5 ? 'gravel' : 'concrete'));

  console.log('seats', nSeat, 'groups', groups.size);
  writeFileSync(
    out,
    JSON.stringify({
      app: '3DCAD',
      version: 1,
      savedAt: new Date().toISOString(),
      model: model.toJSON(),
      sheets: [],
      pointClouds: [],
      camera: { position: [-200, 150, 150], target: [0, 5, 0] },
      render: { style: 'real', month: 7, day: 20, hour: 16, shadows: true, ground: 'grass', edges: false, high: true, showPointClouds: false, showSheets: false },
    }),
  );
  console.log('faces', model.faces.size, 'groups', model.groups.size);
};
main();
