// Холст предпросмотра прогона: все экземпляры в мировых координатах, режимы подсветки,
// выделение экземпляра и путь от старта. Отрисовка по событию (useCanvasView коалесит).
// Складчатый (4D) прогон: режимы показа слоёв — «все слои» внахлёст, «слой W», «глазами игрока».
import { useEffect, useMemo, useRef, useState } from 'react';
import { SIDE_DELTA } from '../model/cells';
import { segmentLine, segmentMid } from '../model/segments';
import type { LocationSpec, Project, Run } from '../model/types';
import { setUI } from '../model/ui';
import { toScreen, useCanvasView, type View } from '../render/camera';
import { CANVAS } from '../render/palette';
import { drawProp } from '../render/props';
import { Btn } from '../ui/kit';
import { normFold, visibleSet } from '../gen4d/fold';
import { hitAll, hitInst, pathTo, type InstGeo, type RunGeo } from './runGeo';
import { DEPTH, HEAT, SHIFT_COLOR, dwText, inkOn, layerColor, mix, ramp, wText } from './util';

export type PreviewMode = 'normal' | 'heat' | 'tiers' | 'depth';
/** Показ складчатого прогона. */
export type FoldView = 'all' | 'layer' | 'player';

const MODES: { id: PreviewMode; label: string; title: string }[] = [
  { id: 'normal', label: 'Обычный', title: 'Пол, стены, декор и выпавшее содержимое (в «Все слои» — цвет по слою W)' },
  { id: 'heat', label: 'Опасность', title: 'Тепловая карта накопленной опасности по пути от старта' },
  { id: 'tiers', label: 'Тиры', title: 'Заливка цветом тира элитности' },
  { id: 'depth', label: 'Глубина', title: 'Глубина по графу от стартовой комнаты' },
];

const FOLD_VIEWS: { id: FoldView; label: string; title: string }[] = [
  {
    id: 'all',
    label: 'Все слои',
    title:
      'Все комнаты сразу: полы полупрозрачные, цвет — по слою W. Наложения — «невозможная» геометрия: комнаты разных слоёв в одном месте 3D. Повторный клик по наложению — следующая комната',
  },
  { id: 'layer', label: 'Слой W', title: 'Один слой чётко (обычный план без пересечений), остальные — едва заметным контуром' },
  { id: 'player', label: 'Глазами игрока', title: 'Только то, что видит игрок из выбранной комнаты: она и соседи за дверями. Клик по соседу — переход' },
];

// режимы переживают переключение страниц
let savedMode: PreviewMode = 'normal';
let savedSight = true;
let savedFoldView: FoldView = 'all';
let savedLayer = 0;

// пороги детализации (CSS-px на метр)
const LOD_DECOR = 9;
const LOD_LOOT = 14;
const LOD_SPOTS = 20;
const LOD_EMPTY_SPOTS = 55;

/** Как рисовать экземпляр: полностью / полупрозрачно / контуром / не рисовать. */
type Look = 'full' | 'trans' | 'ghost' | 'hidden';

const OVERLAP_COLOR = '#ff5cd6';

/** Пометка спец-локации перед названием комнаты на плане (docs/LOCATIONS.md). */
const LOC_MARK: Record<LocationSpec['kind'], string> = { stairwell: '∞', lift: '⇅', lair: '☠', hangar: '❄', swamp: '⚙' };

