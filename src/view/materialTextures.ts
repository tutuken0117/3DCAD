import {
  CanvasTexture,
  Color,
  DoubleSide,
  FrontSide,
  MeshStandardMaterial,
  RepeatWrapping,
  SRGBColorSpace,
} from 'three';
import type { MaterialDef } from '../core/materials';

/**
 * 仕上げ材のテクスチャを canvas に描いて作る（画像ファイルを持たずに済む）。
 * UV はメートル単位で与えるので、texture.repeat = 1 / tile で実寸に合わせる。
 */

const SIZE = 512;

/** 再現性のある乱数 */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function shade(hex: string, k: number): string {
  const c = new Color(hex);
  if (k >= 0) c.lerp(new Color('#ffffff'), k);
  else c.lerp(new Color('#000000'), -k);
  return `#${c.getHexString()}`;
}

/** 細かいノイズ（ざらつき） */
function noise(g: CanvasRenderingContext2D, amount: number, seed: number, size = 2): void {
  const r = rng(seed);
  for (let i = 0; i < (SIZE * SIZE) / (size * size * 3); i++) {
    const v = r();
    g.fillStyle = v > 0.5 ? `rgba(255,255,255,${amount * r()})` : `rgba(0,0,0,${amount * r()})`;
    g.fillRect(Math.floor(r() * SIZE), Math.floor(r() * SIZE), size, size);
  }
}

