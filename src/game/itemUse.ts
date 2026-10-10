// Поведение предметов в руке «Прогулки» — чистая логика, без Babylon, DOM и localStorage (тесты — itemUse.test.ts).
// Состояние, которое живёт в сохранении, — в ячейке хотбара (src/game/hotbar.ts: on/n/q/w/u); мгновенное — горящая
// спичка, качание «Жучка», часы руки — в HandTr (держит слой вида, в мир и в сохранение не уходит).
//  • П-2 (it_flashlight): q — заряд батареек (каждая — 5 мин; в тубусе 2, с удлинением — 3: полный q = 10 / 15 мин);
//    яркость по среднему заряду, ниже 12 % мигает; лампочка w копит износ, пока горит (15 мин) → 'burnout', гаснет.
//    R — лампочка (перегорела и есть запасная), иначе батарейки (2 / 3 штуки → q = 1). ЛКМ с удлинением тубуса — апгрейд.
//  • «Жучок» (it_bug_flash): F — качнуть: +2 с света (запас не больше 8 с), чем чаще жмёшь (за 3 с) — тем ярче и тем
//    дороже по стамине; шумит; после конца — гаснет за 2 с. Лампочка — 15 мин свечения, потом мёртв навсегда (w = 1).
//  • Спички: F — чиркнуть (одна из коробка): обычная — 6 с, слабый свет, гаснет на бегу и в воде; охотничья — 15 с,
//    совсем тускло, не гаснет. Горящая спичка — в HandTr; сменил ячейку — гаснет.
//  • Зиппа: керосин q (6 мин) и фитиль w (10 мин); тусклая, на ходу ещё тусклее, на бегу гаснет; пока горит — обвалы в
//    тоннелях вдвое чаще (collapseMul). Керосинка: керосин 12 мин, фитиль 20 мин, хороший круговой свет; горит, пока
//    on !== false (так её видит общага). R — керосин (канистра −0.25) и фитиль (шпонная верёвка, если фитиль ≥ 50 %).
//  • ЛКМ (useHeld): еда — съесть (эффект — src/game/effects.ts), карты — нужен напарник, сумка — надеть, остальное —
//    подсказка.
// Свет на полу: П-2 и керосинка горят и лёжа (lightOnFloor); спичка, зиппа и «Жучок» — нет. На полу ничего не тратится.
import { lootDef } from '../data/itemsLoot';
import { consume, count, findAll, held, patch, setAt, slotAt, takeOne, wear, type Hotbar, type Slot } from './hotbar';

// ───────────────────────── id предметов ─────────────────────────

export const P2 = 'it_flashlight';
export const BUG = 'it_bug_flash';
export const ZIPPO = 'it_zippo';
export const KEROLAMP = 'it_kerolamp';
export const MATCHES = 'it_matches';
export const HUNT_MATCHES = 'it_hunt_matches';
export const BATTERY = 'it_batteries';
export const BULB = 'it_bulb';
export const TUBE = 'it_tube_ext';
export const KEROSENE = 'it_kerosene';
export const WICK = 'it_wick';

// ───────────────────────── баланс ─────────────────────────

/** Самый длинный шаг логики, с (вкладка была скрыта — фонарь не садится разом). */
export const USE_MAX_DT = 0.5;
/** Заряд «полный» с этого q (меньше — R меняет батарейки / доливает керосин). */
export const FULL_Q = 0.999;

/** П-2: одна батарейка D — столько секунд света. */
export const BATTERY_S = 300;
/** П-2: батареек в тубусе; с удлинением тубуса (бит UP_TUBE в u) — P2_CELLS_TUBE. */
export const P2_CELLS = 2;
export const P2_CELLS_TUBE = 3;
/** Бит апгрейда «удлинение тубуса» в Slot.u. */
export const UP_TUBE = 1;
/** П-2: лампочка перегорает за столько секунд горения. */
export const P2_BULB_S = 900;
/** П-2: яркость = P2_MIN_B + (1 − P2_MIN_B)·q^P2_GAMMA; ниже P2_FLICKER_Q — мигает. */
export const P2_MIN_B = 0.25;
export const P2_GAMMA = 0.6;
export const P2_FLICKER_Q = 0.12;
/** П-2: дальность луча, м (при полной яркости), цвет лампы накаливания. */
export const P2_RANGE = 18;
export const P2_COLOR = '#ffe2b0';

