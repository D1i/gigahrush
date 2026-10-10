// Номера, замки, ключи и записки жилых комнат общаги (tmp/smile-wip/CONTRACT.md §9.3): картинка и ввод поверх чистой
// логики src/locations/obshagaRooms.ts (DORM, dormIndex, plateText, noteText) — через фасад ObshagaWalk (hooks, nav,
// portal, room, openDoor).
//
//  • Лут: хук комнат биома 'obshaga' (src/game/loot.ts registerLootRoom) — элитность лута = DormMeta.tier, в комнате
//    с ключом (meta.key) ключ кладётся первым; ключ ещё и в случайной таблице общаги ('vrare'). Регистрация — при
//    загрузке ЭТОГО модуля: лут разыгрывается лениво, в кадре View3DPage (lootOf → rollRoomLoot, кэш на мир), а
//    View3DPage импортирует модуль статически — модуль выполнен раньше первого кадра; у всех игроков лобби код один —
//    и хук один. HMR — прежняя регистрация снимается (globalThis.__rfDormLoot).
//  • Таблички: у номерных и элитных — эмалевая (белая с синей каймой, номер синим; элитная выглядит так же — что она
//    элитная, знает только записка), у ∞ — тёмная с золотом. Табличка — свой меш на полотне двери со стороны коридора
//    (там, где был жестяной номерок src/blockout/doors.ts; у дверей без номера номерка больше нет): поза — каждый кадр
//    по полотну куска (BabylonBlockout.doorLeaves: позиция петель и поворот), рисуется в комнате полотна
//    (portal.extraProviders, PORTAL_LAYER) — в той же области стенсила и с тем же отсечением, что и полотно; кусок
//    пересобрали — табличка своя, не пропадает.
//  • Замки: запертая по DORM (meta.locked) — пока нет флага мира «unlock:<inst>/<conn>» (кооп-журнал: у всех одинаково;
//    хост отклоняет чужой obshDoor по hooks.locked). E с ключом (хотбар или сумка) — ключ тратится, флаг, щелчок замка,
//    дверь распахивается; изнутри комнаты (накладной замок) — отпереть без ключа. Без ключа — «Заперто. Нужен ключ»
//    (звук и вспышка — у ObshagaWalk). Дверь «в снег» (метка 'snowdoor') и тупики (ObshDoor.room null) — не трогаем.
//  • Записки: в комнате с meta.note — листок в клетку на столе / тумбочке / кровати (высота — лучом по модели мебели),
//    иначе на полу у входа. E рядом и лицом к нему — DOM-листок с текстом noteText (рукописный шрифт, синие чернила);
//    E / Esc — закрыть. Не предмет инвентаря. E — в фазе захвата и только когда записка под взглядом (предмет под
//    взглядом и дверь рядом — важнее).
import type { Scene } from '@babylonjs/core/scene';
import type { Observer } from '@babylonjs/core/Misc/observable';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Matrix, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Ray } from '@babylonjs/core/Culling/ray';
import type { RunExport } from '../blockout/types';
import { doorFlip } from '../blockout/doors';
import { registerLootEntry, registerLootRoom, type LootRoomInfo, type LootRoomResult } from '../game/loot';
import { consume, count } from '../game/hotbar';
import { dormIndex, noteText, type DormMeta } from '../locations/obshagaRooms';
import { SNOWDOOR_CONN } from '../locations/storyDoors';
import { hashSeed, makeRng } from '../model/rng';
import { PORTAL_LAYER, type PortalPiece, type PortalRenderer } from './portal';
import type { NavRoom, ObshDoor, ObshNav } from './obshagaNav';
import type { ObshagaWalk } from './obshagaWalk';
import type { WalkSession } from './walk';
import type { Inventory } from './inventory';
import type { CoopSession } from '../coop/session';

export interface ObshagaRoomsDeps {
  /** сессия прогулки: world.flag(id), request({k:'flag', id}), rx */
  session(): WalkSession | null;
  /** руки игрока (хотбар): held / receive / take */
  inv(): Inventory | null;
  /** кооп: лобби (null — одиночная игра) */
  co: CoopSession | null;
  /** вспышка текста по центру (как у общаги) */
  flash(text: string, color: string, ms?: number): void;
  /** можно ли сейчас управлять (нет спец-сцены поверх, от первого лица) */
  live(): boolean;
}

/** Ключ от комнаты (src/data/items.ts). */
export const KEY_ITEM = 'it_key';
/** Флаг мира отпертой двери (WorldOp 'flag'): «unlock:<inst>/<conn>» — id ObshDoor. */
export const unlockFlag = (doorId: string): string => `unlock:${doorId}`;

/** Табличка: высота середины над низом полотна, толщина, м. */
export const PLATE_Y = 1.6;
export const PLATE_D = 0.004;
/** Записка: размер листка (ширина × длина), м; прочитать — ближе, м, и не дальше угла от взгляда (косинус). */
export const NOTE_W = 0.16;
export const NOTE_L = 0.2;
const NOTE_REACH = 1.75;
const NOTE_COS = 0.82;
/** Дверь рядом (подсказка ObshagaWalk) — записку не читаем: ближе, м (как NEAR_DOOR общаги). */
const NEAR_DOOR = 1.3;
/** Табличек и записок в памяти не больше; не нужные дольше — долой, мс. */
const PLATES_MAX = 40;
const NOTES_MAX = 10;
const IDLE_MS = 20000;

const C_KEY = '#d9c48a';
const C_WARN = '#c9b98a';

// ───────────────────────── чистое (тесты — obshagaRoomsView.test.ts) ─────────────────────────

/** Хук лута комнат общаги: элитность — tier комнаты, ключ — первым (meta.key). Не жилая / без мира — null. */
export function dormLoot(info: LootRoomInfo): LootRoomResult | null {
  if (!info.rx) return null;
  const meta = dormIndex(info.rx).get(info.inst);
  if (!meta) return null;
  return meta.key ? { tier: meta.tier, force: [{ item: KEY_ITEM }] } : { tier: meta.tier };
}

const REG = '__rfDormLoot';
/** Хук лута и ключ в случайной таблице общаги — один раз (повтор / HMR — прежняя регистрация снимается). */
export function registerDormLoot(): () => void {
  const g = globalThis as unknown as Record<string, (() => void) | undefined>;
  g[REG]?.();
  const offRoom = registerLootRoom('obshaga', dormLoot);
  const offKey = registerLootEntry('obshaga', { item: KEY_ITEM, rarity: 'vrare' });
  const off = () => {
    offRoom();
    offKey();
    if (g[REG] === off) g[REG] = undefined;
  };
  g[REG] = off;
  return off;
}

// регистрация — при загрузке модуля (см. шапку): раньше первого розыгрыша лута
registerDormLoot();

/** Дверь жилой комнаты: полотно в самой комнате (dd.inst === dd.room), не «в снег», метаданные есть. */
export function dormDoor(nav: Pick<ObshNav, 'doorById'>, metas: ReadonlyMap<string, DormMeta>, doorId: string): { door: ObshDoor; meta: DormMeta } | null {
  const d = nav.doorById.get(doorId);
  if (!d || !d.room || d.inst !== d.room || d.conn === SNOWDOOR_CONN) return null;
  const meta = metas.get(d.room);
  return meta ? { door: d, meta } : null;
}

