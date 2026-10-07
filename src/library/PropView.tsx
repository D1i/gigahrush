// Canvas-вид декора: миниатюра в списке и крупный предпросмотр в масштабе на фоне пола.
import { useEffect, useRef, useState } from 'react';
import type { Prop } from '../model/types';
import { drawProp, onImageLoad } from '../render/props';

/** Перерисовка при догрузке текстур (кэш картинок общий). */
function useImageTick() {
  const [tick, setTick] = useState(0);
  useEffect(() => onImageLoad(() => setTick((t) => t + 1)), []);
  return tick;
}

function setupCanvas(c: HTMLCanvasElement, w: number, h: number) {
  const dpr = window.devicePixelRatio || 1;
  c.width = Math.round(w * dpr);
  c.height = Math.round(h * dpr);
  c.style.width = w + 'px';
  c.style.height = h + 'px';
  const ctx = c.getContext('2d')!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  return ctx;
}

/** Миниатюра: декор вписан в квадрат, rot = 0 (передняя грань снизу). */
export function PropThumb({ prop, size = 40 }: { prop: Prop; size?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const tick = useImageTick();
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const ctx = setupCanvas(c, size, size);
    ctx.fillStyle = '#0d0e10';
    ctx.fillRect(0, 0, size, size);
    const pad = 4;
    const k = Math.min((size - pad * 2) / Math.max(prop.w, 0.01), (size - pad * 2) / Math.max(prop.h, 0.01));
    drawProp(ctx, prop, size / 2, size / 2, 0, k);
  }, [prop.w, prop.h, prop.color, prop.tex, size, tick]);
  return <canvas ref={ref} className="lib-thumb" />;
}

/**
 * Предпросмотр в масштабе: пол с сеткой 0.1 м (каждый метр ярче), декор по центру с поворотом.
 * extentM — сколько метров помещается по короткой стороне холста (одинаково для всех декоров,
 * если декор влезает, — чтобы размеры можно было сравнивать на глаз).
 */
export function PropFloorView({ prop, rot, width, height, labels = true }: { prop: Prop; rot: number; width: number; height: number; labels?: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const tick = useImageTick();
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const ctx = setupCanvas(c, width, height);
    const extentM = Math.max(2.4, Math.max(prop.w, prop.h) + 0.6);
    const ppm = Math.min(width, height) / extentM;
    // пол — выцветший линолеум
    ctx.fillStyle = '#23211d';
    ctx.fillRect(0, 0, width, height);
    const cx = width / 2;
    const cy = height / 2;
    // сетка от центра, чтобы центр декора лежал на узле
    const step = 0.1 * ppm;
    const nx = Math.ceil(width / 2 / step);
    const ny = Math.ceil(height / 2 / step);
    for (let i = -nx; i <= nx; i++) {
      const x = Math.round(cx + i * step) + 0.5;
      ctx.strokeStyle = i % 10 === 0 ? '#ffffff2a' : '#ffffff0d';
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    }
    for (let j = -ny; j <= ny; j++) {
      const y = Math.round(cy + j * step) + 0.5;
      ctx.strokeStyle = j % 10 === 0 ? '#ffffff2a' : '#ffffff0d';
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }
    drawProp(ctx, prop, cx, cy, rot, ppm);
    if (!labels) return;
    // масштабная линейка 1 м
    const bx = 10;
    const by = height - 12;
    ctx.strokeStyle = '#e8b04b';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(bx, by - 4);
    ctx.lineTo(bx, by);
    ctx.lineTo(bx + ppm, by);
    ctx.lineTo(bx + ppm, by - 4);
    ctx.stroke();
    ctx.fillStyle = '#e8b04b';
    ctx.font = '11px "IBM Plex Mono", monospace';
    ctx.fillText('1 м', bx + 4, by - 6);
    // габарит в текущем повороте
    const sw = rot % 180 === 0 ? prop.w : prop.h;
    const sh = rot % 180 === 0 ? prop.h : prop.w;
    ctx.fillStyle = '#b3afa6';
    ctx.textAlign = 'right';
    ctx.fillText(`${sw.toFixed(2)} × ${sh.toFixed(2)} м · ${rot}°`, width - 8, 16);
    ctx.textAlign = 'left';
  }, [prop.w, prop.h, prop.color, prop.tex, rot, width, height, labels, tick]);
  return <canvas ref={ref} className="lib-floor" />;
}