/** «Жучок»: секунд света за нажатие, предел запаса, окно счёта частоты, затухание после конца, с. */
export const BUG_PRESS_S = 2;
export const BUG_BANK_S = 8;
export const BUG_RATE_WIN = 3;
export const BUG_FADE_S = 2;
/** «Жучок»: лампочка — столько секунд свечения всего, потом мёртв (не меняется). */
export const BUG_BULB_S = 900;
/** «Жучок»: яркость = BUG_I0 + BUG_I_STEP·(нажатий за окно − 1), до 1. */
export const BUG_I0 = 0.35;
export const BUG_I_STEP = 0.13;
/** «Жучок»: стамина за нажатие = BUG_STAMINA + BUG_STAMINA_RATE·(нажатий за окно − 1); шум нажатия. */
export const BUG_STAMINA = 0.04;
export const BUG_STAMINA_RATE = 0.01;
export const BUG_NOISE = 0.8;
export const BUG_RANGE = 10;
export const BUG_COLOR = '#ffd59a';

/** Спичка: горит s секунд, свет (круговой) range м силой intensity; hardy — не гаснет на бегу и в воде. */
export interface MatchDef {
  s: number;
  range: number;
  intensity: number;
  hardy: boolean;
}
export const MATCH_DEFS: Readonly<Record<string, MatchDef>> = {
  [MATCHES]: { s: 6, range: 3.5, intensity: 0.5, hardy: false },
  [HUNT_MATCHES]: { s: 15, range: 2.5, intensity: 0.3, hardy: true },
};
/** Спичка догорает: последние столько секунд свет слабеет. */
export const MATCH_FADE_S = 1;
export const MATCH_COLOR = '#ffad5c';

/** Зиппа: керосина и фитиля хватает на столько секунд горения; свет; на ходу ×ZIPPO_MOVE_MUL; обвалы ×ZIPPO_COLLAPSE_MUL. */
export const ZIPPO_FUEL_S = 360;
export const ZIPPO_WICK_S = 600;
export const ZIPPO_RANGE = 4;
export const ZIPPO_INTENSITY = 0.45;
export const ZIPPO_MOVE_MUL = 0.6;
export const ZIPPO_COLLAPSE_MUL = 2;
export const ZIPPO_COLOR = '#ffb35a';

/** Керосинка: керосин и фитиль, с горения; свет. */
export const KEROLAMP_FUEL_S = 720;
export const KEROLAMP_WICK_S = 1200;
export const KEROLAMP_RANGE = 6;
export const KEROLAMP_INTENSITY = 0.8;
export const KEROLAMP_COLOR = '#ffc070';

/** Керосин кончается: ниже этого q огонь слабеет (до половины). */
export const FUEL_LOW_Q = 0.1;
/** Заправка: канистра теряет столько за раз (полная — 4 заправки). */
export const KEROSENE_PER_FILL = 0.25;
/** R меняет фитиль, если он выгорел хотя бы на столько (меньше — бережём верёвку). */
export const WICK_SWAP_AT = 0.5;

// ───────────────────────── типы ─────────────────────────

/** Что делает игрок в этом кадре. */
export interface UseCtx {
  sprinting: boolean;
  moving: boolean;
  inWater: boolean;
}

/** Свет предмета: spot — луч вдоль взгляда, point — во все стороны; intensity 0…1 (слой вида множит на свою базу). */
export interface Light {
  kind: 'spot' | 'point';
  intensity: number;
  range: number;
  color: string;
}

