// Отрисовка декора (общая для редактора и предпросмотра) и кэш текстур.
import type { Prop } from '../model/types';

const cache = new Map<string, HTMLImageElement>();
const loadListeners = new Set<() => void>();

export function onImageLoad(l: () => void) {
  loadListeners.add(l);
  return () => {
    loadListeners.delete(l);
  };
}

export function getPropImage(prop: Prop): HTMLImageElement | null {
  if (!prop.tex) return null;
  let img = cache.get(prop.tex);
  if (!img) {
    img = new Image();
    img.onload = () => loadListeners.forEach((l) => l());
    img.src = prop.tex;
    cache.set(prop.tex, img);
  }
  return img.complete && img.naturalWidth > 0 ? img : null;
}

export interface DrawPropOpts {
  alpha?: number;
  selected?: boolean;
  /** контур без заливки — для «призрака» при постановке */
  ghost?: boolean;
  /** цвет обводки выделения */
  accent?: string;
}

/**
 * Нарисовать декор с центром в (sx, sy) экранных CSS-px, поворот rot° по часовой.
 * pxPerM — CSS-px на метр. Без текстуры: заливка цветом + подчёркнутая передняя грань
 * (нижняя при rot = 0), чтобы был виден поворот (ТЗ §6).
 */
export function drawProp(
  ctx: CanvasRenderingContext2D,
  prop: Prop,
  sx: number,
  sy: number,
  rot: number,
  pxPerM: number,
  o: DrawPropOpts = {},
) {
  const w = prop.w * pxPerM;
  const h = prop.h * pxPerM;
  ctx.save();
  ctx.translate(sx, sy);
  ctx.rotate((rot * Math.PI) / 180);
  ctx.globalAlpha = o.alpha ?? 1;
  const img = o.ghost ? null : getPropImage(prop);
  if (img) {
    ctx.drawImage(img, -w / 2, -h / 2, w, h);
  } else if (!o.ghost) {
    ctx.fillStyle = prop.color;
    ctx.fillRect(-w / 2, -h / 2, w, h);
    ctx.strokeStyle = 'rgba(0,0,0,0.45)';
    ctx.lineWidth = 1;
    ctx.strokeRect(-w / 2 + 0.5, -h / 2 + 0.5, w - 1, h - 1);
    // передняя грань
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(-w / 2, h / 2 - Math.max(2, Math.min(5, h * 0.12)), w, Math.max(2, Math.min(5, h * 0.12)));
  }
  if (o.ghost) {
    ctx.setLineDash([4, 3]);
    ctx.strokeStyle = o.accent ?? '#e8b04b';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(-w / 2, -h / 2, w, h);
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(-w / 2, h / 2);
    ctx.lineTo(w / 2, h / 2);
    ctx.lineWidth = 3;
    ctx.stroke();
  }
  if (o.selected) {
    ctx.globalAlpha = 1;
    ctx.strokeStyle = o.accent ?? '#e8b04b';
    ctx.lineWidth = 2;
    ctx.strokeRect(-w / 2 - 3, -h / 2 - 3, w + 6, h + 6);
  }
  ctx.restore();
}

/** Попадание точки (в метрах, относительно центра декора) в повёрнутый прямоугольник. */
export function hitProp(prop: Prop, cxM: number, cyM: number, rot: number, pxM: number, pyM: number, padM = 0): boolean {
  const a = (-rot * Math.PI) / 180;
  const dx = pxM - cxM;
  const dy = pyM - cyM;
  const lx = dx * Math.cos(a) - dy * Math.sin(a);
  const ly = dx * Math.sin(a) + dy * Math.cos(a);
  return Math.abs(lx) <= prop.w / 2 + padM && Math.abs(ly) <= prop.h / 2 + padM;
}

/** Загрузка текстуры с диска: длинная сторона → maxSide px, PNG с прозрачностью (ТЗ §6). */
export function loadTextureFile(file: File, maxSide = 512): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
      const w = Math.max(1, Math.round(img.naturalWidth * k));
      const h = Math.max(1, Math.round(img.naturalHeight * k));
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      const ctx = c.getContext('2d')!;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL('image/png'));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Не удалось прочитать изображение'));
    };
    img.src = url;
  });
}