/** Двери жилой комнаты room (полотно в ней). */
export function doorsOfDorm(nav: Pick<ObshNav, 'doorsByRoom'>, room: string): ObshDoor[] {
  return (nav.doorsByRoom.get(room) ?? []).filter((d) => d.room === room && d.inst === room && d.conn !== SNOWDOOR_CONN);
}

/** Что делает E у двери: 'open' — не заперта (обычное), 'inside' — отпереть изнутри, 'key' — отпереть ключом,
 *  'locked' — заперта, ключа нет. */
export type LockAct = 'open' | 'inside' | 'key' | 'locked';
export function lockAct(meta: Pick<DormMeta, 'locked'> | null, unlocked: boolean, inside: boolean, hasKey: boolean): LockAct {
  if (!meta?.locked || unlocked) return 'open';
  if (inside) return 'inside';
  return hasKey ? 'key' : 'locked';
}

/** Размер таблички по надписи, м: номер — 0.10…0.2 × 0.07, ∞ — шире и выше. */
export function plateSize(text: string): { w: number; h: number } {
  const n = [...text].length;
  const inf = text.startsWith('∞');
  const w = Math.min(inf ? 0.21 : 0.2, Math.max(0.1, (inf ? 0.07 : 0.05) + 0.024 * n));
  return { w: Math.round(w * 1000) / 1000, h: inf ? 0.08 : 0.07 };
}

/**
 * Середина таблички в координатах полотна (BoxBatch куска: x — от петель, у правых петель отражено; y — от низа
 * полотна; тело — z ∈ [0, t]): по ширине — посередине, высота PLATE_Y, на обратной стороне (к коридору; у полотна с
 * «чужой» стороны — на лицевой). face — куда смотрит лицо таблички по z.
 */
export function plateLocal(geo: { hinge: 'left' | 'right'; width: number }, thick: number, flip: boolean): { x: number; y: number; z: number; face: 1 | -1 } {
  const x = (geo.hinge === 'right' ? -1 : 1) * (geo.width / 2);
  return flip ? { x, y: PLATE_Y, z: -PLATE_D / 2, face: -1 } : { x, y: PLATE_Y, z: thick + PLATE_D / 2, face: 1 };
}

/** Где лежит записка: на столе, тумбочке или кровати комнаты (рамка мебели, h — высота болванки), иначе на полу
 *  в 1.25 м от входа. Детерминированно по комнате. */
export function notePlace(room: Pick<NavRoom, 'id' | 'props' | 'x0' | 'y0' | 'x1' | 'y1'>, doors: readonly Pick<ObshDoor, 'x' | 'y' | 'nx' | 'ny'>[]): {
  x: number; y: number; h: number; yaw: number; on: 'table' | 'nightstand' | 'bed' | 'floor';
} {
  const R = makeRng(`dorm-note/${room.id}`);
  const yaw = (R.next() * 2 - 1) * Math.PI;
  const ou = R.next() - 0.5, ov = R.next() - 0.5;
  const pick = (ids: (p: NavRoom['props'][number]) => boolean) => room.props.filter(ids);
  const groups: [NavRoom['props'], 'table' | 'nightstand' | 'bed'][] = [
    [pick((p) => p.propId === 'p_obsh_table' || p.propId === 'p_table_kitchen' || p.propId === 'p_table_round'), 'table'],
    [pick((p) => p.propId === 'p_obsh_nightstand'), 'nightstand'],
    [pick((p) => p.cover === 'bed'), 'bed'],
  ];
  for (const [list, on] of groups) {
    if (!list.length) continue;
    const p = list[Math.floor(R.next() * list.length) % list.length];
    const r = p.rect;
    const cx = (r.x0 + r.x1) / 2, cy = (r.y0 + r.y1) / 2;
    // не к самому краю: в средних 40 % рамки
    return { x: cx + ou * 0.4 * (r.x1 - r.x0), y: cy + ov * 0.4 * (r.y1 - r.y0), h: p.h, yaw, on };
  }
  const d = doors[0];
  if (d) return { x: d.x - d.nx * 1.25 + ou * 0.3, y: d.y - d.ny * 1.25 + ov * 0.3, h: 0, yaw, on: 'floor' };
  return { x: (room.x0 + room.x1) / 2, y: (room.y0 + room.y1) / 2, h: 0, yaw, on: 'floor' };
}

/** Записка под взглядом: ближе NOTE_REACH и в конусе взгляда (или почти под ногами). */
export function noteAimed(eye: { x: number; y: number; z: number }, fwd: { x: number; y: number; z: number }, p: { x: number; y: number; z: number }): boolean {
  const dx = p.x - eye.x, dy = p.y - eye.y, dz = p.z - eye.z;
  const d = Math.hypot(dx, dy, dz);
  if (d > NOTE_REACH) return false;
  if (Math.hypot(dx, dz) < 0.45) return true;
  return d < 1e-6 || (dx * fwd.x + dy * fwd.y + dz * fwd.z) / d >= NOTE_COS;
}

/** Текст записки → куски (основная рука и приписка «другой рукой»), номер выделен. */
export function noteParts(text: string): { main: string; alt: string | null } {
  const m = /\s*\(ниже другой рукой:\)\s*/.exec(text);
  if (!m) return { main: text, alt: null };
  return { main: text.slice(0, m.index), alt: text.slice(m.index + m[0].length) };
}

// ───────────────────────── текстуры (canvas → DynamicTexture) ─────────────────────────

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!];
}

function finishTex(name: string, c: HTMLCanvasElement, scene: Scene): DynamicTexture {
  const t = new DynamicTexture(name, c, scene, true, Texture.TRILINEAR_SAMPLINGMODE);
  t.wrapU = Texture.CLAMP_ADDRESSMODE;
  t.wrapV = Texture.CLAMP_ADDRESSMODE;
  t.anisotropicFilteringLevel = 8;
  t.update(true, false);
  return t;
}

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

const PLATE_FONT = '"Arial Narrow", "Roboto Condensed", "Liberation Sans Narrow", Arial, sans-serif';

/** Надпись по центру, сжатая по ширине до maxW. */
function fitText(g: CanvasRenderingContext2D, text: string, cx: number, cy: number, maxW: number) {
  const w = g.measureText(text).width;
  const k = w > maxW ? maxW / w : 1;
  g.save();
  g.translate(cx, cy);
  g.scale(k, 1);
  g.fillText(text, 0, 0);
  g.restore();
}

