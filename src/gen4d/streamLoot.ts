// Лут комнат бесконечного мира «Прогулки»: что (src/game/loot.ts rollRoomLoot) и где — точки LootSpot в тех же мировых
// координатах Babylon, что WorldDrop (src/view3d/worldItems.ts: X = план x, Y — высота поверхности, Z = −план y; м).
//
//  • Что: сид мира (seedKey) + АДРЕС экземпляра (StreamWorld.addressOf), биом квартиры (clusterAt), элитность экземпляра
//    (RunInstance.tier → ранг тира по уровню, 0…4), площадь пола; заявленное комнатой — строки лута и предметы на спотах.
//    Спец-локации (locationOf: лестница, лифт, ангар…) — без лута.
//  • Где (src/game/place.ts placePickups — те же правила, что у находок): заявленное на споте — на своём споте (на мебели —
//    сверху, у высокой — на середине высоты), строка тира с where — в своей мебели; остальное — сначала на свободные
//    споты для предметов (споты, где выпал предмет не из LOOT_DEFS: у него пока нет модели — место свободно), затем на
//    пол: клетки, где встаёт капсула игрока, не в проёмах и не на путях между ними, у стен и мебели (не в стене и не в
//    мебели — классы Slot плана пола walk.ts). На лестнице: на площадке — на её высоте, на марше — точки нет.
//  • y = RunInstance.z (высота низа комнаты) + высота площадки лестницы + высота над полом (мебель); yaw — как у камеры
//    (rotation.y): у спота — его поворот (план rot° по часовой = rotation.y), на полу — по ГСЧ места.
//  • Id точки — «<inst>:L<k>» (k — номер в списке комнаты), подобрана — флаг мира «loot:<id>» (StreamWorld.takeLoot,
//    WorldOp 'loot'). lootOf возвращает все точки (и подобранные) — фильтр: world.lootTaken(id), пересборка — по
//    смене world.lootRev().
//
// ИНТЕГРАЦИЯ (слой отрисовки):
//   const spots = lootOf(walk.world, inst, walk.rx).filter((s) => !walk.world.lootTaken(s.id));
//   E у точки → walk.request({ k: 'loot', id: s.id }) → id (подобрал этот запрос) / null (кто-то раньше)
import type { RunExport, RunInstance } from '../blockout/types';
import { decodeCells, ITEM_CLEAR_M, placePickups, roomOfInstance } from '../game/place';
import { ITEM_SPOT, rollRoomLoot, type LootRoll, type LootRoomSpec } from '../game/loot';
import { lootDef } from '../data/itemsLoot';
import { makeRng } from '../model/rng';
import { tunnelKind } from './biomes';
import { seedKey, type StreamWorld } from './stream';

/** Точка лута в мире. */
export interface LootSpot {
  /** «<inst>:L<k>» (≤ 64 символов) */
  id: string;
  item: string;
  /** штук (нет — 1) */
  n?: number;
  /** заряд/топливо 0…1 (нет — 1) */
  q?: number;
  inst: string;
  /** мировые координаты Babylon, м (как WorldDrop): y — поверхность, на которой лежит предмет */
  x: number;
  y: number;
  z: number;
  yaw: number;
}

const cache = new WeakMap<StreamWorld, Map<string, readonly LootSpot[]>>();
const NONE: readonly LootSpot[] = Object.freeze([]);

const r3 = (v: number): number => {
  const r = Math.round(v * 1000) / 1000;
  return r === 0 ? 0 : r;
};

