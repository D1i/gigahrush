// Погреб (земляной погреб, биом «Погреб»): протискивание боком — механика без движка, в стиле snowCollapse.ts.
//
// Правило для игрока (squeezeRule): «Ходы в погребе узкие: 0.6 м — идёшь как обычно. В щель (0.4 м) грудью вперёд не
// пролезть — плечи шире. Повернись лицом к стене и иди боком (A/D): медленно, приставным шагом. В щели не развернуться
// — поворот упирается в стены».
//
//  • Тело в погребе — эллипс: полуширина плеч a = 0.23 м, полутолщина груди b = 0.13 м, повёрнут по взгляду ψ (поворот
//    камеры rotation.y; у Babylon вперёд — (sin ψ, 0, cos ψ), вправо — (cos ψ, 0, −sin ψ)). Эллипсоид коллизий Babylon
//    выровнен по осям мира и не поворачивается — но стены погреба вдоль осей, а упирается тело в стену своим размахом
//    вдоль её нормали: полуразмеры x = √((a·cos ψ)² + (b·sin ψ)²), z = √((a·sin ψ)² + (b·cos ψ)²) (bodyExtents) —
//    радиусы эллипсоида каждый кадр (src/view3d/posture.ts, body).
//  • Ход 0.6 м: 2a = 0.46 — проходит в любом повороте. Щель 0.4 м: лицом вдоль щели плечи (0.46) не влезают — коллизии
//    не пускают; лицом к стене — грудь (0.26) влезает, и A/D ведут вдоль щели. Повернуться в щели можно лишь на
//    ~±50° от «лицом к стене» (clampYaw: поворот не дальше, чем тело ещё влезает).
//  • Свободно вокруг — лучи от середины тела вдоль ±X и ±Z на нескольких смещениях поперёк (Free; src/view3d/
//    cellarWalk.ts кидает их в коллайдеры): для поворота ψ тело влезает, если на каждом смещении эллипс там уже, чем
//    ход (с зазором FIT_GAP), — середину можно сдвинуть к середине хода (fitAt: сдвиг dx, dz), но не дальше стен.
//  • Боком (squeezing): ширина хода поперёк движения меньше 2a + SQUEEZE_IN (отпускает шире 2a + SQUEEZE_OUT) —
//    скорость × SIDE_SPEED, бег нельзя, руки на стене, шаг приставной (stepShuffle: фаза по пути вбок).
//  • Подсказка: давит вперёд в щель, куда грудью не пролезть, а боком — да (slitAhead) — «повернись боком».
//  • Осыпи (косметика): через crumbDelay с (в щелях чаще) сыплется земля со свода; обвалы — snowCollapse.ts со своими
//    числами (CELLAR_COLLAPSE) и фильтром комнат (cellarCollapseRoom).
import { DEFAULT_COLLAPSE, type CollapseSpec } from './snowCollapse';

/** Первая метка комнат погреба; щель (сужение 0.4 м) — доп. метка куска. */
export const CELLAR_TAG = 'погреб';
export const SLIT_TAG = 'щель';
/** Кусок хода погреба (src/data/roomsCellar.ts: 'ход' — прямые, щели, повороты, развилки; не 'хаб' и не 'клетушка'). */
export const PASS_TAG = 'ход';

/** Тело в погребе: полуширина плеч a, полутолщина груди b, м. */
export const BODY = { a: 0.23, b: 0.13 } as const;
export type Body = { a: number; b: number };

/** Зазор до стены при проверке поворота, м. */
export const FIT_GAP = 0.005;
/** Сдвиг середины тела при повороте за кадр — не больше, м (больше — поворот не даётся). */
export const MAX_SHIFT = 0.08;
/** Боком: ширина поперёк хода меньше 2a + SQUEEZE_IN; снова прямо — шире 2a + SQUEEZE_OUT, м. */
export const SQUEEZE_IN = 0.04;
export const SQUEEZE_OUT = 0.08;
/** Скорость боком — доля от скорости позы. */
export const SIDE_SPEED = 0.36;
/** Путь вбок за полный цикл переступания (два приставных шага), м. */
export const SHUFFLE_CYCLE = 0.5;
/** «Узко» для обвалов: ход уже стольких м (ходы 0.6, щели 0.4; залы от 1.5). */
export const NARROW_M = 0.9;