/** Табличка: эмаль (номер) или тёмная с золотом (∞). Кайма — до самого края (бока меша берут её цвет). */
function plateTexture(scene: Scene, text: string, w: number, h: number): { tex: DynamicTexture; side: [number, number] } {
  const W = 512, H = Math.max(64, Math.round((W * h) / w));
  const [c, g] = canvas(W, H);
  const R = makeRng(`plate/${text}`);
  const inf = text.startsWith('∞');
  const B = Math.round(H * 0.075);
  if (!inf) {
    // кайма (синяя) — фон целиком, эмаль — скруглённый прямоугольник поверх
    g.fillStyle = '#1d3466';
    g.fillRect(0, 0, W, H);
    const gr = g.createLinearGradient(0, 0, 0, H);
    gr.addColorStop(0, '#f3f0e6');
    gr.addColorStop(0.55, '#e9e4d6');
    gr.addColorStop(1, '#d6cfbd');
    g.fillStyle = gr;
    roundRect(g, B, B, W - 2 * B, H - 2 * B, H * 0.12);
    g.fill();
    // тонкая внутренняя линия
    g.strokeStyle = 'rgba(29,52,102,0.75)';
    g.lineWidth = Math.max(2, H * 0.018);
    roundRect(g, B * 1.9, B * 1.9, W - 3.8 * B, H - 3.8 * B, H * 0.08);
    g.stroke();
    // винты по краям
    for (const sx of [B * 2.9, W - B * 2.9]) {
      const sy = H / 2, r = H * 0.055;
      g.fillStyle = '#8d8a80';
      g.beginPath();
      g.arc(sx, sy, r, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = '#4b4943';
      g.lineWidth = r * 0.35;
      g.beginPath();
      const a = R.next() * Math.PI;
      g.moveTo(sx - Math.cos(a) * r * 0.8, sy - Math.sin(a) * r * 0.8);
      g.lineTo(sx + Math.cos(a) * r * 0.8, sy + Math.sin(a) * r * 0.8);
      g.stroke();
      // ржавый подтёк от винта
      const rg = g.createLinearGradient(sx, sy, sx, sy + H * 0.3);
      rg.addColorStop(0, 'rgba(120,70,30,0.35)');
      rg.addColorStop(1, 'rgba(120,70,30,0)');
      g.fillStyle = rg;
      g.fillRect(sx - r * 0.35, sy + r, r * 0.7, H * 0.3);
    }
    // номер
    g.fillStyle = '#1b3164';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = `bold ${Math.round(H * 0.6)}px ${PLATE_FONT}`;
    fitText(g, text, W / 2, H / 2 + H * 0.03, W - B * 2 - H * 0.55);
    // сколы эмали (чёрное железо) у кромки и грязь
    for (let i = 0; i < 5; i++) {
      const edge = R.next() < 0.5;
      const x = edge ? B + R.next() * (W - 2 * B) : (R.next() < 0.5 ? B * 1.2 : W - B * 1.2);
      const y = edge ? (R.next() < 0.5 ? B * 1.2 : H - B * 1.2) : B + R.next() * (H - 2 * B);
      g.fillStyle = `rgba(28,26,24,${0.55 + 0.4 * R.next()})`;
      g.beginPath();
      g.ellipse(x, y, 3 + R.next() * 7, 2 + R.next() * 5, R.next() * Math.PI, 0, Math.PI * 2);
      g.fill();
    }
    for (let i = 0; i < 260; i++) {
      g.fillStyle = `rgba(70,60,40,${0.04 + 0.06 * R.next()})`;
      g.fillRect(R.next() * W, R.next() * H, 1 + R.next() * 3, 1 + R.next() * 2);
    }
  } else {
    // ∞: чёрный лак, золотая кайма и надпись
    g.fillStyle = '#9a7a33';
    g.fillRect(0, 0, W, H);
    const bg = g.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#1c1915');
    bg.addColorStop(1, '#0e0c0a');
    g.fillStyle = bg;
    roundRect(g, B, B, W - 2 * B, H - 2 * B, H * 0.1);
    g.fill();
    const gold = g.createLinearGradient(0, H * 0.2, 0, H * 0.85);
    gold.addColorStop(0, '#f4dc8e');
    gold.addColorStop(0.45, '#c9a046');
    gold.addColorStop(1, '#8a6624');
    g.strokeStyle = gold;
    g.lineWidth = Math.max(2, H * 0.025);
    roundRect(g, B * 1.9, B * 1.9, W - 3.8 * B, H - 3.8 * B, H * 0.07);
    g.stroke();
    // уголки-завитки
    for (const [x, y] of [[B * 3.2, B * 3.2], [W - B * 3.2, B * 3.2], [B * 3.2, H - B * 3.2], [W - B * 3.2, H - B * 3.2]]) {
      g.fillStyle = gold;
      g.beginPath();
      g.arc(x, y, H * 0.03, 0, Math.PI * 2);
      g.fill();
    }
    const [inf0, rest] = [text.slice(0, 1), text.slice(1)];
    const fsInf = Math.round(H * 0.72), fs = Math.round(H * 0.5);
    g.textBaseline = 'middle';
    g.font = `${fsInf}px Georgia, "Times New Roman", serif`;
    const wInf = g.measureText(inf0).width;
    g.font = `bold ${fs}px Georgia, "Times New Roman", serif`;
    const wRest = g.measureText(rest).width;
    const maxW = W - B * 2 - H * 0.5;
    const k = Math.min(1, maxW / (wInf + wRest + H * 0.04));
    g.save();
    g.translate(W / 2, H / 2 + H * 0.03);
    g.scale(k, 1);
    const x0 = -(wInf + wRest + H * 0.04) / 2;
    // гравировка: тёмная тень, потом золото
    for (const [dx, col] of [[2, 'rgba(0,0,0,0.85)'], [0, gold]] as const) {
      g.fillStyle = col;
      g.textAlign = 'left';
      g.font = `${fsInf}px Georgia, "Times New Roman", serif`;
      g.fillText(inf0, x0 + dx, dx - H * 0.02);
      g.font = `bold ${fs}px Georgia, "Times New Roman", serif`;
      g.fillText(rest, x0 + wInf + H * 0.04 + dx, dx);
    }
    g.restore();
    // царапины лака
    for (let i = 0; i < 14; i++) {
      g.strokeStyle = `rgba(200,190,160,${0.05 + 0.08 * R.next()})`;
      g.lineWidth = 1;
      g.beginPath();
      const x = R.next() * W, y = R.next() * H;
      g.moveTo(x, y);
      g.lineTo(x + (R.next() - 0.5) * 60, y + (R.next() - 0.5) * 14);
      g.stroke();
    }
  }
  return { tex: finishTex(`dorm:plate:${text}`, c, scene), side: [2 / W, 0.5] };
}

const HAND_FONT = '"Segoe Print", "Segoe Script", "Ink Free", "Comic Sans MS", "Marck Script", "Caveat", cursive';

/** Листок в клетку с текстом записки синими чернилами (на модели — мелко, читается в оверлее). */
function noteTexture(scene: Scene, text: string, key: string): DynamicTexture {
  const W = 384, H = 480;
  const [c, g] = canvas(W, H);
  const R = makeRng(`note/${key}`);
  g.fillStyle = '#efebdd';
  g.fillRect(0, 0, W, H);
  // клетка 5 мм ≈ 12 px
  g.strokeStyle = 'rgba(120,150,195,0.55)';
  g.lineWidth = 1;
  for (let x = 6; x < W; x += 12) (g.beginPath(), g.moveTo(x + 0.5, 0), g.lineTo(x + 0.5, H), g.stroke());
  for (let y = 6; y < H; y += 12) (g.beginPath(), g.moveTo(0, y + 0.5), g.lineTo(W, y + 0.5), g.stroke());
  // поля
  g.strokeStyle = 'rgba(205,80,80,0.55)';
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(W - 42, 0);
  g.lineTo(W - 42, H);
  g.stroke();
  // рваный край слева (вырван из тетради)
  g.fillStyle = 'rgba(0,0,0,0)';
  g.globalCompositeOperation = 'destination-out';
  for (let y = 0; y < H; y += 6) g.fillRect(0, y, 2 + R.next() * 5, 6);
  g.globalCompositeOperation = 'source-over';
  // сгиб пополам и желтизна по краям
  const fold = g.createLinearGradient(0, H / 2 - 14, 0, H / 2 + 14);
  fold.addColorStop(0, 'rgba(0,0,0,0)');
  fold.addColorStop(0.5, 'rgba(60,50,30,0.16)');
  fold.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = fold;
  g.fillRect(0, H / 2 - 14, W, 28);
  const edge = g.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, H * 0.75);
  edge.addColorStop(0, 'rgba(160,130,70,0)');
  edge.addColorStop(1, 'rgba(160,130,70,0.28)');
  g.fillStyle = edge;
  g.fillRect(0, 0, W, H);
  // текст: синие чернила, наклон, по строкам клетки (2 клетки)
  const { main, alt } = noteParts(text);
  g.save();
  g.transform(1, 0, -0.16, 1, 30, 0);
  const lines = (s: string, font: string, maxW: number): string[] => {
    g.font = font;
    const out: string[] = [];
    let cur = '';
    for (const w of s.split(/\s+/)) {
      const t = cur ? `${cur} ${w}` : w;
      if (g.measureText(t).width > maxW && cur) (out.push(cur), (cur = w));
      else cur = t;
    }
    if (cur) out.push(cur);
    return out;
  };
  let y = 54;
  const f1 = `30px ${HAND_FONT}`;
  g.fillStyle = '#23379a';
  for (const l of lines(main, f1, W - 110)) {
    g.font = f1;
    g.fillText(l, 24 + (R.next() - 0.5) * 4, y + (R.next() - 0.5) * 3);
    y += 36;
  }
  if (alt) {
    y += 18;
    const f2 = `27px ${HAND_FONT}`;
    g.fillStyle = 'rgba(70,64,58,0.9)';
    for (const l of lines(alt, f2, W - 120)) {
      g.font = f2;
      g.fillText(l, 40, y);
      y += 34;
    }
  }
  g.restore();
  const t = finishTex(`dorm:note:${key}`, c, scene);
  t.hasAlpha = true;
  return t;
}