export function PreviewCanvas(props: {
  p: Project;
  run: Run | null;
  geo: RunGeo | null;
  selected: string | null;
  stale: boolean;
}) {
  const { p, run, geo, selected } = props;
  const [mode, setModeState] = useState<PreviewMode>(savedMode);
  const setMode = (m: PreviewMode) => {
    savedMode = m;
    setModeState(m);
  };
  const [showSight, setShowSightState] = useState(savedSight);
  const setShowSight = (v: boolean) => {
    savedSight = v;
    setShowSightState(v);
  };
  const sightLine = run?.sight?.line ?? null;
  const hover = useRef<string | null>(null);
  const pendingFit = useRef(true);

  // ── складчатый прогон
  const fold = !!geo?.fold;
  const [foldView, setFoldViewState] = useState<FoldView>(savedFoldView);
  const [layerK, setLayerKState] = useState(savedLayer);
  const setLayerK = (k: number) => {
    savedLayer = k;
    setLayerKState(k);
  };
  const startId = geo ? ((geo.list.find((g) => g.inst.order === 0) ?? geo.list[0])?.inst.id ?? null) : null;
  const setFoldView = (v: FoldView) => {
    savedFoldView = v;
    setFoldViewState(v);
    // «глазами игрока» без выделения — встаём в стартовую комнату
    if (v === 'player' && geo && !(selected && geo.byId.has(selected)) && startId) setUI({ runInst: startId });
    // «слой W» — слой выделенной комнаты
    if (v === 'layer' && geo && selected && geo.byId.has(selected)) setLayerK(geo.byId.get(selected)!.layer);
  };
  const fv: FoldView | null = fold ? foldView : null;
  const k = geo ? Math.min(geo.maxW, Math.max(geo.minW, layerK)) : 0;
  const foldS = useMemo(() => normFold(run?.settings.fold), [run]);
  /** глубина видимости игрока: depth·2 ≤ localRadius — гарантия непротиворечивости */
  const eyeDepth = Math.floor(foldS.localRadius / 2);
  const eyeAt = fv === 'player' && geo ? (selected && geo.byId.has(selected) ? selected : startId) : null;
  /** потенциально видимый набор (PVS) из генератора: всё, что видно из комнаты; иначе — соседи до eyeDepth */
  const eyePvs = !!(run?.pvs && eyeAt && Array.isArray(run.pvs[eyeAt]));
  const eyeSet = useMemo(
    () => (run && eyeAt ? (eyePvs ? new Set([eyeAt, ...run.pvs![eyeAt]]) : visibleSet(run, eyeAt, eyeDepth)) : null),
    [run, eyeAt, eyeDepth, eyePvs],
  );

  const look = (g: InstGeo): Look => {
    if (!fv) return 'full';
    if (fv === 'all') return 'trans';
    if (fv === 'layer') return g.layer === k ? 'full' : 'ghost';
    return eyeSet?.has(g.inst.id) ? 'full' : 'hidden';
  };
  const hittable = (g: InstGeo) => {
    const l = look(g);
    return l === 'full' || l === 'trans';
  };
  /** Что вписывать: «глазами игрока» — видимое множество, иначе весь прогон. */
  const fitTarget = () => {
    if (!geo) return null;
    if (fv === 'player' && eyeSet?.size) {
      let b: { x0: number; y0: number; x1: number; y1: number } | null = null;
      for (const id of eyeSet) {
        const x = geo.byId.get(id)?.w.bbox;
        if (!x) continue;
        b = b ? { x0: Math.min(b.x0, x.x0), y0: Math.min(b.y0, x.y0), x1: Math.max(b.x1, x.x1), y1: Math.max(b.y1, x.y1) } : { ...x };
      }
      if (b) {
        const pad = 10;
        return { x0: b.x0 - pad, y0: b.y0 - pad, x1: b.x1 + pad, y1: b.y1 + pad };
      }
    }
    return geo.bbox;
  };

  const propMap = useMemo(() => new Map(p.props.map((x) => [x.id, x])), [p.props, run]);
  const itemMap = useMemo(() => new Map(p.items.map((x) => [x.id, x])), [p.items, run]);
  const tierMap = useMemo(() => new Map(p.economy.tiers.map((x) => [x.id, x])), [p.economy.tiers, run]);
  const finishMap = useMemo(() => new Map((p.finishes ?? []).map((x) => [x.id, x])), [p.finishes, run]);
  const limit = p.economy.dangerLimit;
  const heatMax = Math.max(1, geo?.maxAcc ?? 0, limit > 0 ? limit * 1.25 : 0);
  const path = useMemo(() => (geo ? pathTo(geo, selected) : []), [geo, selected]);

  const floorColor = (g: InstGeo): string => {
    const c = g.content;
    switch (mode) {
      case 'heat':
        return c ? ramp(HEAT, c.dangerAcc / heatMax) : '#6d6a64';
      case 'tiers': {
        const t = c?.tierId ? tierMap.get(c.tierId) : undefined;
        return t ? mix(t.color, CANVAS.floor, 0.18) : '#8d887c';
      }
      case 'depth':
        return ramp(DEPTH, geo && geo.maxDepth > 0 ? g.inst.depth / geo.maxDepth : 0);
      default: {
        // «все слои» — цвет слоя W, чтобы наложения читались
        if (fv === 'all') return layerColor(g.layer);
        // разыгранная напольная отделка — её цвет; иначе чередующийся «линолеум»
        const fid = c?.finish?.floor;
        const f = fid ? finishMap.get(fid) : undefined;
        return f ? f.color : g.inst.order % 2 ? CANVAS.floorAlt : CANVAS.floor;
      }
    }
  };

  const draw = (ctx: CanvasRenderingContext2D, v: View) => {
    if (!geo || !geo.list.length) return;
    if (pendingFit.current && v.w > 1) {
      pendingFit.current = false;
      api.fit(fitTarget());
    }
    const { dpr, ppc, scale } = v;
    const cellT = () => ctx.setTransform(dpr * ppc, 0, 0, dpr * ppc, dpr * v.ox, dpr * v.oy);
    const scrT = () => ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // отсечение по видимой области (с запасом на подписи) и по режиму слоёв
    const m = 40 / ppc;
    const vx0 = -v.ox / ppc - m, vy0 = -v.oy / ppc - m;
    const vx1 = (v.w - v.ox) / ppc + m, vy1 = (v.h - v.oy) / ppc + m;
    const looks = new Map<string, Look>();
    const vis = geo.list.filter((g) => {
      const b = g.w.bbox;
      if (!(b.x1 >= vx0 && b.x0 <= vx1 && b.y1 >= vy0 && b.y0 <= vy1)) return false;
      const l = look(g);
      looks.set(g.inst.id, l);
      return l !== 'hidden';
    });
    const lk = (g: InstGeo) => looks.get(g.inst.id)!;
    const solid = vis.filter((g) => lk(g) !== 'ghost');
    const onPath = new Set(path.map((g) => g.inst.id));
    const fills = new Map(solid.map((g) => [g.inst.id, floorColor(g)]));
    const wallPx = Math.max(1, Math.min(CANVAS.wallW + 1, ppc * 0.9));
    const sel = selected ? geo.byId.get(selected) : undefined;
    const selShown = sel && looks.get(sel.inst.id) !== undefined && hittable(sel) ? sel : undefined;
    // «все слои» с выделением: фокус на выделенной и тех, кто делит с ней место, остальное приглушено
    const focus = fv === 'all' && sel ? new Set([sel.inst.id, ...sel.overlaps]) : null;
    const floorAlpha = (g: InstGeo) => (lk(g) !== 'trans' ? 1 : !focus ? 0.42 : focus.has(g.inst.id) ? 0.6 : 0.16);

    // ── пол
    cellT();
    for (const g of solid) {
      ctx.fillStyle = fills.get(g.inst.id)!;
      ctx.globalAlpha = floorAlpha(g);
      ctx.fill(g.floor);
    }
    ctx.globalAlpha = 1;
    // в «все слои» выделенная комната — непрозрачно поверх наложений
    if (selShown && lk(selShown) === 'trans') {
      ctx.fillStyle = fills.get(selShown.inst.id)!;
      ctx.fill(selShown.floor);
    }
    if (path.length > 1 && fv !== 'player') {
      ctx.fillStyle = 'rgba(232,176,75,0.16)';
      for (const g of solid) if (onPath.has(g.inst.id) && g.inst.id !== selected) ctx.fill(g.floor);
    }
    if (hover.current && hover.current !== selected) {
      const h = geo.byId.get(hover.current);
      if (h && looks.has(h.inst.id) && hittable(h)) {
        ctx.fillStyle = 'rgba(255,255,255,0.12)';
        ctx.fill(h.floor);
      }
    }
    if (selShown) {
      ctx.fillStyle = 'rgba(232,176,75,0.28)';
      ctx.fill(selShown.floor);
    }

    // ── стены
    ctx.lineCap = 'square';
    // контуры других слоёв («слой W») — едва заметно
    ctx.strokeStyle = 'rgba(220,216,207,0.13)';
    ctx.lineWidth = 1 / ppc;
    for (const g of vis) if (lk(g) === 'ghost') ctx.stroke(g.walls);
    for (const g of solid) {
      if (lk(g) === 'trans') {
        ctx.strokeStyle = layerColor(g.layer, 34);
        ctx.lineWidth = Math.max(1, wallPx * 0.7) / ppc;
        ctx.globalAlpha = focus && !focus.has(g.inst.id) ? 0.35 : 1;
      } else {
        ctx.strokeStyle = CANVAS.wall;
        ctx.lineWidth = wallPx / ppc;
      }
      ctx.stroke(g.walls);
    }
    ctx.globalAlpha = 1;
    if (mode === 'heat' && limit > 0) {
      ctx.strokeStyle = '#ff4a3a';
      ctx.lineWidth = 1.6 / ppc;
      ctx.setLineDash([5 / ppc, 3 / ppc]);
      for (const g of solid) if ((g.content?.dangerAcc ?? 0) > limit) ctx.stroke(g.walls);
      ctx.setLineDash([]);
    }
    // кто делит место с выделенной комнатой (в других слоях) — розовый пунктир
    if (sel && fv && fv !== 'player') {
      ctx.strokeStyle = OVERLAP_COLOR;
      ctx.lineWidth = 2.5 / ppc;
      ctx.setLineDash([6 / ppc, 4 / ppc]);
      for (const id of sel.overlaps) {
        const o = geo.byId.get(id);
        if (o && looks.has(id)) ctx.stroke(o.walls);
      }
      ctx.setLineDash([]);
    }
    if (selShown) {
      ctx.strokeStyle = CANVAS.select;
      ctx.lineWidth = (wallPx + 1.5) / ppc;
      ctx.stroke(selShown.walls);
    }

    scrT();
    const S = (x: number, y: number) => toScreen(v, x, y);

    // ── двери: разрыв в стене + дуга открывания внутрь комнаты
    for (const g of solid) {
      const fill = fills.get(g.inst.id)!;
      const trans = lk(g) === 'trans';
      for (const d of g.w.doors) {
        const [x1, y1, x2, y2] = segmentLine(d);
        const [a1, b1] = S(x1, y1);
        const [a2, b2] = S(x2, y2);
        ctx.lineCap = 'butt';
        ctx.beginPath();
        ctx.moveTo(a1, b1);
        ctx.lineTo(a2, b2);
        if (!trans) {
          ctx.strokeStyle = fill;
          ctx.lineWidth = wallPx + 1;
          ctx.stroke();
        }
        const L = Math.hypot(a2 - a1, b2 - b1);
        ctx.strokeStyle = CANVAS.door;
        if (L < 8) {
          ctx.lineWidth = 2;
          ctx.stroke();
          continue;
        }
        const [sdx, sdy] = SIDE_DELTA[d.side];
        const ix = -sdx, iy = -sdy; // внутрь комнаты
        const ang0 = Math.atan2(iy, ix);
        const ang1 = Math.atan2(b2 - b1, a2 - a1);
        let delta = ang1 - ang0;
        while (delta > Math.PI) delta -= 2 * Math.PI;
        while (delta <= -Math.PI) delta += 2 * Math.PI;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(a1, b1);
        ctx.lineTo(a1 + ix * L, b1 + iy * L);
        ctx.stroke();
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 2]);
        ctx.beginPath();
        ctx.arc(a1, b1, L, ang0, ang1, delta < 0);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    // ── метки стыковки: связанные — тонко зелёным, тупики — красным с крестиком,
    //    пороги со сдвигом слоя (dw ≠ 0) — фиолетовая «молния» и «+1»/«−2» внутри комнаты
    ctx.lineCap = 'butt';
    const bolts: { x: number; y: number; ix: number; iy: number; L: number; dw: number }[] = [];
    for (const g of solid) {
      if (focus && !focus.has(g.inst.id) && !onPath.has(g.inst.id)) continue;
      for (const c of g.w.connectors) {
        const [x1, y1, x2, y2] = segmentLine(c);
        const [a1, b1] = S(x1, y1);
        const [a2, b2] = S(x2, y2);
        // тупик — всё, что не участвует в связях (в т.ч. явно перечисленное в openConnectors)
        const linked = g.linked.has(c.id) && !g.open.has(c.id);
        const peer = linked ? g.peers.find((x) => x.connector === c.id) : undefined;
        const dw = peer?.dw ?? 0;
        // «глазами игрока»: дверь в комнату вне видимого множества — закрыта; у PVS — проём в темноту
        const closed = fv === 'player' && !!peer && !eyeSet?.has(peer.inst);
        ctx.strokeStyle = closed ? (eyePvs ? '#1b1d21' : '#5b5f66') : !linked ? CANVAS.connectorOpen : dw ? SHIFT_COLOR : CANVAS.connector;
        ctx.lineWidth = closed ? 4 : linked ? (dw ? 2.5 : 1.5) : 2.5;
        ctx.beginPath();
        ctx.moveTo(a1, b1);
        ctx.lineTo(a2, b2);
        ctx.stroke();
        const L = Math.hypot(a2 - a1, b2 - b1);
        if (!linked) {
          const [mx, my] = S(...segmentMid(c));
          const r = Math.max(3, Math.min(7, L / 3));
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(mx - r, my - r);
          ctx.lineTo(mx + r, my + r);
          ctx.moveTo(mx + r, my - r);
          ctx.lineTo(mx - r, my + r);
          ctx.stroke();
        } else if (dw) {
          const [mx, my] = S(...segmentMid(c));
          const [sdx, sdy] = SIDE_DELTA[c.side];
          bolts.push({ x: mx, y: my, ix: -sdx, iy: -sdy, L, dw });
        }
      }
    }
    for (const b of bolts) shiftMarker(ctx, b.x, b.y, b.ix, b.iy, b.L, b.dw);

    // ── декор
    if (scale >= LOD_DECOR) {
      for (const g of solid) {
        const alpha = lk(g) === 'trans' && g !== selShown ? 0.45 : mode === 'normal' ? 1 : 0.55;
        for (const d of g.w.decor) {
          const pr = propMap.get(d.propId);
          if (!pr) continue;
          const [sx, sy] = S(d.x, d.y);
          drawProp(ctx, pr, sx, sy, d.rot, scale, { alpha });
        }
      }
    }

    // содержимое спотов и лут — только у комнат, нарисованных полностью (и у выделенной)
    const detailed = solid.filter((g) => lk(g) === 'full' || g === selShown);

    // ── споты с выпавшим содержимым
    if (scale >= LOD_SPOTS) {
      for (const g of detailed) {
        for (const s of g.content?.spots ?? []) {
          const [sx, sy] = S(s.x, s.y);
          const c = s.content;
          if (!c) {
            if (scale >= LOD_EMPTY_SPOTS) {
              ctx.strokeStyle = CANVAS.spot;
              ctx.lineWidth = 1;
              ctx.setLineDash([2, 2]);
              ctx.beginPath();
              ctx.arc(sx, sy, 4, 0, Math.PI * 2);
              ctx.stroke();
              ctx.setLineDash([]);
            }
            continue;
          }
          if (c.kind === 'prop') {
            const pr = propMap.get(c.id);
            // s.rot уже включает поворот содержимого (assign.rot)
            if (pr) drawProp(ctx, pr, sx, sy, s.rot, scale);
          } else {
            const it = itemMap.get(c.id);
            itemDot(ctx, sx, sy, Math.max(4, Math.min(10, 0.12 * scale)), it?.color ?? '#999', it?.name ?? '?');
          }
        }
      }
    }

    // ── лут: стопки маркеров у декора или в центре комнаты
    if (scale >= LOD_LOOT) {
      for (const g of detailed) {
        const loot = g.content?.loot;
        if (!loot?.length) continue;
        const stacks = new Map<string, { x: number; y: number; colors: string[]; n: number }>();
        for (const l of loot) {
          const d = l.decorId ? g.w.decor.find((x) => x.id === l.decorId) : undefined;
          const key = d ? d.id : '';
          let st = stacks.get(key);
          if (!st) {
            const [sx, sy] = d ? S(d.x, d.y) : S(g.cx, g.cy);
            stacks.set(key, (st = { x: sx, y: d ? sy : sy + 22, colors: [], n: 0 }));
          }
          st.colors.push(itemMap.get(l.itemId)?.color ?? '#999');
          st.n += l.count;
        }
        for (const st of stacks.values()) lootStack(ctx, st.x, st.y, st.colors, st.n);
      }
    }

    // ── путь от старта до выделенного: стрелки через связи
    if (path.length > 1 && fv !== 'player') {
      ctx.strokeStyle = CANVAS.select;
      ctx.fillStyle = CANVAS.select;
      ctx.lineWidth = 2.5;
      ctx.lineJoin = 'round';
      for (let i = 1; i < path.length; i++) {
        const a = path[i - 1];
        const b = path[i];
        const pts: [number, number][] = [S(a.cx, a.cy)];
        const pl = b.peers.find((x) => x.inst === a.inst.id);
        const con = pl ? b.w.connectors.find((c) => c.id === pl.connector) : undefined;
        if (con) pts.push(S(...segmentMid(con)));
        pts.push(S(b.cx, b.cy));
        ctx.beginPath();
        ctx.moveTo(pts[0][0], pts[0][1]);
        for (let j = 1; j < pts.length; j++) ctx.lineTo(pts[j][0], pts[j][1]);
        ctx.stroke();
        const [px, py] = pts[pts.length - 2];
        const [qx, qy] = pts[pts.length - 1];
        arrowHead(ctx, px, py, qx, qy, 9);
        if (con) arrowHead(ctx, pts[0][0], pts[0][1], pts[1][0], pts[1][1], 7);
      }
    }

    // ── подписи
    ctx.textBaseline = 'middle';
    // выделенную подписываем последней — поверх наложений
    const base = focus ? solid.filter((g) => focus.has(g.inst.id) || onPath.has(g.inst.id)) : solid;
    const labelled = selShown ? [...base.filter((g) => g !== selShown), selShown] : base;
    for (const g of labelled) {
      const b = g.w.bbox;
      const wPx = (b.x1 - b.x0) * ppc;
      const [sx, sy] = S(g.cx, g.cy);
      const c = g.content;
      const tier = c?.tierId ? tierMap.get(c.tierId) : undefined;
      const isStart = g.inst.order === 0;
      if (wPx < 56) {
        // мелкий масштаб: только точка тира и старт
        if (tier) {
          ctx.fillStyle = tier.color;
          ctx.beginPath();
          ctx.arc(sx, sy, 3.5, 0, Math.PI * 2);
          ctx.fill();
        }
        if (isStart) startFlag(ctx, sx, sy - 8);
        continue;
      }
      const wTag = fold ? { text: wText(g.layer), color: layerColor(g.layer) } : null;
      // спец-локация (src/locations/) — пометка перед названием: «∞» лестница, «⇅» лифт, «☠» логово
      const loc = g.room?.location;
      const name = (loc ? `${LOC_MARK[loc.kind]} ` : '') + (g.room?.name ?? g.inst.roomId);
      label(ctx, sx, sy, Math.min(wPx - 8, 180), name, tier, c?.danger ?? 0, isStart, wPx >= 90, wTag);
    }
    // линия обзора — поверх всего (в складчатом прогоне не считается)
    if (showSight && sightLine && run?.sight) {
      drawSight(ctx, S(sightLine[0], sightLine[1]), S(sightLine[2], sightLine[3]), run.sight.maxM, run.settings.sightM ?? 0);
    }
  };

  const api = useCanvasView({
    cellM: p.settings.cellM,
    draw,
    leftPans: true,
    initialScale: 20,
    handlers: {
      onDown: () => false,
      onClick: (e) => {
        if (!geo) return;
        const hits = hitAll(geo, e.x, e.y, hittable);
        if (!hits.length) {
          // «глазами игрока» — игрок всегда где-то стоит, пустой клик выделение не снимает
          if (fv !== 'player') setUI({ runInst: null });
          return;
        }
        // наложение комнат разных слоёв: повторный клик — следующая (сверху вниз)
        const i = hits.findIndex((h) => h.inst.id === selected);
        const next = i >= 0 ? hits[(i - 1 + hits.length) % hits.length] : hits[hits.length - 1];
        setUI({ runInst: next.inst.id });
      },
      onHover: (e) => {
        if (!geo) return;
        const h = hitInst(geo, e.x, e.y, hittable);
        const id = h ? h.inst.id : null;
        if (id !== hover.current) {
          hover.current = id;
          if (api.ref.current) api.ref.current.style.cursor = id ? 'pointer' : '';
          api.redraw();
        }
      },
      onLeave: () => {
        if (hover.current) {
          hover.current = null;
          api.redraw();
        }
      },
    },
  });

  // автоматический fit после каждой генерации, смены режима слоёв и перехода «глазами игрока»
  useEffect(() => {
    pendingFit.current = true;
    api.redraw();
  }, [geo, fv, fv === 'player' ? eyeAt : null]);

  const overLimit = geo && limit > 0 ? geo.list.filter((g) => (g.content?.dangerAcc ?? 0) > limit).length : 0;
  const tierCounts = useMemo(() => {
    const m = new Map<string | null, number>();
    for (const c of run?.content ?? []) m.set(c.tierId, (m.get(c.tierId) ?? 0) + 1);
    return m;
  }, [run]);
  const layerCount = geo?.layers.find((x) => x[0] === k)?.[1] ?? 0;
  const showLayerLegend = !!geo && fold && (fv === 'layer' || (fv === 'all' && mode === 'normal'));
  const goLayer = (w: number) => {
    setLayerK(w);
    savedFoldView = 'layer';
    setFoldViewState('layer');
  };

  return (
    <>
      <canvas ref={api.ref} />
      {(!geo || !geo.list.length) && (
        <div className="pv-empty">{geo?.error ? 'Ошибка геометрии: ' + geo.error : run ? 'Прогон пуст' : 'Нет прогона — нажмите «Сгенерировать»'}</div>
      )}
      <div className="float pv-toolbar">
        {MODES.map((m) => (
          <Btn key={m.id} sm on={mode === m.id} onClick={() => setMode(m.id)} title={m.title}>
            {m.label}
          </Btn>
        ))}
        <div className="sep" />
        <Btn sm onClick={() => geo && api.fit(fitTarget())} title={fv === 'player' ? 'Вписать видимое игроком' : 'Вписать весь прогон в окно'}>
          ⤢ Вписать
        </Btn>
        {!fold && (
          <>
            <div className="sep" />
            <Btn sm on={showSight} onClick={() => setShowSight(!showSight)} title="Самая длинная прямая линия видимости в прогоне">
              👁 Линия обзора
            </Btn>
            <Btn
              sm
              disabled={!sightLine}
              onClick={() => {
                if (!sightLine) return;
                setShowSight(true);
                const [x1, y1, x2, y2] = sightLine;
                const pad = 25; // клеток вокруг линии
                api.fit({ x0: Math.min(x1, x2) - pad, y0: Math.min(y1, y2) - pad, x1: Math.max(x1, x2) + pad, y1: Math.max(y1, y2) + pad });
              }}
              title="Центрировать камеру на линии обзора"
            >
              показать
            </Btn>
          </>
        )}
      </div>
      {fold && geo && (
        <div className="float pv-toolbar pv-foldbar">
          <span className="pv-4d" title="Складчатый прогон: пороги сдвигают слой W">
            4D
          </span>
          {FOLD_VIEWS.map((x) => (
            <Btn key={x.id} sm on={fv === x.id} onClick={() => setFoldView(x.id)} title={x.title}>
              {x.label}
            </Btn>
          ))}
          {fv === 'layer' && (
            <>
              <div className="sep" />
              <Btn sm icon disabled={k <= geo.minW} onClick={() => setLayerK(k - 1)} title="Слой ниже">
                ◀
              </Btn>
              <input
                type="range"
                className="pv-range"
                min={geo.minW}
                max={geo.maxW}
                step={1}
                value={k}
                onChange={(e) => setLayerK(+e.target.value)}
                title="Слой W"
              />
              <Btn sm icon disabled={k >= geo.maxW} onClick={() => setLayerK(k + 1)} title="Слой выше">
                ▶
              </Btn>
              <span className="pv-wchip" style={{ background: layerColor(k) }}>
                {wText(k)}
              </span>
              <span className="hint" style={{ paddingRight: 4 }}>
                {layerCount} комн.
              </span>
            </>
          )}
          {fv === 'player' && eyeSet && (
            <>
              <div className="sep" />
              <span className="hint" style={{ padding: '0 4px' }}>
                {eyePvs ? 'видимый набор (PVS)' : 'видно'} {eyeSet.size} из {geo.list.length} ·{' '}
                {eyePvs ? 'всё, что видно из комнаты' : eyeDepth ? `соседи до ${eyeDepth} двер.` : 'только сама комната'} · клик по соседу — переход
              </span>
            </>
          )}
        </div>
      )}
      <div className="float hud pv-hud">клик — выбор · протяжка — панорама · колесо — масштаб</div>
      {props.stale && run && (
        <div className="float pv-stale" style={fold ? { top: 90 } : undefined}>
          Проект изменён после прогона — перегенерируйте
        </div>
      )}
      <div className="pv-legends">
        {fv === 'player' && geo && (
          <div className="float pv-legend">
            <div className="cap">Глазами игрока{eyePvs ? ' · видимый набор (PVS)' : ''}</div>
            {eyePvs ? (
              <div className="hint" style={{ maxWidth: 320 }}>
                Всё, что видно из комнаты игрока по прямой сквозь проёмы в пределах обзора, — генератор гарантирует, что эти комнаты не пересекаются. Остальное
                скрыто: в 3D там может стоять другая комната. Чёрные проёмы — край набора: открыты в темноту, их по построению не видно, поэтому смена набора
                на пороге бесшовна.
              </div>
            ) : (
              <div className="hint" style={{ maxWidth: 320 }}>
                Комната игрока и всё в ≤ {eyeDepth} двер. от неё (глубина = ⌊радиус {foldS.localRadius} / 2⌋). Остальное скрыто: в 3D там может стоять другая
                комната. Серые проёмы — двери за пределом видимости (закрыты).
                {eyeDepth === 0 && (
                  <span style={{ color: 'var(--accent)' }}> При радиусе 1 соседи между собой могут пересекаться — их рисуют только сквозь проём (порталы).</span>
                )}
              </div>
            )}
          </div>
        )}
        {showLayerLegend && geo && (
          <div className="float pv-legend">
            <div className="cap">
              Слои W · {geo.layers.length} · пар в одном месте: {geo.overlapCount}
            </div>
            <div className="pv-wlist">
              {geo.layers.map(([w, n]) => (
                <span
                  key={w}
                  className={'pv-wchip' + (fv === 'layer' && w === k ? ' on' : '')}
                  style={{ background: layerColor(w) }}
                  title={`${wText(w)}: ${n} комн. — показать только этот слой`}
                  onClick={() => goLayer(w)}
                >
                  {w > 0 ? `+${w}` : w < 0 ? `−${-w}` : '0'}
                  <span className="n">{n}</span>
                </span>
              ))}
            </div>
            <div className="hint" style={{ marginTop: 4 }}>
              <span style={{ color: SHIFT_COLOR }}>⚡ +1</span> — выход через этот порог сдвигает слой ·{' '}
              <span style={{ color: OVERLAP_COLOR }}>пунктир</span> — делит место с выделенной
            </div>
          </div>
        )}
        {geo && geo.list.length > 0 && mode !== 'normal' && (
          <div className="float pv-legend">
            {mode === 'heat' && (
              <>
                <div className="cap">Накопленная опасность</div>
                <div className="bar" style={{ background: `linear-gradient(90deg, ${HEAT.join(',')})` }}>
                  {limit > 0 && <div className="lim" style={{ left: `calc(${Math.min(100, (limit / heatMax) * 100)}% - 1px)` }} title={`Порог ${limit}`} />}
                </div>
                <div className="ticks">
                  <span>0</span>
                  {limit > 0 && <span style={{ color: 'var(--text)' }}>порог {limit}</span>}
                  <span>{+heatMax.toFixed(1)}</span>
                </div>
                <div className="hint" style={{ marginTop: 4 }}>
                  макс. {+geo.maxAcc.toFixed(2)} · за порогом: <b style={{ color: overLimit ? 'var(--danger)' : 'var(--ok)' }}>{overLimit}</b> (красный пунктир)
                </div>
              </>
            )}
            {mode === 'depth' && (
              <>
                <div className="cap">Глубина от старта</div>
                <div className="bar" style={{ background: `linear-gradient(90deg, ${DEPTH.join(',')})` }} />
                <div className="ticks">
                  <span>0</span>
                  <span>{geo.maxDepth}</span>
                </div>
              </>
            )}
            {mode === 'tiers' && (
              <>
                <div className="cap">Тиры элитности</div>
                <div className="tiers">
                  <div className="pv-rowline">
                    <span className="swatch" style={{ background: '#8d887c' }} />
                    <span className="grow">базовая</span>
                    <span className="n">{tierCounts.get(null) ?? 0}</span>
                  </div>
                  {[...p.economy.tiers]
                    .sort((a, b) => a.level - b.level)
                    .map((t) => (
                      <div key={t.id} className="pv-rowline">
                        <span className="swatch" style={{ background: t.color }} />
                        <span className="grow">
                          {t.name} <span className="muted">ур. {t.level}</span>
                        </span>
                        <span className="n">{tierCounts.get(t.id) ?? 0}</span>
                      </div>
                    ))}
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </>
  );
}

/** Маркер порога со сдвигом слоя: «молния» на проёме и «+1»/«−2» чуть внутри комнаты. */
function shiftMarker(ctx: CanvasRenderingContext2D, x: number, y: number, ix: number, iy: number, L: number, dw: number) {
  const s = Math.max(5, Math.min(9, L / 2.5));
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(x + s * 0.25, y - s);
  ctx.lineTo(x - s * 0.55, y + s * 0.15);
  ctx.lineTo(x - s * 0.02, y + s * 0.15);
  ctx.lineTo(x - s * 0.25, y + s);
  ctx.lineTo(x + s * 0.55, y - s * 0.15);
  ctx.lineTo(x + s * 0.02, y - s * 0.15);
  ctx.closePath();
  ctx.fillStyle = SHIFT_COLOR;
  ctx.strokeStyle = '#140a20';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.fill();
  // подпись сдвига внутри комнаты
  if (L >= 12) {
    const t = dwText(dw);
    ctx.font = `700 10px 'IBM Plex Mono', monospace`;
    const tw = ctx.measureText(t).width;
    const tx = x + ix * (s + 9), ty = y + iy * (s + 9);
    ctx.fillStyle = 'rgba(20,10,32,0.88)';
    ctx.beginPath();
    ctx.roundRect(tx - tw / 2 - 3, ty - 7, tw + 6, 14, 3);
    ctx.fill();
    ctx.fillStyle = SHIFT_COLOR;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(t, tx, ty + 0.5);
  }
  ctx.restore();
}

// ───────────── примитивы ─────────────

/** Линия обзора: яркий пунктир, кружки на концах, подпись длины. */
function drawSight(ctx: CanvasRenderingContext2D, a: [number, number], b: [number, number], maxM: number, limitM: number) {
  const over = limitM > 0 && maxM > limitM + 1e-6;
  const col = over ? '#ff4a3a' : '#4fe0ff';
  ctx.save();
  ctx.lineCap = 'round';
  ctx.strokeStyle = 'rgba(0,0,0,0.75)';
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(a[0], a[1]);
  ctx.lineTo(b[0], b[1]);
  ctx.stroke();
  ctx.strokeStyle = col;
  ctx.lineWidth = 2.5;
  ctx.setLineDash([8, 5]);
  ctx.stroke();
  ctx.setLineDash([]);
  for (const [x, y] of [a, b]) {
    ctx.beginPath();
    ctx.arc(x, y, 5, 0, Math.PI * 2);
    ctx.fillStyle = col;
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = '#000';
    ctx.stroke();
  }
  const t = `👁 ${+maxM.toFixed(1)} м${limitM > 0 ? ` / ${+limitM.toFixed(1)}` : ''}`;
  ctx.font = `600 11px 'IBM Plex Mono', monospace`;
  const tw = ctx.measureText(t).width;
  const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2 - 14;
  ctx.fillStyle = 'rgba(10,12,14,0.9)';
  ctx.beginPath();
  ctx.roundRect(mx - tw / 2 - 5, my - 8, tw + 10, 16, 3);
  ctx.fill();
  ctx.strokeStyle = col;
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.fillStyle = col;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(t, mx, my + 0.5);
  ctx.restore();
}

function itemDot(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string, name: string) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = 'rgba(0,0,0,0.7)';
  ctx.stroke();
  if (r >= 6) {
    ctx.fillStyle = inkOn(color);
    ctx.font = `600 ${Math.round(r * 1.15)}px 'IBM Plex Sans', sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText((name[0] ?? '?').toUpperCase(), x, y + 0.5);
  }
}

function lootStack(ctx: CanvasRenderingContext2D, x: number, y: number, colors: string[], n: number) {
  const k = Math.min(4, colors.length);
  const s = 8;
  for (let i = k - 1; i >= 0; i--) {
    const ox = x - s / 2 + i * 3 - (k - 1) * 1.5;
    const oy = y - s / 2 - i * 3 + (k - 1) * 1.5;
    ctx.fillStyle = colors[i];
    ctx.fillRect(ox, oy, s, s);
    ctx.strokeStyle = 'rgba(0,0,0,0.8)';
    ctx.lineWidth = 1;
    ctx.strokeRect(ox + 0.5, oy + 0.5, s - 1, s - 1);
  }
  const t = String(n);
  ctx.font = `600 10px 'IBM Plex Mono', monospace`;
  const tw = ctx.measureText(t).width;
  const bx = x + s / 2 + (k - 1) * 1.5 + 2;
  ctx.fillStyle = 'rgba(17,18,20,0.88)';
  ctx.fillRect(bx, y - 6, tw + 6, 12);
  ctx.fillStyle = '#e8b04b';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(t, bx + 3, y + 0.5);
}

function arrowHead(ctx: CanvasRenderingContext2D, px: number, py: number, qx: number, qy: number, size: number) {
  const a = Math.atan2(qy - py, qx - px);
  // стрелка у середины отрезка, чтобы не закрывать подпись
  const mx = (px + qx) / 2, my = (py + qy) / 2;
  ctx.beginPath();
  ctx.moveTo(mx + Math.cos(a) * size, my + Math.sin(a) * size);
  ctx.lineTo(mx + Math.cos(a + 2.5) * size, my + Math.sin(a + 2.5) * size);
  ctx.lineTo(mx + Math.cos(a - 2.5) * size, my + Math.sin(a - 2.5) * size);
  ctx.closePath();
  ctx.fill();
}

function startFlag(ctx: CanvasRenderingContext2D, x: number, y: number) {
  ctx.fillStyle = '#8fb86f';
  ctx.beginPath();
  ctx.moveTo(x, y - 6);
  ctx.lineTo(x + 8, y - 3);
  ctx.lineTo(x, y);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = '#111';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(x, y - 6);
  ctx.lineTo(x, y + 6);
  ctx.stroke();
}

function fitText(ctx: CanvasRenderingContext2D, s: string, maxW: number): string {
  if (ctx.measureText(s).width <= maxW) return s;
  let lo = 0, hi = s.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (ctx.measureText(s.slice(0, mid) + '…').width <= maxW) lo = mid;
    else hi = mid - 1;
  }
  return lo > 0 ? s.slice(0, lo) + '…' : '';
}

function label(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  maxW: number,
  name: string,
  tier: { name: string; color: string; level: number } | undefined,
  danger: number,
  isStart: boolean,
  full: boolean,
  wTag: { text: string; color: string } | null = null,
) {
  ctx.font = `600 11px 'IBM Plex Sans Condensed', 'IBM Plex Sans', sans-serif`;
  const title = fitText(ctx, (isStart ? '▶ ' : '') + name, maxW - 8);
  const tw = ctx.measureText(title).width;
  // вторая строка: чип тира + опасность
  ctx.font = `600 10px 'IBM Plex Sans Condensed', sans-serif`;
  // короткая форма «Э3 · Зажиточная квартира»: имя тира без префикса «Элитность N — »
  const short = tier ? tier.name.replace(/^.*?—\s*/, '') : '';
  const chip = tier ? (full ? `Э${tier.level} · ${short}` : `Э${tier.level}`) : '';
  const cw = chip ? ctx.measureText(chip).width + 8 : 0;
  const dz = danger ? `+${+danger.toFixed(2)}` : '';
  const dw = dz ? ctx.measureText(dz).width + 4 : 0;
  // складчатый прогон: чип слоя «W +1» первым
  const ww = wTag ? ctx.measureText(wTag.text).width + 10 : 0;
  const line2 = chip || dz || wTag;
  const w = Math.max(tw, ww + cw + dw) + 8;
  const h = line2 ? 30 : 16;
  const bx = x - w / 2, by = y - h / 2;
  ctx.fillStyle = 'rgba(17,18,20,0.84)';
  ctx.beginPath();
  ctx.roundRect(bx, by, w, h, 3);
  ctx.fill();
  if (isStart) {
    ctx.strokeStyle = '#8fb86f';
    ctx.lineWidth = 1;
    ctx.stroke();
  }
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `600 11px 'IBM Plex Sans Condensed', 'IBM Plex Sans', sans-serif`;
  ctx.fillStyle = isStart ? '#b9dc9a' : '#dcd8cf';
  ctx.fillText(title, x, by + 8.5);
  if (line2) {
    ctx.font = `600 10px 'IBM Plex Sans Condensed', sans-serif`;
    let cx = x - (ww + cw + dw) / 2;
    const cy = by + 22;
    if (wTag) {
      ctx.fillStyle = wTag.color;
      ctx.beginPath();
      ctx.roundRect(cx, cy - 6, ww - 2, 12, 2);
      ctx.fill();
      ctx.fillStyle = '#141414';
      ctx.textAlign = 'left';
      ctx.fillText(wTag.text, cx + 4, cy + 0.5);
      cx += ww;
    }
    if (chip && tier) {
      ctx.fillStyle = tier.color;
      ctx.beginPath();
      ctx.roundRect(cx, cy - 6, cw, 12, 6);
      ctx.fill();
      ctx.fillStyle = inkOn(tier.color);
      ctx.textAlign = 'left';
      ctx.fillText(chip, cx + 4, cy + 0.5);
      cx += cw;
    }
    if (dz) {
      ctx.fillStyle = '#e07a62';
      ctx.textAlign = 'left';
      ctx.fillText(dz, cx + 4, cy + 0.5);
    }
  }
}

