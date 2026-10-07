// Крупный предпросмотр отделки в масштабе: стена 3 × 2.5 м (вид спереди, повтор от пола)
// или пол 3 × 3 м (вид сверху, повтор от угла). Нижняя панель — до своей высоты.
// Границы повторов можно подсветить, чтобы проверить стыки бесшовной текстуры.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Finish } from '../model/types';
import { scaledTile, texImage, useTexTick } from './finishTex';

const WALL = { w: 3, h: 2.5 };
const FLOOR = { w: 3, h: 3 };
const AMBER = '#e8b04b';
const DIM = '#b3afa6';
const MONO = '11px "IBM Plex Mono", monospace';

function useSize(ref: React.RefObject<HTMLElement | null>) {
  const [size, setSize] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);
  return size;
}

/** Залить прямоугольник отделкой; (ax, ay) — точка, где начинается повтор. */
function fillFinish(
  ctx: CanvasRenderingContext2D,
  f: Finish,
  r: { x: number; y: number; w: number; h: number },
  ax: number,
  ay: number,
  ppm: number,
  dpr: number,
) {
  ctx.fillStyle = f.color;
  ctx.fillRect(r.x, r.y, r.w, r.h);
  const img = texImage(f.tex);
  if (!img) return;
  const tw = Math.max(0.5, f.tileW * ppm);
  const th = Math.max(0.5, f.tileH * ppm);
  const tile = scaledTile(img, tw * dpr, th * dpr);
  const pat = ctx.createPattern(tile, 'repeat');
  if (!pat) return;
  pat.setTransform(new DOMMatrix().translate(ax, ay).scale(tw / tile.width, th / tile.height));
  ctx.fillStyle = pat;
  ctx.fillRect(r.x, r.y, r.w, r.h);
}

/** Пунктир границ повтора внутри прямоугольника. */
function seams(ctx: CanvasRenderingContext2D, f: Finish, r: { x: number; y: number; w: number; h: number }, ax: number, ay: number, ppm: number) {
  const tw = f.tileW * ppm;
  const th = f.tileH * ppm;
  if (tw < 3 || th < 3) return;
  ctx.save();
  ctx.beginPath();
  ctx.rect(r.x, r.y, r.w, r.h);
  ctx.clip();
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 3]);
  ctx.strokeStyle = 'rgba(232,176,75,0.75)';
  ctx.beginPath();
  const i0 = Math.ceil((r.x - ax) / tw);
  for (let x = ax + i0 * tw; x <= r.x + r.w + 0.01; x += tw) {
    ctx.moveTo(Math.round(x) + 0.5, r.y);
    ctx.lineTo(Math.round(x) + 0.5, r.y + r.h);
  }
  const j0 = Math.ceil((r.y - ay) / th);
  for (let y = ay + j0 * th; y <= r.y + r.h + 0.01; y += th) {
    ctx.moveTo(r.x, Math.round(y) + 0.5);
    ctx.lineTo(r.x + r.w, Math.round(y) + 0.5);
  }
  ctx.stroke();
  ctx.restore();
}

/** Размерная линия с засечками и подписью. */
function dimLine(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number, text: string, color = DIM) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  const vert = Math.abs(x2 - x1) < Math.abs(y2 - y1);
  for (const [x, y] of [
    [x1, y1],
    [x2, y2],
  ]) {
    if (vert) {
      ctx.moveTo(x - 4, y);
      ctx.lineTo(x + 4, y);
    } else {
      ctx.moveTo(x, y - 4);
      ctx.lineTo(x, y + 4);
    }
  }
  ctx.stroke();
  ctx.font = MONO;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const tw = ctx.measureText(text).width + 8;
  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2;
  ctx.translate(mx, my);
  if (vert) ctx.rotate(-Math.PI / 2);
  ctx.fillStyle = '#0d0e10';
  ctx.fillRect(-tw / 2, -7, tw, 14);
  ctx.fillStyle = color;
  ctx.fillText(text, 0, 0.5);
  ctx.restore();
}