// ───────────────────────── меши ─────────────────────────

type V3 = [number, number, number];

/** Табличка — брусок w × h × d с центром в начале: лицо (z = face·d/2) с текстурой (читается снаружи), остальное —
 *  цвет каймы (точка текстуры side). Нормали заданы (свет — независимо от обхода), без отсечения задних граней. */
function plateMesh(scene: Scene, name: string, w: number, h: number, d: number, face: 1 | -1, side: [number, number]): Mesh {
  const pos: number[] = [], nrm: number[] = [], uv: number[] = [], idx: number[] = [];
  const quad = (p: V3[], n: V3, t: [number, number][]) => {
    const k = pos.length / 3;
    p.forEach((q, i) => (pos.push(...q), nrm.push(...n), uv.push(...t[i])));
    idx.push(k, k + 1, k + 2, k, k + 2, k + 3);
  };
  const x = w / 2, y = h / 2, z = d / 2;
  const s4: [number, number][] = [side, side, side, side];
  // лицо: смотрящему снаружи вправо — к −x при face +1 (левая система Babylon), к +x при face −1
  const u = (px: number) => (face > 0 ? 0.5 - px / w : 0.5 + px / w);
  const zf = face * z;
  quad([[-x, -y, zf], [x, -y, zf], [x, y, zf], [-x, y, zf]], [0, 0, face], [[u(-x), 0], [u(x), 0], [u(x), 1], [u(-x), 1]]);
  quad([[-x, -y, -zf], [x, -y, -zf], [x, y, -zf], [-x, y, -zf]], [0, 0, -face], s4);
  quad([[-x, y, -z], [x, y, -z], [x, y, z], [-x, y, z]], [0, 1, 0], s4);
  quad([[-x, -y, -z], [x, -y, -z], [x, -y, z], [-x, -y, z]], [0, -1, 0], s4);
  quad([[x, -y, -z], [x, y, -z], [x, y, z], [x, -y, z]], [1, 0, 0], s4);
  quad([[-x, -y, -z], [-x, y, -z], [-x, y, z], [-x, -y, z]], [-1, 0, 0], s4);
  const vd = new VertexData();
  vd.positions = pos;
  vd.normals = nrm;
  vd.uvs = uv;
  vd.indices = idx;
  const m = new Mesh(name, scene);
  vd.applyToMesh(m, false);
  return m;
}

/** Листок: прямоугольник w × l в плоскости XZ (нормаль +y), верх текста — к +z; чуть выгнут вдоль сгиба. */
function noteMesh(scene: Scene, name: string, w: number, l: number): Mesh {
  const pos: number[] = [], nrm: number[] = [], uv: number[] = [], idx: number[] = [];
  const NX = 2, NZ = 4;
  for (let j = 0; j <= NZ; j++) {
    for (let i = 0; i <= NX; i++) {
      const u = i / NX, v = j / NZ;
      // сгиб посередине — чуть приподнят, края листа — на поверхности
      const lift = 0.004 * (1 - Math.abs(v - 0.5) * 2);
      pos.push((u - 0.5) * w, lift, (v - 0.5) * l);
      nrm.push(0, 1, 0);
      uv.push(u, v);
    }
  }
  for (let j = 0; j < NZ; j++) {
    for (let i = 0; i < NX; i++) {
      const a = j * (NX + 1) + i, b = a + 1, c = a + NX + 1, d = c + 1;
      idx.push(a, c, d, a, d, b);
    }
  }
  const vd = new VertexData();
  vd.positions = pos;
  vd.normals = nrm;
  vd.uvs = uv;
  vd.indices = idx;
  const m = new Mesh(name, scene);
  vd.applyToMesh(m, false);
  return m;
}

function portalMesh(m: Mesh) {
  m.layerMask = PORTAL_LAYER;
  m.isPickable = false;
  m.checkCollisions = false;
  m.receiveShadows = false;
}

// ───────────────────────── звук замка ─────────────────────────

/** Щелчок замка: ключ входит (шорох), поворот — два щелчка сувальд и глухой ход ригеля. WebAudio-синтез. */
class LockAudio {
  private ctx: AudioContext | null = null;
  private noise: AudioBuffer | null = null;