function draw(def: MaterialDef, g: CanvasRenderingContext2D): void {
  const base = def.color;
  const r = rng(def.id.length * 97 + 13);
  g.fillStyle = base;
  g.fillRect(0, 0, SIZE, SIZE);
  switch (def.pattern) {
    case 'plaster':
      noise(g, 0.06, 1, 3);
      noise(g, 0.04, 2, 8);
      break;
    case 'concrete': {
      // 打放しの型枠割り（900×1800 を想定）とセパ穴
      noise(g, 0.08, 3, 2);
      noise(g, 0.05, 4, 12);
      g.strokeStyle = shade(base, -0.25);
      g.lineWidth = 2;
      g.strokeRect(1, 1, SIZE - 2, SIZE / 2 - 2);
      g.strokeRect(1, SIZE / 2 + 1, SIZE - 2, SIZE / 2 - 2);
      g.fillStyle = shade(base, -0.35);
      for (const y of [SIZE / 8, (SIZE * 3) / 8, (SIZE * 5) / 8, (SIZE * 7) / 8])
        for (const x of [SIZE / 6, SIZE / 2, (SIZE * 5) / 6]) {
          g.beginPath();
          g.arc(x, y, 4, 0, Math.PI * 2);
          g.fill();
        }
      break;
    }
    case 'siding': {
      const rows = 8;
      const h = SIZE / rows;
      for (let i = 0; i < rows; i++) {
        g.fillStyle = shade(base, (r() - 0.5) * 0.08);
        g.fillRect(0, i * h, SIZE, h);
        g.fillStyle = shade(base, -0.28);
        g.fillRect(0, i * h + h - 4, SIZE, 4);
        g.fillStyle = shade(base, 0.15);
        g.fillRect(0, i * h, SIZE, 2);
      }
      noise(g, 0.04, 5, 2);
      break;
    }
    case 'brick': {
      // 0.9m 角に 4 列 × 12 段
      const cols = 4;
      const rows = 12;
      const w = SIZE / cols;
      const h = SIZE / rows;
      g.fillStyle = '#cfc6b8';
      g.fillRect(0, 0, SIZE, SIZE);
      for (let y = 0; y < rows; y++) {
        const off = y % 2 ? w / 2 : 0;
        for (let x = -1; x <= cols; x++) {
          g.fillStyle = shade(base, (r() - 0.5) * 0.3);
          g.fillRect(x * w + off + 3, y * h + 3, w - 6, h - 6);
        }
      }
      noise(g, 0.07, 6, 2);
      break;
    }
    case 'wood':
    case 'flooring': {
      const boards = def.pattern === 'wood' ? 8 : 6;
      const horizontal = def.pattern === 'flooring';
      const s = SIZE / boards;
      for (let i = 0; i < boards; i++) {
        g.fillStyle = shade(base, (r() - 0.5) * 0.25);
        if (horizontal) g.fillRect(0, i * s, SIZE, s);
        else g.fillRect(i * s, 0, s, SIZE);
        // 木目
        g.strokeStyle = `rgba(60,35,15,0.18)`;
        g.lineWidth = 1;
        for (let k = 0; k < 6; k++) {
          g.beginPath();
          const o = i * s + r() * s;
          for (let t = 0; t <= SIZE; t += 16) {
            const wob = Math.sin(t / 40 + k) * 3;
            if (horizontal) (t === 0 ? g.moveTo(t, o + wob) : g.lineTo(t, o + wob));
            else (t === 0 ? g.moveTo(o + wob, t) : g.lineTo(o + wob, t));
          }
          g.stroke();
        }
        g.fillStyle = 'rgba(30,20,10,0.45)';
        if (horizontal) g.fillRect(0, i * s, SIZE, 2);
        else g.fillRect(i * s, 0, 2, SIZE);
        if (horizontal) {
          const cut = r() * SIZE;
          g.fillRect(cut, i * s, 2, s);
        }
      }
      break;
    }
    case 'metal-vertical':
    case 'roof-metal': {
      // 縦のはぜ（立平・角波）
      const ribs = def.pattern === 'roof-metal' ? 4 : 8;
      const s = SIZE / ribs;
      for (let i = 0; i < ribs; i++) {
        const grad = g.createLinearGradient(i * s, 0, i * s + s, 0);
        grad.addColorStop(0, shade(base, 0.12));
        grad.addColorStop(0.5, base);
        grad.addColorStop(1, shade(base, -0.12));
        g.fillStyle = grad;
        g.fillRect(i * s, 0, s, SIZE);
        g.fillStyle = shade(base, 0.35);
        g.fillRect(i * s, 0, 3, SIZE);
        g.fillStyle = shade(base, -0.4);
        g.fillRect(i * s + 3, 0, 2, SIZE);
      }
      noise(g, 0.03, 7, 2);
      break;
    }
    case 'roof-tile': {
      // 桟瓦: 横に波、段ごとに影
      const rows = 4;
      const cols = 4;
      const h = SIZE / rows;
      const w = SIZE / cols;
      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
          const grad = g.createLinearGradient(x * w, 0, x * w + w, 0);
          grad.addColorStop(0, shade(base, -0.25));
          grad.addColorStop(0.45, shade(base, 0.25));
          grad.addColorStop(1, shade(base, -0.3));
          g.fillStyle = grad;
          g.fillRect(x * w, y * h, w, h);
        }
        g.fillStyle = 'rgba(0,0,0,0.45)';
        g.fillRect(0, y * h + h - 6, SIZE, 6);
      }
      noise(g, 0.04, 8, 2);
      break;
    }
    case 'slate': {
      const rows = 6;
      const cols = 4;
      const h = SIZE / rows;
      const w = SIZE / cols;
      for (let y = 0; y < rows; y++) {
        const off = y % 2 ? w / 2 : 0;
        for (let x = -1; x <= cols; x++) {
          g.fillStyle = shade(base, (r() - 0.5) * 0.18);
          g.fillRect(x * w + off + 1, y * h, w - 2, h);
        }
        g.fillStyle = 'rgba(0,0,0,0.5)';
        g.fillRect(0, y * h + h - 4, SIZE, 4);
      }
      noise(g, 0.05, 9, 2);
      break;
    }
    case 'glass': {
      const grad = g.createLinearGradient(0, 0, SIZE, SIZE);
      grad.addColorStop(0, shade(base, 0.35));
      grad.addColorStop(0.5, base);
      grad.addColorStop(1, shade(base, -0.2));
      g.fillStyle = grad;
      g.fillRect(0, 0, SIZE, SIZE);
      break;
    }
    case 'tile': {
      const n = 4;
      const s = SIZE / n;
      for (let y = 0; y < n; y++)
        for (let x = 0; x < n; x++) {
          g.fillStyle = shade(base, (r() - 0.5) * 0.15);
          g.fillRect(x * s + 2, y * s + 2, s - 4, s - 4);
        }
      g.strokeStyle = shade(base, -0.3);
      g.lineWidth = 3;
      for (let i = 0; i <= n; i++) {
        g.beginPath();
        g.moveTo(i * s, 0);
        g.lineTo(i * s, SIZE);
        g.moveTo(0, i * s);
        g.lineTo(SIZE, i * s);
        g.stroke();
      }
      noise(g, 0.05, 10, 2);
      break;
    }
    case 'grass': {
      for (let i = 0; i < 9000; i++) {
        g.strokeStyle = shade(base, (r() - 0.5) * 0.5);
        g.lineWidth = 1;
        const x = r() * SIZE;
        const y = r() * SIZE;
        g.beginPath();
        g.moveTo(x, y);
        g.lineTo(x + (r() - 0.5) * 4, y - 3 - r() * 5);
        g.stroke();
      }
      break;
    }
    case 'asphalt':
      noise(g, 0.18, 11, 2);
      noise(g, 0.1, 12, 1);
      break;
    case 'stone': {
      // 不定形の石（大小の矩形を目地で区切る）
      g.fillStyle = shade(base, -0.35);
      g.fillRect(0, 0, SIZE, SIZE);
      const rows = 5;
      const h = SIZE / rows;
      for (let y = 0; y < rows; y++) {
        let x = -r() * 60;
        while (x < SIZE) {
          const w = 70 + r() * 110;
          g.fillStyle = shade(base, (r() - 0.5) * 0.3);
          g.fillRect(x + 3, y * h + 3, w - 6, h - 6);
          x += w;
        }
      }
      noise(g, 0.08, 13, 2);
      break;
    }
    case 'block': {
      // ブロック積み（半分ずらし）
      const cols = 4;
      const rows = 8;
      const w = SIZE / cols;
      const h = SIZE / rows;
      g.fillStyle = shade(base, -0.3);
      g.fillRect(0, 0, SIZE, SIZE);
      for (let y = 0; y < rows; y++) {
        const off = y % 2 ? w / 2 : 0;
        for (let x = -1; x <= cols; x++) {
          g.fillStyle = shade(base, (r() - 0.5) * 0.12);
          g.fillRect(x * w + off + 2, y * h + 2, w - 4, h - 4);
        }
      }
      noise(g, 0.08, 14, 2);
      break;
    }
    case 'panel': {
      // 大判パネル（縦長の目地）
      const cols = 2;
      const w = SIZE / cols;
      for (let x = 0; x < cols; x++) {
        g.fillStyle = shade(base, (r() - 0.5) * 0.06);
        g.fillRect(x * w, 0, w, SIZE);
      }
      g.fillStyle = shade(base, -0.35);
      for (let x = 0; x <= cols; x++) g.fillRect(x * w - 2, 0, 4, SIZE);
      g.fillRect(0, SIZE / 2 - 2, SIZE, 4);
      g.fillRect(0, 0, SIZE, 2);
      noise(g, 0.04, 15, 2);
      break;
    }
    case 'shingle': {
      // アスファルトシングル（段ごとにずらした切り込み）
      const rows = 6;
      const h = SIZE / rows;
      for (let y = 0; y < rows; y++) {
        const off = (y % 2) * 32;
        for (let x = -1; x < 9; x++) {
          g.fillStyle = shade(base, (r() - 0.5) * 0.25);
          g.fillRect(x * 64 + off + 1, y * h, 62, h - 3);
        }
        g.fillStyle = 'rgba(0,0,0,0.45)';
        g.fillRect(0, y * h + h - 4, SIZE, 4);
      }
      noise(g, 0.12, 16, 2);
      break;
    }
    case 'gravel': {
      // 砂利・土（小石の粒）
      noise(g, 0.12, 17, 2);
      for (let i = 0; i < 2600; i++) {
        g.fillStyle = shade(base, (r() - 0.5) * 0.6);
        g.beginPath();
        g.ellipse(r() * SIZE, r() * SIZE, 2 + r() * 5, 2 + r() * 4, r() * Math.PI, 0, Math.PI * 2);
        g.fill();
      }
      break;
    }
    case 'plain':
      break;
  }
}

