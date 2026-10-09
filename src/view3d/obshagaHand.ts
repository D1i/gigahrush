// Рука «Общаги» — модель и анимация (механика — src/locations/obshaga.ts: HandState → handView).
//
// В темноте из двери комнаты вылезает огромная рука: кисть ползёт по коридору, а за ней тянется очень длинное
// предплечье — назад, в дверь (рука «растёт» из проёма). Сечение предплечья у кисти ~1.75 × 1.9 м, дальше от кисти
// (плечо, лишние локти) — ~1.85 × 2.2, почти до потолка: коридор 2.0 × 2.5 заполнен, мимо не пройти и поверх не
// заглянуть. К двери тоньше (~1.2 м), в самом проёме (0.8 × 2.05) сжата косяками (уже и выше) и выдавлена по обе
// стороны; на крутых изгибах внутренняя сторона собрана в складки, на внешней — костяные гребни. Через каждые ~6–8 м —
// лишний «локоть» (костяные бугры, складки кожи). Кисть: ладонь с костяшками и сухожилиями, четыре костлявых пальца по
// пять фаланг и большой палец, длинные жёлто-грязные ногти. Ползёт, перебирая пальцами: цикл — по пройденному кистью
// пути (опорный палец неподвижен в мире, кисть уходит вперёд над ним; кончики крайних — у стен); стоит — пальцы
// опущены, изредка подёргиваются; замерла под взглядом — не шелохнётся вовсе. Хватает — пальцы крюком смыкаются вокруг
// схваченного на уровне пояса (ставить его в fistCenter()); отступает от лампы — пальцы вытянуты и волочатся, скребут
// пол. В проёме кисть сжата, пальцы веером по высоте двери протискиваются первыми. Тычет под кровать (view.poke) —
// кисть припадает к полу у кровати (наклон вперёд, костяшки ниже), остальные пальцы упираются кончиками в пол
// полукругом у костяшек высокой аркой (всё, кроме указательного, — в круге 1.2 м у кончика: механика держит кончик в
// POKE_STAND 1.3 м от рамки кровати), указательный уходит под неё: ближние фаланги дугой вниз к краю (pokeBend), дальние
// — горизонтально на 0.14 м над полом (под сеткой кровати на 0.30; ложится горизонтально за 0.2 м до рамки view.bed
// по своему направлению), выпад к игроку и назад — по pokeReach(фаза), удар — на 0.3 м не доходя до глаз, ладонь на
// ударе подаётся вперёд; и под взглядом (кисть замершей руки при тычке пересчитывается, остальные пальцы не
// шелохнутся). Кровать рядом (view.bed) — пальцы переходят в позу упора заранее, на подходе в кровать не лезут. Пол:
// каждая фаланга не ниже низа своего кольца (floorAngle), подушечки и ногти, упёршиеся в пол, приподняты — ни одна
// вершина кисти не уходит под пол (перебор, тычок, разгон позы). Беззвучна, своего света нет: обычный
// освещаемый материал (StandardMaterial без emissive и ambient) — в темноте не видна, под лампой видна.
//
// Без ассетов: геометрия своя (сетки-«трубы», вершины сразу в мировых координатах, матрица мешей единичная и
// заморожена), кожа — процедурная текстура (RawTexture 512²: цвет + карта нормалей, бесшовный повтор), складки, синяки
// и грязь — цветами вершин. Материал один на сцену (общий у всех рук, счётчик ссылок); текстура строится ~0.15 с в
// первом конструкторе сцены — создавать руку при входе в биом, не в момент появления.
//
// Контракт:
//   const hand = new HandMesh(scene, { corridorW: 2, ceilH: 2.5 });
//   каждый кадр: hand.update(view, toWorld, t, doorway?)
//     view — handView(h) / obshagaView(dir).hand; null или visible = false — рука спрятана (новый trail[0] или
//       variant — новая рука: поза и кэш сбрасываются);
//     toWorld(p) — точка плана на полу комнаты p.room → мир Babylon (обычно x = p.x, y = пол комнаты, z = −p.y);
//       зовётся только для изменившихся точек (кэш), Pt-аргумент переиспользуется — не сохранять его;
//     t — время, с (только мелкие подёргивания пальцев стоящей руки и скорость поворота кисти; замершая от t не зависит);
//     doorway — середина проёма двери на плане (по нему сжатие косяками и пальцы в проёме); нет — проём в doorDepth м
//       от trail[0] по следу (trail[0] — точка «за дверью» в комнате).
//   портальный рендер (./portal.ts): extras(room) = hand.byRoom().get(room). Куски руки — по непрерывным участкам
//     следа с одной комнатой (Pt.room; без комнаты — ключ ''), каждый заходит в соседние на HAND.overlapM: на границах
//     комнат нет дыр, даже если метки запаздывают (точки следа между дверью и проёмом механика метит комнатой проёма).
//     Кисть — в комнатах последних 3 м руки и кончика. Слой — opts.layerMask (по умолчанию PORTAL_LAYER: камера сама
//     их не рисует; без порталов передать слой камеры).
//   коллизии: hand.colliders() — невидимые коробки вдоль руки (по ~1.6 м, во всю её ширину) и под ладонью, по
//     комнатам; checkCollisions = true при создании (интеграция может переключать по комнатам каждый кадр).
//   Карты byRoom()/colliders() живые (те же объекты, обновляются в update); пока руки нет — пустые.
//   fistCenter() — полость кулака в мире (середина суставов четырёх пальцев), пока рука сжимается, иначе null.
//   pokeTip() — кончик тычущего пальца в мире, пока рука тычет под кровать, иначе null (QA, тесты).
//   Фаза тычка: view.poke01 (хост — каждый кадр точная; клиент — срез ~10/с, между срезами досчитывается по dt).
//
// Перерасчёт: труба руки — только когда меняются след, кончик или поворот кисти; кисть — каждый кадр, пока не замерла;
// замершая — ни одной записи в буферы и ни одного вызова toWorld (кроме тычка под кровать). Вершин: рука 29 на ~0.2 м (45 м — ~7.8 тыс.), кисть
// ~2.1 тыс.; меши: кусок на комнату + кисть; кадр в движении ~1 мс (45 м, node).
//
// Ограничения: стены механика не знает — ось руки сглажена (углы коридора скругляются, на крутом повороте рука может
// чуть задеть угол стены); кисть и пальцы рассчитаны на прямой коридор corridorW (у развилок кончики крайних пальцев
// могут уйти в проём или в стену); швы бесконечного хода (сдвиг комнат при рендере) не разрывают трубу — toWorld должен
// давать непрерывные координаты вдоль руки.
import type { Scene } from '@babylonjs/core/scene';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer';
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { RawTexture } from '@babylonjs/core/Materials/Textures/rawTexture';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { OBSHAGA, POKE_STAND, pokeReach, rectGap, type HandView, type Pt } from '../locations/obshaga';
import { makeRng } from '../model/rng';
import { PORTAL_LAYER } from './portal';

/** Размеры и шаги руки, м. */
export const HAND = {
  corridorW: 2.0,
  ceilH: 2.5,
  /** проём двери комнаты */
  doorW: 0.8,
  doorH: 2.05,
  /** сечение предплечья у кисти (ширина × высота) */
  armW: 1.75,
  armH: 1.9,
  /** дальше от кисти (плечо и лишние локти) — до потолка: поверх руки коридор не просматривается */
  upperW: 1.84,
  upperH: 2.22,
  /** у двери (до сжатия косяками) */
  doorArmW: 1.2,
  doorArmH: 1.4,
  /** низ руки над полом */
  floorGap: 0.05,
  /** trail[0] глубже плоскости проёма на столько — если проём не передан */
  doorDepth: 1.0,
  /** рука продолжается за trail[0] вглубь комнаты */
  rootExt: 3.2,
  /** прореживание следа (опорные точки оси) и шаг колец трубы */
  ctrlStep: 0.4,
  ringStep: 0.2,
  /** сегментов в сечении руки */
  seg: 28,
  /** куски по комнатам заходят в соседние на столько */
  overlapM: 2.5,
  /** запястье и конец трубы руки (внутри ладони) позади кончика */
  wristD: 1.9,
  armEndD: 0.95,
  /** путь кисти за полный цикл перебора пальцами (шаг пальца 1.0 м = 0.7 цикла опоры: стоящий палец неподвижен в мире) */
  crawlCycle: 1.0 / 0.7,
  /** метров руки на повтор текстуры кожи */
  texTile: 1.6,
  /** кисть поворачивается не быстрее, рад/с */
  turnRate: 2.4,
} as const;

/** Ладонь (локально: f — вперёд от кончика, l — влево, y — вверх от пола), м. */
const PALM = { fc: -0.72, af: 0.98, al: 0.8, ay: 0.36, yc: 0.86 } as const;
/**
 * Тычок под кровать: наклон кисти вперёд (рад) и её опускание, выпад ладони на ударе, м; удар не доходит до глаз
 * игрока на short, палец отходит на pull; высота оси дальних фаланг (сетка кровати — 0.30: верх сустава ≤ 0.29), м.
 * Тычет указательный (палец finger): ближняя фаланга и следующие до prox одним звеном — дугой вниз (pokeBend), дальние —
 * горизонтально; сустав, с которого палец лежит горизонтально, — не дальше POKE_STAND − edge от кончика руки (в плане:
 * кончик стоит не ближе POKE_STAND к рамке кровати — всё, что выше 0.2 м, снаружи неё). Остальные пальцы упираются
 * кончиками в пол полукругом радиуса plantR у кончика руки (поперёк — tl · plantL) высокой аркой: сгиб — у основания
 * (веса суставов PLANT_W вместо fd.wts) — в круге POKE_STAND (тест obshagaHand.test.ts). Кровать рядом (view.bed) —
 * в эту позу упора пальцы (и указательный) переходят заранее, с POKE_STAND + near до POKE_STAND от её рамки: на подходе
 * в кровать не лезут. Тыча, кисть доворачивает к игроку не больше чем на turn (рад) от направления следа (запястье).
 */
const POKE = { pitch: 0.34, drop: 0.12, lunge: 0.12, short: 0.3, pull: 0.5, y: 0.14, finger: 0, prox: 3, edge: 0.2, plantR: 0.85, plantL: 0.8, near: 1.0, turn: 0.6 } as const;
const PLANT_W = [1.6, 0.6, 0.4, 0.3];
/** Пол: суставы, кольца и ногти не ниже стольких метров над полом. */
const FLOOR_GAP = 0.005;
/** сетки кисти: ладонь (ряды вдоль f × сегменты), палец (сегменты), ноготь (ряды × сегменты) */
const PR = 16, PC = 22, FC = 12, NR = 6, NC = 8;
/** повторов текстуры по окружности руки */
const UREP = 4;

const TAU = Math.PI * 2;
const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
const approach = (v: number, to: number, step: number) => (v < to ? Math.min(to, v + step) : Math.max(to, v - step));
const ease = (k: number) => k * k * (3 - 2 * k);
const sgnPow = (v: number, e: number) => (v < 0 ? -Math.pow(-v, e) : Math.pow(v, e));

/** Гладкая ступень 0 → 1 между e0 и e1 (e0 > e1 — убывающая). */
export function smoothstep(e0: number, e1: number, x: number): number {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}

// ───────────────────────── ось руки (чистые функции) ─────────────────────────

/** Накопленные длины ломаной следа на плане: out[i] — путь от trail[0] до trail[i], м. Возвращает полную длину. */
export function trailArcs(trail: readonly Pt[], out: number[]): number {
  out.length = trail.length;
  let s = 0;
  out[0] = 0;
  for (let i = 1; i < trail.length; i++) {
    s += Math.hypot(trail[i].x - trail[i - 1].x, trail[i].y - trail[i - 1].y);
    out[i] = s;
  }
  return s;
}

/** Точка оси на пути s от trail[0] (s < 0 — продолжение за trail[0] по (bx, by), вглубь комнаты; s > длины — кончик). */
export function planAt(trail: readonly Pt[], arcs: readonly number[], bx: number, by: number, s: number, out: { x: number; y: number }) {
  const n = trail.length - 1;
  if (s <= 0 || n === 0) {
    const e = Math.max(0, -s);
    out.x = trail[0].x + bx * e;
    out.y = trail[0].y + by * e;
    return out;
  }
  if (s >= arcs[n]) {
    out.x = trail[n].x;
    out.y = trail[n].y;
    return out;
  }
  let lo = 0, hi = n;
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1;
    if (arcs[m] <= s) lo = m;
    else hi = m;
  }
  const a = trail[lo], b = trail[lo + 1];
  const L = arcs[lo + 1] - arcs[lo];
  const f = L > 1e-9 ? (s - arcs[lo]) / L : 1;
  out.x = a.x + (b.x - a.x) * f;
  out.y = a.y + (b.y - a.y) * f;
  return out;
}

/** Опорная точка оси руки на плане: путь s от trail[0], метка комнаты. */
export interface SpinePt {
  x: number;
  y: number;
  s: number;
  room: string;
}

/**
 * Прореживание следа: точки оси через step м пути от trail[0], от −ext (продолжение за trail[0] по (bx, by) — вглубь
 * комнаты) до sMax включительно. Точки привязаны к пути от двери: след только растёт с конца, поэтому прежние точки не
 * сдвигаются (кэш мировых координат). Комната точки — комната конца отрезка следа, на котором она лежит (за trail[0] —
 * его). Пишет в out (объекты переиспользуются), возвращает число точек.
 */