  play(gain = 0.5) {
    try {
      const C = (window as unknown as { AudioContext?: typeof AudioContext }).AudioContext;
      if (!C) return;
      const ctx = (this.ctx ??= new C());
      if (ctx.state === 'suspended') void ctx.resume().catch(() => {});
      if (!this.noise) {
        const b = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
        const d = b.getChannelData(0);
        const R = makeRng('lock-noise');
        for (let i = 0; i < d.length; i++) d[i] = R.next() * 2 - 1;
        this.noise = b;
      }
      const out = ctx.createGain();
      out.gain.value = gain;
      out.connect(ctx.destination);
      const t0 = ctx.currentTime + 0.01;
      const burst = (at: number, dur: number, type: BiquadFilterType, f: number, q: number, g: number) => {
        const s = ctx.createBufferSource();
        s.buffer = this.noise;
        const fl = ctx.createBiquadFilter();
        fl.type = type;
        fl.frequency.value = f;
        fl.Q.value = q;
        const e = ctx.createGain();
        e.gain.setValueAtTime(0, t0 + at);
        e.gain.linearRampToValueAtTime(g, t0 + at + Math.min(0.004, dur / 4));
        e.gain.exponentialRampToValueAtTime(0.0008, t0 + at + dur);
        s.connect(fl).connect(e).connect(out);
        s.start(t0 + at, Math.random() * 0.5);
        s.stop(t0 + at + dur + 0.02);
      };
      const tone = (at: number, dur: number, f0: number, f1: number, g: number, type: OscillatorType = 'triangle') => {
        const o = ctx.createOscillator();
        o.type = type;
        o.frequency.setValueAtTime(f0, t0 + at);
        o.frequency.exponentialRampToValueAtTime(f1, t0 + at + dur);
        const e = ctx.createGain();
        e.gain.setValueAtTime(0, t0 + at);
        e.gain.linearRampToValueAtTime(g, t0 + at + 0.002);
        e.gain.exponentialRampToValueAtTime(0.0008, t0 + at + dur);
        o.connect(e).connect(out);
        o.start(t0 + at);
        o.stop(t0 + at + dur + 0.02);
      };
      // ключ входит в скважину: шорох металла
      burst(0, 0.16, 'bandpass', 3800, 2.5, 0.12);
      burst(0.05, 0.09, 'highpass', 5200, 0.8, 0.06);
      // поворот: щелчки сувальд
      burst(0.24, 0.018, 'bandpass', 2600, 6, 0.5);
      tone(0.241, 0.03, 1900, 1500, 0.12);
      burst(0.34, 0.015, 'bandpass', 3100, 6, 0.35);
      // ригель уходит: глухой стук
      tone(0.44, 0.09, 190, 95, 0.4, 'sine');
      burst(0.44, 0.07, 'lowpass', 700, 0.8, 0.45);
      burst(0.445, 0.012, 'bandpass', 2200, 4, 0.3);
    } catch {}
  }

  dispose() {
    void this.ctx?.close().catch(() => {});
    this.ctx = null;
  }
}

// ───────────────────────── DOM: подсказка и листок ─────────────────────────

const CSS_ID = 'rf-dorm-note-css';
const CSS = `
.rf-dnote { position: absolute; inset: 0; z-index: 8; display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 16px; pointer-events: none; background: radial-gradient(ellipse at center, #0a0806b0 0%, #000000e0 78%); animation: rf-dnote-in .28s ease-out; }
@keyframes rf-dnote-in { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
.rf-dnote-sheet { position: relative; width: min(470px, 82vw); min-height: 320px; box-sizing: border-box; padding: 44px 64px 46px 34px;
  background-color: #f1ede0;
  background-image: linear-gradient(#7f9fcf4d 1px, transparent 1px), linear-gradient(90deg, #7f9fcf4d 1px, transparent 1px),
    radial-gradient(ellipse at 50% 50%, transparent 55%, #b39a6247 100%), linear-gradient(180deg, transparent 49%, #5a4a2a1c 50%, transparent 51%);
  background-size: 18px 18px, 18px 18px, 100% 100%, 100% 100%; background-position: -1px -1px, -1px -1px, 0 0, 0 0;
  box-shadow: 0 18px 50px #000c, 0 2px 0 #0004; transform: rotate(-1.8deg);
  clip-path: polygon(0 1.2%, 3% 0.4%, 7% 1.4%, 12% 0.2%, 18% 1.1%, 24% 0.3%, 31% 1.3%, 38% 0.5%, 45% 1.2%, 53% 0.2%, 60% 1%,
    68% 0.4%, 76% 1.3%, 84% 0.3%, 91% 1.1%, 100% 0.4%, 100% 100%, 0 100%); }
.rf-dnote-sheet::after { content: ''; position: absolute; top: 0; bottom: 0; right: 44px; width: 2px; background: #cf5a5a80; }
.rf-dnote-text { position: relative; font-family: ${HAND_FONT}; font-size: 21px; line-height: 36px; color: #1f3493;
  transform: skewX(-8deg) rotate(-0.6deg); transform-origin: 0 0; white-space: pre-wrap; text-shadow: 0 0 1px #1f349355; }
.rf-dnote-text b { font-weight: 600; text-decoration: underline; text-decoration-thickness: 2px; text-underline-offset: 5px; }
.rf-dnote-alt { display: block; margin-top: 22px; padding-left: 26px; color: #4a4038; font-size: 19px; transform: rotate(2.2deg) skewX(-3deg); opacity: .9; }
.rf-dnote-hint { font-family: var(--mono, monospace); font-size: 12px; letter-spacing: .05em; color: #cbbd9f; text-shadow: 0 1px 2px #000; }
`;

function ensureCss() {
  if (typeof document === 'undefined' || document.getElementById(CSS_ID)) return;
  const s = document.createElement('style');
  s.id = CSS_ID;
  s.textContent = CSS;
  document.head.appendChild(s);
}

/** Текст с выделенным номером (6 цифр) — узлы DOM (без innerHTML). */
function richText(el: HTMLElement, s: string) {
  const re = /\d{6}/g;
  let at = 0;
  for (let m = re.exec(s); m; m = re.exec(s)) {
    if (m.index > at) el.appendChild(document.createTextNode(s.slice(at, m.index)));
    const b = document.createElement('b');
    b.textContent = m[0];
    el.appendChild(b);
    at = m.index + m[0].length;
  }
  if (at < s.length) el.appendChild(document.createTextNode(s.slice(at)));
}

const typing = (e: Event): boolean => {
  const t = e.target as HTMLElement | null;
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
};

// ───────────────────────── контроллер ─────────────────────────

interface Plate {
  mesh: Mesh;
  mat: StandardMaterial;
  tex: DynamicTexture;
  text: string;
  face: 1 | -1;
  used: number;
}

interface Note {
  inst: string;
  text: string;
  mesh: Mesh;
  mat: StandardMaterial;
  tex: DynamicTexture;
  /** точка листка (Babylon); высота — лучом по мебели куска piece */
  at: Vector3 | null;
  /** кусок, по которому уточнена высота (пересобран — модели мебели догрузились — заново); null — без куска */
  piece: object | null;
  used: number;
}