/** Ранг элитности экземпляра 0…4: место тира среди тиров проекта по уровню (нет тира — 0). */
export function tierRank(rx: Pick<RunExport, 'tiers'>, tierId: string | null | undefined): number {
  if (!tierId) return 0;
  const sorted = [...(rx.tiers ?? [])].sort((a, b) => a.level - b.level || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const i = sorted.findIndex((t) => t.id === tierId);
  return i < 0 ? 0 : Math.min(4, i);
}

/** Экземпляр в JSON прогона (по id: «i<order>» — сначала по индексу). */
function instOf(rx: RunExport, id: string): RunInstance | null {
  const m = /^i(\d+)$/.exec(id);
  const g = m ? rx.instances[+m[1]] : undefined;
  if (g?.id === id) return g;
  return rx.instances.find((i) => i.id === id) ?? null;
}

/** Розыгрыш комнаты (вход rollRoomLoot) по миру и JSON прогона; null — нет экземпляра или это спец-локация. */
export function lootRoomOf(world: StreamWorld, instId: string, rx: RunExport): LootRoomSpec | null {
  const inst = instOf(rx, instId);
  const addr = world.addressOf(instId);
  if (!inst || !addr || world.locationOf(instId)) return null;
  const cl = world.clusterAt(instId);
  const cellM = rx.cellM > 0 ? rx.cellM : 0.1;
  const tunnels = cl?.tunnels === true;
  const kind = tunnels ? tunnelKind(roomOfInstance(inst)) : null;
  const declared: { item: string; count: number; at?: string }[] = [];
  for (const s of inst.spots ?? []) if (s.content?.kind === 'item') declared.push({ item: s.content.id, count: 1, at: ITEM_SPOT + s.id });
  for (const l of inst.loot ?? []) declared.push({ item: l.itemId, count: l.count, ...(l.decorId ? { at: l.decorId } : {}) });
  return {
    seed: seedKey(world.settings.seed, world.settings.mods),
    inst: instId,
    addr,
    biome: cl?.biome?.id ?? null,
    tier: tierRank(rx, inst.tier),
    areaM2: decodeCells(inst.cells).size * cellM * cellM,
    tunnels,
    ...(kind ? { kind } : {}),
    roomId: inst.roomId,
    tags: inst.roomTags ?? [],
    declared,
    rx,
  };
}

/**
 * Точки лута экземпляра instId (все, и подобранные; заморожены, кэш на мир и экземпляр). rx — JSON прогона мира
 * (WalkSession.rx): геометрия комнаты, таблицы мебели и тиров; его же получает хук комнаты. Экземпляра в rx нет —
 * пусто (без кэша); спец-локация — пусто.
 */
export function lootOf(world: StreamWorld, instId: string, rx: RunExport): readonly LootSpot[] {
  let byInst = cache.get(world);
  const hit = byInst?.get(instId);
  if (hit) return hit;
  const inst = instOf(rx, instId);
  if (!inst) return NONE;
  const spec = lootRoomOf(world, instId, rx);
  const out = spec ? placeLoot(rx, inst, rollRoomLoot(spec), `${spec.seed}#lootpos:${spec.addr}`) : NONE;
  if (!byInst) cache.set(world, (byInst = new Map()));
  byInst.set(instId, out);
  return out;
}

/** Куда положить разыгранное: заявленное — на свой спот / в свою мебель, прочее — на свободные споты, затем на пол. */
export function placeLoot(rx: RunExport, inst: RunInstance, rolls: readonly LootRoll[], seed: string): readonly LootSpot[] {
  if (!rolls.length) return NONE;
  const cellM = rx.cellM > 0 ? rx.cellM : 0.1;
  const rng = makeRng(seed);
  const spotById = new Map((inst.spots ?? []).map((s) => [s.id, s] as const));
  // свободные споты для предметов: выпал предмет не из каталога лута (у него нет модели) — в случайном порядке места
  const used = new Set<string>();
  const spotOf = (r: LootRoll): string | null => (r.at?.startsWith(ITEM_SPOT) ? r.at.slice(ITEM_SPOT.length) : null);
  for (const r of rolls) {
    const sid = spotOf(r);
    if (sid !== null && spotById.has(sid)) used.add(sid);
  }
  const free = rng.shuffle((inst.spots ?? []).filter((s) => s.content?.kind === 'item' && !lootDef(s.content.id) && !used.has(s.id)).map((s) => s.id));
  // экземпляр-заготовка для placePickups: на спотах — только наше, лут — наше на пол / в мебель
  const onSpot = new Map<string, number>();
  const rows: { roll: number; decorId?: string }[] = [];
  rolls.forEach((r, i) => {
    const sid = spotOf(r);
    if (sid !== null && spotById.has(sid) && !onSpot.has(sid)) onSpot.set(sid, i);
    else if (r.at && sid === null) rows.push({ roll: i, decorId: r.at });
    else if (free.length) onSpot.set(free.shift()!, i);
    else rows.push({ roll: i });
  });
  const syn: RunInstance = {
    ...inst,
    spots: (inst.spots ?? []).map((s) => {
      const i = onSpot.get(s.id);
      if (i !== undefined) return { ...s, content: { kind: 'item' as const, id: rolls[i].item, rot: 0 } };
      return s.content?.kind === 'item' ? { ...s, content: null } : s;
    }),
    loot: rows.map((w, k) => ({ itemId: rolls[w.roll].item, count: 1, from: 'room', rowId: `L${k}`, ...(w.decorId ? { decorId: w.decorId } : {}) })),
  };
  const picks = placePickups(rx, syn);
  // id находки placePickups → номер розыгрыша
  const rollOf = new Map<string, number>();
  for (const [sid, i] of onSpot) rollOf.set(`${inst.id}:spot:${sid}`, i);
  rows.forEach((w, k) => rollOf.set(`${inst.id}:loot:${k}`, w.roll));
  const at = new Map<number, { x: number; y: number; z: number; yaw: number | null }>();
  for (const p of picks) {
    const i = rollOf.get(p.id);
    if (i === undefined) continue;
    const s = p.from === 'spot' ? spotById.get(p.id.slice(`${inst.id}:spot:`.length)) : undefined;
    at.set(i, { x: p.x, y: p.y, z: p.z, yaw: s ? s.contentRot ?? s.rot : null });
  }
  const base = inst.z ?? 0;
  const out: LootSpot[] = [];
  rolls.forEach((r, i) => {
    const p = at.get(i);
    if (!p) return;
    const st = stairAt(inst, p.x, p.y, ITEM_CLEAR_M / cellM);
    if (st === null) return; // на марше лестницы — не кладём
    const yaw = p.yaw !== null ? (p.yaw * Math.PI) / 180 : (rng.next() * 2 - 1) * Math.PI;
    out.push({
      id: `${inst.id}:L${out.length}`,
      item: r.item,
      ...(r.n && r.n > 1 ? { n: r.n } : {}),
      ...(r.q !== undefined ? { q: r.q } : {}),
      inst: inst.id,
      x: r3(p.x * cellM),
      y: r3(base + st + p.z),
      z: r3(-p.y * cellM),
      yaw: r3(Math.atan2(Math.sin(yaw), Math.cos(yaw))),
    });
  });
  for (const s of out) Object.freeze(s);
  return Object.freeze(out);
}

/** Пол лестницы под точкой (мировые клетки): высота площадки над низом комнаты, м (0 — обычный пол); null — на марше
 *  или ближе pad клеток к нему (все марши, и сорвавшиеся дорожки эскалатора — escLanes). */
function stairAt(inst: RunInstance, x: number, y: number, pad: number): number | null {
  const s = inst.stair;
  if (!s) return 0;
  for (const f of inst.escLanes ?? s.flights ?? []) if (x > f.x0 - pad && x < f.x1 + pad && y > f.y0 - pad && y < f.y1 + pad) return null;
  let z = 0;
  for (const p of s.pads ?? []) if (x > p.x0 && x < p.x1 && y > p.y0 && y < p.y1) z = Math.max(z, p.z);
  return z;
}
