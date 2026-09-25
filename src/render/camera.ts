// Камера и модель ввода для холстов (ТЗ §3): у каждого холста своя камера
// (смещение в px + масштаб px/м), одинаковая модель ввода, учёт devicePixelRatio (≤ 2),
// перерисовка по событию (rAF-коалесинг), а не в постоянном цикле.
//
// Ввод:
//  • колесо — масштаб вокруг курсора;
//  • средняя/правая кнопка или Space + левая — панорама;
//  • opts.leftPans — левая протяжка по пустому месту панорамирует (для предпросмотра);
//  • касание одним пальцем — как левая кнопка; двумя — щипок/панорама (жест инструмента отменяется).
import { useCallback, useEffect, useRef } from 'react';
import { onImageLoad } from './props';

export interface View {
  /** смещение мира в CSS-px */
  ox: number;
  oy: number;
  /** масштаб, CSS-px на метр */
  scale: number;
  cellM: number;
  /** CSS-px на клетку = scale * cellM */
  ppc: number;
  /** размеры холста в CSS-px */
  w: number;
  h: number;
  dpr: number;
}

export interface PointerInfo {
  /** мировые координаты в клетках (дробные) */
  x: number;
  y: number;
  /** экранные CSS-px относительно холста */
  sx: number;
  sy: number;
  shift: boolean;
  alt: boolean;
  ctrl: boolean;
  button: number;
  pointerType: string;
}

export interface CanvasHandlers {
  /** начало жеста левой кнопкой/пальцем. Вернуть false, чтобы при leftPans начать панораму. */
  onDown?(e: PointerInfo): boolean | void;
  onMove?(e: PointerInfo): void;
  onUp?(e: PointerInfo): void;
  /** движение без нажатия */
  onHover?(e: PointerInfo): void;
  onLeave?(): void;
  /** клик без сдвига (< 4 px) */
  onClick?(e: PointerInfo): void;
  /** жест прерван (второй палец, потеря захвата) */
  onCancel?(): void;
}

export interface CanvasViewOpts {
  cellM: number;
  draw(ctx: CanvasRenderingContext2D, v: View): void;
  handlers?: CanvasHandlers;
  leftPans?: boolean;
  /** начальный масштаб px/м */
  initialScale?: number;
}

export const toScreen = (v: View, x: number, y: number): [number, number] => [v.ox + x * v.ppc, v.oy + y * v.ppc];
export const toWorld = (v: View, sx: number, sy: number): [number, number] => [(sx - v.ox) / v.ppc, (sy - v.oy) / v.ppc];

const MIN_SCALE = 4;
const MAX_SCALE = 1000;