export function spineSamples(
  trail: readonly Pt[],
  arcs: readonly number[],
  bx: number,
  by: number,
  step: number,
  ext: number,
  sMax: number,
  out: SpinePt[],
): number {
  const t0 = trail[0];
  const r0 = t0.room ?? '';
  const last = trail.length - 1;
  let n = 0;
  let j = 0;
  for (let k = -Math.round(ext / step); ; k++) {
    const s = k * step;
    if (s > sMax + 1e-9) break;
    const o = out[n] ?? (out[n] = { x: 0, y: 0, s: 0, room: '' });
    o.s = s;
    if (s <= 0 || last === 0) {
      const e = Math.max(0, -s);
      o.x = t0.x + bx * e;
      o.y = t0.y + by * e;
      o.room = r0;
    } else {
      while (j < last - 1 && arcs[j + 1] < s) j++;
      const a = trail[j], b = trail[j + 1];
      const L = arcs[j + 1] - arcs[j];
      const f = L > 1e-9 ? clamp((s - arcs[j]) / L, 0, 1) : 1;
      o.x = a.x + (b.x - a.x) * f;
      o.y = a.y + (b.y - a.y) * f;
      o.room = b.room ?? '';
    }
    n++;
  }
  return n;
}

/**
 * Путь по следу до ближайшей к p точки, м. Концы ломаной продолжены прямыми: проём ещё впереди кончика (рука не
 * доросла) — больше длины. Следа нет (одна точка или нулевая длина) — NaN.
 */
export function projectArc(trail: readonly Pt[], arcs: readonly number[], p: { x: number; y: number }): number {
  const n = trail.length - 1;
  let best = Infinity;
  let bs = NaN;
  for (let i = 0; i < n; i++) {
    const a = trail[i], b = trail[i + 1];
    const dx = b.x - a.x, dy = b.y - a.y;
    const L2 = dx * dx + dy * dy;
    if (L2 < 1e-12) continue;
    let f = ((p.x - a.x) * dx + (p.y - a.y) * dy) / L2;
    if (i > 0) f = Math.max(f, 0);
    if (i < n - 1) f = Math.min(f, 1);
    const d = Math.hypot(p.x - (a.x + dx * f), p.y - (a.y + dy * f));
    if (d < best - 1e-9) {
      best = d;
      bs = arcs[i] + f * Math.sqrt(L2);
    }
  }
  return bs;
}

/** Участок колец одной комнаты: свои кольца [from, to], с заходом в соседей — [a, b]. */
export interface RoomRun {
  room: string;
  from: number;
  to: number;
  a: number;
  b: number;
}

/** Разбиение колец по меткам комнат на непрерывные участки (с заходом overlap колец в соседей). Возвращает их число. */
export function roomRuns(labels: readonly string[], n: number, overlap: number, out: RoomRun[]): number {
  let m = 0;
  let i = 0;
  while (i < n) {
    let j = i;
    while (j + 1 < n && labels[j + 1] === labels[i]) j++;
    const o = out[m] ?? (out[m] = { room: '', from: 0, to: 0, a: 0, b: 0 });
    o.room = labels[i];
    o.from = i;
    o.to = j;
    o.a = Math.max(0, i - overlap);
    o.b = Math.min(n - 1, j + overlap);
    m++;
    i = j + 1;
  }
  return m;
}

/** Облик руки по сиду: где лишние локти (путь от кисти, м) и фазы бугров. */
export interface ArmLook {
  elbows: number[];
  ph: number[];
}

export function armLook(seed: number): ArmLook {
  const r = makeRng((seed >>> 0) ^ 0x2b7e1516);
  const elbows: number[] = [];
  for (let d = 5.4 + r.next() * 1.4; d < 80; d += 6 + r.next() * 1.8) elbows.push(d);
  const ph: number[] = [];
  for (let i = 0; i < 8; i++) ph.push(r.next() * TAU);
  return { elbows, ph };
}

/** Сечение руки в точке оси. */
export interface ArmSection {
  /** ширина и высота сечения, низ над полом, м */
  w: number;
  h: number;
  bottom: number;
  /** сжатие косяками 0…1 */
  pinch: number;
  /** складка кожи 0…1 */
  crease: number;
  /** костяной бугор лишнего локтя 0…1 */
  knob: number;
  /** 0 у проёма … 1 дальше ~4 м от него (кожа у двери темнее) */
  far: number;
  /** сухожилия у запястья 0…1 */
  tendon: number;
}

export interface ArmDims {
  corridorW: number;
  ceilH: number;
  doorW: number;
  doorH: number;
}

/**
 * Профиль руки: d — путь от кончика назад, м; sd — путь за плоскость проёма (< 0 — в комнате за дверью).
 * У кисти предплечье во весь коридор, к запястью сужается и приподнимается (конец трубы — внутри ладони), к двери
 * тоньше, в проёме сжато под размер косяков (выше и уже) и выдавлено по обе стороны.
 */
export function armSection(d: number, sd: number, look: ArmLook, dims: ArmDims, out: ArmSection): ArmSection {
  const H = HAND;
  const far = smoothstep(0.3, 4.2, sd);
  const up = smoothstep(4.5, 7.5, d);
  let w: number, h: number;
  if (sd >= 0) {
    w = lerp(H.doorArmW, lerp(H.armW, H.upperW, up), far);
    h = lerp(H.doorArmH, lerp(H.armH, H.upperH, up), far);
  } else {
    const k = smoothstep(0, 1.6, -sd);
    w = lerp(H.doorArmW, 1.32, k);
    h = lerp(H.doorArmH, 1.5, k);
  }
  const ph = look.ph;
  w *= 1 + 0.035 * Math.sin(0.83 * d + ph[0]) + 0.02 * Math.sin(2.3 * d + ph[1]);
  h *= 1 + 0.03 * Math.sin(0.61 * d + ph[2]) + 0.015 * Math.sin(1.9 * d + ph[3]);
  let knob = 0, crease = 0;
  for (const e of look.elbows) {
    const x = d - e;
    if (x > 2.5) continue;
    if (x < -2.5) break;
    const g = Math.exp(-((x / 0.8) ** 2));
    w *= 1 + 0.08 * g;
    h *= 1 + 0.035 * g;
    knob = Math.max(knob, Math.exp(-((x / 0.42) ** 2)));
    // складки по обе стороны локтя и перетяжка между ними
    crease = Math.max(crease, Math.exp(-(((Math.abs(x) - 0.62) / 0.13) ** 2)), 0.7 * Math.exp(-(((Math.abs(x) - 0.95) / 0.1) ** 2)));
  }
  // предплечье у кисти: мышца, запястье, конец трубы внутри ладони
  w *= 1 + 0.05 * Math.exp(-(((d - 3.4) / 0.9) ** 2));
  const kw = smoothstep(H.wristD - 0.1, 4.4, d);
  w = lerp(1.36, w, kw);
  h = lerp(1.06, h, kw);
  let bottom = lerp(0.37, H.floorGap, smoothstep(H.wristD - 0.2, 4.1, d));
  crease = Math.max(crease, 0.8 * Math.exp(-(((d - H.wristD) / 0.12) ** 2)), 0.6 * Math.exp(-(((d - H.wristD - 0.38) / 0.12) ** 2)));
  const tendon = smoothstep(4.6, 2.4, d) * smoothstep(H.wristD - 0.2, H.wristD + 0.4, d);
  const ke = smoothstep(H.armEndD - 0.05, 1.65, d);
  w *= lerp(0.72, 1, ke);
  h *= lerp(0.72, 1, ke);
  // проём: плоть сжата косяками (уже и выше), по обе стороны выдавлена
  const asd = Math.abs(sd);
  const pinch = 1 - smoothstep(0.1, 0.42, asd);
  const bulge = Math.exp(-(((asd - 0.6) / 0.22) ** 2));
  w *= 1 + 0.1 * bulge;
  h *= 1 + 0.05 * bulge;
  w = lerp(w, Math.min(w, dims.doorW - 0.08), pinch);
  h = lerp(h, Math.min(dims.doorH - H.floorGap - 0.08, h * 1.25), pinch);
  bottom = lerp(bottom, H.floorGap, pinch);
  w = Math.min(w, dims.corridorW - 0.08);
  h = Math.min(h, dims.ceilH - bottom - 0.12);
  out.w = w;
  out.h = h;
  out.bottom = bottom;
  out.pinch = pinch;
  out.crease = crease;
  out.knob = knob;
  out.far = far;
  out.tendon = tendon;
  return out;
}

// ───────────────────────── пальцы (чистые функции) ─────────────────────────

/**
 * Палец в своей вертикальной плоскости: фаланги lens, угол первой к горизонту a (вверх +), каждый следующий сустав
 * сгибает вниз на b·wts[i]. Подбирает (a, b) так, чтобы конец последней фаланги пришёл в (u вперёд, v вверх) от
 * основания (Ньютон от прошлого решения в out — поза непрерывна, палец выгнут дугой вверх). Недостаёт — вытянут к цели.
 * Возвращает невязку, м.
 */
export function solveFinger(lens: readonly number[], wts: readonly number[], u: number, v: number, out: { a: number; b: number }): number {
  const n = lens.length;
  let total = 0;
  for (const l of lens) total += l;
  const dist = Math.hypot(u, v);
  if (dist >= total * 0.995) {
    out.a = Math.atan2(v, u);
    out.b = 0;
    return dist - total;
  }
  let a = out.a, b = out.b;
  if (!Number.isFinite(a) || !Number.isFinite(b)) {
    a = Math.atan2(v, u) + 0.8;
    b = 0.45;
  }
  let err = Infinity;
  for (let it = 0; it < 14; it++) {
    let x = 0, y = 0, ja1 = 0, ja2 = 0, jb1 = 0, jb2 = 0, c = 0;
    for (let i = 0; i < n; i++) {
      if (i > 0) c += wts[i - 1];
      const th = a - b * c;
      const co = Math.cos(th), si = Math.sin(th), l = lens[i];
      x += l * co;
      y += l * si;
      ja1 -= l * si;
      ja2 += l * co;
      jb1 += l * c * si;
      jb2 -= l * c * co;
    }
    const ex = x - u, ey = y - v;
    err = Math.hypot(ex, ey);
    if (err < 1e-4) break;
    const det = ja1 * jb2 - jb1 * ja2;
    if (Math.abs(det) < 1e-9) {
      b = clamp(b + 0.1, -0.3, 1.35);
      continue;
    }
    let da = (-ex * jb2 + jb1 * ey) / det;
    let db = (-ja1 * ey + ja2 * ex) / det;
    const m = Math.max(Math.abs(da), Math.abs(db));
    if (m > 0.35) {
      da *= 0.35 / m;
      db *= 0.35 / m;
    }
    a = clamp(a + da, -1.4, 1.7);
    b = clamp(b + db, -0.3, 1.35);
  }
  out.a = a;
  out.b = b;
  return err;
}

/**
 * Тычущий под кровать палец: ближняя фаланга (la) и следующие одним прямым звеном (lb) — от основания к началу дальних
 * фаланг (u вперёд, v вверх от основания; дальние лежат горизонтально под кроватью). Сустав между звеньями — над
 * прямой: палец дугой вверх и круто вниз, к полу у края кровати; не достаёт — оба звена по прямой к цели. Углы звеньев
 * к горизонту (вверх +), рад.
 */
export function pokeBend(la: number, lb: number, u: number, v: number, out: { a: number; b: number }): { a: number; b: number } {
  const line = Math.atan2(v, u);
  const d = Math.hypot(u, v);
  if (d >= la + lb - 1e-6) {
    out.a = out.b = line;
    return out;
  }
  const dd = Math.max(d, Math.abs(la - lb) + 1e-3);
  out.a = line + Math.acos(clamp((la * la + dd * dd - lb * lb) / (2 * la * dd), -1, 1));
  out.b = Math.atan2(v - la * Math.sin(out.a), u - la * Math.cos(out.a));
  return out;
}

/** Путь луча (x, y) + t·(vx, vy) (единичный) до прямоугольника плана r: внутри — 0, мимо — +∞. */
export function rayRect(x: number, y: number, vx: number, vy: number, r: { x0: number; y0: number; x1: number; y1: number }): number {
  let t0 = 0, t1 = Infinity;
  for (const [o, v, lo, hi] of [[x, vx, r.x0, r.x1], [y, vy, r.y0, r.y1]]) {
    if (Math.abs(v) < 1e-12) {
      if (o < lo || o > hi) return Infinity;
      continue;
    }
    const a = (lo - o) / v, b = (hi - o) / v;
    t0 = Math.max(t0, Math.min(a, b));
    t1 = Math.min(t1, Math.max(a, b));
  }
  return t0 <= t1 ? t0 : Infinity;
}

/**
 * Пол для фаланги: угол th к горизонту (вверх +) с началом на высоте y0 и длиной len — ближайший угол, при котором конец
 * не ниже clr: смотрит вперёд — поднимается к горизонту вперёд, назад (cos < 0) — к горизонту назад; конец и так не ниже
 * — th как есть (поза не трогается). Начало ниже clr − len — фаланга торчит вверх. Ветвь угла (± 2π) сохраняется.
 */
export function floorAngle(th: number, y0: number, len: number, clr: number): number {
  const need = (clr - y0) / len;
  if (Math.sin(th) >= need) return th;
  const tn = th - TAU * Math.round(th / TAU);
  const s = Math.asin(clamp(need, -1, 1));
  const to = Math.cos(tn) >= 0 ? s : tn > 0 ? Math.PI - s : -Math.PI - s;
  return th + (to - tn);
}

/**
 * Перебор пальцем по фазе p (0…1): опора (доля stance) — кончик стоит, относительно кисти уходит назад (k 0 → 1);
 * перенос — поднят (lift 0 → 1 → 0) и выносится вперёд (k 1 → 0).
 */
export function crawlGait(p: number, out: { k: number; lift: number }, stance = 0.7): { k: number; lift: number } {
  const q0 = p - Math.floor(p);
  if (q0 < stance) {
    out.k = q0 / stance;
    out.lift = 0;
  } else {
    const q = (q0 - stance) / (1 - stance);
    out.k = 1 - ease(q);
    out.lift = Math.sin(Math.PI * q);
  }
  return out;
}