/** Подсказки HUD. */
export const HINT_SLIT = 'Не пролезть — повернись боком (лицом к стене, A/D)';
export const HINT_TURN = 'Тесно — не развернуться';

/** Обвалы в погребе: те же правила, что в снегу; метров по узким ходам между обвалами — 50…120. */
export const CELLAR_COLLAPSE: CollapseSpec = { ...DEFAULT_COLLAPSE, everyM: [50, 120] };

/** Осыпи (косметика): пауза между ними, с; в щели — × CRUMB_SLIT. */
export const CRUMB_S: readonly [number, number] = [6, 20];
export const CRUMB_SLIT = 0.45;

const TAU = Math.PI * 2;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Угол в (−π, π]. */
export function wrapAngle(a: number): number {
  a %= TAU;
  if (a > Math.PI) a -= TAU;
  if (a <= -Math.PI) a += TAU;
  return a;
}

/** Комната погреба (первая метка). */
export const isCellarTags = (tags: readonly string[]): boolean => tags[0] === CELLAR_TAG;
/** Кусок-щель погреба. */
export const isSlitTags = (tags: readonly string[]): boolean => isCellarTags(tags) && tags.includes(SLIT_TAG);
/** Фильтр комнат обвала (collapseSite): ходы погреба (камеры и клетушки не обваливаются); метры копятся только в узком
 *  (cellarWalk: ширина у середины тела меньше NARROW_M). */
export const cellarCollapseRoom = (tags: readonly string[]): boolean => isCellarTags(tags) && tags.includes(PASS_TAG);

/** Полуразмеры тела-эллипса по осям мира (x, z) при повороте взгляда yaw. */
export function bodyExtents(a: number, b: number, yaw: number): { x: number; z: number } {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  return { x: Math.hypot(a * c, b * s), z: Math.hypot(a * s, b * c) };
}

/** Свободно от середины тела до стен вдоль оси: pos — в +, neg — в −; off — смещение начала луча поперёк, м. */
export interface Span {
  off: number;
  pos: number;
  neg: number;
}

/** Лучи вокруг тела: x — вдоль ±X (на смещениях по Z), z — вдоль ±Z (на смещениях по X). */
export interface Free {
  x: Span[];
  z: Span[];
}

/** Полуразмер эллипса (полуоси ex — вдоль оси, ey — поперёк) вдоль оси на смещении off поперёк; за краем — 0. */
const halfAt = (along: number, across: number, off: number): number => {
  const q = off / across;
  return q * q >= 1 ? 0 : along * Math.sqrt(1 - q * q);
};

/** Окно сдвига середины вдоль оси: [lo, hi] (влезает, если lo ≤ hi). */
function shiftWindow(spans: readonly Span[], along: number, across: number, gap: number): { lo: number; hi: number } {
  let lo = -Infinity, hi = Infinity;
  for (const s of spans) {
    const h = halfAt(along, across, s.off);
    if (h <= 0) continue;
    lo = Math.max(lo, h + gap - s.neg);
    hi = Math.min(hi, s.pos - gap - h);
  }
  return { lo, hi };
}

/**
 * Влезает ли тело при повороте yaw; slack — запас (м, ≥ 0 — влезает; чем меньше, тем теснее), (dx, dz) — сдвиг
 * середины тела, чтобы не задевать стен (ближайший к нулю; не больше MAX_SHIFT).
 */
