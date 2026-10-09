// Мировая геометрия экземпляров прогона — для предпросмотра и экспорта раскладки.
import { cellKey, parseKey, rotateCell, rotatePoint } from '../model/cells';
import { segmentLine } from '../model/segments';
import type { CellKey, Connector, Decor, Door, Instance, Project, Run, Spot } from '../model/types';
import type { RunFinish } from '../blockout/types';
import { encodeRows, normDeg, transformSeg } from './geom';
import { cloneLocation } from '../locations/stairwell';
import { connDz, worldStair } from '../model/stairs';
import { TAG_OPEN_H } from '../data/roomBuilder';

export interface InstanceWorld {
  inst: Instance;
  cells: Set<CellKey>;
  doors: Door[];
  connectors: Connector[];
  /** декор в мировых координатах (x, y, rot уже с учётом поворота экземпляра) */
  decor: Decor[];
  spots: Spot[];
  bbox: { x0: number; y0: number; x1: number; y1: number };
}

/** Мировая геометрия одного экземпляра (поворот rot вокруг (0,0), затем сдвиг dx, dy). */
export function instanceWorld(p: Project, inst: Instance): InstanceWorld {
  const room = p.rooms.find((r) => r.id === inst.roomId);
  const { rot, dx, dy } = inst;
  const cells = new Set<CellKey>();
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  if (room) {
    for (const k of room.cells) {
      const [lx, ly] = parseKey(k);
      const [rx, ry] = rotateCell(lx, ly, rot);
      const x = rx + dx, y = ry + dy;
      cells.add(cellKey(x, y));
      if (x < x0) x0 = x;
      if (y < y0) y0 = y;
      if (x + 1 > x1) x1 = x + 1;
      if (y + 1 > y1) y1 = y + 1;
    }
  }
  if (x0 === Infinity) x0 = y0 = x1 = y1 = 0;
  const pt = <T extends { x: number; y: number; rot: number }>(o: T): T => {
    const [rx, ry] = rotatePoint(o.x, o.y, rot);
    return { ...o, x: rx + dx, y: ry + dy, rot: normDeg(o.rot + rot) };
  };
  return {
    inst,
    cells,
    doors: room ? room.doors.map((d) => transformSeg(d, rot, dx, dy)) : [],
    connectors: room ? room.connectors.map((c) => transformSeg(c, rot, dx, dy)) : [],
    decor: room ? room.decor.map(pt) : [],
    spots: room ? room.spots.map(pt) : [],
    bbox: { x0, y0, x1, y1 },
  };
}

/** Все экземпляры прогона (с кэшем по run внутри не нужно — вызывающий мемоизирует). */
export function runWorld(p: Project, run: Run): InstanceWorld[] {
  return run.instances.map((i) => instanceWorld(p, i));
}

export interface ExportOptions {
  /** включать текстуры декора и отделки (data:URI). По умолчанию false — tex: null, hasTex: true/false */
  withTex?: boolean;
}

/** Экспорт готовой раскладки для движка (ТЗ §1, машинный сценарий): самодостаточный JSON,
 *  всё в мировых координатах, cells сжаты, ссылки на props/items по id + их таблицы.
 *  Формат описан в docs/GENERATOR.md, раздел «Формат экспорта прогона». */