/** Палец кисти (локально: f — вперёд от кончика руки, l — влево, y — вверх от пола), м. */
export interface FingerDef {
  /** основание (костяшка) */
  bf: number;
  bl: number;
  by: number;
  /** фаланги от основания */
  lens: number[];
  /** доли сгиба внутренних суставов (lens.length − 1) */
  wts: number[];
  /** толщина у основания и у кончика (радиус) */
  r0: number;
  r1: number;
  /** куда ставит кончик: поперёк (у стен) и вперёд — от front до back за опору */
  tl: number;
  front: number;
  back: number;
  /** фаза в цикле перебора и доля опоры в нём (шаг back → front = stance · HAND.crawlCycle: опора неподвижна в мире) */
  ph: number;
  stance: number;
  thumb: boolean;
  /** в проёме (кисть сжата): высота кончика — пальцы веером по высоте двери */
  sy: number;
  /** длина ногтя за кончиком */
  nail: number;
}

/** Пальцы руки по варианту (0…1): правая/левая, разброс длин и фаз; кончики крайних — у стен коридора. */
export function fingerDefs(variant: number, corridorW: number): { right: boolean; fingers: FingerDef[] } {
  const r = makeRng((Math.floor(variant * 0x7fffffff) ^ 0x5f3759df) >>> 0);
  const right = r.next() < 0.6;
  const j = (k: number) => 1 + (r.next() - 0.5) * k;
  const wall = corridorW / 2;
  const mk = (bf: number, bl: number, by: number, lens: number[], wts: number[], r0: number, r1: number, tl: number, front: number, ph: number, thumb: boolean, sy: number): FingerDef => {
    // большой палец короче — шаг у него короче (та же скорость опоры, меньшая её доля в цикле)
    const stance = thumb ? 0.45 : 0.7;
    const stride = stance * HAND.crawlCycle;
    const s = j(0.1);
    const L = lens.map((l) => l * s * j(0.06));
    const lim = wall - r1 - 0.05;
    const tlc = clamp(tl, -lim, lim);
    // передний край шага — в пределах досягаемости (97% длины пальца до кончика на полу): иначе палец не достанет
    // пола и опора «поедет» вместе с кистью
    const total = L.reduce((a, b) => a + b, 0);
    const v = r1 + 0.05 - by;
    const uMax = Math.sqrt(Math.max(0, (0.97 * total) ** 2 - v * v));
    const reach = bf + Math.sqrt(Math.max(0, uMax * uMax - (tlc - bl) ** 2));
    const fr = Math.min(front, reach);
    return {
      bf, bl, by, lens: L, wts, r0, r1, tl: tlc, front: fr, back: fr - stride, ph: ph + (r.next() - 0.5) * 0.1, stance, thumb, sy,
      nail: 0.24 + r.next() * 0.12,
    };
  };
  // правая рука ладонью вниз: большой палец слева (l > 0); сгиб больше к кончику — пальцы тянутся вперёд и
  // впиваются кончиками в пол (коготь), а не встают аркой
  const W4 = [0.55, 0.85, 1.15, 1.35];
  const fingers = [
    mk(0.05, 0.52, 1.06, [0.54, 0.47, 0.4, 0.34, 0.27], W4, 0.155, 0.088, wall - 0.12, 1.9, 0.0, false, 1.3),
    mk(0.13, 0.18, 1.1, [0.58, 0.52, 0.45, 0.38, 0.31], W4, 0.162, 0.092, 0.3, 2.1, 0.5, false, 1.0),
    mk(0.09, -0.17, 1.08, [0.56, 0.49, 0.43, 0.36, 0.29], W4, 0.155, 0.088, -0.32, 2.0, 0.2, false, 0.72),
    mk(-0.03, -0.5, 1.02, [0.47, 0.4, 0.35, 0.29, 0.23], W4, 0.138, 0.078, -(wall - 0.12), 1.6, 0.7, false, 0.45),
    mk(-0.88, 0.68, 0.8, [0.56, 0.52, 0.45], [0.8, 1.2], 0.19, 0.11, wall - 0.1, 0.5, 0.4, true, 0.35),
  ];
  if (!right) for (const f of fingers) {
    f.bl = -f.bl;
    f.tl = -f.tl;
  }
  return { right, fingers };
}

// ───────────────────────── кожа (чистая функция) ─────────────────────────

/** Решётка периодического шума nu × nv. */
function lattice(next: () => number, nu: number, nv = nu): Float32Array {
  const a = new Float32Array(nu * nv);
  for (let i = 0; i < a.length; i++) a[i] = next();
  return a;
}

/** Периодический (бесшовный) шум значений 0…1 по решётке nu × nv; u, v — доли повтора. */
function vnoise(lat: Float32Array, nu: number, nv: number, u: number, v: number): number {
  const x = u * nu, y = v * nv;
  const xi = Math.floor(x), yi = Math.floor(y);
  let fx = x - xi, fy = y - yi;
  fx = fx * fx * (3 - 2 * fx);
  fy = fy * fy * (3 - 2 * fy);
  const x0 = ((xi % nu) + nu) % nu, y0 = ((yi % nv) + nv) % nv;
  const x1 = (x0 + 1) % nu, y1 = (y0 + 1) % nv;
  const a = lat[y0 * nu + x0], b = lat[y0 * nu + x1], c = lat[y1 * nu + x0], d = lat[y1 * nu + x1];
  return a + (b - a) * fx + (c - a + (a - b - c + d) * fx) * fy;
}

/** Гребень шума: 1 там, где шум пересекает 0.5 (извилистые линии-складки). */
const ridge = (n: number) => 1 - Math.abs(2 * n - 1);

/**
 * Текстура кожи size × size (RGBA, бесшовная): бледная серо-жёлтая (#B9B2A0) с синеватыми и желтоватыми пятнами,
 * сетка извилистых складок (вытянуты поперёк руки, рвутся), поры, тонкие синеватые вены вдоль руки, редкие
 * старческие пятна; и карта нормалей того же рельефа (складки вдавлены, вены выпуклые). u — вокруг руки, v — вдоль.
 */
export function skinTexels(size: number, seed = 7): { color: Uint8Array; normal: Uint8Array } {
  const r = makeRng(seed);
  const nx = () => r.next();
  const M4 = lattice(nx, 4), M8 = lattice(nx, 8), M16 = lattice(nx, 16), P64 = lattice(nx, 64), P128 = lattice(nx, 128);
  // складки: крупные (6 × 36 — вытянуты вокруг руки) и мелкие (12 × 72), каждые — с рваной «заслонкой»
  const K1 = lattice(nx, 6, 36), K2 = lattice(nx, 12, 72), G1 = lattice(nx, 6), G2 = lattice(nx, 10), WU = lattice(nx, 8);
  const S16 = lattice(nx, 16), B6 = lattice(nx, 6);
  const veins: { u0: number; a1: number; f1: number; p1: number; a2: number; f2: number; p2: number; w: number; gate: Float32Array }[] = [];
  for (let i = 0; i < 7; i++) {
    veins.push({
      u0: (i + r.next() * 0.6) / 7,
      a1: 0.03 + r.next() * 0.07,
      f1: 1 + Math.floor(r.next() * 2),
      p1: r.next(),
      a2: 0.01 + r.next() * 0.025,
      f2: 3 + Math.floor(r.next() * 4),
      p2: r.next(),
      w: 0.004 + r.next() * 0.005,
      gate: lattice(nx, 3, 5),
    });
  }
  const N = size * size;
  const hgt = new Float32Array(N);
  const color = new Uint8Array(N * 4);
  const base = [190, 183, 165], blu = [150, 160, 178], yel = [201, 189, 156], bru = [168, 150, 158], veinC = [112, 126, 150], spotC = [150, 128, 102];
  const ucs = new Float32Array(veins.length);
  for (let y = 0; y < size; y++) {
    const v = y / size;
    // середины вен в этой строке (зависят только от v)
    for (let k = 0; k < veins.length; k++) {
      const vn = veins[k];
      ucs[k] = vn.u0 + vn.a1 * Math.sin(TAU * (v * vn.f1 + vn.p1)) + vn.a2 * Math.sin(TAU * (v * vn.f2 + vn.p2));
    }
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const m = 0.55 * vnoise(M4, 4, 4, u, v) + 0.3 * vnoise(M8, 8, 8, u, v) + 0.15 * vnoise(M16, 16, 16, u, v);
      const fine = 0.6 * vnoise(P64, 64, 64, u, v) + 0.4 * vnoise(P128, 128, 128, u, v);
      const wu = (vnoise(WU, 8, 8, u, v) - 0.5) * 0.08;
      const c1 = smoothstep(0.72, 0.98, ridge(vnoise(K1, 6, 36, u + wu, v))) * smoothstep(0.3, 0.65, vnoise(G1, 6, 6, u, v));
      const c2 = 0.5 * smoothstep(0.8, 0.985, ridge(vnoise(K2, 12, 72, u - wu, v))) * smoothstep(0.35, 0.7, vnoise(G2, 10, 10, u, v));
      const crease = Math.max(c1, c2);
      let vein = 0;
      for (let k = 0; k < veins.length; k++) {
        const vn = veins[k];
        let du = u - ucs[k];
        du -= Math.round(du);
        if (Math.abs(du) > vn.w * 4) continue;
        const g = smoothstep(0.35, 0.65, vnoise(vn.gate, 3, 5, u, v));
        if (g > 0) vein = Math.max(vein, Math.exp(-((du / vn.w) ** 2)) * g);
      }
      const spot = smoothstep(0.74, 0.88, vnoise(S16, 16, 16, u, v));
      const bruise = smoothstep(0.62, 0.85, vnoise(B6, 6, 6, u, v));
      const i = y * size + x;
      hgt[i] = 0.3 * fine - 0.5 * crease + 0.45 * vein + 0.12 * m;
      const kb = 0.6 * smoothstep(0.42, 0.75, m), ky = 0.4 * smoothstep(0.52, 0.25, m);
      const shade = (0.94 + 0.1 * fine) * (1 - 0.14 * crease);
      for (let c = 0; c < 3; c++) {
        let col = base[c];
        col += (blu[c] - col) * kb;
        col += (yel[c] - col) * ky;
        col += (bru[c] - col) * 0.35 * bruise;
        col *= shade;
        col += (veinC[c] - col) * 0.38 * vein;
        col += (spotC[c] - col) * 0.4 * spot;
        color[i * 4 + c] = clamp(Math.round(col), 0, 255);
      }
      color[i * 4 + 3] = 255;
    }
  }
  // карта нормалей (как snowGrain в ./snowView.ts)
  const normal = new Uint8Array(N * 4);
  const H = (x: number, y: number) => hgt[((y + size) % size) * size + ((x + size) % size)];
  const k = 2.6;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (H(x + 1, y) - H(x - 1, y)) * k, dy = (H(x, y + 1) - H(x, y - 1)) * k;
      const l = Math.hypot(dx, dy, 1);
      const o = (y * size + x) * 4;
      normal[o] = Math.round((-dx / l) * 127.5 + 127.5);
      normal[o + 1] = Math.round((-dy / l) * 127.5 + 127.5);
      normal[o + 2] = Math.round((1 / l) * 127.5 + 127.5);
      normal[o + 3] = 255;
    }
  }
  return { color, normal };
}

/** Общий материал кожи сцены (счётчик ссылок — освобождает последняя рука). */
const skins = new WeakMap<Scene, { mat: StandardMaterial; refs: number }>();
const SKIN_TEX = 512;

function acquireSkin(scene: Scene): StandardMaterial {
  const got = skins.get(scene);
  if (got) {
    got.refs++;
    return got.mat;
  }
  const { color, normal } = skinTexels(SKIN_TEX);
  const tex = (data: Uint8Array, name: string) => {
    const t = RawTexture.CreateRGBATexture(data, SKIN_TEX, SKIN_TEX, scene, true, false, Texture.TRILINEAR_SAMPLINGMODE);
    t.name = name;
    t.wrapU = t.wrapV = Texture.WRAP_ADDRESSMODE;
    t.anisotropicFilteringLevel = 4;
    return t;
  };
  const m = new StandardMaterial('obshaga:handSkin', scene);
  m.diffuseColor = Color3.White();
  m.diffuseTexture = tex(color, 'obshaga:handSkin');
  m.bumpTexture = tex(normal, 'obshaga:handBump');
  m.bumpTexture.level = 0.9;
  // матовая кожа, чуть влажная: слабый широкий блик; своего света нет
  m.specularColor = new Color3(0.07, 0.07, 0.065);
  m.specularPower = 14;
  m.emissiveColor = Color3.Black();
  m.ambientColor = Color3.Black();
  // в «Прогулке» уже 4 источника (полусфера, лампа настроения, своя и чужая керосинки): лампа не должна выпасть
  m.maxSimultaneousLights = 6;
  skins.set(scene, { mat: m, refs: 1 });
  return m;
}

function releaseSkin(scene: Scene) {
  const got = skins.get(scene);
  if (!got || --got.refs > 0) return;
  got.mat.diffuseTexture?.dispose();
  got.mat.bumpTexture?.dispose();
  got.mat.dispose();
  skins.delete(scene);
}

// ───────────────────────── сетки ─────────────────────────

/**
 * Нормали сетки rows × cols (+ шовный столбец — копия первого) центральными разностями, наружу — от центра ряда
 * (centers — xyz по рядам). Без накопления по граням: шов и концы гладкие, ничего не выделяет.
 */
