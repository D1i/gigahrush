// Холст редактора одной комнаты (ТЗ §5): форма, размер, двери, метки, декор, споты.
// Жесты — конечный автомат в ref; проект меняется только через mutate (протяжка — один шаг undo:
// checkpoint на первом сдвиге/нажатии, дальше mutate({undo:false})).
import { useEffect, useRef } from 'react';
import type { Project, Room, Selection, Side } from '../model/types';
import { applyShape, areaM2, brushCells, ellipseCells, rectCells, resizeCells, type BBox } from '../model/cells';
import { placeSegment, reattachSegments } from '../model/segments';
import { deleteSpot, uid } from '../model/ops';
import { checkpoint, getProject, mutate, revert, useProject } from '../model/store';
import { getUI, notify, setUI, useUI } from '../model/ui';
import { useCanvasView, type PointerInfo, type View } from '../render/camera';
import { drawRoom, roomBBox, type Overlay } from './drawRoom';
import { HANDLE_CURSOR, hitHandle, hitObject } from './hit';
import { TOOLS, ToolContext, Toolbar } from './Toolbar';
import { variantFloorProps, walkCheck, walkMessage, type WalkResult } from '../gen/walk';
import './editor.css';

type Gesture =
  | { t: 'shape'; shape: 'rect' | 'ellipse'; x0: number; y0: number; x1: number; y1: number; mode: 'add' | 'sub' }
  | { t: 'brush'; mode: 'add' | 'sub'; lx: number; ly: number }
  | { t: 'resize'; handle: string; orig: Set<string>; bb0: BBox; to: { x0: number; y0: number; x1: number; y1: number }; cp: boolean }
  | { t: 'moveObj'; kind: 'decor' | 'spot'; id: string; dx: number; dy: number; cp: boolean }
  | { t: 'moveSeg'; kind: 'door' | 'connector'; id: string; cp: boolean };

interface Hover {
  x: number;
  y: number;
  sx: number;
  sy: number;
}

const curRoom = (p: Project = getProject()): Room | null => p.rooms.find((r) => r.id === getUI().roomId) ?? null;
/** Отступ при вписывании; сверху дополнительно место под плавающие панели и размерную линию. */
const FIT_PAD = 56;
const FIT_TOP = 60;
const snapHalf = (v: number) => Math.round(v * 2) / 2;
const free = (v: number) => Math.round(v * 1000) / 1000;
const fmtM = (cells: number, cm: number) => (cells * cm).toFixed(2);
const inv = (m: 'add' | 'sub') => (m === 'add' ? 'sub' : 'add');
const normDeg = (d: number) => Math.round((((d % 360) + 360) % 360) * 1000) / 1000;

/** Без падений: реализации ядра могут бросать, пока не готовы — холст не должен ломаться на наведении. */
function safe<T>(f: () => T, fb: T): T {
  try {
    return f();
  } catch {
    return fb;
  }
}

/** Выполнить действие над проектом с сообщением об ошибке вместо падения. */
function act(fn: () => void) {
  try {
    fn();
  } catch (e: any) {
    notify(String(e?.message ?? e), 'error');
  }
}

/** Перепривязка дверей/меток после изменения формы (внутри текущего шага undo) + уведомления. */
function reattachAfterShape(roomId: string) {
  let res = { moved: 0, removed: 0 };
  mutate(
    (p) => {
      const r = p.rooms.find((x) => x.id === roomId);
      if (r) res = reattachSegments(r);
    },
    { undo: false },
  );
  if (res.removed > 0) notify(`Удалено проёмов: ${res.removed}`, 'warn');
  if (res.moved > 0) notify(`Перенесено проёмов на другие стены: ${res.moved}`, 'info');
  const r = curRoom();
  if (r && r.cells.size === 0) notify('Комната пуста — нарисуйте форму заново', 'warn');
}