export class ObshagaRoomsView {
  private obs: Observer<Scene> | null;
  private plates = new Map<string, Plate>();
  private notes = new Map<string, Note>();
  private extrasBy = new Map<string, Mesh[]>();
  private extrasOf: PortalRenderer | null = null;
  private metaCache: { rx: RunExport; frame: number; map: Map<string, DormMeta> } | null = null;
  private pending = new Set<string>();
  private target: Note | null = null;
  private reading: { note: Note; el: HTMLDivElement } | null = null;
  private prompt: HTMLDivElement | null = null;
  private promptOn = false;
  private gcAt = 0;
  private readonly lock = new LockAudio();
  private disposed = false;

  constructor(
    readonly scene: Scene,
    readonly obsh: ObshagaWalk,
    readonly deps: ObshagaRoomsDeps,
  ) {
    obsh.hooks.locked.push(this.lockedHook);
    obsh.hooks.prompt.push(this.promptHook);
    obsh.hooks.doorKey.push(this.keyHook);
    this.obs = scene.onBeforeRenderObservable.add(() => this.frame());
    if (typeof window !== 'undefined') {
      window.addEventListener('keydown', this.onKey, true);
      document.addEventListener('pointerlockchange', this.onLock);
      if (import.meta.env?.DEV) (window as unknown as { __rfDorm?: unknown }).__rfDorm = this.qa(); // для QA-скриптов
    }
  }

  // ───────────────────────── данные ─────────────────────────

  /** Метаданные жилых комнат мира (dormIndex — свой кэш; здесь — ещё и на кадр: JSON ручек не считать на каждый крючок). */
  private metas(): Map<string, DormMeta> | null {
    const rx = this.deps.session()?.rx;
    if (!rx) return null;
    const f = this.scene.getFrameId();
    const c = this.metaCache;
    if (c && c.rx === rx && c.frame === f) return c.map;
    const map = dormIndex(rx);
    this.metaCache = { rx, frame: f, map };
    return map;
  }

  /** Заперта ли дверь замком DORM сейчас (без флага «отперта»): дверь и комната или null. */
  private lockOf(id: string): { door: ObshDoor; meta: DormMeta } | null {
    const nav = this.obsh.nav();
    const metas = this.metas();
    if (!nav || !metas) return null;
    const dm = dormDoor(nav, metas, id);
    if (!dm?.meta.locked) return null;
    return this.deps.session()?.world.flag(unlockFlag(id)) ? null : dm;
  }

  private hasKey(): boolean {
    const inv = this.deps.inv();
    return !!inv && count(inv.hotbar, KEY_ITEM) > 0;
  }

  /** Забрать один ключ (из хотбара или сумки: сперва из меньших стеков, сумка — раньше хотбара). */
  private takeKey(): boolean {
    const inv = this.deps.inv();
    if (!inv) return false;
    const h = consume(inv.hotbar, KEY_ITEM, 1);
    if (!h) return false;
    // ROOMSVIEW-NEEDS: нет публичного Inventory.take(item) — хотбар целиком (пишется в localStorage сразу, HUD — тоже)
    inv.qa().setHotbar(h);
    return true;
  }

  // ───────────────────────── крючки ObshagaWalk ─────────────────────────

  private lockedHook = (id: string): string | null => (this.lockOf(id) ? 'Заперто. Нужен ключ' : null);

  private promptHook = (id: string): string | null => {
    const L = this.lockOf(id);
    if (!L) return null;
    const act = lockAct(L.meta, false, this.obsh.room() === L.door.room, this.hasKey());
    return act === 'inside' ? 'E — отпереть изнутри' : act === 'key' ? 'E — отпереть ключом' : null;
  };

  private keyHook = (id: string): boolean => {
    const L = this.lockOf(id);
    if (!L) return false;
    if (this.pending.has(id)) return true;
    const act = lockAct(L.meta, false, this.obsh.room() === L.door.room, this.hasKey());
    if (act === 'locked' || act === 'open') return false; // заперта без ключа — звук и «Заперто. Нужен ключ» у общаги
    if (act === 'key' && !this.takeKey()) return false;
    this.pending.add(id);
    void this.unlock(L.door, act === 'key');
    return true;
  };

  /** Отпереть: флаг мира (кооп — через журнал лобби), щелчок замка, дверь распахивается. Не вышло — ключ назад. */
  private async unlock(d: ObshDoor, usedKey: boolean) {
    const s = this.deps.session();
    const flag = unlockFlag(d.id);
    let r: string | null = null;
    try {
      r = s ? await s.request({ k: 'flag', id: flag }) : null;
    } catch {
      r = null;
    }
    this.pending.delete(d.id);
    if (this.disposed) return;
    const done = !!r || !!s?.world.flag(flag);
    // кто-то отпер раньше (или не вышло) — ключ не потрачен
    if (usedKey && !r) this.deps.inv()?.receive({ item: KEY_ITEM });
    if (!done) {
      this.deps.flash('Замок не поддаётся', C_WARN, 1100);
      return;
    }
    this.lock.play(usedKey ? 0.55 : 0.4);
    this.deps.flash(!r ? 'Уже отперто' : usedKey ? 'Отперто ключом' : 'Отперто изнутри', C_KEY, 1200);
    // повернул ключ — толкнул дверь (если ещё рядом)
    setTimeout(() => {
      if (this.disposed || !this.obsh.inside()) return;
      const c = this.scene.activeCamera?.globalPosition;
      if (c && Math.hypot(c.x - d.x, -c.z - d.y) < 2.2) this.obsh.openDoor(d.id);
    }, 520);
  }

  // ───────────────────────── кадр ─────────────────────────

  private frame() {
    if (this.disposed) return;
    const now = performance.now();
    const portal = this.obsh.portal();
    this.ensureExtras(portal);
    this.extrasBy.clear();
    this.target = null;
    const rx = this.deps.session()?.rx ?? null;
    const nav = this.obsh.nav();
    const metas = this.metas();
    if (!rx || !nav || !metas || !portal || !this.obsh.inside()) {
      this.showPrompt(false);
      if (this.reading) this.closeNote();
      this.gc(now);
      return;
    }
    const cur = this.obsh.room();
    const rooms = new Set(portal.lastRooms);
    if (cur) rooms.add(cur);
    for (const room of rooms) {
      const meta = metas.get(room);
      if (!meta) continue;
      if (meta.plate) for (const d of doorsOfDorm(nav, room)) this.plateFrame(d, meta.plate, portal, now);
      if (meta.note != null) this.noteFrame(meta, nav, portal, now);
    }
    this.aim(nav, cur);
    this.gc(now);
  }

  private put(room: string, m: Mesh) {
    const l = this.extrasBy.get(room);
    if (l) l.push(m);
    else this.extrasBy.set(room, [m]);
  }

  private extrasFn = (room: string): readonly Mesh[] | undefined => this.extrasBy.get(room);

  private ensureExtras(portal: PortalRenderer | null) {
    if (portal === this.extrasOf) return;
    this.extrasOf?.extraProviders.delete(this.extrasFn);
    this.extrasOf = portal;
    portal?.extraProviders.add(this.extrasFn);
  }