function gridNormals(pos: Float32Array, nor: Float32Array, base: number, rows: number, cols: number, centers: Float32Array, cbase: number) {
  const C = cols + 1;
  for (let r = 0; r < rows; r++) {
    const r0 = r > 0 ? r - 1 : 0, r1 = r < rows - 1 ? r + 1 : rows - 1;
    const cx = centers[(cbase + r) * 3], cy = centers[(cbase + r) * 3 + 1], cz = centers[(cbase + r) * 3 + 2];
    for (let c = 0; c < cols; c++) {
      const c0 = c > 0 ? c - 1 : cols - 1, c1 = c < cols - 1 ? c + 1 : 0;
      const i = (base + r * C + c) * 3;
      const a0 = (base + r0 * C + c) * 3, a1 = (base + r1 * C + c) * 3;
      const b0 = (base + r * C + c0) * 3, b1 = (base + r * C + c1) * 3;
      const sx = pos[a1] - pos[a0], sy = pos[a1 + 1] - pos[a0 + 1], sz = pos[a1 + 2] - pos[a0 + 2];
      const ux = pos[b1] - pos[b0], uy = pos[b1 + 1] - pos[b0 + 1], uz = pos[b1 + 2] - pos[b0 + 2];
      let nx = uy * sz - uz * sy, ny = uz * sx - ux * sz, nz = ux * sy - uy * sx;
      const ox = pos[i] - cx, oy = pos[i + 1] - cy, oz = pos[i + 2] - cz;
      let l = Math.hypot(nx, ny, nz);
      if (l < 1e-12) {
        nx = ox;
        ny = oy;
        nz = oz;
        l = Math.hypot(nx, ny, nz) || 1;
        if (l === 1 && nx === 0 && ny === 0 && nz === 0) ny = 1;
      }
      if (nx * ox + ny * oy + nz * oz < 0) l = -l;
      nx /= l;
      ny /= l;
      nz /= l;
      nor[i] = nx;
      nor[i + 1] = ny;
      nor[i + 2] = nz;
      if (c === 0) {
        const k = (base + r * C + cols) * 3;
        nor[k] = nx;
        nor[k + 1] = ny;
        nor[k + 2] = nz;
      }
    }
  }
}

/**
 * Порядок обхода треугольников сетки: Babylon (левая система) считает лицевым треугольник, у которого
 * cross(p1 − p0, p2 − p0) смотрит против нормали (как в CreatePlane). Проверка на четырёхугольнике в середине.
 */
function gridFlip(pos: Float32Array, nor: Float32Array, base: number, rows: number, cols: number): boolean {
  const C = cols + 1;
  const a = base + (rows >> 1) * C + (cols >> 2), b = a + 1, d = a + C + 1;
  const ux = pos[b * 3] - pos[a * 3], uy = pos[b * 3 + 1] - pos[a * 3 + 1], uz = pos[b * 3 + 2] - pos[a * 3 + 2];
  const vx = pos[d * 3] - pos[a * 3], vy = pos[d * 3 + 1] - pos[a * 3 + 1], vz = pos[d * 3 + 2] - pos[a * 3 + 2];
  const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  return nx * nor[a * 3] + ny * nor[a * 3 + 1] + nz * nor[a * 3 + 2] > 0;
}

function gridIndices(out: Uint16Array | Uint32Array, at: number, base: number, rows: number, cols: number, flip: boolean): number {
  const C = cols + 1;
  for (let r = 0; r < rows - 1; r++) {
    for (let c = 0; c < cols; c++) {
      const a = base + r * C + c, b = a + 1, e = a + C, d = e + 1;
      if (!flip) {
        out[at++] = a; out[at++] = b; out[at++] = d;
        out[at++] = a; out[at++] = d; out[at++] = e;
      } else {
        out[at++] = a; out[at++] = d; out[at++] = b;
        out[at++] = a; out[at++] = e; out[at++] = d;
      }
    }
  }
  return at;
}

/** Крышки трубы руки: (сдвиг вдоль оси от крайнего кольца, м; масштаб сечения) — 3 сзади, 3 спереди. */
const ARM_CAPS = [-0.3, 0.07, -0.2, 0.55, -0.1, 0.83, 0.1, 0.83, 0.19, 0.55, 0.25, 0.07];
/** Кольца внутри фаланги (доли длины) и крышка-подушечка пальца (сдвиг в радиусах кончика, масштаб). */
const PHAL_Q = [0.25, 0.5, 0.75];
const TIP_CAP = [0.5, 0.86, 0.85, 0.55, 1.0, 0.07];

/** Сглаживание 1-2-3-2-1 внутренних точек (по две с концов не трогает); tmp — скретч. */
function smooth5(a: number[], tmp: number[], n: number) {
  for (let i = 0; i < n; i++) tmp[i] = a[i];
  for (let i = 2; i < n - 2; i++) a[i] = (tmp[i - 2] + 2 * tmp[i - 1] + 3 * tmp[i] + 2 * tmp[i + 1] + tmp[i + 2]) / 9;
}

const growF = (a: Float32Array<ArrayBuffer>, n: number): Float32Array<ArrayBuffer> => {
  if (a.length >= n) return a;
  const b = new Float32Array(Math.ceil(n * 1.5));
  b.set(a);
  return b;
};
const growN = (a: number[], n: number) => {
  while (a.length < n) a.push(0);
  return a;
};

// ───────────────────────── меш ─────────────────────────

export interface HandMeshOptions {
  /** ширина и высота коридора, м (2.0 × 2.5): рука во весь коридор, кончики крайних пальцев у стен */
  corridorW?: number;
  ceilH?: number;
  /** проём двери, м (0.8 × 2.05): рука в нём сжата косяками */
  doorW?: number;
  doorH?: number;
  /** trail[0] глубже плоскости проёма на столько, м (если update не получил doorway) */
  doorDepth?: number;
  /** слой мешей (по умолчанию PORTAL_LAYER — для PortalRenderer.extras) */
  layerMask?: number;
  /** сид облика (лишние локти, бугры); вариант пальцев — из view.variant */
  seed?: number;
}

interface ArmRun {
  mesh: Mesh;
  /** вершин в буферах меша (−1 — ещё не заливали) */
  verts: number;
  pos: Float32Array;
  nor: Float32Array;
  uv: Float32Array;
  col: Float32Array;
  room: string;
}

interface WorldCache {
  x: number;
  y: number;
  room: string;
  wx: number;
  wy: number;
  wz: number;
}

/** Сетка кисти: смещение первой вершины, ряды, сегменты (без шовного), первый ряд в таблице центров. */
interface HGrid {
  base: number;
  rows: number;
  cols: number;
  cbase: number;
}

/** Огромная рука общаги: см. шапку файла. */
export class HandMesh {
  readonly material: StandardMaterial;
  private readonly dims: ArmDims;
  private readonly layerMask: number;
  private readonly doorDepth: number;
  private readonly look: ArmLook;
  private enabled = true;
  private shown = false;
  private disposed = false;

  // ── текущая рука (новая — сброс состояния) ──
  private k0x = NaN;
  private k0y = NaN;
  private k0r = '';
  private kVar = NaN;
  private lastT = 0;
  /** направление кисти в мире, рад: вперёд F = (cos, 0, sin) */
  private yaw = 0;
  private prevTipX = 0;
  private prevTipY = 0;
  /** путь кисти вперёд (цикл перебора) и весь путь (скребущие пальцы при отступлении), м */
  private crawl = 0;
  private path = 0;
  /** смеси поз 0…1: кулак, отступление, движение */
  private grab = 0;
  private retr = 0;
  private move = 0;
  /** тычок под кровать: смесь позы 0…1, фаза цикла 0…1 (и последняя присланная), цель в мире (по точке плана) */
  private pk = 0;
  private pokeU = 0;
  private pokeSrc = NaN;
  private pkX = NaN;
  private pkY = NaN;
  private pkR = '';
  private pkWx = 0;
  private pkWy = 0;
  private pkWz = 0;
  /** тычущий палец: ближняя фаланга, следующие (одно звено), дальние (горизонтально), углы звеньев; кончик (локально f, l, y) */
  private pokeLa = 0;
  private pokeLb = 0;
  private pokeLd = 0;
  private readonly pokeAng = { a: 0, b: 0 };
  private readonly pokeTipL = new Float32Array(3);
  /** веса суставов упёртого пальца в позе тычка (смесь fd.wts → PLANT_W) */
  private readonly wtmp = [0, 0, 0, 0];
  private sig = NaN;
  private right = true;
  private fingers: FingerDef[] = [];
  private ik: { a: number; b: number }[] = [];
  /** кончик в мире, длина руки, проём на пути */
  private ox = 0;
  private oy = 0;
  private oz = 0;
  private L = 0;
  private sDoor = 0;
  private tipRoom: string | undefined = undefined;

  // ── ось и кольца руки ──
  private arcs: number[] = [];
  private samples: SpinePt[] = [];
  private wcache: WorldCache[] = [];
  private cx: number[] = [];
  private cy: number[] = [];
  private cz: number[] = [];
  private cs: number[] = [];
  private cr: string[] = [];
  private tx: number[] = [];
  private ty: number[] = [];
  private tz: number[] = [];
  /** кольца: точка оси на полу (x, y, z), касательная, путь, комната, масштаб (крышки), кривизна вбок */
  private rx: number[] = [];
  private ry: number[] = [];
  private rz: number[] = [];
  private rtx: number[] = [];
  private rty: number[] = [];
  private rtz: number[] = [];
  private rs: number[] = [];
  private rsc: number[] = [];
  private rk: number[] = [];
  private rroom: string[] = [];
  private readonly ctrlArrs = [this.cx, this.cy, this.cz, this.cs, this.tx, this.ty, this.tz];
  private readonly ringArrs = [this.rx, this.ry, this.rz, this.rtx, this.rty, this.rtz, this.rs, this.rsc, this.rk];
  private nRings = 0;
  private aPos = new Float32Array(0);
  private aNor = new Float32Array(0);
  private aUv = new Float32Array(0);
  private aCol = new Float32Array(0);
  private aCen = new Float32Array(0);
  /** порядок обхода трубы (определяется на первой постройке) и индексы на maxRows колец */
  private aFlip: boolean | null = null;
  private aIdx: Uint16Array | Uint32Array = new Uint16Array(0);
  private aIdxRows = 0;
  private runs: ArmRun[] = [];
  private runDefs: RoomRun[] = [];
  private nRuns = 0;
  private handRooms: string[] = [];

  // ── кисть ──
  private hand: Mesh;
  private grids: HGrid[] = [];
  private hVerts = 0;
  private hLoc: Float32Array;
  private hPos: Float32Array;
  private hNor: Float32Array;
  private hUv: Float32Array;
  private hCol: Float32Array;
  private hCenL: Float32Array;
  private hCen: Float32Array;
  private hUploaded = false;
  /** цвета/развёртка кисти залиты для этого варианта */
  private hColorsFor = NaN;

  // ── коллизии ──
  private boxes: Mesh[] = [];
  private nBoxes = 0;
  private boxRoom: string[] = [];
  private colTipX = NaN;
  private colTipY = NaN;
  private colRings = -1;

  // ── карты по комнатам ──
  private rooms = new Map<string, Mesh[]>();
  private colRooms = new Map<string, Mesh[]>();
  private readonly empty = new Map<string, Mesh[]>();
  private readonly listPool = new Map<string, Mesh[]>();
  private readonly colPool = new Map<string, Mesh[]>();

  // ── скретч ──
  private readonly sec: ArmSection = { w: 0, h: 0, bottom: 0, pinch: 0, crease: 0, knob: 0, far: 0, tendon: 0 };
  private readonly p2 = { x: 0, y: 0 };
  private readonly qPt: Pt = { x: 0, y: 0 };
  private readonly gait = { k: 0, lift: 0 };
  /** таблицы сечения руки по сегментам */
  private readonly tSx: Float32Array;
  private readonly tSy: Float32Array;
  private readonly tBot: Float32Array;
  private readonly tRidge: Float32Array;
  private readonly tKnob: Float32Array;
  private readonly tTend: Float32Array;
  private readonly tSide: Float32Array;
  private readonly tS2: Float32Array;
  private readonly tC2: Float32Array;
  private readonly tS3: Float32Array;
  private readonly tC3: Float32Array;
  private readonly tS5: Float32Array;
  private readonly tC5: Float32Array;

  constructor(readonly scene: Scene, opts: HandMeshOptions = {}) {
    this.dims = {
      corridorW: opts.corridorW ?? HAND.corridorW,
      ceilH: opts.ceilH ?? HAND.ceilH,
      doorW: opts.doorW ?? HAND.doorW,
      doorH: opts.doorH ?? HAND.doorH,
    };
    this.layerMask = opts.layerMask ?? PORTAL_LAYER;
    this.doorDepth = opts.doorDepth ?? HAND.doorDepth;
    this.look = armLook(opts.seed ?? 1);
    this.material = acquireSkin(scene);

    // сечение руки: φ = 0 — низ (шов текстуры на полу), против часовой — бок, π — верх
    const S = HAND.seg;
    const mk = () => new Float32Array(S);
    this.tSx = mk(); this.tSy = mk(); this.tBot = mk(); this.tRidge = mk(); this.tKnob = mk(); this.tTend = mk(); this.tSide = mk();
    this.tS2 = mk(); this.tC2 = mk(); this.tS3 = mk(); this.tC3 = mk(); this.tS5 = mk(); this.tC5 = mk();
    for (let j = 0; j < S; j++) {
      const f = (TAU * j) / S;
      const s = Math.sin(f), c = Math.cos(f);
      // низ площе (рука лежит на полу), верх круглее
      const e = c > 0 ? 2 / 3.3 : 2 / 2.3;
      // плоть расплывается по полу: у низа сечение шире
      this.tSx[j] = sgnPow(s, e) * (1 + 0.06 * smoothstep(0.2, 0.75, c));
      this.tSy[j] = -sgnPow(c, e);
      this.tBot[j] = smoothstep(0.55, 0.95, c);
      const dp = f - Math.PI;
      const g = (x: number, w: number) => Math.exp(-((x / w) ** 2));
      this.tRidge[j] = 0.025 * g(dp, 0.32);
      this.tKnob[j] = 0.11 * g(dp, 0.3) + 0.07 * g(dp - 0.65, 0.24) + 0.07 * g(dp + 0.65, 0.24);
      this.tTend[j] = 0.03 * (g(dp - 0.35, 0.18) + g(dp + 0.35, 0.18) + g(dp - 0.9, 0.2));
      this.tSide[j] = Math.pow(Math.abs(s), 4) * (c < 0.3 ? 1 : 0.4);
      this.tS2[j] = Math.sin(2 * f); this.tC2[j] = Math.cos(2 * f);
      this.tS3[j] = Math.sin(3 * f); this.tC3[j] = Math.cos(3 * f);
      this.tS5[j] = Math.sin(5 * f); this.tC5[j] = Math.cos(5 * f);
    }

    // кисть: ладонь, 5 пальцев, 5 ногтей — постоянная топология
    const defs = fingerDefs(0.5, this.dims.corridorW).fingers;
    let base = 0, cb = 0;
    const add = (rows: number, cols: number) => {
      this.grids.push({ base, rows, cols, cbase: cb });
      base += rows * (cols + 1);
      cb += rows;
    };
    add(PR, PC);
    for (const f of defs) add(4 * f.lens.length + 1 + 3, FC);
    for (let i = 0; i < defs.length; i++) add(NR, NC);
    this.hVerts = base;
    this.hLoc = new Float32Array(base * 3);
    this.hPos = new Float32Array(base * 3);
    this.hNor = new Float32Array(base * 3);
    this.hUv = new Float32Array(base * 2);
    this.hCol = new Float32Array(base * 4);
    this.hCenL = new Float32Array(cb * 3);
    this.hCen = new Float32Array(cb * 3);
    this.hand = this.newMesh('obshaga:hand');
  }