export function fitAt(body: Body, yaw: number, free: Free, gap = FIT_GAP): { ok: boolean; slack: number; dx: number; dz: number } {
  const e = bodyExtents(body.a, body.b, yaw);
  const wx = shiftWindow(free.x, e.x, e.z, gap);
  const wz = shiftWindow(free.z, e.z, e.x, gap);
  // запас окна — с учётом предела сдвига
  const lim = (w: { lo: number; hi: number }) => Math.min(w.hi - w.lo, MAX_SHIFT - w.lo, w.hi + MAX_SHIFT);
  const slack = Math.min(lim(wx), lim(wz));
  const shift = (w: { lo: number; hi: number }) => (w.lo > w.hi ? 0 : clamp(0, w.lo, w.hi));
  return { ok: slack >= 0, slack, dx: shift(wx), dz: shift(wz) };
}

/**
 * Запас тела на месте (без сдвига), м: ≥ 0 — не задевает стен, < 0 — на столько «в» стене. Ход в погребе проверяется
 * им (cellarWalk: коллизии Babylon пропускают эллипсоид углом в проём, если он шире проёма на несколько см).
 */
export function clearance(body: Body, yaw: number, free: Free, gap = 0): number {
  const e = bodyExtents(body.a, body.b, yaw);
  const wx = shiftWindow(free.x, e.x, e.z, gap);
  const wz = shiftWindow(free.z, e.z, e.x, gap);
  return Math.min(wx.hi, -wx.lo, wz.hi, -wz.lo);
}

/** Ход боком / вперёд: на новом месте тело влезает (с допуском STEP_TOL) или хотя бы не хуже, чем было. */
export const STEP_TOL = 0.004;
export function stepOk(now: number, before: number): boolean {
  return now >= -STEP_TOL || now >= before - 1e-4;
}

/** Поворот проверяется по дуге шагами не больше стольких рад (рывок мышью не «проскочит» запретное «лицом вдоль»). */
const ARC_STEP = 0.05;

/**
 * Поворот взгляда from → to в тесноте: по всей дуге тело влезает — to; упирается — до последнего влезающего поворота
 * (по дуге шагами ARC_STEP, у границы — делением пополам). Не влезал и from (тело и так в тесноте) — to, если не хуже,
 * иначе остаётся from.
 */
export function clampYaw(body: Body, from: number, to: number, free: Free, gap = FIT_GAP): number {
  const fit = (y: number) => fitAt(body, y, free, gap).slack;
  const sFrom = fit(from);
  if (sFrom < 0) return fit(to) >= sFrom - 1e-9 ? to : from;
  const d = wrapAngle(to - from);
  const n = Math.max(1, Math.ceil(Math.abs(d) / ARC_STEP));
  let lo = 0;
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    if (fit(from + d * t) >= 0) {
      lo = t;
      continue;
    }
    let hi = t;
    for (let k = 0; k < 14; k++) {
      const m = (lo + hi) / 2;
      if (fit(from + d * m) >= 0) lo = m;
      else hi = m;
    }
    return from + d * lo;
  }
  return to;
}

/** Ширина хода у середины тела вдоль оси (лучи без смещения; нет таких — Infinity). */
export function widthOf(spans: readonly Span[]): number {
  let w = Infinity;
  for (const s of spans) if (Math.abs(s.off) < 1e-6) w = Math.min(w, s.pos + s.neg);
  return w;
}

/** Ширина хода поперёк движения (mx, mz — сдвиг за кадр); стоит — null. */
export function crossWidth(free: Free, mx: number, mz: number): number | null {
  if (Math.hypot(mx, mz) < 1e-4) return null;
  // идёт вдоль X — ширина поперёк по Z, и наоборот
  return Math.abs(mx) >= Math.abs(mz) ? widthOf(free.z) : widthOf(free.x);
}

/** Протискивается боком: уже 2a + SQUEEZE_IN — да, шире 2a + SQUEEZE_OUT — нет, между — как было; стоит — как было. */
export function squeezing(width: number | null, was: boolean, body: Body = BODY): boolean {
  if (width === null) return was;
  if (width < 2 * body.a + SQUEEZE_IN) return true;
  if (width > 2 * body.a + SQUEEZE_OUT) return false;
  return was;
}