export function FinishPreview(props: { finish: Finish; dado: Finish | undefined; showSeams: boolean }) {
  const { finish: f, dado, showSeams } = props;
  const box = useRef<HTMLDivElement>(null);
  const ref = useRef<HTMLCanvasElement>(null);
  const size = useSize(box);
  const tick = useTexTick();

  useEffect(() => {
    const c = ref.current;
    const { w: W, h: H } = size;
    if (!c || W < 50 || H < 50) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = Math.round(W * dpr);
    c.height = Math.round(H * dpr);
    c.style.width = W + 'px';
    c.style.height = H + 'px';
    const ctx = c.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#0d0e10';
    ctx.fillRect(0, 0, W, H);

    const isWall = f.surface === 'wall';
    const ext = isWall ? WALL : FLOOR;
    const hasDado = isWall && !!f.dado;
    const ml = 76, mr = hasDado ? 72 : 32, mt = 44, mb = 72;
    const ppm = Math.max(10, Math.min((W - ml - mr) / ext.w, (H - mt - mb) / ext.h));
    const ww = ext.w * ppm;
    const hh = ext.h * ppm;
    const x0 = Math.round(ml + Math.max(0, (W - ml - mr - ww) / 2));
    const y0 = Math.round(mt + Math.max(0, (H - mt - mb - hh) / 2));
    const y1 = y0 + hh;
    const rect = { x: x0, y: y0, w: ww, h: hh };
    // стены — повтор от пола (нижний край), пол — от угла комнаты
    const ax = x0;
    const ay = isWall ? y1 : y0;

    fillFinish(ctx, f, rect, ax, ay, ppm, dpr);
    if (showSeams) seams(ctx, f, rect, ax, ay, ppm);

    // нижняя панель
    let dadoY = y1;
    if (hasDado && f.dado) {
      const hD = Math.min(ext.h, Math.max(0, f.dado.heightM));
      dadoY = y1 - hD * ppm;
      const dr = { x: x0, y: dadoY, w: ww, h: y1 - dadoY };
      if (dado) {
        fillFinish(ctx, dado, dr, ax, y1, ppm, dpr);
        if (showSeams) seams(ctx, dado, dr, ax, y1, ppm);
      } else {
        ctx.fillStyle = '#d8604a33';
        ctx.fillRect(dr.x, dr.y, dr.w, dr.h);
      }
      // стык панели: тёмная тень + светлая кромка
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      ctx.fillRect(x0, dadoY - 1, ww, 2);
      ctx.fillStyle = 'rgba(255,255,255,0.18)';
      ctx.fillRect(x0, dadoY + 1, ww, 1);
      dimLine(ctx, x0 + ww + 22, y1, x0 + ww + 22, dadoY, `${+f.dado.heightM.toFixed(2)} м`, AMBER);
      const lbl = dado ? `панель: ${dado.name}` : 'панель: отделка не найдена';
      ctx.font = MONO;
      const tw = ctx.measureText(lbl).width + 10;
      ctx.fillStyle = 'rgba(13,14,16,0.82)';
      ctx.fillRect(x0 + ww - tw - 6, dadoY - 20, tw, 15);
      ctx.fillStyle = dado ? AMBER : '#d8604a';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(lbl, x0 + ww - tw - 1, dadoY - 12);
    }

    // контур и пол под стеной
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 1;
    ctx.strokeRect(x0 + 0.5, y0 + 0.5, ww - 1, hh - 1);
    if (isWall) {
      ctx.fillStyle = '#3a3e44';
      ctx.fillRect(x0 - 12, y1, ww + 24, 3);
    }

    // размеры
    dimLine(ctx, x0, y1 + 20, x0 + ww, y1 + 20, `${ext.w.toFixed(2)} м`);
    dimLine(ctx, x0 - 22, y1, x0 - 22, y0, `${ext.h.toFixed(2)} м`);
    // засечки каждые 0.5 м слева
    ctx.strokeStyle = DIM;
    ctx.fillStyle = DIM;
    ctx.font = '10px "IBM Plex Mono", monospace';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (let m = 0.5; m < ext.h - 0.01; m += 0.5) {
      const y = isWall ? y1 - m * ppm : y0 + m * ppm;
      const major = Math.abs(m - Math.round(m)) < 1e-6;
      ctx.beginPath();
      ctx.moveTo(x0 - (major ? 8 : 5), Math.round(y) + 0.5);
      ctx.lineTo(x0, Math.round(y) + 0.5);
      ctx.stroke();
      if (major) ctx.fillText(`${m} м`, x0 - 32, y);
    }

    // линейка 1 м
    const by = y1 + 48;
    ctx.strokeStyle = AMBER;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x0, by - 5);
    ctx.lineTo(x0, by);
    ctx.lineTo(x0 + ppm, by);
    ctx.lineTo(x0 + ppm, by - 5);
    ctx.stroke();
    ctx.fillStyle = AMBER;
    ctx.font = MONO;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText('1 м', x0 + 4, by - 6);

    // заголовок
    const nx = ext.w / Math.max(0.01, f.tileW);
    const ny = ext.h / Math.max(0.01, f.tileH);
    ctx.fillStyle = '#dcd8cf';
    ctx.font = '600 13px "IBM Plex Sans Condensed", "IBM Plex Sans", sans-serif';
    ctx.textBaseline = 'middle';
    const title = `${isWall ? 'Стена' : 'Пол (вид сверху)'} ${ext.w} × ${ext.h} м`;
    const ty = Math.max(20, y0 - 18);
    ctx.fillText(title, x0, ty);
    const tW = ctx.measureText(title).width;
    ctx.font = MONO;
    ctx.fillStyle = DIM;
    ctx.fillText(
      `· повтор ${+f.tileW.toFixed(3)} × ${+f.tileH.toFixed(3)} м · ${nx.toFixed(1)} × ${ny.toFixed(1)} шт.${f.tex ? '' : ' · без текстуры'}`,
      x0 + tW + 8,
      ty,
    );
  }, [size.w, size.h, f, f.color, f.tex, f.tileW, f.tileH, f.dado?.finishId, f.dado?.heightM, f.surface, dado, dado?.color, dado?.tex, dado?.tileW, dado?.tileH, showSeams, tick]);

  return (
    <div ref={box} className="fin-canvas-box">
      <canvas ref={ref} />
    </div>
  );
}