  // ───────────── публичное ─────────────

  /**
   * Кадр. view — вид руки (null / visible = false — спрятать); toWorld — точка плана на полу → мир; t — время, с;
   * doorway — середина проёма двери на плане (необязательно).
   */
  update(view: HandView | null | undefined, toWorld: (p: Pt) => Vector3, t: number, doorway?: Pt | null): void {
    if (this.disposed) return;
    if (!view || !view.visible || !this.enabled || !view.trail.length) {
      this.hide();
      this.lastT = t;
      return;
    }
    const trail = view.trail;
    const t0 = trail[0];
    const fresh = !this.shown || t0.x !== this.k0x || t0.y !== this.k0y || (t0.room ?? '') !== this.k0r || view.variant !== this.kVar;
    if (fresh) this.reset(view);
    const dt = fresh || !(t > this.lastT) ? 0 : Math.min(0.1, t - this.lastT);
    this.lastT = t;
    const frozen = view.frozen && !fresh;

    const L = (this.L = trailArcs(trail, this.arcs));
    // проём на пути от trail[0]
    let sd = NaN;
    if (doorway) {
      sd = projectArc(trail, this.arcs, doorway);
      if (!Number.isFinite(sd)) sd = (doorway.x - t0.x) * Math.cos(view.heading) + (doorway.y - t0.y) * Math.sin(view.heading);
    }
    this.sDoor = Number.isFinite(sd) ? sd : this.doorDepth;

    // кончик в мире и направление кисти — по последним 1.2 м оси
    const tip = view.tip;
    const moved = Math.hypot(tip.x - this.prevTipX, tip.y - this.prevTipY);
    if (fresh || moved > 0 || tip.room !== this.tipRoom) {
      const ow = this.world(toWorld, tip.x, tip.y, tip.room ?? '');
      this.ox = ow.x;
      this.oy = ow.y;
      this.oz = ow.z;
      this.tipRoom = tip.room;
    }
    // цель тычка в мире (по точке плана, только при её смене)
    const pa = view.pokeAt;
    if (pa && (pa.x !== this.pkX || pa.y !== this.pkY || (pa.room ?? '') !== this.pkR)) {
      const w = this.world(toWorld, pa.x, pa.y, pa.room ?? '');
      this.pkWx = w.x;
      this.pkWy = w.y;
      this.pkWz = w.z;
      this.pkX = pa.x;
      this.pkY = pa.y;
      this.pkR = pa.room ?? '';
    }
    if (fresh || !frozen) {
      let bx = -Math.cos(view.heading), by = -Math.sin(view.heading);
      if (L > 0.05) {
        planAt(trail, this.arcs, 0, 0, Math.min(0.8, L), this.p2);
        const l = Math.hypot(t0.x - this.p2.x, t0.y - this.p2.y);
        if (l > 1e-6) {
          bx = (t0.x - this.p2.x) / l;
          by = (t0.y - this.p2.y) / l;
        }
      }
      planAt(trail, this.arcs, bx, by, L - 1.2, this.p2);
      const bw = this.world(toWorld, this.p2.x, this.p2.y, tip.room ?? '');
      const dx = this.ox - bw.x, dz = this.oz - bw.z;
      if (dx * dx + dz * dz > 1e-8) {
        let target = Math.atan2(dz, dx);
        // тычет — кисть доворачивает к игроку под кроватью (запястье гнётся не больше POKE.turn): пришла к кровати
        // наискось (короткий подход в тесной комнате) — палец не тянется поперёк кисти
        if (view.poke && this.pk > 0) {
          let d = Math.atan2(this.pkWz - this.oz, this.pkWx - this.ox) - target;
          d -= TAU * Math.round(d / TAU);
          if (Number.isFinite(d)) target += clamp(d, -POKE.turn, POKE.turn) * ease(this.pk);
        }
        if (fresh) this.yaw = target;
        else if (!frozen) {
          let dd = target - this.yaw;
          dd -= TAU * Math.round(dd / TAU);
          this.yaw += clamp(dd, -HAND.turnRate * dt, HAND.turnRate * dt);
        }
      }
    }

    // путь и смеси поз (замершая — ничего не меняется)
    if (!fresh && !frozen) {
      if (view.phase === 'stalking' || view.phase === 'emerging') this.crawl += moved;
      this.path += moved;
      const grabbing = view.phase === 'grabbing';
      this.grab = approach(this.grab, grabbing ? 1 : 0, dt / (grabbing ? 0.16 : 0.6));
      this.retr = approach(this.retr, view.phase === 'retreating' ? 1 : 0, dt / 0.35);
      this.move = approach(this.move, moved > 1e-5 ? 1 : 0, dt / 0.25);
    }
    // тычок под кровать — и у замершей (палец, что достаёт, бьёт под взглядом); фаза — по виду, между срезами — сама
    if (!fresh) this.pk = approach(this.pk, view.poke ? 1 : 0, dt / 0.3);
    if (view.poke) {
      const u = view.poke01;
      if (u !== this.pokeSrc) this.pokeU = this.pokeSrc = u;
      else this.pokeU = (this.pokeU + dt / OBSHAGA.pokePeriodS) % 1;
    }
    this.prevTipX = tip.x;
    this.prevTipY = tip.y;

    // труба руки — только при изменении
    let sum = trail.length * 7.31 + this.yaw * 3.7 + this.sDoor * 1.9 + this.ox * 0.37 + this.oy * 0.71 + this.oz * 0.53;
    for (let i = 0; i < trail.length; i++) sum += (trail[i].x * 1.3 + trail[i].y * 2.7) * (i + 1);
    let rebuilt = false;
    if (fresh || sum !== this.sig) {
      this.sig = sum;
      this.buildArm(view, toWorld);
      rebuilt = true;
    }
    if (fresh || rebuilt || !frozen || this.pk > 0) this.buildHand(view, t, fresh);
    if (rebuilt && (fresh || this.nRings !== this.colRings || Math.hypot(tip.x - this.colTipX, tip.y - this.colTipY) > 0.1)) {
      this.buildColliders(view);
      this.colTipX = tip.x;
      this.colTipY = tip.y;
      this.colRings = this.nRings;
    }
    if (!this.shown) this.show();
    if (rebuilt) this.fillRooms();
  }

  /** Меши по комнатам (для PortalRenderer.extras): живая карта; пока руки нет — пустая. */
  byRoom(): Map<string, Mesh[]> {
    return this.shown && this.enabled ? this.rooms : this.empty;
  }

  /** Невидимые коробки-коллайдеры (checkCollisions) вдоль руки и под ладонью, по комнатам; пока руки нет — пустая. */
  colliders(): Map<string, Mesh[]> {
    return this.shown && this.enabled ? this.colRooms : this.empty;
  }

  /** Полость кулака в мире (середина суставов четырёх пальцев — куда ставить схваченного), пока рука сжимается; иначе null. */
  fistCenter(out = new Vector3()): Vector3 | null {
    if (!this.shown || this.grab < 0.3) return null;
    const fx = Math.cos(this.yaw), fz = Math.sin(this.yaw);
    const f = this.fist[0], l = this.fist[1];
    return out.set(this.ox + fx * f - fz * l, this.oy + this.fist[2], this.oz + fz * f + fx * l);
  }

  /** Кончик тычущего пальца в мире (край ногтя не считая), пока рука тычет под кровать; иначе null. */
  pokeTip(out = new Vector3()): Vector3 | null {
    if (!this.shown || this.pk < 0.3) return null;
    const fx = Math.cos(this.yaw), fz = Math.sin(this.yaw);
    const f = this.pokeTipL[0], l = this.pokeTipL[1];
    return out.set(this.ox + fx * f - fz * l, this.oy + this.pokeTipL[2], this.oz + fz * f + fx * l);
  }

  /** Для QA: вершин и мешей сейчас. */
  stats(): { arm: number; hand: number; meshes: number; colliders: number; rooms: number } {
    let arm = 0;
    for (let i = 0; i < this.nRuns; i++) arm += Math.max(0, this.runs[i].verts);
    return { arm, hand: this.hVerts, meshes: this.nRuns + 1, colliders: this.nBoxes, rooms: this.rooms.size };
  }

  setEnabled(on: boolean): void {
    if (on === this.enabled) return;
    this.enabled = on;
    if (!on) this.hide();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.hide();
    for (const r of this.runs) r.mesh.dispose(false, false);
    for (const b of this.boxes) b.dispose(false, false);
    this.hand.dispose(false, false);
    this.runs = [];
    this.boxes = [];
    releaseSkin(this.scene);
  }

  // ───────────── состояние ─────────────

  private reset(view: HandView) {
    const t0 = view.trail[0];
    this.k0x = t0.x;
    this.k0y = t0.y;
    this.k0r = t0.room ?? '';
    if (view.variant !== this.kVar) {
      const d = fingerDefs(view.variant, this.dims.corridorW);
      this.right = d.right;
      this.fingers = d.fingers;
    }
    this.kVar = view.variant;
    this.ik = this.fingers.map(() => ({ a: NaN, b: NaN }));
    const pl = this.fingers[POKE.finger].lens;
    this.pokeLa = pl[0];
    this.pokeLb = pl.slice(1, POKE.prox).reduce((a, b) => a + b, 0);
    this.pokeLd = pl.slice(POKE.prox).reduce((a, b) => a + b, 0);
    this.crawl = view.variant * HAND.crawlCycle;
    this.path = 0;
    this.grab = view.phase === 'grabbing' ? 1 : 0;
    this.retr = view.phase === 'retreating' ? 1 : 0;
    this.move = 0;
    this.pk = view.poke ? 1 : 0;
    this.pokeU = view.poke01;
    this.pokeSrc = NaN;
    this.prevTipX = view.tip.x;
    this.prevTipY = view.tip.y;
    this.sig = NaN;
    this.colRings = -1;
    this.wcache.length = 0;
  }

  /** Точка плана → мир (переиспользуемый Pt). */
  private world(toWorld: (p: Pt) => Vector3, x: number, y: number, room: string): Vector3 {
    const q = this.qPt;
    q.x = x;
    q.y = y;
    q.room = room || undefined;
    return toWorld(q);
  }

  private newMesh(name: string): Mesh {
    const m = new Mesh(name, this.scene);
    m.material = this.material;
    m.layerMask = this.layerMask;
    m.isPickable = false;
    m.alwaysSelectAsActiveMesh = true;
    m.freezeWorldMatrix();
    m.setEnabled(false);
    return m;
  }

  private show() {
    this.shown = true;
    this.hand.setEnabled(true);
    for (let i = 0; i < this.nRuns; i++) this.runs[i].mesh.setEnabled(true);
    for (let i = 0; i < this.nBoxes; i++) this.boxes[i].setEnabled(true);
  }

  private hide() {
    if (!this.shown) return;
    this.shown = false;
    this.hand.setEnabled(false);
    for (const r of this.runs) r.mesh.setEnabled(false);
    for (const b of this.boxes) b.setEnabled(false);
    this.k0x = NaN;
  }

  // ───────────── труба руки ─────────────