  /** Табличка двери d: поза — по полотну куска комнаты (петли, поворот), рисуется в комнате полотна. */
  private plateFrame(d: ObshDoor, text: string, portal: PortalRenderer, now: number) {
    const dm = portal.cache.peek(d.inst)?.bo.doorLeaves.get(d.id);
    const lf = dm?.leaves[0];
    if (!dm || !lf || !lf.mesh.isEnabled()) return;
    const loc = plateLocal(lf.geo, dm.style.thick, doorFlip(dm.slot.tag ?? ''));
    let p = this.plates.get(d.id);
    if (p && (p.text !== text || p.face !== loc.face)) {
      this.dropPlate(d.id, p);
      p = undefined;
    }
    if (!p) p = this.makePlate(d.id, text, loc.face);
    p.used = now;
    const R = lf.mesh.rotation.y;
    const m = p.mesh;
    Vector3.TransformCoordinatesFromFloatsToRef(loc.x, loc.y, loc.z, Matrix.RotationY(R), m.position);
    m.position.addInPlace(lf.mesh.position);
    m.rotation.set(0, R, 0);
    m.computeWorldMatrix(true);
    this.put(d.inst, m);
  }

  private makePlate(id: string, text: string, face: 1 | -1): Plate {
    const { w, h } = plateSize(text);
    const { tex, side } = plateTexture(this.scene, text, w, h);
    const mat = new StandardMaterial(`dorm:plate:${id}`, this.scene);
    mat.diffuseTexture = tex;
    mat.backFaceCulling = false;
    const inf = text.startsWith('∞');
    // эмаль блестит; ∞ — золото и лак
    mat.specularColor = inf ? new Color3(0.55, 0.45, 0.25) : new Color3(0.22, 0.22, 0.22);
    mat.specularPower = inf ? 48 : 64;
    const mesh = plateMesh(this.scene, `dorm:plate:${id}`, w, h, PLATE_D, face, side);
    mesh.material = mat;
    portalMesh(mesh);
    const p: Plate = { mesh, mat, tex, text, face, used: 0 };
    this.plates.set(id, p);
    return p;
  }

  private dropPlate(id: string, p: Plate) {
    this.plates.delete(id);
    p.mesh.dispose(false, false);
    p.mat.dispose(false, false);
    p.tex.dispose();
  }

  /** Записка комнаты: листок на мебели (луч по моделям куска), рисуется в своей комнате. */
  private noteFrame(meta: DormMeta, nav: ObshNav, portal: PortalRenderer, now: number) {
    const text = noteText(meta);
    if (!text) return;
    let n = this.notes.get(meta.inst);
    if (n && n.text !== text) {
      this.dropNote(n);
      n = undefined;
    }
    if (!n) n = this.makeNote(meta.inst, text);
    n.used = now;
    const piece = portal.cache.peek(meta.inst) ?? null;
    if (!n.at || n.piece !== piece) this.placeNote(n, nav, piece);
    if (!n.at) return;
    this.put(meta.inst, n.mesh);
  }

  private makeNote(inst: string, text: string): Note {
    const tex = noteTexture(this.scene, text, inst);
    const mat = new StandardMaterial(`dorm:note:${inst}`, this.scene);
    mat.diffuseTexture = tex;
    mat.useAlphaFromDiffuseTexture = false;
    mat.backFaceCulling = false;
    mat.specularColor = new Color3(0.04, 0.04, 0.04);
    const mesh = noteMesh(this.scene, `dorm:note:${inst}`, NOTE_W, NOTE_L);
    mesh.material = mat;
    portalMesh(mesh);
    const n: Note = { inst, text, mesh, mat, tex, at: null, piece: null, used: 0 };
    this.notes.set(inst, n);
    return n;
  }

  private dropNote(n: Note) {
    if (this.reading?.note === n) this.closeNote();
    this.notes.delete(n.inst);
    n.mesh.dispose(false, false);
    n.mat.dispose(false, false);
    n.tex.dispose();
  }

  /** Место листка: notePlace (мебель по плану), высота — лучом сверху по моделям мебели куска (есть кусок), иначе —
   *  высота болванки. */
  private placeNote(n: Note, nav: ObshNav, piece: PortalPiece | null) {
    const room = nav.rooms.get(n.inst);
    if (!room) return;
    const pl = notePlace(room, doorsOfDorm(nav, n.inst));
    let y = room.z + pl.h;
    if (piece && pl.on !== 'floor') {
      const ray = new Ray(new Vector3(pl.x, room.z + 1.6, -pl.y), new Vector3(0, -1, 0), 1.6);
      let best = -Infinity;
      const test = (m: Mesh) => {
        if (!m.isEnabled() || !m.isVisible || !m.subMeshes?.length) return;
        const hit = ray.intersectsMesh(m, false);
        const py = hit.hit ? hit.pickedPoint?.y : undefined;
        if (py !== undefined && py > room.z + 0.12 && py < room.z + 1.4 && py > best) best = py;
      };
      for (const m of piece.meshes) {
        if (!/^prop/.test(m.name)) continue;
        test(m);
        for (const c of m.getChildMeshes(false)) test(c as Mesh);
      }
      if (best > -Infinity) y = best;
    }
    const m = n.mesh;
    m.position.set(pl.x, y + 0.003, -pl.y);
    m.rotation.set(0, pl.yaw, 0);
    m.computeWorldMatrix(true);
    n.at = m.position.clone();
    n.piece = piece;
  }

  /** Записка под взглядом своего игрока: в своей комнате, рядом и в конусе взгляда; дверь рядом или предмет под
   *  взглядом — не она. */
  private aim(nav: ObshNav, cur: string | null) {
    if (this.reading) {
      const c = this.scene.activeCamera?.globalPosition;
      const at = this.reading.note.at;
      if (!c || !at || cur !== this.reading.note.inst || Vector3.Distance(c, at) > 2.4 || !this.deps.live()) this.closeNote();
      this.showPrompt(false);
      return;
    }
    const n = cur ? this.notes.get(cur) : undefined;
    const cam = this.scene.activeCamera;
    let ok = false;
    if (n?.at && cam && this.deps.live() && !this.deps.inv()?.aimed) {
      const eye = cam.globalPosition;
      const fwd = cam.getDirection(Vector3.Forward());
      ok = noteAimed(eye, fwd, n.at) && !this.doorNear(nav, cur!, eye);
    }
    this.target = ok ? n! : null;
    this.showPrompt(ok);
  }

  /** Дверь или лампа на споте ближе NEAR_DOOR (у них своя подсказка и E) — как ObshagaWalk.prompts. */
  private doorNear(nav: ObshNav, room: string, eye: Vector3): boolean {
    const feet = eye.y - this.obsh.posture.eye;
    const rooms = [room, ...(nav.rooms.get(room)?.edges.map((e) => e.to) ?? [])];
    for (const l of nav.lamps) if (rooms.includes(l.inst) && Math.abs(feet - l.z) <= 1.2 && Math.hypot(eye.x - l.x, -eye.z - l.y) < NEAR_DOOR) return true;
    for (const r of rooms) {
      for (const d of nav.doorsByRoom.get(r) ?? []) {
        if (Math.abs(feet - d.z) > 1.4) continue;
        if (Math.hypot(eye.x - d.x, -eye.z - d.y) < NEAR_DOOR) return true;
      }
    }
    return false;
  }