/** Мгновенное состояние руки (держит вид; не сохраняется): часы t, горящая спичка, качание «Жучка». */
export interface HandTr {
  /** часы руки, с (копит stepHeld / stepHand) */
  t: number;
  /** горящая спичка: какая, сколько ещё гореть (с), в какой ячейке чиркнули (сменил ячейку — гаснет) */
  match: { item: string; left: number; sel: number } | null;
  /** «Жучок»: времена нажатий за окно частоты (часы t) и до какого t горит */
  bug: { presses: number[]; until: number } | null;
}

/** События шага (звук, подсказка): лампочка перегорела; батарейки сели; кончился керосин; выгорел фитиль; задуло на
 *  бегу; залило водой; спичка догорела / погасла. */
export type UseEvent = 'burnout' | 'empty' | 'out_fuel' | 'out_wick' | 'blown' | 'drowned' | 'match_out';

export function newHandTr(): HandTr {
  return { t: 0, match: null, bug: null };
}

// ───────────────────────── мелочи ─────────────────────────

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
const qOf = (s: Slot): number => s.q ?? 1;
const wOf = (s: Slot): number => s.w ?? 0;
const clampDt = (dt: number): number => (Number.isFinite(dt) ? Math.min(USE_MAX_DT, Math.max(0, dt)) : 0);