  private buildArm(view: HandView, toWorld: (p: Pt) => Vector3) {
    const trail = view.trail;
    const t0 = trail[0];
    const L = this.L;
    let bx = -Math.cos(view.heading), by = -Math.sin(view.heading);
    if (L > 0.05) {
      planAt(trail, this.arcs, 0, 0, Math.min(0.8, L), this.p2);
      const l = Math.hypot(t0.x - this.p2.x, t0.y - this.p2.y);
      if (l > 1e-6) {
        bx = (t0.x - this.p2.x) / l;
        by = (t0.y - this.p2.y) / l;
      }
    }
    // опорные точки оси: от двери (и за неё, в комнату) — до запястья; дальше две — по направлению кисти
    const n = spineSamples(trail, this.arcs, bx, by, HAND.ctrlStep, HAND.rootExt, L - HAND.wristD - 0.3, this.samples);
    const nc = n + 2;
    for (const a of this.ctrlArrs) growN(a, nc);
    for (let i = 0; i < n; i++) {
      const sp = this.samples[i];
      let c = this.wcache[i];
      if (!c) c = this.wcache[i] = { x: NaN, y: NaN, room: '', wx: 0, wy: 0, wz: 0 };
      if (c.x !== sp.x || c.y !== sp.y || c.room !== sp.room) {
        const w = this.world(toWorld, sp.x, sp.y, sp.room);
        c.x = sp.x;
        c.y = sp.y;
        c.room = sp.room;
        c.wx = w.x;
        c.wy = w.y;
        c.wz = w.z;
      }
      this.cx[i] = c.wx;
      this.cy[i] = c.wy;
      this.cz[i] = c.wz;
      this.cs[i] = sp.s;
      this.cr[i] = sp.room;
    }
    const fx = Math.cos(this.yaw), fz = Math.sin(this.yaw);
    const tipRoom = view.tip.room ?? '';
    for (let k = 0; k < 2; k++) {
      const back = k === 0 ? HAND.wristD : HAND.armEndD;
      this.cx[n + k] = this.ox - fx * back;
      this.cy[n + k] = this.oy;
      this.cz[n + k] = this.oz - fz * back;
      this.cs[n + k] = L - back;
      this.cr[n + k] = tipRoom;
    }
    this.cr.length = nc;
    // сглаживание оси (углы коридора скругляются; концы не трогаем — корень и вход в ладонь)
    for (let pass = 0; pass < 2; pass++) {
      smooth5(this.cx, this.tx, nc);
      smooth5(this.cy, this.ty, nc);
      smooth5(this.cz, this.tz, nc);
    }

    // кольца: Катмулл — Ром по опорным, ~ringStep; 3 кольца крышки с каждого конца
    let maxR = 6 + 1;
    for (let i = 0; i < nc - 1; i++) maxR += Math.max(1, Math.round(this.dist3(i, i + 1) / HAND.ringStep));
    for (const a of this.ringArrs) growN(a, maxR);
    let nr = 3;
    for (let i = 0; i < nc - 1; i++) {
      const m = Math.max(1, Math.round(this.dist3(i, i + 1) / HAND.ringStep));
      const last = i === nc - 2;
      for (let j = 0; j < m + (last ? 1 : 0); j++) {
        const t = j / m;
        this.catmull(i, nc, t, nr);
        this.rs[nr] = this.cs[i] + (this.cs[i + 1] - this.cs[i]) * t;
        this.rroom[nr] = t < 0.5 ? this.cr[i] : this.cr[i + 1];
        this.rsc[nr] = 1;
        nr++;
      }
    }
    const first = 3, lastR = nr - 1;
    // кривизна вбок (для сжатия внутренней стороны изгиба)
    for (let i = first; i <= lastR; i++) {
      const a = Math.max(first, i - 1), b = Math.min(lastR, i + 1);
      const ds = Math.hypot(this.rx[b] - this.rx[a], this.ry[b] - this.ry[a], this.rz[b] - this.rz[a]);
      const lx = -this.rtz[i], lz = this.rtx[i];
      const ll = Math.hypot(lx, lz) || 1;
      this.rk[i] = ds > 1e-6 ? ((this.rtx[b] - this.rtx[a]) * lx + (this.rtz[b] - this.rtz[a]) * lz) / ll / ds : 0;
    }
    // крышки: сзади (глубоко в комнате) и спереди (внутри ладони)
    for (let q = 0; q < 6; q++) {
      const k = q < 3 ? q : nr + q - 3, src = q < 3 ? first : lastR, o = ARM_CAPS[q * 2], sc = ARM_CAPS[q * 2 + 1];
      this.rtx[k] = this.rtx[src];
      this.rty[k] = this.rty[src];
      this.rtz[k] = this.rtz[src];
      this.rx[k] = this.rx[src] + this.rtx[src] * o;
      this.ry[k] = this.ry[src] + this.rty[src] * o;
      this.rz[k] = this.rz[src] + this.rtz[src] * o;
      this.rs[k] = this.rs[src];
      this.rroom[k] = this.rroom[src];
      this.rsc[k] = sc;
      this.rk[k] = 0;
    }
    nr += 3;
    this.nRings = nr;
    this.rroom.length = nr;

    // вершины
    const S = HAND.seg, C = S + 1;
    const nv = nr * C;
    this.aPos = growF(this.aPos, nv * 3);
    this.aNor = growF(this.aNor, nv * 3);
    this.aUv = growF(this.aUv, nv * 2);
    this.aCol = growF(this.aCol, nv * 4);
    this.aCen = growF(this.aCen, nr * 3);
    const pos = this.aPos, uv = this.aUv, col = this.aCol, cen = this.aCen;
    const ph = this.look.ph;
    const sec = this.sec;
    for (let i = 0; i < nr; i++) {
      const s = this.rs[i];
      const d = L - s;
      armSection(d, s - this.sDoor, this.look, this.dims, sec);
      const sc = this.rsc[i];
      const w = 0.5 * sec.w * sc, h = 0.5 * sec.h * sc;
      const yc = sec.bottom + 0.5 * sec.h;
      const tx = this.rtx[i], ty = this.rty[i], tz = this.rtz[i];
      let lx = -tz, lz = tx;
      const ll = Math.hypot(lx, lz);
      if (ll > 1e-6) {
        lx /= ll;
        lz /= ll;
      } else {
        lx = 1;
        lz = 0;
      }
      let ux = -tx * ty, uy = 1 - ty * ty, uz = -tz * ty;
      const ul = Math.hypot(ux, uy, uz) || 1;
      ux /= ul;
      uy /= ul;
      uz /= ul;
      const ccx = this.rx[i] + ux * yc, ccy = this.ry[i] + uy * yc, ccz = this.rz[i] + uz * yc;
      // центр для нормалей: у крышек — центр соседнего полного кольца (нормали крышки — наружу от него)
      const src = i < first ? first : i > lastR ? lastR : i;
      if (src === i) {
        cen[i * 3] = ccx;
        cen[i * 3 + 1] = ccy;
        cen[i * 3 + 2] = ccz;
      }
      const k = this.rk[i];
      const lim = Math.abs(k) > 1e-4 ? 0.92 / Math.abs(k) : Infinity;
      const bend = clamp(Math.abs(k) * 1.3 - 0.3, 0, 1) * (1 - sec.pinch);
      const ridgeS = 0.05 + 0.06 * Math.max(0, Math.sin(this.rs[i] * 8.5));
      const a1 = 0.7 * d + ph[4], a2 = -1.3 * d + ph[5], a3 = 2.1 * d + ph[6];
      const s1 = Math.sin(a1), c1 = Math.cos(a1), s2 = Math.sin(a2), c2 = Math.cos(a2), s3 = Math.sin(a3), c3 = Math.cos(a3);
      const darkBase = 0.2 * (1 - sec.far);
      const v = d / HAND.texTile;
      for (let j = 0; j <= S; j++) {
        const jj = j === S ? 0 : j;
        const bot = this.tBot[jj];
        // бугры и складки: sin(m·φ + a) = sin(mφ)cos a + cos(mφ)sin a
        const wav =
          0.022 * (this.tS3[jj] * c1 + this.tC3[jj] * s1) + 0.014 * (this.tS5[jj] * c2 + this.tC5[jj] * s2) + 0.01 * (this.tS2[jj] * c3 + this.tC2[jj] * s3);
        const mod = 1 + (1 - bot) * (wav + this.tRidge[jj] + sec.knob * this.tKnob[jj] + sec.tendon * this.tTend[jj] - 0.03 * sec.crease);
        let x = w * this.tSx[jj] * mod;
        const y = h * this.tSy[jj] * mod;
        // внешняя сторона крутого изгиба — костяные гребни (как костяшки согнутого пальца)
        if (x * k < 0 && bend > 0) x *= 1 + bend * this.tSide[jj] * ridgeS;
        // внутренняя сторона крутого изгиба — сжата (без выворота сетки) и собрана в складки
        let fold = 0;
        if (lim < 4 && x * k > 0) {
          const ax = Math.abs(x);
          x = Math.sign(x) * lim * Math.tanh(ax / lim);
          fold = clamp((ax - Math.abs(x)) / 0.25, 0, 1) * (0.6 + 0.4 * Math.sin(this.rs[i] * 19 + jj));
        }
        const o = (i * C + j) * 3;
        pos[o] = ccx + lx * x + ux * y;
        pos[o + 1] = ccy + uy * y;
        pos[o + 2] = ccz + lz * x + uz * y;
        const u2 = (i * C + j) * 2;
        uv[u2] = (j / S) * UREP;
        uv[u2 + 1] = v;
        // цвет: складки и низ темнее, у двери темнее и грязнее, проём — синяк, костяные бугры желтее
        const knobV = sec.knob * this.tKnob[jj] * 12;
        const dark = clamp(0.3 * sec.crease * (1 - 0.5 * bot) + 0.24 * bot + darkBase + 0.35 * fold, 0, 0.8);
        const o4 = (i * C + j) * 4;
        col[o4] = (1 - dark) * (1 - 0.14 * sec.pinch + 0.04 * knobV);
        col[o4 + 1] = (1 - dark) * (1 - 0.2 * sec.pinch + 0.02 * knobV);
        col[o4 + 2] = (1 - dark) * (1 - 0.04 * sec.pinch - 0.06 * knobV);
        col[o4 + 3] = 1;
      }
    }
    for (let i = 0; i < first; i++) for (let c = 0; c < 3; c++) cen[i * 3 + c] = cen[first * 3 + c];
    for (let i = lastR + 1; i < nr; i++) for (let c = 0; c < 3; c++) cen[i * 3 + c] = cen[lastR * 3 + c];
    gridNormals(pos, this.aNor, 0, nr, S, cen, 0);
    if (this.aFlip === null) this.aFlip = gridFlip(pos, this.aNor, 0, nr, S);
    if (this.aIdxRows < nr) {
      const rows = Math.ceil(nr * 1.4) + 8;
      const big = rows * C > 65535;
      this.aIdx = big ? new Uint32Array((rows - 1) * S * 6) : new Uint16Array((rows - 1) * S * 6);
      gridIndices(this.aIdx, 0, 0, rows, S, this.aFlip);
      this.aIdxRows = rows;
    }

    // куски по комнатам (с заходом в соседей)
    const ov = Math.round(HAND.overlapM / HAND.ringStep);
    const nRuns = roomRuns(this.rroom, nr, ov, this.runDefs);
    for (let r = 0; r < nRuns; r++) this.fillRun(r, this.runDefs[r]);
    for (let r = nRuns; r < this.nRuns; r++) this.runs[r].mesh.setEnabled(false);
    if (this.shown) for (let r = this.nRuns; r < nRuns; r++) this.runs[r].mesh.setEnabled(true);
    this.nRuns = nRuns;
    // кисть — в комнатах последних метров руки и кончика
    this.handRooms.length = 0;
    this.handRooms.push(tipRoom);
    for (let i = lastR; i >= first && L - this.rs[i] < 3.2; i--) if (!this.handRooms.includes(this.rroom[i])) this.handRooms.push(this.rroom[i]);
  }

  private dist3(a: number, b: number) {
    return Math.hypot(this.cx[b] - this.cx[a], this.cy[b] - this.cy[a], this.cz[b] - this.cz[a]);
  }

  /** Кольцо k: точка и касательная Катмулла — Рома на отрезке опорных i → i + 1 при t (концы — отражением). */
  private catmull(i: number, nc: number, t: number, k: number) {
    const t2 = t * t, t3 = t2 * t;
    let px = 0, py = 0, pz = 0, dx = 0, dy = 0, dz = 0;
    for (let c = 0; c < 3; c++) {
      const arr = c === 0 ? this.cx : c === 1 ? this.cy : this.cz;
      const p1 = arr[i], p2 = arr[i + 1];
      const p0 = i > 0 ? arr[i - 1] : 2 * p1 - p2;
      const p3 = i + 2 < nc ? arr[i + 2] : 2 * p2 - p1;
      const b = p2 - p0, cc = 2 * p0 - 5 * p1 + 4 * p2 - p3, d = -p0 + 3 * p1 - 3 * p2 + p3;
      const p = 0.5 * (2 * p1 + b * t + cc * t2 + d * t3);
      const q = 0.5 * (b + 2 * cc * t + 3 * d * t2);
      if (c === 0) {
        px = p;
        dx = q;
      } else if (c === 1) {
        py = p;
        dy = q;
      } else {
        pz = p;
        dz = q;
      }
    }
    this.rx[k] = px;
    this.ry[k] = py;
    this.rz[k] = pz;
    const tl = Math.hypot(dx, dy, dz);
    if (tl > 1e-9) {
      this.rtx[k] = dx / tl;
      this.rty[k] = dy / tl;
      this.rtz[k] = dz / tl;
    } else if (k > 0) {
      this.rtx[k] = this.rtx[k - 1];
      this.rty[k] = this.rty[k - 1];
      this.rtz[k] = this.rtz[k - 1];
    } else {
      this.rtx[k] = 1;
      this.rty[k] = 0;
      this.rtz[k] = 0;
    }
  }

  /** Кусок r: кольца [a, b] из общих буферов трубы → свой меш. */
  private fillRun(r: number, def: RoomRun) {
    let run = this.runs[r];
    if (!run) {
      run = this.runs[r] = { mesh: this.newMesh(`obshaga:arm${r}`), verts: -1, pos: new Float32Array(0), nor: new Float32Array(0), uv: new Float32Array(0), col: new Float32Array(0), room: '' };
    }
    run.room = def.room;
    const C = HAND.seg + 1;
    const rows = def.b - def.a + 1;
    const nv = rows * C;
    const same = nv === run.verts;
    if (!same) {
      run.pos = new Float32Array(nv * 3);
      run.nor = new Float32Array(nv * 3);
      run.uv = new Float32Array(nv * 2);
      run.col = new Float32Array(nv * 4);
    }
    const v0 = def.a * C;
    run.pos.set(this.aPos.subarray(v0 * 3, (v0 + nv) * 3));
    run.nor.set(this.aNor.subarray(v0 * 3, (v0 + nv) * 3));
    run.uv.set(this.aUv.subarray(v0 * 2, (v0 + nv) * 2));
    run.col.set(this.aCol.subarray(v0 * 4, (v0 + nv) * 4));
    const m = run.mesh;
    if (!same) {
      m.setVerticesData(VertexBuffer.PositionKind, run.pos, true);
      m.setVerticesData(VertexBuffer.NormalKind, run.nor, true);
      m.setVerticesData(VertexBuffer.UVKind, run.uv, true);
      m.setVerticesData(VertexBuffer.ColorKind, run.col, true);
      m.setIndices(this.aIdx.subarray(0, (rows - 1) * HAND.seg * 6), nv);
      run.verts = nv;
    } else {
      m.updateVerticesData(VertexBuffer.PositionKind, run.pos, true);
      m.updateVerticesData(VertexBuffer.NormalKind, run.nor);
      m.updateVerticesData(VertexBuffer.UVKind, run.uv);
      m.updateVerticesData(VertexBuffer.ColorKind, run.col);
    }
  }