export function useCanvasView(opts: CanvasViewOpts) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const optsRef = useRef(opts);
  optsRef.current = opts;
  const cam = useRef({ ox: 60, oy: 60, scale: opts.initialScale ?? 90, w: 0, h: 0, dpr: 1 });
  const raf = useRef(0);

  const view = useCallback((): View => {
    const c = cam.current;
    const cellM = optsRef.current.cellM;
    return { ox: c.ox, oy: c.oy, scale: c.scale, cellM, ppc: c.scale * cellM, w: c.w, h: c.h, dpr: c.dpr };
  }, []);

  const paint = useCallback(() => {
    raf.current = 0;
    const cv = ref.current;
    if (!cv) return;
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    const v = view();
    ctx.setTransform(v.dpr, 0, 0, v.dpr, 0, 0);
    ctx.clearRect(0, 0, v.w, v.h);
    optsRef.current.draw(ctx, v);
  }, [view]);

  const redraw = useCallback(() => {
    if (!raf.current) raf.current = requestAnimationFrame(paint);
  }, [paint]);

  /** Вписать прямоугольник (в клетках) в холст с отступом padPx. */
  const fit = useCallback(
    (b: { x0: number; y0: number; x1: number; y1: number } | null, padPx = 48) => {
      const c = cam.current;
      if (!b || c.w === 0) return;
      const cellM = optsRef.current.cellM;
      const wM = Math.max(0.5, (b.x1 - b.x0) * cellM);
      const hM = Math.max(0.5, (b.y1 - b.y0) * cellM);
      const s = Math.min((c.w - padPx * 2) / wM, (c.h - padPx * 2) / hM);
      c.scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, s));
      const ppc = c.scale * cellM;
      c.ox = c.w / 2 - ((b.x0 + b.x1) / 2) * ppc;
      c.oy = c.h / 2 - ((b.y0 + b.y1) / 2) * ppc;
      redraw();
    },
    [redraw],
  );

  const zoomAt = useCallback(
    (sx: number, sy: number, factor: number) => {
      const c = cam.current;
      const ns = Math.max(MIN_SCALE, Math.min(MAX_SCALE, c.scale * factor));
      const k = ns / c.scale;
      c.ox = sx - (sx - c.ox) * k;
      c.oy = sy - (sy - c.oy) * k;
      c.scale = ns;
      redraw();
    },
    [redraw],
  );

  // размеры и DPR
  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const parent = cv.parentElement!;
    const ro = new ResizeObserver(() => {
      const r = parent.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const c = cam.current;
      c.w = Math.max(1, Math.floor(r.width));
      c.h = Math.max(1, Math.floor(r.height));
      c.dpr = dpr;
      cv.width = Math.floor(c.w * dpr);
      cv.height = Math.floor(c.h * dpr);
      cv.style.width = c.w + 'px';
      cv.style.height = c.h + 'px';
      paint();
    });
    ro.observe(parent);
    const off = onImageLoad(redraw);
    return () => {
      ro.disconnect();
      off();
      if (raf.current) cancelAnimationFrame(raf.current);
    };
  }, [paint, redraw]);

  // ввод
  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    let space = false;
    const pointers = new Map<number, { x: number; y: number }>();
    let mode: 'none' | 'tool' | 'pan' | 'pinch' = 'none';
    let panLast = { x: 0, y: 0 };
    let downAt = { x: 0, y: 0 };
    let moved = false;
    let pinch = { d: 0, cx: 0, cy: 0 };

    const info = (e: PointerEvent | MouseEvent): PointerInfo => {
      const r = cv.getBoundingClientRect();
      const sx = e.clientX - r.left;
      const sy = e.clientY - r.top;
      const [x, y] = toWorld(view(), sx, sy);
      return {
        x, y, sx, sy,
        shift: e.shiftKey, alt: e.altKey, ctrl: e.ctrlKey || e.metaKey,
        button: e.button,
        pointerType: (e as PointerEvent).pointerType ?? 'mouse',
      };
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)) {
        space = true;
        cv.style.cursor = 'grab';
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        space = false;
        cv.style.cursor = '';
      }
    };

    const pinchState = () => {
      const ps = [...pointers.values()];
      const dx = ps[0].x - ps[1].x;
      const dy = ps[0].y - ps[1].y;
      return { d: Math.hypot(dx, dy), cx: (ps[0].x + ps[1].x) / 2, cy: (ps[0].y + ps[1].y) / 2 };
    };

    const down = (e: PointerEvent) => {
      const r = cv.getBoundingClientRect();
      pointers.set(e.pointerId, { x: e.clientX - r.left, y: e.clientY - r.top });
      cv.setPointerCapture(e.pointerId);
      if (pointers.size === 2) {
        if (mode === 'tool') optsRef.current.handlers?.onCancel?.();
        mode = 'pinch';
        pinch = pinchState();
        return;
      }
      if (pointers.size > 2) return;
      const p = info(e);
      downAt = { x: p.sx, y: p.sy };
      moved = false;
      if (e.button === 1 || e.button === 2 || space) {
        mode = 'pan';
        panLast = { x: p.sx, y: p.sy };
        cv.style.cursor = 'grabbing';
        e.preventDefault();
        return;
      }
      if (e.button !== 0) return;
      const res = optsRef.current.handlers?.onDown?.(p);
      if (res === false && optsRef.current.leftPans) {
        mode = 'pan';
        panLast = { x: p.sx, y: p.sy };
      } else {
        mode = 'tool';
      }
    };

    const move = (e: PointerEvent) => {
      const r = cv.getBoundingClientRect();
      if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX - r.left, y: e.clientY - r.top });
      const p = info(e);
      if (Math.hypot(p.sx - downAt.x, p.sy - downAt.y) > 4) moved = true;
      if (mode === 'pinch' && pointers.size >= 2) {
        const n = pinchState();
        const c = cam.current;
        c.ox += n.cx - pinch.cx;
        c.oy += n.cy - pinch.cy;
        if (pinch.d > 0) zoomAt(n.cx, n.cy, n.d / pinch.d);
        pinch = n;
        redraw();
        return;
      }
      if (mode === 'pan') {
        const c = cam.current;
        c.ox += p.sx - panLast.x;
        c.oy += p.sy - panLast.y;
        panLast = { x: p.sx, y: p.sy };
        redraw();
        return;
      }
      if (mode === 'tool') {
        optsRef.current.handlers?.onMove?.(p);
        return;
      }
      optsRef.current.handlers?.onHover?.(p);
    };

    const up = (e: PointerEvent) => {
      pointers.delete(e.pointerId);
      const p = info(e);
      if (mode === 'pinch') {
        if (pointers.size === 0) mode = 'none';
        return;
      }
      if (mode === 'tool') {
        optsRef.current.handlers?.onUp?.(p);
        if (!moved) optsRef.current.handlers?.onClick?.(p);
      } else if (mode === 'pan' && !moved && e.button === 0) {
        optsRef.current.handlers?.onClick?.(p);
      }
      if (mode === 'pan') cv.style.cursor = space ? 'grab' : '';
      mode = 'none';
    };

    const cancel = (e: PointerEvent) => {
      pointers.delete(e.pointerId);
      if (mode === 'tool') optsRef.current.handlers?.onCancel?.();
      mode = 'none';
    };

    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = cv.getBoundingClientRect();
      const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      zoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(-dy * 0.0015));
    };

    const leave = () => {
      if (mode === 'none') optsRef.current.handlers?.onLeave?.();
    };
    const ctx = (e: Event) => e.preventDefault();

    cv.addEventListener('pointerdown', down);
    cv.addEventListener('pointermove', move);
    cv.addEventListener('pointerup', up);
    cv.addEventListener('pointercancel', cancel);
    cv.addEventListener('pointerleave', leave);
    cv.addEventListener('wheel', wheel, { passive: false });
    cv.addEventListener('contextmenu', ctx);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    cv.style.touchAction = 'none';
    return () => {
      cv.removeEventListener('pointerdown', down);
      cv.removeEventListener('pointermove', move);
      cv.removeEventListener('pointerup', up);
      cv.removeEventListener('pointercancel', cancel);
      cv.removeEventListener('pointerleave', leave);
      cv.removeEventListener('wheel', wheel);
      cv.removeEventListener('contextmenu', ctx);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [view, zoomAt, redraw]);

  // Перерисовка после каждого рендера компонента-владельца (дёшево: rAF-коалесинг).
  useEffect(() => {
    redraw();
  });

  return { ref, redraw, view, fit, zoomAt };
}