/** Детерминированный «шум» 0…1 по целому k (мигание без Math.random). */
function hash01(k: number): number {
  const x = Math.sin(k * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

/** Батареек в тубусе П-2 (с удлинением — 3). */
export const cellsOf = (s: Slot): number => ((s.u ?? 0) & UP_TUBE ? P2_CELLS_TUBE : P2_CELLS);

/** Горит ли предмет сам по себе (П-2, зиппа, керосинка): включён, есть заряд/керосин, лампочка/фитиль целы. Керосинка
 *  включена, пока on !== false. */
export function isLit(s: Slot | null): boolean {
  if (!s) return false;
  const ok = qOf(s) > 0 && wOf(s) < 1;
  if (s.item === P2 || s.item === ZIPPO) return !!s.on && ok;
  if (s.item === KEROLAMP) return s.on !== false && ok;
  return false;
}

/** Яркость П-2 по заряду (без мигания). */
export const p2Brightness = (q: number): number => P2_MIN_B + (1 - P2_MIN_B) * Math.pow(clamp01(q), P2_GAMMA);

/** Нажатий «Жучка» в окне частоты к моменту t. */
function bugRate(presses: readonly number[], t: number): number {
  let n = 0;
  for (const p of presses) if (p <= t && p > t - BUG_RATE_WIN) n++;
  return n;
}

/** Яркость «Жучка» при rate нажатиях за окно. */
const bugLevel = (rate: number): number => Math.min(1, BUG_I0 + BUG_I_STEP * Math.max(0, rate - 1));

/** Огонь на керосине слабеет, когда керосин на исходе. */
const fuelDim = (q: number): number => (q >= FUEL_LOW_Q ? 1 : 0.5 + (0.5 * q) / FUEL_LOW_Q);

// ───────────────────────── шаг ─────────────────────────

/** Шаг предмета в руке на dt секунд (dt зажат 0…USE_MAX_DT; часы tr.t идут всегда, даже с пустой рукой):
 *  П-2 тратит заряд и лампочку, зиппа/керосинка — керосин и фитиль, «Жучок» — лампочку, пока светит; спичка горит (и
 *  гаснет на бегу / в воде, если не охотничья). Ничего не изменилось — тот же slot. */
export function stepHeld(
  slot: Slot | null,
  dt: number,
  ctx: UseCtx,
  tr: HandTr = newHandTr(),
): { slot: Slot | null; tr: HandTr; events: UseEvent[] } {
  dt = clampDt(dt);
  const t0 = tr.t;
  const events: UseEvent[] = [];
  const next: HandTr = { ...tr, t: t0 + dt };
  let s = slot;

  // горящая спичка (в руке, что бы ни было в ячейке)
  if (tr.match) {
    const d = MATCH_DEFS[tr.match.item];
    const left = tr.match.left - dt;
    if (!d || left <= 0) {
      next.match = null;
      events.push('match_out');
    } else if (!d.hardy && ctx.inWater) {
      next.match = null;
      events.push('drowned', 'match_out');
    } else if (!d.hardy && ctx.sprinting) {
      next.match = null;
      events.push('blown', 'match_out');
    } else next.match = { ...tr.match, left };
  }

  if (s && dt > 0) {
    if (s.item === P2 && isLit(s)) {
      const q = Math.max(0, qOf(s) - dt / (cellsOf(s) * BATTERY_S));
      const w = Math.min(1, wOf(s) + dt / P2_BULB_S);
      s = { ...s, q, w };
      if (w >= 1) {
        s.on = false;
        events.push('burnout');
      } else if (q <= 0) events.push('empty');
    } else if (s.item === ZIPPO && isLit(s)) {
      if (ctx.sprinting) {
        s = { ...s, on: false };
        events.push('blown');
      } else s = burnFuel(s, dt, ZIPPO_FUEL_S, ZIPPO_WICK_S, events);
    } else if (s.item === KEROLAMP && isLit(s)) {
      s = burnFuel(s, dt, KEROLAMP_FUEL_S, KEROLAMP_WICK_S, events);
    } else if (s.item === BUG && tr.bug && wOf(s) < 1) {
      const glow = Math.min(dt, Math.max(0, tr.bug.until - t0));
      if (glow > 0) {
        const w = Math.min(1, wOf(s) + glow / BUG_BULB_S);
        s = { ...s, w };
        if (w >= 1) {
          next.bug = null;
          events.push('burnout');
        }
      }
    }
  }
  // «Жучок» давно погас и не качали — забыть
  if (next.bug && next.t > next.bug.until + BUG_FADE_S && bugRate(next.bug.presses, next.t) === 0) next.bug = null;
  return { slot: s, tr: next, events };
}

/** Керосин и фитиль горят dt секунд (полный бак — fuelS, новый фитиль — wickS); кончилось — гаснет с событием. */
function burnFuel(s: Slot, dt: number, fuelS: number, wickS: number, events: UseEvent[]): Slot {
  const q = Math.max(0, qOf(s) - dt / fuelS);
  const w = Math.min(1, wOf(s) + dt / wickS);
  const r: Slot = { ...s, q, w };
  if (q <= 0) {
    r.on = false;
    events.push('out_fuel');
  } else if (w >= 1) {
    r.on = false;
    events.push('out_wick');
  }
  return r;
}

/** Шаг руки целиком (каждый кадр, вместо stepHeld): сменил ячейку — спичка гаснет, «Жучок» не в руке — гаснет; затем
 *  stepHeld для выбранной ячейки и правка её в хотбаре. Ничего не изменилось — тот же h. Внимание: горящий П-2 меняет
 *  хотбар каждый кадр — сохранять в localStorage реже (по таймеру / при смене ячейки). */
export function stepHand(h: Hotbar, dt: number, ctx: UseCtx, tr: HandTr): { h: Hotbar; tr: HandTr; events: UseEvent[] } {
  const pre: UseEvent[] = [];
  let tr0 = tr;
  if (tr0.match && tr0.match.sel !== h.sel) {
    tr0 = { ...tr0, match: null };
    pre.push('match_out');
  }
  const s = held(h);
  if (tr0.bug && s?.item !== BUG) tr0 = { ...tr0, bug: null };
  const r = stepHeld(s, dt, ctx, tr0);
  const h2 = r.slot !== s ? setAt(h, { bag: false, i: h.sel }, r.slot) : h;
  return { h: h2, tr: r.tr, events: [...pre, ...r.events] };
}

// ───────────────────────── свет ─────────────────────────

/** Свет в руке: горящая спичка (tr.match) — главнее ячейки; иначе свет предмета slot (П-2 — луч, «Жучок» — луч по
 *  качанию, зиппа / керосинка — круговой). Не светит — null. Мигание — по часам tr.t (без tr — ровно). */
export function lightOf(slot: Slot | null, ctx: UseCtx, tr?: HandTr | null): Light | null {
  const t = tr?.t ?? 0;
  if (tr?.match) {
    const d = MATCH_DEFS[tr.match.item];
    if (d) {
      const k = Math.min(1, tr.match.left / MATCH_FADE_S) * (0.85 + 0.15 * hash01(Math.floor(t * 10)));
      return { kind: 'point', intensity: d.intensity * k, range: d.range, color: MATCH_COLOR };
    }
  }
  if (!slot) return null;
  if (slot.item === BUG) {
    const b = tr?.bug;
    if (!b || wOf(slot) >= 1) return null;
    let i: number;
    if (t < b.until) i = bugRate(b.presses, t) > 0 ? bugLevel(bugRate(b.presses, t)) : BUG_I0;
    else if (t < b.until + BUG_FADE_S) i = bugLevel(Math.max(1, bugRate(b.presses, b.until))) * (1 - (t - b.until) / BUG_FADE_S);
    else return null;
    return { kind: 'spot', intensity: i, range: BUG_RANGE * (0.5 + 0.5 * i), color: BUG_COLOR };
  }
  if (!isLit(slot)) return null;
  if (slot.item === P2) return p2Light(slot, t);
  const q = qOf(slot);
  if (slot.item === ZIPPO) {
    const i = ZIPPO_INTENSITY * (ctx.moving ? ZIPPO_MOVE_MUL : 1) * fuelDim(q) * (0.9 + 0.1 * hash01(Math.floor(t * 8)));
    return { kind: 'point', intensity: i, range: ZIPPO_RANGE, color: ZIPPO_COLOR };
  }
  if (slot.item === KEROLAMP) {
    const i = KEROLAMP_INTENSITY * fuelDim(q) * (0.94 + 0.06 * hash01(Math.floor(t * 6)));
    return { kind: 'point', intensity: i, range: KEROLAMP_RANGE, color: KEROLAMP_COLOR };
  }
  return null;
}

/** Луч П-2: яркость по заряду, ниже P2_FLICKER_Q — мигает (тем глубже, чем ближе к нулю). */
function p2Light(s: Slot, t: number): Light {
  const q = qOf(s);
  let b = p2Brightness(q);
  if (q < P2_FLICKER_Q) b *= 1 - 0.7 * (1 - q / P2_FLICKER_Q) * hash01(Math.floor(t * 14));
  return { kind: 'spot', intensity: b, range: P2_RANGE * (0.55 + 0.45 * b), color: P2_COLOR };
}

/** Свет предмета, лежащего на полу: горящие П-2 (луч) и керосинка (круговой); спичка, зиппа, «Жучок» — нет. */
export function lightOnFloor(slot: Slot | null): Light | null {
  if (!slot || !isLit(slot)) return null;
  if (slot.item === P2) return p2Light(slot, 0);
  if (slot.item === KEROLAMP) {
    return { kind: 'point', intensity: KEROLAMP_INTENSITY * fuelDim(qOf(slot)), range: KEROLAMP_RANGE, color: KEROLAMP_COLOR };
  }
  return null;
}

/** Ячейка, которую кладут на пол: зиппа гаснет (захлопнул крышку), остальное — как было. */
export function onDrop(slot: Slot): Slot {
  return slot.item === ZIPPO && slot.on ? { ...slot, on: false } : slot;
}

/** Множитель частоты обвалов от руки: горящая зиппа — ZIPPO_COLLAPSE_MUL, иначе 1. */
export function collapseMul(h: Hotbar): number {
  const s = held(h);
  return s?.item === ZIPPO && isLit(s) ? ZIPPO_COLLAPSE_MUL : 1;
}

// ───────────────────────── F: свет ─────────────────────────

/** Вкл/выкл П-2, зиппы, керосинки в ячейке i (по умолчанию — выбранной). Зажечь нельзя (сели батарейки, перегорела
 *  лампочка, нет керосина / фитиля, на бегу — зиппа) — h тот же и msg. */
export function toggleLight(h: Hotbar, i: number = h.sel, ctx?: UseCtx): { h: Hotbar; msg?: string } {
  const s = slotAt(h, { bag: false, i });
  if (!s) return { h };
  if (s.item !== P2 && s.item !== ZIPPO && s.item !== KEROLAMP) return { h };
  const on = s.item === KEROLAMP ? s.on !== false : !!s.on;
  if (on) return { h: patch(h, i, { on: false }) };
  if (s.item === P2) {
    if (wOf(s) >= 1) return { h, msg: 'Лампочка перегорела — нужна запасная (R)' };
    if (qOf(s) <= 0) return { h, msg: `Батарейки сели — нужно ${cellsOf(s)} батарейки D (R)` };
  } else {
    if (qOf(s) <= 0) return { h, msg: 'Нет керосина (R — заправить)' };
    if (wOf(s) >= 1) return { h, msg: 'Фитиль выгорел — нужна шпонная верёвка (R)' };
    if (s.item === ZIPPO && ctx?.sprinting) return { h, msg: 'На бегу не зажечь' };
  }
  return { h: patch(h, i, { on: true }) };
}

/** «Жучок»: качнуть (часы — tr.t). +BUG_PRESS_S света (запас ≤ BUG_BANK_S), частота за BUG_RATE_WIN — ярче и дороже.
 *  Вернёт стамину (доля шкалы) и шум (effects.addNoise). Перегорел — ничего, msg. Не «Жучок» — ничего. */
export function pump(slot: Slot | null, tr: HandTr): { tr: HandTr; staminaCost: number; noise: number; msg?: string } {
  if (slot?.item !== BUG) return { tr, staminaCost: 0, noise: 0 };
  if (wOf(slot) >= 1) return { tr, staminaCost: 0, noise: 0, msg: 'Лампочка «Жучка» перегорела — он мёртв' };
  const now = tr.t;
  const presses = [...(tr.bug?.presses ?? []).filter((p) => p > now - BUG_RATE_WIN && p <= now), now];
  const until = Math.min(Math.max(tr.bug?.until ?? now, now) + BUG_PRESS_S, now + BUG_BANK_S);
  const rate = presses.length;
  return {
    tr: { ...tr, bug: { presses, until } },
    staminaCost: BUG_STAMINA + BUG_STAMINA_RATE * (rate - 1),
    noise: BUG_NOISE,
  };
}

/** Чиркнуть спичкой из выбранной ячейки (коробок — n − 1, последняя — ячейка пустеет). Уже горит — задуть. Обычную
 *  спичку не зажечь в воде и на бегу (не тратится, msg). Не спички — ничего. */
export function strike(h: Hotbar, tr: HandTr, ctx: UseCtx): { h: Hotbar; tr: HandTr; msg?: string } {
  if (tr.match) return { h, tr: { ...tr, match: null } };
  const s = held(h);
  const d = s ? MATCH_DEFS[s.item] : undefined;
  if (!s || !d) return { h, tr };
  if (!d.hardy && ctx.inWater) return { h, tr, msg: 'В воде спичку не зажечь' };
  if (!d.hardy && ctx.sprinting) return { h, tr, msg: 'На бегу спичку не зажечь' };
  return { h: takeOne(h, h.sel).h, tr: { ...tr, match: { item: s.item, left: d.s, sel: h.sel } } };
}

/** Клавиша F для выбранной ячейки: П-2 / зиппа / керосинка — вкл/выкл, «Жучок» — качнуть, спички — чиркнуть (горит —
 *  задуть); прочее — ничего. staminaCost — снять со стамины, noise — effects.addNoise. */
export function pressF(
  h: Hotbar,
  ctx: UseCtx,
  tr: HandTr,
): { h: Hotbar; tr: HandTr; msg?: string; staminaCost: number; noise: number } {
  const s = held(h);
  if (tr.match || (s && MATCH_DEFS[s.item])) return { ...strike(h, tr, ctx), staminaCost: 0, noise: 0 };
  if (!s) return { h, tr, staminaCost: 0, noise: 0 };
  if (s.item === BUG) {
    const p = pump(s, tr);
    return { h, tr: p.tr, msg: p.msg, staminaCost: p.staminaCost, noise: p.noise };
  }
  const r = toggleLight(h, h.sel, ctx);
  return { h: r.h, tr, msg: r.msg, staminaCost: 0, noise: 0 };
}

// ───────────────────────── R: перезарядка / заправка ─────────────────────────

/** Что сделала перезарядка: лампочка, батарейки, керосин, фитиль. */
export type Reloaded = 'bulb' | 'batteries' | 'fuel' | 'wick';

/** R для предмета в ячейке i хотбара (по умолчанию — выбранной); запчасти берутся из хотбара и сумки.
 *  • П-2: перегорела лампочка и есть it_bulb — вкрутить (w = 0); иначе заряд < 1 и есть 2 (3) батарейки — заменить
 *    (q = 1, старые — в мусор); иначе msg, чего не хватает.
 *  • Зиппа / керосинка: керосин < 1 и есть канистра — долить (q = 1, у канистры q − 0.25, пустая исчезает; берётся
 *    самая пустая); фитиль выгорел ≥ WICK_SWAP_AT и есть шпонная верёвка — заменить (w = 0, верёвка n − 1). Чего нет —
 *    msg; всё полно — msg «Заправлено».
 *  Ничего не сделано — h тот же, done пуст. */
export function reload(h: Hotbar, i: number = h.sel): { h: Hotbar; done: Reloaded[]; msg?: string } {
  const s = slotAt(h, { bag: false, i });
  if (!s) return { h, done: [] };
  if (s.item === P2) {
    const cells = cellsOf(s);
    const burnt = wOf(s) >= 1;
    if (burnt && count(h, BULB) > 0) return { h: patch(consume(h, BULB, 1)!, i, { w: 0 }), done: ['bulb'] };
    if (qOf(s) < FULL_Q && count(h, BATTERY) >= cells) {
      return {
        h: patch(consume(h, BATTERY, cells)!, i, { q: 1 }),
        done: ['batteries'],
        msg: burnt ? 'Лампочка перегорела — нужна запасная' : undefined,
      };
    }
    if (burnt) return { h, done: [], msg: 'Лампочка перегорела — нужна запасная' };
    if (qOf(s) < FULL_Q) return { h, done: [], msg: `Нужно ${cells} батарейки D` };
    return { h, done: [], msg: 'Батарейки свежие' };
  }
  if (s.item === ZIPPO || s.item === KEROLAMP) {
    let h2 = h;
    const done: Reloaded[] = [];
    const miss: string[] = [];
    if (qOf(s) < FULL_Q) {
      const cans = findAll(h2, KEROSENE).sort((a, b) => qOf(slotAt(h2, a)!) - qOf(slotAt(h2, b)!));
      if (cans.length) {
        const can = slotAt(h2, cans[0])!;
        const left = qOf(can) - KEROSENE_PER_FILL;
        h2 = setAt(h2, cans[0], left > 1e-6 ? { ...can, q: left } : null);
        h2 = patch(h2, i, { q: 1 });
        done.push('fuel');
      } else miss.push('керосин');
    }
    if (wOf(s) >= WICK_SWAP_AT) {
      if (count(h2, WICK) > 0) {
        h2 = patch(consume(h2, WICK, 1)!, i, { w: 0 });
        done.push('wick');
      } else miss.push('шпонная верёвка');
    }
    const msg = miss.length
      ? miss.length === 2
        ? 'Нужны керосин и шпонная верёвка'
        : miss[0] === 'керосин'
          ? 'Нужен керосин'
          : 'Нужна шпонная верёвка'
      : done.length
        ? undefined
        : 'Заправлено';
    return { h: h2, done, msg };
  }
  return { h, done: [] };
}

// ───────────────────────── ЛКМ: использовать ─────────────────────────

/** Итог ЛКМ: новый хотбар; fx — id съеденного (→ effects.applyFood); msg — подсказка; needPartner — карты (дурак в
 *  коопе: сыграть может только вид с напарником); wear — сумка надета. */
export interface Used {
  h: Hotbar;
  fx?: string;
  msg?: string;
  needPartner?: true;
  wear?: true;
}

/** ЛКМ для предмета в руке: еда — съесть одну штуку (fx); карты — needPartner; сумка — надеть (wear); П-2 при удлинении
 *  тубуса при себе — поставить (u |= UP_TUBE, деталь тратится, заряд q × 2/3 — та же энергия на 3 батарейки; новую
 *  батарейку — R); прочее — подсказка msg. */
export function useHeld(h: Hotbar): Used {
  const s = held(h);
  if (!s) return { h };
  const d = lootDef(s.item);
  if (!d) return { h };
  switch (d.kind) {
    case 'food':
      return { h: takeOne(h, h.sel).h, fx: s.item };
    case 'cards':
      return { h, needPartner: true, msg: 'Сыграть в дурака можно только с напарником' };
    case 'bag': {
      const r = wear(h, h.sel);
      return r.h ? { h: r.h, wear: true } : { h, msg: r.msg };
    }
    case 'light':
      if (s.item === P2 && count(h, TUBE) > 0) {
        if ((s.u ?? 0) & UP_TUBE) return { h, msg: 'Тубус уже удлинён' };
        const h2 = patch(consume(h, TUBE, 1)!, h.sel, { u: (s.u ?? 0) | UP_TUBE, q: (qOf(s) * P2_CELLS) / P2_CELLS_TUBE });
        return { h: h2, msg: 'Тубус удлинён: третья батарейка — +5 минут света' };
      }
      if (s.item === BUG) return { h, msg: 'F — качать «Жучок»' };
      return { h, msg: 'F — свет, R — ' + (s.item === P2 ? 'батарейки и лампочка' : 'заправить') };
    case 'part':
      return { h, msg: s.item === TUBE ? 'Возьми П-2 в руку и используй (ЛКМ)' : 'Возьми П-2 в руку и нажми R' };
    case 'battery':
      return { h, msg: `Батарейки — в П-2: возьми его в руку и нажми R` };
    case 'fuel':
    case 'wick':
      return { h, msg: 'Возьми зиппу или керосинку и нажми R' };
    case 'match':
      return { h, msg: 'F — чиркнуть спичку' };
    case 'currency':
      return { h, msg: `${d.name}: валюта — у торговца` };
    case 'trade':
      return { h, msg: 'Только на продажу торговцу' };
  }
  return { h };
}

/** Сколько ещё света у предмета, с (П-2 — по заряду и тубусу; зиппа/керосинка — по керосину и фитилю) — для HUD;
 *  остальное — null. */
export function lightLeftS(s: Slot): number | null {
  if (s.item === P2) return wOf(s) >= 1 ? 0 : Math.min(qOf(s) * cellsOf(s) * BATTERY_S, (1 - wOf(s)) * P2_BULB_S);
  if (s.item === ZIPPO) return Math.min(qOf(s) * ZIPPO_FUEL_S, (1 - wOf(s)) * ZIPPO_WICK_S);
  if (s.item === KEROLAMP) return Math.min(qOf(s) * KEROLAMP_FUEL_S, (1 - wOf(s)) * KEROLAMP_WICK_S);
  if (s.item === BUG) return (1 - wOf(s)) * BUG_BULB_S;
  return null;
}