  // ───────────── кисть ─────────────

  private buildHand(view: HandView, t: number, fresh: boolean) {
    const loc = this.hLoc, uv = this.hUv, col = this.hCol, cenL = this.hCenL;
    const g = ease(this.grab), rb = ease(this.retr), mv = this.move;
    // тычок под кровать: кисть припадает к полу (наклон вперёд, ниже), на ударе — выпад ладонью; кровать рядом — пальцы
    // заранее в позе упора (near)
    const pkb = ease(this.pk), ext = pokeReach(this.pokeU);
    const near = view.bed ? smoothstep(POKE_STAND + POKE.near, POKE_STAND + 0.05, rectGap(view.tip, view.bed)) : 0;
    const lunge = POKE.lunge * pkb * Math.max(0, ext);
    // в проёме кисть сжата: пальцы веером по высоте двери, ладонь узкая и выше
    const kq = smoothstep(0.3, 2.4, this.L - this.sDoor);
    const sL = lerp(0.5, 1, kq), sY = lerp(1.35, 1, kq);
    const lift = 0.08 * g - POKE.drop * pkb, pitch = 0.12 * g + POKE.pitch * pkb;
    const cp = Math.cos(pitch), sp = Math.sin(pitch);
    const xf = (f: number, l: number, y: number, o: Float32Array, at: number) => {
      const df = f - PALM.fc, dy = y - PALM.yc;
      o[at] = PALM.fc + df * cp + dy * sp + lunge;
      o[at + 1] = l;
      o[at + 2] = PALM.yc + dy * cp - df * sp + lift;
    };
    const colorsNow = fresh || this.hColorsFor !== this.kVar;
    const wallLim = this.dims.corridorW / 2;

    // ── ладонь: труба вдоль f, концы — запястье (внутри руки) и передний край под костяшками ──
    {
      const G = this.grids[0];
      const C = G.cols + 1;
      const fB = PALM.fc - PALM.af, fF = PALM.fc + PALM.af;
      for (let r = 0; r < G.rows; r++) {
        const q = 0.5 - 0.5 * Math.cos((Math.PI * r) / (G.rows - 1));
        const f = fB + (fF - fB) * q;
        const z = (f - PALM.fc) / PALM.af;
        const az = Math.min(1, Math.abs(z));
        let sg = z >= 0 ? Math.cbrt(1 - az * az * az) : Math.pow(1 - Math.pow(az, 2.2), 1 / 2.2);
        sg = Math.max(sg, 0.05);
        const al = PALM.al * (1 - 0.14 * Math.max(0, -z));
        xf(f, 0, PALM.yc * 1, cenL, (G.cbase + r) * 3);
        for (let c = 0; c <= G.cols; c++) {
          const cc = c === G.cols ? 0 : c;
          const fi = (TAU * cc) / G.cols;
          const s = Math.sin(fi), co = Math.cos(fi);
          const e = co > 0 ? 2 / 3.4 : 2 / 2.6;
          const x = al * sg * sgnPow(s, e);
          let y = -PALM.ay * sg * sgnPow(co, e);
          const top = Math.max(0, -co);
          // свод тыльной стороны, костяшки и сухожилия к ним
          y += 0.06 * sg * top * top;
          let kn = 0;
          for (let i = 0; i < 4; i++) {
            const fd = this.fingers[i];
            const gk = Math.exp(-((f - fd.bf) ** 2 + (x - fd.bl) ** 2) / 0.03);
            kn = Math.max(kn, gk);
            // сухожилие: от запястья к костяшке
            const ax = -1.55, ay = fd.bl * 0.35, bx2 = fd.bf - 0.12, by2 = fd.bl;
            const vx = bx2 - ax, vy = by2 - ay;
            const tt = clamp(((f - ax) * vx + (x - ay) * vy) / (vx * vx + vy * vy), 0, 1);
            const dd = Math.hypot(f - (ax + vx * tt), x - (ay + vy * tt));
            y += 0.035 * Math.exp(-((dd / 0.06) ** 2)) * top;
          }
          y += 0.1 * kn * Math.sqrt(top);
          const at = (G.base + r * C + c) * 3;
          xf(f, x * sL, PALM.yc + y * sY, loc, at);
          if (colorsNow) {
            const u2 = (G.base + r * C + c) * 2;
            uv[u2] = (c / G.cols) * 2;
            uv[u2 + 1] = f;
            const bot = smoothstep(0.3, 0.9, co);
            const dark = 0.25 * kn * top + 0.1 * bot;
            const o4 = (G.base + r * C + c) * 4;
            col[o4] = (1 - dark) * (1 - 0.04 * bot);
            col[o4 + 1] = (1 - dark) * (1 - 0.08 * bot);
            col[o4 + 2] = (1 - dark) * (1 - 0.16 * bot);
            col[o4 + 3] = 1;
          }
        }
      }
    }

    // ── пальцы ──
    const gait = this.gait;
    const J = this.joints;
    let fistF = 0, fistL = 0, fistY = 0, fistN = 0;
    const blocked = view.blocked ? 2.4 : 1;
    // цель тычка — локально (игрок под кроватью; пол его комнаты относительно кисти)
    const yfx = Math.cos(this.yaw), yfz = Math.sin(this.yaw);
    const pdx = this.pkWx - this.ox, pdz = this.pkWz - this.oz;
    const pkF = pdx * yfx + pdz * yfz, pkL = -pdx * yfz + pdz * yfx, pkDy = this.pkWy - this.oy;
    for (let i = 0; i < this.fingers.length; i++) {
      const fd = this.fingers[i];
      const G = this.grids[1 + i];
      const NG = this.grids[1 + this.fingers.length + i];
      const n = fd.lens.length;
      // цель кончика: перебор → сжатие в проёме → отступление (волочатся, скребут)
      crawlGait(this.crawl / HAND.crawlCycle + fd.ph, gait, fd.stance);
      // упор у кровати (тычет или кровать рядом): пальцы упираются в пол (без подёргиваний: замершая под взглядом не
      // шелохнётся); указательный — только на подходе, тычет он своей позой
      const plant = fd.thumb ? 0 : i === POKE.finger ? near : Math.max(pkb, near);
      const twitch = (1 - mv) * (1 - Math.max(pkb, near)) * (0.07 * Math.pow(Math.max(0, Math.sin(t * 0.83 * blocked + 5.1 * i + this.kVar * 10)), 16) + 0.012 * Math.sin(t * 0.5 + i * 1.7));
      let tf = lerp(fd.front, fd.back, gait.k);
      let tl = fd.tl;
      let ty = fd.r1 + 0.05 + gait.lift * 0.38 * mv + twitch;
      if (fd.thumb) {
        tf = lerp(tf, 0.15, 1 - kq);
        tl = lerp(fd.bl * 0.3, tl, kq);
        ty = lerp(0.35, ty, kq);
      } else {
        tf = lerp(fd.front + 0.4, tf, kq);
        tl = lerp(tl * 0.3, tl, kq);
        ty = lerp(fd.sy, ty, kq);
      }
      const claw = 0.5 + 0.5 * Math.sin(TAU * (this.path / 0.9 + fd.ph));
      tf = lerp(tf, fd.front + 0.3 - 0.35 * claw, rb);
      tl = lerp(tl, fd.tl * 0.85, rb);
      ty = lerp(ty, fd.r1 + 0.04, rb);
      // тычет — остальные упираются кончиками в пол полукругом у костяшек высокой аркой (сгиб у основания): кисть и
      // пальцы — в круге POKE_STAND у кончика руки, снаружи кровати
      let wts = fd.wts;
      if (plant > 0) {
        const pl = clamp(fd.tl * POKE.plantL, -0.9 * POKE.plantR, 0.9 * POKE.plantR);
        tf = lerp(tf, Math.sqrt(POKE.plantR * POKE.plantR - pl * pl), plant);
        tl = lerp(tl, pl, plant);
        ty = lerp(ty, fd.r1 + 0.04, plant);
        wts = this.wtmp;
        for (let k = 0; k < fd.wts.length; k++) wts[k] = lerp(fd.wts[k], PLANT_W[k] ?? fd.wts[k], plant);
      }
      tl = clamp(tl, -(wallLim - fd.r1 - 0.04), wallLim - fd.r1 - 0.04);
      // основание — с ладонью (сжатие, подъём и наклон в кулаке)
      xf(fd.bf, fd.bl * sL, PALM.yc + (fd.by - PALM.yc) * sY, J, 0);
      const bF = J[0], bL = J[1], bY = J[2];
      let dfx = tf - bF, dlx = tl - bL;
      const u = Math.hypot(dfx, dlx) || 1e-6;
      dfx /= u;
      dlx /= u;
      const ik = this.ik[i];
      solveFinger(fd.lens, wts, u, ty - bY, ik);
      // кулак: пальцы крюком вокруг схваченного на уровне пояса (вперёд, вниз и назад под него), большой — поперёк
      const a = lerp(ik.a, fd.thumb ? 0.3 : 0.35, g);
      const b = lerp(ik.b, fd.thumb ? 0.9 : 1.0, g);
      let gx = 1, gl = -fd.bl * 0.25;
      if (fd.thumb) gl = -Math.sign(fd.bl || 1) * 0.9;
      const gn = Math.hypot(gx, gl);
      gx /= gn;
      gl /= gn;
      let Df = lerp(dfx, gx, g), Dl = lerp(dlx, gl, g);
      const dn = Math.hypot(Df, Dl) || 1;
      Df /= dn;
      Dl /= dn;
      // тычущий палец: ближние фаланги дугой вниз к краю кровати, дальние — горизонтально под ней, к игроку; выпад —
      // путь кончика от основания (удар — на POKE.short не доходя, отведён — на POKE.pull ближе). Горизонтально палец
      // ложится не дальше POKE_STAND − edge от кончика руки (дальше — кровать) и там, куда достают ближние звенья;
      // игрок дальше — палец не достаёт (кончик короче цели), но под сетку не лезет
      const poking = i === POKE.finger && pkb > 0;
      let pa = 0, pb = 0;
      if (poking) {
        const ux = Math.max(0.3, pkF - bF), ul = pkL - bL;
        const uh = Math.hypot(ux, ul);
        const rHit = Math.max(0.3, uh - POKE.short);
        const R = lerp(rHit - POKE.pull, rHit, ext);
        const py = Math.max(fd.r1 + 0.03, POKE.y + pkDy);
        // край кровати по направлению пальца (план: от основания к цели); кровать неизвестна — без предела
        const dF = ux / uh, dL = ul / uh;
        let xEdge = Infinity;
        const bed = view.bed;
        if (bed) {
          const bx = view.tip.x + yfx * bF - yfz * bL, by = -(-view.tip.y + yfz * bF + yfx * bL);
          const vx = yfx * dF - yfz * dL, vy = -(yfz * dF + yfx * dL);
          xEdge = rayRect(bx, by, vx, vy, bed) - POKE.edge;
        }
        const reach = 0.995 * (this.pokeLa + this.pokeLb);
        const xLink = Math.sqrt(Math.max(0, reach * reach - (py - bY) * (py - bY)));
        pokeBend(this.pokeLa, this.pokeLb, Math.max(0.05, Math.min(R - this.pokeLd, xEdge, xLink)), py - bY, this.pokeAng);
        pa = this.pokeAng.a;
        pb = this.pokeAng.b;
        Df = lerp(Df, ux / uh, pkb);
        Dl = lerp(Dl, ul / uh, pkb);
        const pn = Math.hypot(Df, Dl) || 1;
        Df /= pn;
        Dl /= pn;
      }
      // суставы (FK) и рамки фаланг: T — вдоль, N — к тыльной стороне; Lf — поперёк плоскости пальца. Пол: конец фаланги
      // не ниже низа своего кольца (сустав — 1.2 радиуса, у кончика — радиус и подушечка; смотрит назад — тыльная
      // сторона снизу, она толще) — фаланга поднимается к горизонту (floorAngle), поза выше пола не трогается
      let c = 0;
      for (let k = 0; k < n; k++) {
        if (k > 0) c += wts[k - 1];
        let th = a - b * c;
        if (poking) th = lerp(th, k === 0 ? pa : k < POKE.prox ? pb : 0, pkb);
        const rEnd = k + 1 < n ? 1.2 * 0.92 * lerp(fd.r0, fd.r1, (k + 1) / n) : fd.r1;
        th = floorAngle(th, J[k * 9 + 2], fd.lens[k], rEnd * (Math.cos(th) < 0 && k + 1 < n ? 1.2 : 1) + FLOOR_GAP);
        const co = Math.cos(th), si = Math.sin(th);
        const o = k * 9;
        // J: [x, l, y] сустава k; T и N фаланги k
        J[o + 3] = co * Df;
        J[o + 4] = co * Dl;
        J[o + 5] = si;
        J[o + 6] = -si * Df;
        J[o + 7] = -si * Dl;
        J[o + 8] = co;
        J[o + 9] = J[o] + fd.lens[k] * J[o + 3];
        J[o + 10] = J[o + 1] + fd.lens[k] * J[o + 4];
        J[o + 11] = J[o + 2] + fd.lens[k] * J[o + 5];
      }
      if (poking) {
        this.pokeTipL[0] = J[n * 9];
        this.pokeTipL[1] = J[n * 9 + 1];
        this.pokeTipL[2] = J[n * 9 + 2];
      }
      if (!fd.thumb) {
        for (let k = 1; k <= n; k++) {
          fistF += J[k * 9];
          fistL += J[k * 9 + 1];
          fistY += J[k * 9 + 2];
          fistN++;
        }
      }
      const Lf0 = -Dl, Lf1 = Df;
      const C = G.cols + 1;
      let row = 0;
      let arc = 0;
      const rJ = (k: number) => lerp(fd.r0, fd.r1, k / n);
      // кольцо пальца: центр, к тыльной стороне N, радиус, сустав (костяшка, складки), кончик (подушечка грязнее);
      // ушло под пол (подушечка у пола, остатки после floorAngle) — приподнято целиком: прижато к полу
      const ring = (px: number, pl: number, py: number, N0: number, N1: number, N2: number, r: number, joint: number, tipK: number) => {
        const low = py - Math.abs(N2) * r * 0.92 * (N2 < 0 ? 1 + 0.2 * joint : 1);
        if (low < FLOOR_GAP) py += FLOOR_GAP - low;
        const at = G.cbase + row;
        cenL[at * 3] = px;
        cenL[at * 3 + 1] = pl;
        cenL[at * 3 + 2] = py;
        for (let cc = 0; cc <= G.cols; cc++) {
          const j = cc === G.cols ? 0 : cc;
          const fi = (TAU * j) / G.cols;
          const s = Math.sin(fi), co = Math.cos(fi);
          const dors = Math.max(0, -co);
          const w = r * 1.07, h = r * 0.92 * (1 + 0.2 * joint * dors);
          const x = w * s, y = -h * co;
          const o = (G.base + row * C + cc) * 3;
          loc[o] = px + Lf0 * x + N0 * y;
          loc[o + 1] = pl + Lf1 * x + N1 * y;
          loc[o + 2] = py + N2 * y;
          if (colorsNow) {
            const u2 = (G.base + row * C + cc) * 2;
            uv[u2] = cc / G.cols;
            uv[u2 + 1] = arc + i * 0.37;
            const palm = Math.max(0, co);
            const dark = joint * (0.34 * Math.pow(dors, 1.5) + 0.2 * palm) + tipK * 0.25 * palm;
            const o4 = (G.base + row * C + cc) * 4;
            col[o4] = (1 - dark) * (1 - 0.02 * tipK);
            col[o4 + 1] = (1 - dark) * (1 - 0.08 * tipK);
            col[o4 + 2] = (1 - dark) * (1 - 0.14 * tipK);
            col[o4 + 3] = 1;
          }
        }
        row++;
      };
      for (let k = 0; k < n; k++) {
        const o = k * 9;
        // в суставе — биссектриса соседних фаланг (сетка не выворачивается)
        let N0 = J[o + 6], N1 = J[o + 7], N2 = J[o + 8];
        if (k > 0) {
          N0 += J[o - 3];
          N1 += J[o - 2];
          N2 += J[o - 1];
          const nl2 = Math.hypot(N0, N1, N2) || 1;
          N0 /= nl2;
          N1 /= nl2;
          N2 /= nl2;
        }
        ring(J[o], J[o + 1], J[o + 2], N0, N1, N2, rJ(k) * (k > 0 ? 1.2 : 1), k > 0 ? 1 : 0, 0);
        for (const q of PHAL_Q) {
          arc += fd.lens[k] * 0.25;
          // фаланга тоньше суставов: костлявые пальцы
          const r = lerp(rJ(k), rJ(k + 1), q) * (1 - 0.13 * Math.sin(Math.PI * q));
          const lq = fd.lens[k] * q;
          ring(J[o] + J[o + 3] * lq, J[o + 1] + J[o + 4] * lq, J[o + 2] + J[o + 5] * lq, J[o + 6], J[o + 7], J[o + 8], r, 0, 0);
        }
        arc += fd.lens[k] * 0.25;
      }
      // кончик и подушечка (крышка)
      const e = (n - 1) * 9;
      const T0 = J[e + 3], T1 = J[e + 4], T2 = J[e + 5], N0 = J[e + 6], N1 = J[e + 7], N2 = J[e + 8];
      const ex = J[e + 9], el = J[e + 10], ey = J[e + 11];
      ring(ex, el, ey, N0, N1, N2, fd.r1, 0, 0.6);
      for (let q = 0; q < 3; q++) {
        const o = TIP_CAP[q * 2], d = fd.r1 * o, dn = fd.r1 * 0.1 * o;
        ring(ex + T0 * d - N0 * dn, el + T1 * d - N1 * dn, ey + T2 * d - N2 * dn, N0, N1, N2, fd.r1 * TIP_CAP[q * 2 + 1], 0, 1);
      }

      // ── ноготь: пластина на тыльной стороне последней фаланги, длинный свободный край загнут вниз ──
      const ll = fd.lens[n - 1];
      const sx = J[e], sl = J[e + 1], sy0 = J[e + 2];
      const NCc = NG.cols + 1;
      for (let r = 0; r < NG.rows; r++) {
        const q = r / (NG.rows - 1);
        const along = lerp(0.42 * ll, ll + fd.nail, q);
        const over = Math.max(0, along - ll - 0.02);
        const rr = along <= ll ? lerp(rJ(n - 1), fd.r1, along / ll) : fd.r1 * (1 - 0.15 * Math.min(1, over / 0.05));
        const hOff = rr * 0.92 + 0.012 - (r === 0 ? 0.03 : 0);
        const curl = 0.9 * over * over + 0.25 * over;
        const wN = 0.85 * fd.r1 * (q < 0.12 ? lerp(0.5, 1, q / 0.12) : q > 0.6 ? lerp(1, 0.35, (q - 0.6) / 0.4) : 1) * (r === 0 ? 0.5 : 1);
        const px = sx + T0 * along + N0 * (hOff - curl);
        const pl = sl + T1 * along + N1 * (hOff - curl);
        const py = sy0 + T2 * along + N2 * (hOff - curl);
        const at = NG.cbase + r;
        cenL[at * 3] = px;
        cenL[at * 3 + 1] = pl;
        cenL[at * 3 + 2] = py;
        for (let cc = 0; cc <= NG.cols; cc++) {
          const j = cc === NG.cols ? 0 : cc;
          const ps = (TAU * j) / NG.cols;
          const x = wN * Math.cos(ps);
          const y = 0.022 * Math.sin(ps) - (0.3 * x * x) / Math.max(wN, 1e-3);
          const o = (NG.base + r * NCc + cc) * 3;
          loc[o] = px + Lf0 * x + N0 * y;
          loc[o + 1] = pl + Lf1 * x + N1 * y;
          loc[o + 2] = py + N2 * y;
          if (colorsNow) {
            const u2 = (NG.base + r * NCc + cc) * 2;
            uv[u2] = 0.31;
            uv[u2 + 1] = 0.07 + q * 0.02;
            // ноготь #8F8670 (к средней коже ~0.78), свободный край — жёлто-бурый, кромка — грязь; снизу — грязь
            const free = smoothstep(ll - 0.02, ll + fd.nail * 0.8, along), edge = smoothstep(0.75, 1, q);
            const under = Math.sin(ps) < 0 ? 0.6 : 1;
            const o4 = (NG.base + r * NCc + cc) * 4;
            col[o4] = lerp(lerp(0.84, 0.74, free), 0.4, edge) * under;
            col[o4 + 1] = lerp(lerp(0.8, 0.64, free), 0.34, edge) * under;
            col[o4 + 2] = lerp(lerp(0.66, 0.44, free), 0.24, edge) * under;
            col[o4 + 3] = 1;
          }
        }
        // свободный край упёрся в пол — ряд приподнят: ноготь гнётся по полу, а не уходит под него
        let lo = Infinity;
        for (let cc = 0; cc <= NG.cols; cc++) lo = Math.min(lo, loc[(NG.base + r * NCc + cc) * 3 + 2]);
        if (lo < FLOOR_GAP) {
          for (let cc = 0; cc <= NG.cols; cc++) loc[(NG.base + r * NCc + cc) * 3 + 2] += FLOOR_GAP - lo;
          cenL[at * 3 + 2] += FLOOR_GAP - lo;
        }
      }
    }

    if (fistN) {
      this.fist[0] = fistF / fistN;
      this.fist[1] = fistL / fistN;
      this.fist[2] = fistY / fistN;
    }

    // ── в мир ──
    const fx = Math.cos(this.yaw), fz = Math.sin(this.yaw);
    const lx = -fz, lz = fx;
    const pos = this.hPos, cen = this.hCen;
    for (let v = 0; v < this.hVerts; v++) {
      const f = loc[v * 3], l = loc[v * 3 + 1], y = loc[v * 3 + 2];
      pos[v * 3] = this.ox + fx * f + lx * l;
      pos[v * 3 + 1] = this.oy + y;
      pos[v * 3 + 2] = this.oz + fz * f + lz * l;
    }
    for (let r = 0; r < cen.length / 3; r++) {
      const f = cenL[r * 3], l = cenL[r * 3 + 1], y = cenL[r * 3 + 2];
      cen[r * 3] = this.ox + fx * f + lx * l;
      cen[r * 3 + 1] = this.oy + y;
      cen[r * 3 + 2] = this.oz + fz * f + lz * l;
    }
    for (const G of this.grids) gridNormals(pos, this.hNor, G.base, G.rows, G.cols, cen, G.cbase);
    const m = this.hand;
    if (!this.hUploaded) {
      let ni = 0;
      for (const G of this.grids) ni += (G.rows - 1) * G.cols * 6;
      const idx = this.hVerts > 65535 ? new Uint32Array(ni) : new Uint16Array(ni);
      let at = 0;
      for (const G of this.grids) at = gridIndices(idx, at, G.base, G.rows, G.cols, gridFlip(pos, this.hNor, G.base, G.rows, G.cols));
      m.setVerticesData(VertexBuffer.PositionKind, pos, true);
      m.setVerticesData(VertexBuffer.NormalKind, this.hNor, true);
      m.setVerticesData(VertexBuffer.UVKind, uv, true);
      m.setVerticesData(VertexBuffer.ColorKind, col, true);
      m.setIndices(idx, this.hVerts);
      this.hUploaded = true;
    } else {
      m.updateVerticesData(VertexBuffer.PositionKind, pos, true);
      m.updateVerticesData(VertexBuffer.NormalKind, this.hNor);
      if (colorsNow) {
        m.updateVerticesData(VertexBuffer.UVKind, uv);
        m.updateVerticesData(VertexBuffer.ColorKind, col);
      }
    }
    if (colorsNow) this.hColorsFor = this.kVar;
  }

