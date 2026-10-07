// Текстуры отделки в интерфейсе: blob-URL для CSS-образцов (data:URI в 200+ КБ не тащим в style
// каждой строки списка), кэш картинок для canvas, уменьшенный тайл для чистого тайлинга, средний цвет.
import { useEffect, useState } from 'react';
import type { Finish } from '../model/types';

const urls = new Map<string, string>();

/** Короткий blob:URL для data:URI (кэшируется на сессию). */
export function texUrl(tex: string): string {
  let u = urls.get(tex);
  if (u) return u;
  try {
    const comma = tex.indexOf(',');
    const meta = tex.slice(5, comma);
    const mime = meta.split(';')[0] || 'image/png';
    const raw = meta.includes(';base64') ? atob(tex.slice(comma + 1)) : decodeURIComponent(tex.slice(comma + 1));
    const bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
    u = URL.createObjectURL(new Blob([bytes], { type: mime }));
  } catch {
    u = tex;
  }
  urls.set(tex, u);
  return u;
}

const images = new Map<string, HTMLImageElement>();
const listeners = new Set<() => void>();

/** Картинка текстуры, если уже загружена (иначе null и перерисовка по onload). */
export function texImage(tex: string | null): HTMLImageElement | null {
  if (!tex) return null;
  let img = images.get(tex);
  if (!img) {
    img = new Image();
    img.onload = () => listeners.forEach((l) => l());
    img.src = texUrl(tex);
    images.set(tex, img);
  }
  return img.complete && img.naturalWidth > 0 ? img : null;
}

/** Перерисовка компонента при догрузке любой текстуры отделки. */
export function useTexTick(): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const l = () => setTick((t) => t + 1);
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  }, []);
  return tick;
}

// Уменьшенный тайл: паттерн canvas без мипмапов «рябит» на мелком масштабе, поэтому повтор
// заранее ужимается до нужного размера в пикселях качественным сглаживанием.
const tiles = new Map<string, HTMLCanvasElement>();

export function scaledTile(img: HTMLImageElement, wPx: number, hPx: number): HTMLCanvasElement {
  const w = Math.max(1, Math.round(wPx));
  const h = Math.max(1, Math.round(hPx));
  const key = `${img.src}|${w}|${h}`;
  let c = tiles.get(key);
  if (c) return c;
  c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  // ступенчатое уменьшение по 2× — без пропуска пикселей узора
  let src: CanvasImageSource = img;
  let sw = img.naturalWidth;
  let sh = img.naturalHeight;
  while (sw / 2 > w && sh / 2 > h) {
    const t = document.createElement('canvas');
    t.width = Math.ceil(sw / 2);
    t.height = Math.ceil(sh / 2);
    const tc = t.getContext('2d')!;
    tc.imageSmoothingQuality = 'high';
    tc.drawImage(src, 0, 0, t.width, t.height);
    src = t;
    sw = t.width;
    sh = t.height;
  }
  ctx.drawImage(src, 0, 0, w, h);
  if (tiles.size > 24) tiles.delete(tiles.keys().next().value!);
  tiles.set(key, c);
  return c;
}

/** Средний цвет картинки (#rrggbb) и её размер в пикселях. */
export function analyzeTexture(tex: string): Promise<{ color: string; w: number; h: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const size = { w: img.naturalWidth, h: img.naturalHeight };
      const n = 32;
      const c = document.createElement('canvas');
      c.width = n;
      c.height = n;
      const ctx = c.getContext('2d')!;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, 0, 0, n, n);
      const d = ctx.getImageData(0, 0, n, n).data;
      let r = 0, g = 0, b = 0, a = 0;
      for (let i = 0; i < d.length; i += 4) {
        const w = d[i + 3] / 255;
        r += d[i] * w;
        g += d[i + 1] * w;
        b += d[i + 2] * w;
        a += w;
      }
      if (a <= 0) return resolve({ color: '#888888', ...size });
      const hex = (v: number) => Math.round(v / a).toString(16).padStart(2, '0');
      resolve({ color: `#${hex(r)}${hex(g)}${hex(b)}`, ...size });
    };
    img.onerror = () => reject(new Error('Не удалось прочитать текстуру'));
    img.src = texUrl(tex);
  });
}

/** Размер картинки текстуры в пикселях (если загружена). */
export function texSize(tex: string | null): { w: number; h: number } | null {
  const img = texImage(tex);
  return img ? { w: img.naturalWidth, h: img.naturalHeight } : null;
}

/** «0.53 × 0.53 м» */
export const tileLabel = (f: Pick<Finish, 'tileW' | 'tileH'>) => `${+f.tileW.toFixed(2)} × ${+f.tileH.toFixed(2)} м`;

export const SURFACE_NAME = { wall: 'стены', floor: 'пол' } as const;