  private gc(now: number) {
    if (now - this.gcAt < 2000) return;
    this.gcAt = now;
    const old = <T extends { used: number }>(m: Map<string, T>, max: number): [string, T][] => {
      const all = [...m].sort((a, b) => a[1].used - b[1].used);
      return all.filter(([, v], i) => now - v.used > IDLE_MS || all.length - i > max);
    };
    for (const [id, p] of old(this.plates, PLATES_MAX)) this.dropPlate(id, p);
    for (const [, n] of old(this.notes, NOTES_MAX)) if (this.reading?.note !== n) this.dropNote(n);
  }

  // ───────────────────────── DOM ─────────────────────────

  private stage(): HTMLElement | null {
    return (this.scene.getEngine().getRenderingCanvas?.() as HTMLCanvasElement | null)?.parentElement ?? null;
  }

  private showPrompt(on: boolean) {
    if (on === this.promptOn) return;
    this.promptOn = on;
    if (on && !this.prompt) {
      const st = this.stage();
      if (!st) return;
      const el = (this.prompt = document.createElement('div'));
      el.className = 'float hud v3-lift-prompt';
      el.textContent = 'E — прочитать записку';
      st.appendChild(el);
    }
    if (this.prompt) this.prompt.style.display = on ? '' : 'none';
  }

  private openNote(n: Note) {
    if (this.reading) return;
    const st = this.stage();
    if (!st) return;
    ensureCss();
    const el = document.createElement('div');
    el.className = 'rf-dnote';
    const sheet = document.createElement('div');
    sheet.className = 'rf-dnote-sheet';
    const tx = document.createElement('div');
    tx.className = 'rf-dnote-text';
    const { main, alt } = noteParts(n.text);
    richText(tx, main);
    if (alt) {
      const a = document.createElement('span');
      a.className = 'rf-dnote-alt';
      richText(a, alt);
      tx.appendChild(a);
    }
    sheet.appendChild(tx);
    // наклон листка — свой у каждой записки
    sheet.style.transform = `rotate(${(((hashSeed(n.inst) % 100) / 100) * 4 - 2).toFixed(2)}deg)`;
    const hint = document.createElement('div');
    hint.className = 'rf-dnote-hint';
    hint.textContent = 'E / Esc — закрыть';
    el.append(sheet, hint);
    st.appendChild(el);
    this.reading = { note: n, el };
    this.showPrompt(false);
  }

  private closeNote() {
    const r = this.reading;
    if (!r) return;
    this.reading = null;
    r.el.remove();
  }

  // ───────────────────────── ввод ─────────────────────────

  /** E — раньше двери и лампы (фаза захвата), только когда записка под взглядом или листок открыт. */
  private onKey = (e: KeyboardEvent) => {
    if (this.disposed) return;
    if (this.reading) {
      if (e.code === 'KeyE' || e.code === 'Escape') {
        e.stopImmediatePropagation();
        e.preventDefault();
        if (!e.repeat) this.closeNote();
      }
      return;
    }
    if (e.code !== 'KeyE' || e.repeat || e.ctrlKey || e.metaKey || e.altKey || typing(e)) return;
    const n = this.target;
    if (!n || !this.deps.live() || this.deps.inv()?.aimed) return;
    e.stopImmediatePropagation();
    e.preventDefault();
    this.openNote(n);
  };

  /** Мышь отпущена (Esc в захвате не доходит до страницы) — листок закрыть. */
  private onLock = () => {
    if (this.reading && !document.pointerLockElement) this.closeNote();
  };

  // ───────────────────────── QA ─────────────────────────

  /** Хуки для браузерных проверок (window.__rfDorm). */
  qa() {
    const self = this;
    return {
      /** жилые двери мира: номер, вид, заперта ли и отперта ли, записка, ключ */
      doors() {
        const nav = self.obsh.nav();
        const metas = self.metas();
        const w = self.deps.session()?.world;
        if (!nav || !metas) return [];
        const out = [];
        for (const d of nav.doors) {
          const dm = dormDoor(nav, metas, d.id);
          if (!dm) continue;
          const m = dm.meta;
          out.push({
            id: d.id, cor: d.cor, room: d.room, x: d.x, y: d.y, nx: d.nx, ny: d.ny, z: d.z, k: m.k, loc: m.loc, kind: m.kind,
            plate: m.plate, tier: m.tier, locked: m.locked, unlocked: !!w?.flag(unlockFlag(d.id)), note: m.note, key: m.key,
          });
        }
        return out;
      },
      meta(inst: string) {
        return self.metas()?.get(inst) ?? null;
      },
      /** ключи в руках: дать n (как подобрал) / сколько */
      giveKey(n = 1) {
        return self.deps.inv()?.qa().give(n > 1 ? { item: KEY_ITEM, n } : { item: KEY_ITEM }) ?? false;
      },
      keys() {
        const inv = self.deps.inv();
        return inv ? count(inv.hotbar, KEY_ITEM) : 0;
      },
      /** таблички и записки, что сейчас рисуются (по комнатам) */
      state() {
        return {
          plates: [...self.plates].map(([id, p]) => ({ id, text: p.text, face: p.face, pos: p.mesh.position.asArray().map((v) => +v.toFixed(3)) })),
          notes: [...self.notes.values()].map((n) => ({ inst: n.inst, at: n.at?.asArray().map((v) => +v.toFixed(3)) ?? null, piece: !!n.piece })),
          extras: Object.fromEntries([...self.extrasBy].map(([r, l]) => [r, l.map((m) => m.name)])),
          target: self.target?.inst ?? null,
          reading: self.reading?.note.inst ?? null,
          prompt: self.promptOn,
          pending: [...self.pending],
        };
      },
      /** точка записки комнаты (Babylon) — после того как комнату нарисовали */
      noteAt(inst: string) {
        return self.notes.get(inst)?.at?.asArray() ?? null;
      },
      closeNote() {
        self.closeNote();
      },
    };
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    const rm = <T>(l: T[], f: T) => {
      const i = l.indexOf(f);
      if (i >= 0) l.splice(i, 1);
    };
    rm(this.obsh.hooks.locked, this.lockedHook);
    rm(this.obsh.hooks.prompt, this.promptHook);
    rm(this.obsh.hooks.doorKey, this.keyHook);
    if (this.obs) this.scene.onBeforeRenderObservable.remove(this.obs);
    this.obs = null;
    this.extrasOf?.extraProviders.delete(this.extrasFn);
    this.extrasOf = null;
    if (typeof window !== 'undefined') {
      window.removeEventListener('keydown', this.onKey, true);
      document.removeEventListener('pointerlockchange', this.onLock);
    }
    this.closeNote();
    this.prompt?.remove();
    this.prompt = null;
    for (const [id, p] of [...this.plates]) this.dropPlate(id, p);
    for (const n of [...this.notes.values()]) this.dropNote(n);
    this.lock.dispose();
  }
}