/** 色・模様・大きさが同じなら同じテクスチャを使う */
const sig = (def: MaterialDef) => `${def.id}|${def.color}|${def.pattern}|${def.tile}`;

const textureCache = new Map<string, CanvasTexture>();

export function materialTexture(def: MaterialDef): CanvasTexture | null {
  if (def.pattern === 'plain') return null;
  let tex = textureCache.get(sig(def));
  if (!tex) {
    const c = document.createElement('canvas');
    c.width = c.height = SIZE;
    draw(def, c.getContext('2d')!);
    tex = new CanvasTexture(c);
    tex.wrapS = tex.wrapT = RepeatWrapping;
    tex.colorSpace = SRGBColorSpace;
    tex.anisotropy = 8;
    tex.repeat.set(1 / def.tile, 1 / def.tile);
    textureCache.set(sig(def), tex);
  }
  return tex;
}

/** 材料見本（パレット表示用の小さな画像） */
const swatchCache = new Map<string, string>();

export function materialSwatch(def: MaterialDef): string {
  const key = sig(def);
  const hit = swatchCache.get(key);
  if (hit) return hit;
  const c = document.createElement('canvas');
  c.width = c.height = SIZE;
  draw(def, c.getContext('2d')!);
  const s = document.createElement('canvas');
  s.width = s.height = 48;
  s.getContext('2d')!.drawImage(c, 0, 0, SIZE / 2, SIZE / 2, 0, 0, 48, 48);
  const url = s.toDataURL();
  swatchCache.set(key, url);
  return url;
}

const materialCache = new Map<string, MeshStandardMaterial>();

/** 3D 描画用のマテリアル（doubleSided: 裏面も同じ見た目で描く） */
export function threeMaterial(def: MaterialDef, doubleSided: boolean): MeshStandardMaterial {
  const key = `${sig(def)}:${def.opacity}:${def.roughness}:${def.emissive}:${doubleSided}`;
  let m = materialCache.get(key);
  if (!m) {
    const map = materialTexture(def);
    m = new MeshStandardMaterial({
      color: map ? '#ffffff' : def.color,
      map,
      roughness: def.roughness,
      metalness: def.metalness,
      transparent: def.opacity !== undefined,
      opacity: def.opacity ?? 1,
      depthWrite: def.opacity === undefined,
      side: doubleSided || def.opacity !== undefined ? DoubleSide : FrontSide,
      emissive: def.emissive ? new Color(def.color) : new Color(0x000000),
      emissiveIntensity: def.emissive ?? 0,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
    });
    materialCache.set(key, m);
  }
  return m;
}