export function RoomCanvas() {
  const p = useProject();
  const ui = useUI();
  const room = p.rooms.find((r) => r.id === ui.roomId) ?? null;

  const gesture = useRef<Gesture | null>(null);
  const hover = useRef<Hover | null>(null);
  const shiftHeld = useRef(false);
  const needFit = useRef(true);
  const hudRef = useRef<HTMLDivElement | null>(null);

  // ───────────── отрисовка ─────────────

  const draw = (ctx: CanvasRenderingContext2D, v: View) => {
    const pr = getProject();
    const u = getUI();
    const r = curRoom(pr);
    if (needFit.current && v.w > 1 && r) {
      needFit.current = false;
      fitRoom();
    }
    const g = gesture.current;
    const h = hover.current;
    const cm = pr.settings.cellM;
    let overlay: Overlay = null;
    let cursorHud: { sx: number; sy: number; text: string } | null = null;

    if (r) {
      if (g?.t === 'shape') {
        overlay = { kind: 'shape', shape: g.shape, x0: g.x0, y0: g.y0, x1: g.x1, y1: g.y1, mode: g.mode };
        if (h) cursorHud = { sx: h.sx, sy: h.sy, text: `${fmtM(Math.abs(g.x1 - g.x0), cm)} × ${fmtM(Math.abs(g.y1 - g.y0), cm)} м` };
      } else if (g?.t === 'resize') {
        const w = g.to.x1 - g.to.x0;
        const hh = g.to.y1 - g.to.y0;
        if (h) cursorHud = { sx: h.sx, sy: h.sy, text: `Ш ${fmtM(w, cm)} × Г ${fmtM(hh, cm)} м` };
      } else if (g?.t === 'moveObj' && h) {
        const o = g.kind === 'decor' ? r.decor.find((d) => d.id === g.id) : r.spots.find((s) => s.id === g.id);
        if (o) cursorHud = { sx: h.sx, sy: h.sy, text: `${fmtM(o.x, cm)}, ${fmtM(o.y, cm)} м` };
      } else if (h && u.tool === 'brush') {
        const mode = g?.t === 'brush' ? g.mode : shiftHeld.current ? inv(u.toolMode) : u.toolMode;
        overlay = { kind: 'brush', x: h.x, y: h.y, r: u.brushM / cm / 2, mode };
        if (g?.t === 'brush') cursorHud = { sx: h.sx, sy: h.sy, text: `⌀ ${u.brushM.toFixed(2)} м` };
      } else if (h && !g && (u.tool === 'door' || u.tool === 'connector')) {
        const isDoor = u.tool === 'door';
        if (isDoor ? u.layers.doors : u.layers.connectors) {
          const len = isDoor ? u.doorLen : u.connectorLen;
          const seg = safe(() => placeSegment(r.cells, h.x, h.y, len, isDoor ? r.doors : r.connectors), null);
          if (seg) overlay = { kind: 'segment', cat: u.tool as 'door' | 'connector', seg };
        }
      } else if (h && !g && u.tool === 'decor' && u.layers.decor) {
        const prop = pr.props.find((x) => x.id === u.decorPropId);
        if (prop) {
          const sn = shiftHeld.current ? free : snapHalf;
          overlay = { kind: 'decor', prop, x: sn(h.x), y: sn(h.y), rot: 0 };
        }
      } else if (h && !g && u.tool === 'spot' && u.layers.spots) {
        const sn = shiftHeld.current ? free : snapHalf;
        const grp = r.spotGroups.find((x) => x.id === u.spotGroupId);
        overlay = { kind: 'spot', x: sn(h.x), y: sn(h.y), color: grp?.color ?? '#8a8d92' };
      }
    }

    // проходимость считается всегда (из кэша walkCheck — дёшево): предупреждение в HUD видно и без слоя
    const walk = r ? walkState(pr, r, u.layers.walk) : null;

    drawRoom(ctx, v, pr, r, {
      walk: walk?.res ?? null,
      layers: u.layers,
      selection: u.selection,
      overlay,
      handles: u.tool === 'select' && (!g || g.t === 'resize'),
      cursorHud,
    });

    // нижний HUD — напрямую в DOM, без перерендера React на каждое движение
    if (hudRef.current) {
      const pos = h ? `x ${fmtM(h.x, cm)}  y ${fmtM(h.y, cm)} м` : 'x —  y —';
      const area = r ? `${areaM2(r.cells, cm).toFixed(2)} м²` : '—';
      hudRef.current.innerHTML =
        `<span>${pos}</span><span><b>${Math.round(v.scale)}</b> px/м</span><span>площадь <b>${area}</b></span>` + walkHud(walk, u.layers.walk);
    }
  };

  // ───────────── жесты ─────────────

  const setCursor = (c: string) => {
    const cv = cref.current;
    if (cv && cv.style.cursor !== 'grab' && cv.style.cursor !== 'grabbing') cv.style.cursor = c;
  };

  const updateCursor = (e: PointerInfo) => {
    const u = getUI();
    const r = curRoom();
    if (!r) return setCursor('');
    if (u.tool !== 'select') return setCursor('crosshair');
    const v = view();
    const hnd = hitHandle(r, v, e.sx, e.sy);
    if (hnd) return setCursor(HANDLE_CURSOR[hnd]);
    const hit = safe(() => hitObject(getProject(), r, v, u.layers, e.x, e.y), null);
    setCursor(hit ? 'move' : '');
  };

  const stampBrush = (roomId: string, x0: number, y0: number, x1: number, y1: number, mode: 'add' | 'sub') => {
    const u = getUI();
    const cm = getProject().settings.cellM;
    const r = u.brushM / cm / 2;
    const d = Math.hypot(x1 - x0, y1 - y0);
    const n = Math.max(1, Math.ceil(d / Math.max(0.5, r * 0.5)));
    mutate(
      (p) => {
        const room = p.rooms.find((x) => x.id === roomId);
        if (!room) return;
        for (let i = d === 0 ? n : 1; i <= n; i++) {
          const t = i / n;
          applyShape(room.cells, brushCells(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, r), mode);
        }
      },
      { undo: false },
    );
  };

  const onDown = (e: PointerInfo) => {
    hover.current = { x: e.x, y: e.y, sx: e.sx, sy: e.sy };
    const u = getUI();
    const r = curRoom();
    if (!r) return;
    const v = view();
    switch (u.tool) {
      case 'select': {
        const hnd = hitHandle(r, v, e.sx, e.sy);
        const bb = roomBBox(r);
        if (hnd && bb) {
          gesture.current = { t: 'resize', handle: hnd, orig: new Set(r.cells), bb0: bb, to: { x0: bb.x0, y0: bb.y0, x1: bb.x1, y1: bb.y1 }, cp: false };
          return;
        }
        const hit = safe(() => hitObject(getProject(), r, v, u.layers, e.x, e.y), null);
        setUI({ selection: hit });
        if (hit?.kind === 'decor' || hit?.kind === 'spot') {
          const o = hit.kind === 'decor' ? r.decor.find((d) => d.id === hit.id) : r.spots.find((s) => s.id === hit.id);
          if (o) gesture.current = { t: 'moveObj', kind: hit.kind, id: hit.id, dx: o.x - e.x, dy: o.y - e.y, cp: false };
        } else if (hit?.kind === 'door' || hit?.kind === 'connector') {
          gesture.current = { t: 'moveSeg', kind: hit.kind, id: hit.id, cp: false };
        }
        return;
      }
      case 'rect':
      case 'ellipse': {
        const x = Math.round(e.x);
        const y = Math.round(e.y);
        gesture.current = { t: 'shape', shape: u.tool, x0: x, y0: y, x1: x, y1: y, mode: e.shift ? inv(u.toolMode) : u.toolMode };
        redraw();
        return;
      }
      case 'brush': {
        const mode = e.shift ? inv(u.toolMode) : u.toolMode;
        checkpoint();
        gesture.current = { t: 'brush', mode, lx: e.x, ly: e.y };
        act(() => stampBrush(r.id, e.x, e.y, e.x, e.y, mode));
        return;
      }
      default:
        return; // постановка — по клику
    }
  };

  const onMove = (e: PointerInfo) => {
    hover.current = { x: e.x, y: e.y, sx: e.sx, sy: e.sy };
    const g = gesture.current;
    const r = curRoom();
    if (!g || !r) return redraw();
    switch (g.t) {
      case 'shape':
        g.x1 = Math.round(e.x);
        g.y1 = Math.round(e.y);
        redraw();
        return;
      case 'brush':
        act(() => stampBrush(r.id, g.lx, g.ly, e.x, e.y, g.mode));
        g.lx = e.x;
        g.ly = e.y;
        return;
      case 'resize': {
        const nx = Math.round(e.x);
        const ny = Math.round(e.y);
        const b = g.bb0;
        const to = { x0: b.x0, y0: b.y0, x1: b.x1, y1: b.y1 };
        if (g.handle.includes('w')) to.x0 = Math.min(nx, b.x1 - 1);
        if (g.handle.includes('e')) to.x1 = Math.max(nx, b.x0 + 1);
        if (g.handle.includes('n')) to.y0 = Math.min(ny, b.y1 - 1);
        if (g.handle.includes('s')) to.y1 = Math.max(ny, b.y0 + 1);
        if (to.x0 === g.to.x0 && to.x1 === g.to.x1 && to.y0 === g.to.y0 && to.y1 === g.to.y1) return redraw();
        g.to = to;
        if (!g.cp) {
          checkpoint();
          g.cp = true;
        }
        act(() =>
          mutate(
            (p) => {
              const room = p.rooms.find((x) => x.id === r.id);
              if (room) room.cells = resizeCells(g.orig, to);
            },
            { undo: false },
          ),
        );
        return;
      }
      case 'moveObj': {
        const sn = e.shift ? free : snapHalf;
        const nx = sn(e.x + g.dx);
        const ny = sn(e.y + g.dy);
        const list: { id: string; x: number; y: number }[] = g.kind === 'decor' ? r.decor : r.spots;
        const o = list.find((x) => x.id === g.id);
        if (!o || (o.x === nx && o.y === ny)) return redraw();
        if (!g.cp) {
          checkpoint();
          g.cp = true;
        }
        mutate(
          () => {
            o.x = nx;
            o.y = ny;
          },
          { undo: false },
        );
        return;
      }
      case 'moveSeg': {
        const isDoor = g.kind === 'door';
        const list = isDoor ? r.doors : r.connectors;
        const s = list.find((x) => x.id === g.id);
        if (!s) return;
        const pl = safe(() => placeSegment(r.cells, e.x, e.y, s.len, list.filter((x) => x.id !== g.id)), null);
        if (!pl || (pl.cx === s.cx && pl.cy === s.cy && pl.side === s.side)) return redraw();
        if (!g.cp) {
          checkpoint();
          g.cp = true;
        }
        mutate(
          () => {
            s.cx = pl.cx;
            s.cy = pl.cy;
            s.side = pl.side as Side;
          },
          { undo: false },
        );
        return;
      }
    }
  };

  const onUp = (e: PointerInfo) => {
    const g = gesture.current;
    gesture.current = null;
    const r = curRoom();
    if (!g || !r) return redraw();
    switch (g.t) {
      case 'shape': {
        const x0 = Math.min(g.x0, g.x1), x1 = Math.max(g.x0, g.x1);
        const y0 = Math.min(g.y0, g.y1), y1 = Math.max(g.y0, g.y1);
        if (x1 - x0 < 1 || y1 - y0 < 1) return redraw();
        act(() => {
          const shape = g.shape === 'rect' ? rectCells(x0, y0, x1 - x0, y1 - y0) : ellipseCells(x0, y0, x1, y1);
          mutate((p) => {
            const room = p.rooms.find((x) => x.id === r.id);
            if (room) applyShape(room.cells, shape, g.mode);
          });
          reattachAfterShape(r.id);
        });
        return;
      }
      case 'brush':
        act(() => reattachAfterShape(r.id));
        return;
      case 'resize':
        if (g.cp) act(() => reattachAfterShape(r.id));
        else redraw();
        return;
      default:
        redraw();
    }
  };

  const onClick = (e: PointerInfo) => {
    const u = getUI();
    const r = curRoom();
    if (!r) return;
    const sn = e.shift ? free : snapHalf;
    switch (u.tool) {
      case 'door':
      case 'connector': {
        const isDoor = u.tool === 'door';
        if (!(isDoor ? u.layers.doors : u.layers.connectors)) {
          notify(`Слой «${isDoor ? 'Двери' : 'Метки стыковки'}» скрыт`, 'warn');
          return;
        }
        act(() => {
          const len = isDoor ? u.doorLen : u.connectorLen;
          const g = placeSegment(r.cells, e.x, e.y, len, isDoor ? r.doors : r.connectors);
          if (!g) {
            notify('Нет свободной стены такой длины', 'warn');
            return;
          }
          const id = uid(isDoor ? 'door' : 'con');
          mutate((p) => {
            const room = p.rooms.find((x) => x.id === r.id);
            if (!room) return;
            if (isDoor) room.doors.push({ id, cx: g.cx, cy: g.cy, side: g.side, len: g.len });
            else room.connectors.push({ id, cx: g.cx, cy: g.cy, side: g.side, len: g.len, name: u.connectorTag, tag: u.connectorTag });
          });
          setUI({ selection: { kind: isDoor ? 'door' : 'connector', id } });
        });
        return;
      }
      case 'decor': {
        if (!u.layers.decor) return notify('Слой «Декор» скрыт', 'warn');
        const prop = getProject().props.find((x) => x.id === u.decorPropId);
        if (!prop) return notify('Выберите декор для постановки на панели инструментов', 'warn');
        act(() => {
          const id = uid('dec');
          mutate((p) => {
            p.rooms.find((x) => x.id === r.id)?.decor.push({ id, propId: prop.id, x: sn(e.x), y: sn(e.y), rot: 0 });
          });
          setUI({ selection: { kind: 'decor', id } });
        });
        return;
      }
      case 'spot': {
        if (!u.layers.spots) return notify('Слой «Споты» скрыт', 'warn');
        act(() => {
          const id = uid('spot');
          const groupId = r.spotGroups.some((g) => g.id === u.spotGroupId) ? u.spotGroupId : null;
          mutate((p) => {
            const room = p.rooms.find((x) => x.id === r.id);
            if (!room) return;
            // первый свободный номер
            const names = new Set(room.spots.map((s) => s.name));
            let n = room.spots.length + 1;
            for (let i = 1; i <= room.spots.length + 1; i++)
              if (!names.has(`Спот ${i}`)) {
                n = i;
                break;
              }
            room.spots.push({ id, name: `Спот ${n}`, x: sn(e.x), y: sn(e.y), rot: 0, groupId });
          });
          setUI({ selection: { kind: 'spot', id } });
        });
        return;
      }
    }
  };

  /** Отмена текущего жеста: вернуть проект к снимку начала жеста. */
  const cancelGesture = (): boolean => {
    const g = gesture.current;
    if (!g) return false;
    gesture.current = null;
    if (g.t === 'brush' || ((g.t === 'resize' || g.t === 'moveObj' || g.t === 'moveSeg') && g.cp)) revert();
    redraw();
    return true;
  };

  const { ref: cref, redraw, view, fit } = useCanvasView({
    cellM: p.settings.cellM,
    draw,
    handlers: {
      onDown,
      onMove,
      onUp,
      onClick,
      onHover: (e) => {
        hover.current = { x: e.x, y: e.y, sx: e.sx, sy: e.sy };
        updateCursor(e);
        redraw();
      },
      onLeave: () => {
        hover.current = null;
        redraw();
      },
      onCancel: cancelGesture,
    },
  });

  /** Вписать комнату, оставив сверху место под панели: bbox расширяется вверх на FIT_TOP px
   *  в масштабе, который получится после вписывания. */
  function fitRoom() {
    const r = curRoom();
    const bb = r && roomBBox(r);
    if (!bb) return;
    const v = view();
    const cm = getProject().settings.cellM;
    const wM = Math.max(0.5, bb.w * cm);
    const hM = Math.max(0.5, bb.h * cm);
    const s = Math.min((v.w - FIT_PAD * 2) / wM, (v.h - FIT_PAD * 2 - FIT_TOP) / hM);
    if (!(s > 0)) return fit(bb, FIT_PAD);
    fit({ x0: bb.x0, y0: bb.y0 - FIT_TOP / (s * cm), x1: bb.x1, y1: bb.y1 }, FIT_PAD);
  }

  // смена комнаты — сбросить жест и вписать
  useEffect(() => {
    gesture.current = null;
    needFit.current = true;
    redraw();
  }, [ui.roomId]);

  // смена инструмента прерывает жест
  useEffect(() => {
    cancelGesture();
  }, [ui.tool]);

  // горячие клавиши
  useEffect(() => {
    const isTyping = (t: EventTarget | null) =>
      t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement;

    const down = (e: KeyboardEvent) => {
      if (e.key === 'Shift') {
        shiftHeld.current = true;
        redraw();
      }
      if (isTyping(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
      const u = getUI();
      if (u.page !== 'editor' || u.variantsGroupId) return;
      const digit = /^Digit([1-8])$/.exec(e.code);
      if (digit) {
        setUI({ tool: TOOLS[+digit[1] - 1].id });
        e.preventDefault();
        return;
      }
      switch (e.code) {
        case 'KeyV':
          setUI({ tool: 'select' });
          break;
        case 'KeyX':
          setUI({ toolMode: inv(u.toolMode) });
          break;
        case 'KeyF':
          fitRoom();
          break;
        case 'Escape':
          if (!cancelGesture()) setUI({ selection: null });
          break;
        case 'Delete':
        case 'Backspace':
          deleteSelection(u.selection);
          e.preventDefault();
          break;
        case 'KeyQ':
        case 'KeyE':
          rotateSelection(u.selection, (e.code === 'KeyE' ? 1 : -1) * (e.shiftKey ? 15 : 90));
          break;
        default:
          return;
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.key === 'Shift') {
        shiftHeld.current = false;
        redraw();
      }
    };
    const blur = () => {
      shiftHeld.current = false;
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
    };
  }, []);

  return (
    <>
      <canvas ref={cref} />
      {!room && <div className="rc-empty">Нет комнаты — создайте её в списке слева</div>}
      <Toolbar ui={ui} onFit={fitRoom} />
      <ToolContext ui={ui} p={p} room={room} />
      <div className="float hud rc-hud" ref={hudRef} />
    </>
  );
}

// ───────────── проходимость ─────────────

interface WalkState {
  res: WalkResult;
  /** варианты спотов, перегораживающие проход (в генерации подменяются) */
  variants: string[];
}

/** Проходимость комнаты (декор) и, если слой включён, варианты спотов поперёк прохода. */
function walkState(p: Project, r: Room, withVariants: boolean): WalkState | null {
  if (r.cells.size === 0) return null;
  const props = new Map(p.props.map((x) => [x.id, x]));
  const opts = { cellM: p.settings.cellM };
  const res = walkCheck(r, props, undefined, opts);
  const variants: string[] = [];
  if (withVariants && res.ok) {
    for (const g of r.spotGroups) {
      const bad: string[] = [];
      g.variants.forEach((v, i) => {
        const own = variantFloorProps(r, g, v, props);
        if (own.length && !walkCheck(r, props, own, opts).ok) bad.push(`В${i + 1}`);
      });
      if (bad.length) variants.push(`«${g.name}» ${bad.join(', ')}`);
    }
  }
  return { res, variants };
}

const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function walkHud(w: WalkState | null, layer: boolean): string {
  if (!w || w.res.openings.length === 0) return '';
  if (!w.res.ok) return `<span style="color:#ff8a78">⚠ проход: ${esc(walkMessage(w.res) ?? '')}</span>`;
  if (!layer) return '';
  let out = '<span style="color:#7fd08f">проход ✓ все двери связаны</span>';
  if (w.variants.length) out += `<span style="color:#e8b04b">поперёк прохода: ${esc(w.variants.join(', '))} — в генерации подменяются</span>`;
  return out;
}

// ───────────── операции над выделением ─────────────

function deleteSelection(sel: Selection) {
  const r = curRoom();
  if (!sel || !r) return;
  act(() => {
    mutate((p) => {
      const room = p.rooms.find((x) => x.id === r.id);
      if (!room) return;
      if (sel.kind === 'decor') room.decor = room.decor.filter((d) => d.id !== sel.id);
      else if (sel.kind === 'door') room.doors = room.doors.filter((d) => d.id !== sel.id);
      else if (sel.kind === 'connector') room.connectors = room.connectors.filter((d) => d.id !== sel.id);
      else if (sel.kind === 'spot') deleteSpot(room, sel.id);
    });
    setUI({ selection: null });
  });
}

function rotateSelection(sel: Selection, delta: number) {
  const r = curRoom();
  if (!sel || !r || (sel.kind !== 'decor' && sel.kind !== 'spot')) return;
  const list: { id: string; rot: number }[] = sel.kind === 'decor' ? r.decor : r.spots;
  if (!list.some((x) => x.id === sel.id)) return;
  mutate(
    (p) => {
      const room = p.rooms.find((x) => x.id === r.id);
      const l: { id: string; rot: number }[] = sel.kind === 'decor' ? room!.decor : room!.spots;
      const o = l.find((x) => x.id === sel.id);
      if (!o) return;
      // шаг к следующему кратному step в сторону поворота (с выравниванием «кривых» углов)
      const step = Math.abs(delta);
      const k = o.rot / step;
      o.rot = normDeg((delta > 0 ? Math.floor(k + 1e-6) + 1 : Math.ceil(k - 1e-6) - 1) * step);
    },
    { key: `rot-${sel.id}` },
  );
}