  /** середина суставов четырёх пальцев (локально f, l, y) — полость кулака */
  private readonly fist = new Float32Array([0.4, 0, 1.2]);
  /** суставы пальца: по 9 чисел на фалангу (сустав x/l/y, T, N) + конец */
  private readonly joints = new Float32Array(9 * 6 + 3);

  // ───────────── коллизии ─────────────

  private buildColliders(view: HandView) {
    const first = 3, lastR = this.nRings - 4;
    const L = this.L;
    let nb = 0;
    const sec = this.sec;
    const STEP = 8;
    for (let a = first; a < lastR; a += STEP) {
      const b = Math.min(lastR, a + STEP);
      if (L - this.rs[a] < 1.4) break;
      let w = 0, h = 0, bot = Infinity;
      for (let i = a; i <= b; i += 2) {
        armSection(L - this.rs[i], this.rs[i] - this.sDoor, this.look, this.dims, sec);
        w = Math.max(w, sec.w);
        h = Math.max(h, sec.h + sec.bottom);
        bot = Math.min(bot, sec.bottom);
      }
      const dx = this.rx[b] - this.rx[a], dz = this.rz[b] - this.rz[a];
      const len = Math.hypot(dx, dz) + 0.25;
      const box = this.box(nb);
      box.position.set((this.rx[a] + this.rx[b]) / 2, (this.ry[a] + this.ry[b]) / 2 + (bot + h) / 2, (this.rz[a] + this.rz[b]) / 2);
      box.rotation.set(0, Math.atan2(dx, dz), 0);
      box.scaling.set(Math.min(w, this.dims.corridorW - 0.1), Math.max(0.2, h - bot), len);
      this.boxRoom[nb] = this.rroom[(a + b) >> 1];
      nb++;
    }
    // ладонь
    const fx = Math.cos(this.yaw), fz = Math.sin(this.yaw);
    const hb = this.box(nb);
    hb.position.set(this.ox + fx * (PALM.fc - 0.1), this.oy + 0.65, this.oz + fz * (PALM.fc - 0.1));
    hb.rotation.set(0, Math.atan2(fx, fz), 0);
    hb.scaling.set(Math.min(1.6, this.dims.corridorW - 0.12), 1.1, 2.0);
    this.boxRoom[nb] = view.tip.room ?? '';
    nb++;
    for (let i = 0; i < nb; i++) {
      const b = this.boxes[i];
      if (this.shown) b.setEnabled(true);
      b.computeWorldMatrix(true);
    }
    for (let i = nb; i < this.nBoxes; i++) this.boxes[i].setEnabled(false);
    this.nBoxes = nb;
    // карта
    for (const l of this.colPool.values()) l.length = 0;
    this.colRooms.clear();
    for (let i = 0; i < nb; i++) {
      const room = this.boxRoom[i];
      let l = this.colPool.get(room);
      if (!l) this.colPool.set(room, (l = []));
      if (!l.length) this.colRooms.set(room, l);
      l.push(this.boxes[i]);
    }
  }

  private box(i: number): Mesh {
    let b = this.boxes[i];
    if (!b) {
      b = CreateBox(`obshaga:handCol${i}`, { size: 1 }, this.scene);
      b.isVisible = false;
      b.isPickable = false;
      b.checkCollisions = true;
      b.layerMask = this.layerMask;
      b.setEnabled(this.shown);
      this.boxes[i] = b;
    }
    return b;
  }

  private fillRooms() {
    for (const l of this.listPool.values()) l.length = 0;
    this.rooms.clear();
    const put = (room: string, m: Mesh) => {
      let l = this.listPool.get(room);
      if (!l) this.listPool.set(room, (l = []));
      if (!l.length) this.rooms.set(room, l);
      if (!l.includes(m)) l.push(m);
    };
    for (let r = 0; r < this.nRuns; r++) put(this.runs[r].room, this.runs[r].mesh);
    for (const room of this.handRooms) put(room, this.hand);
  }
}