export function exportRunJSON(p: Project, run: Run, opts: ExportOptions = {}): unknown {
  const worlds = runWorld(p, run);
  const contentBy = new Map(run.content.map((c) => [c.inst, c] as const));
  const linkBy = new Map<string, { inst: string; connector: string }>();
  for (const l of run.links) {
    linkBy.set(`${l.a.inst}/${l.a.connector}`, l.b);
    linkBy.set(`${l.b.inst}/${l.b.connector}`, l.a);
  }

  const usedProps = new Set<string>();
  const usedItems = new Set<string>();
  const usedTiers = new Set<string>();
  const usedShops = new Set<string>();
  const usedFinishes = new Set<string>();

  const instances = worlds.map((w) => {
    const room = p.rooms.find((r) => r.id === w.inst.roomId);
    const c = contentBy.get(w.inst.id);
    const spawned = new Map((c?.spots ?? []).map((s) => [s.spotId, s] as const));
    for (const d of w.decor) usedProps.add(d.propId);
    const finish = { wall: c?.finish?.wall ?? null, floor: c?.finish?.floor ?? null };
    if (finish.wall) usedFinishes.add(finish.wall);
    if (finish.floor) usedFinishes.add(finish.floor);
    if (c) {
      if (c.tierId) usedTiers.add(c.tierId);
      for (const s of c.spots) if (s.content) (s.content.kind === 'prop' ? usedProps : usedItems).add(s.content.id);
      for (const l of c.loot) {
        usedItems.add(l.itemId);
        if (l.shopId) usedShops.add(l.shopId);
      }
    }
    return {
      id: w.inst.id,
      roomId: w.inst.roomId,
      roomName: room?.name ?? '',
      roomTags: room?.tags ?? [],
      rot: w.inst.rot,
      dx: w.inst.dx,
      dy: w.inst.dy,
      order: w.inst.order,
      depth: w.inst.depth,
      parent: w.inst.parent,
      /** слой W складчатого генератора (0 — евклидов прогон) */
      w: w.inst.w ?? 0,
      /** этаж (0 — этаж старта, ниже — отрицательные, выше — положительные): меняется только переходом спец-локации
       *  (links[].kind = 'descent' — вниз, 'lift' — выход лифта вверх) */
      floor: w.inst.floor ?? 0,
      /** спец-локация комнаты (src/locations/, docs/LOCATIONS.md) или null — обычная комната */
      location: room?.location ? cloneLocation(room.location) : null,
      /** высота низа комнаты, м (за лестницами, src/model/stairs.ts) и лестница в мировых клетках — только если есть */
      ...(w.inst.z ? { z: w.inst.z } : {}),
      ...(room?.stair ? { stair: worldStair(room.stair, w.inst.rot, w.inst.dx, w.inst.dy) } : {}),
      // своя высота потолка (залы метро, Room.ceilM) — только если задана
      ...(room?.ceilM && room.ceilM > 0 ? { ceilM: room.ceilM } : {}),
      bbox: w.bbox,
      cells: encodeRows(w.cells),
      doors: w.doors.map((d) => ({ id: d.id, cx: d.cx, cy: d.cy, side: d.side, len: d.len, line: segmentLine(d) })),
      connectors: w.connectors.map((k, ci) => ({
        id: k.id, name: k.name, tag: k.tag, cx: k.cx, cy: k.cy, side: k.side, len: k.len,
        line: segmentLine(k),
        linkedTo: linkBy.get(`${w.inst.id}/${k.id}`) ?? null,
        // пол у метки выше низа комнаты (лестница), м
        ...(room?.stair && connDz(room, ci) ? { dz: connDz(room, ci) } : {}),
        // высота проёма по метке (TAG_OPEN_H: высокие проходы метро), м — только если задана
        ...(TAG_OPEN_H[k.tag] > 0 ? { openH: TAG_OPEN_H[k.tag] } : {}),
      })),
      decor: w.decor.map((d) => ({ id: d.id, propId: d.propId, x: d.x, y: d.y, rot: d.rot })),
      spots: w.spots.map((s) => {
        const sp = spawned.get(s.id);
        return {
          id: s.id, name: s.name, x: s.x, y: s.y, rot: s.rot, groupId: s.groupId,
          variantId: sp?.variantId ?? null,
          /** содержимое после розыгрыша; rot содержимого (мировой) = contentRot */
          content: sp?.content ?? null,
          contentRot: sp ? sp.rot : null,
        };
      }),
      tier: c?.tierId ?? null,
      danger: c?.danger ?? 0,
      dangerAcc: c?.dangerAcc ?? 0,
      groups: c?.groups ?? [],
      loot: c?.loot ?? [],
      /** разыгранная отделка: id из таблицы finishes или null (нет правила) */
      finish,
    };
  });
  for (const id of Object.keys(run.totals)) usedItems.add(id);

  const tiers = p.economy.tiers.filter((t) => usedTiers.has(t.id));
  for (const t of tiers) for (const row of t.loot) {
    if (row.source.kind === 'item') usedItems.add(row.source.id);
    else usedShops.add(row.source.id);
  }
  const shops = p.economy.shops.filter((s) => usedShops.has(s.id));
  // отделки: выпавшие + нижние панели (dado) выпавших, по цепочке
  const finById = new Map((p.finishes ?? []).map((f) => [f.id, f] as const));
  for (const id of [...usedFinishes]) {
    let d = finById.get(id)?.dado;
    for (let k = 0; d && finById.has(d.finishId) && !usedFinishes.has(d.finishId) && k < 16; k++) {
      usedFinishes.add(d.finishId);
      d = finById.get(d.finishId)!.dado;
    }
  }
  const finishes: RunFinish[] = (p.finishes ?? [])
    .filter((f) => usedFinishes.has(f.id))
    .map((f) => ({
      id: f.id,
      name: f.name,
      surface: f.surface,
      color: f.color,
      tex: opts.withTex ? f.tex : null,
      hasTex: !!f.tex,
      tileW: f.tileW,
      tileH: f.tileH,
      dado: f.dado && finById.has(f.dado.finishId) ? { finishId: f.dado.finishId, heightM: f.dado.heightM } : null,
    }));
  for (const s of shops) {
    usedItems.add(s.currencyItemId);
    for (const o of s.offers) usedItems.add(o.itemId);
  }

  return {
    format: 'room-forge-run',
    version: 1,
    seed: run.seed,
    cellM: p.settings.cellM,
    units: { cell: p.settings.cellM, note: 'координаты в клетках, ось Y вниз' },
    settings: run.settings,
    props: p.props
      .filter((x) => usedProps.has(x.id))
      .map((x) => ({ id: x.id, name: x.name, w: x.w, h: x.h, color: x.color, tags: x.tags, hasTex: !!x.tex, tex: opts.withTex ? x.tex : null })),
    items: p.items.filter((x) => usedItems.has(x.id)).map((x) => ({ id: x.id, name: x.name, color: x.color, tags: x.tags, note: x.note })),
    tiers,
    shops,
    /** отделки, на которые ссылаются instances[].finish и dado; tex — только с withTex */
    finishes,
    dangerLimit: p.economy.dangerLimit,
    instances,
    /** связи: обычные двери (dw — сдвиг порога по W) и переходы спец-локаций — kind = 'descent' (a — экземпляр
     *  локации, connector пуст; b — комната-выход и метка, через которую в неё приходят; floors — этажей вниз) и
     *  kind = 'lift' (a — лифт, connector пуст; b — комната за выходом кабины и метка прихода; floors — этажей
     *  над лифтом; side — 'straight' / 'right'). Не проёмы */
    links: run.links,
    openConnectors: run.openConnectors,
    /** самая длинная линия прямого обзора: метры и отрезок «от края до края» в мировых клетках */
    sight: run.sight,
    /** почему рост остановился раньше count (null — count набран) */
    stop: run.stop ?? null,
    /** режим генератора и сводка складок (4D); links[].dw — сдвиг порога по W */
    mode: run.settings.mode ?? 'euclid',
    fold: run.fold ?? null,
    /** потенциально видимые наборы (бесшовный 4D): комната → что рендерить, стоя в ней */
    pvs: run.pvs ?? null,
    totals: run.totals,
    warnings: run.warnings,
    ms: run.ms,
  };
}