/** Щель впереди: грудью вперёд (плечи поперёк) не пролезть, боком (грудь поперёк) — да. */
export function slitAhead(width: number, body: Body = BODY, gap = FIT_GAP): boolean {
  return width < 2 * body.a + 2 * gap && width >= 2 * body.b + 2 * gap;
}

/** Ось взгляда: ближайшая ось мира к направлению (fx, fz), если угол до неё меньше ~40°; иначе null. */
export function facingAxis(fx: number, fz: number): { axis: 'x' | 'z'; sign: 1 | -1 } | null {
  const l = Math.hypot(fx, fz);
  if (l < 1e-6) return null;
  const x = fx / l, z = fz / l;
  if (Math.abs(x) >= 0.76) return { axis: 'x', sign: x > 0 ? 1 : -1 };
  if (Math.abs(z) >= 0.76) return { axis: 'z', sign: z > 0 ? 1 : -1 };
  return null;
}

/** Приставной шаг: фаза (рад) по пути вбок, сторона хода (1 — вправо), число шагов. */
export interface Shuffle {
  phase: number;
  dir: 1 | -1;
  steps: number;
}

export const newShuffle = (): Shuffle => ({ phase: 0, dir: 1, steps: 0 });

/** Кадр шага: along — путь вбок за кадр (м, со знаком: + вправо). step — начался новый приставной шаг (каждые π). */
export function stepShuffle(s: Shuffle, along: number): { step: boolean } {
  const d = Math.abs(along);
  if (d < 1e-5 || d > 0.5) return { step: false };
  s.dir = along > 0 ? 1 : -1;
  const before = Math.floor(s.phase / Math.PI);
  s.phase += (d / SHUFFLE_CYCLE) * TAU;
  const step = Math.floor(s.phase / Math.PI) > before;
  if (step) s.steps++;
  // фаза не растёт без конца (точность sin)
  if (s.phase > TAU * 1000) s.phase -= TAU * 1000;
  return { step };
}

/** Пауза до следующей осыпи, с (r — случайное 0…1; в щели — чаще). */
export function crumbDelay(r: number, slit: boolean): number {
  const [a, b] = CRUMB_S;
  return (a + (b - a) * clamp(r, 0, 1)) * (slit ? CRUMB_SLIT : 1);
}

/** Пыль после обвала: туман сжимается до DUST.start…DUST.end за attackS, держится holdS, оседает за settleS. */
export const DUST = { start: 0.3, end: 1.5, attackS: 0.4, holdS: 3, settleS: 5 } as const;

/** Доля пыли 0…1 через t с после обвала (0 — осела). */
export function dustLevel(t: number): number {
  if (!(t >= 0)) return 0;
  const sm = (x: number) => {
    const k = clamp(x, 0, 1);
    return k * k * (3 - 2 * k);
  };
  const up = sm(t / DUST.attackS);
  const down = 1 - sm((t - DUST.attackS - DUST.holdS) / DUST.settleS);
  return Math.min(up, down);
}

/** Туман погреба с пылью k (0…1): от обычного (start, end) к плотному DUST. */
export function dustFog(base: { start: number; end: number }, k: number): { start: number; end: number } {
  const q = clamp(k, 0, 1);
  return { start: base.start + (DUST.start - base.start) * q, end: base.end + (DUST.end - base.end) * q };
}

/** Правило для игрока. */
export function squeezeRule(spec: CollapseSpec = CELLAR_COLLAPSE): string {
  return 'Ходы в погребе узкие. В щель грудью вперёд не пролезть — повернись лицом к стене и иди боком (A/D): ' +
    'медленно, приставным шагом, бежать нельзя; в щели не развернуться. ' +
    `Затрещали крепи и сыплется земля — уходи от места: через ${spec.warnS} с свод рухнет и завалит ход. ` +
    `Засыпало — откапывайся (E, ~${spec.digSelf} раз), напарник откопает быстрее (~${spec.digMate}). ` +
    `Завал можно разгрести: E у кучи, ~${spec.clear} раз (вдвоём — быстрее).`;
}
