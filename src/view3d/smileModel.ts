// «Улыбка» — моб общаги: процедурная модель девушки (SmileModel), красные зрачки в темноте ловушки (RedEyes) и
// артериальная струя крови из шеи жертвы (BloodSpurt). Механика — src/locations/smile.ts (SmileView), контракт —
// tmp/smile-wip/CONTRACT.md §5.
//
// Облик. Худая высокая девушка (макушка ~1.72 м): серо-голубая бледная кожа в пятнах и венах, запавшие глаза в тёмных
// кругах (радужка почти чёрная, левый глаз чуть косит наружу), высокие скулы, впалые щёки, острый подбородок; шея, руки
// и пальцы длиннее нормы (кончики пальцев висящей руки — у колен), грязные ногти. Длинные мокрые чёрные волосы —
// прядями-лентами: лежат по голове и висят по тяжести (голова набок — висят отвесно в сторону), часть прядей падает на
// лицо справа. Грязно-белая ночная рубашка до колен с короткими рукавами (разводы, рваный неровный подол), босые грязные
// ступни. Улыбка неестественно широкая (уголки почти под скулами), губы разошлись — виден ряд зубов; torn 0 → 1: щёки
// рвутся к ушам (рваные края, мясо), челюсть отваливается — пасть с зубами до ушей, кровь на губах, подбородке, шее,
// кровь стекает по рубашке (наплыв растёт с torn). Поза 'pounce' и 'eat' рвут рот сами (torn не меньше фазы броска).
//
// Без ассетов: вся геометрия своя (сетки-«трубы» вдоль костей, голова — сетка по широте/долготе с разрезом рта), вершины
// пересчитываются на ЦП в setPose — в координатах тела (узел body под root; ~4 тыс. вершин, ~6.8 тыс. треугольников).
// Кожа и ткань — процедурные текстуры (RawTexture 256², общие на сцену, счётчик ссылок; первая модель сцены строит их
// ~0.1 с — создавать при входе в биом), остальное — цвета вершин. Материалы освещаются светом сцены и чуть светятся
// сами (emissive ~0.13: в тусклой общаге читаются силуэт, лицо и рубашка); глаза в темноте — отдельный RedEyes.
//
// Контракт (оси модели: начало — между ступнями на полу, вперёд +Z, вправо +X, вверх +Y; side = −1 — зеркало по X):
//   const m = new SmileModel(scene);   m.root.position / m.root.rotation.y ставит интеграция (поворот только по Y);
//   каждый кадр: m.setPose({ pose, lean, side, torn, t, look, pounce? }) — после установки root (сдвинули root без
//   setPose — m.sync()). m.meshes — порталу (слой — opts.layerMask, по умолчанию PORTAL_LAYER); скрытую (setVisible
//   (false)) порталу не отдавать — PortalRenderer рисует отданные меши, не глядя на enabled.
//   Позы (размеры — SMILE_MODEL, читать в момент использования):
//   • 'peek' — выглядывает из-за косяка/угла. Косяк — вертикальное ребро в (side·peek.jambX, y, peek.jambZ): ближний к
//     зрителю простенок идёт от ребра вперёд (+Z), его коридорная грань — плоскость x = side·jambX, коридор — за ней
//     (side·x > jambX). Она стоит в проёме/за углом лицом вдоль стены (к зрителю, +Z). lean 0 — вся позади плоскости
//     стены и позади ребра; ~0.3 — пальцы обхватили ребро (видны на коридорной грани), голова ещё за стеной; 1 — корпус
//     клонится вбок, голова наклонена ~30° и вместе с плечом — в коридоре (центр головы ~ peek.head), лицо к look.
//     Расстановка по проёму двери и зрителю — SmileModel.placePeek() / placePeekDoor().
//   • 'window' — лицо и ладони прижаты к стеклу: стекло — плоскость z = window.glassZ (кончик носа на ней, ладони в
//     ~1 см), центр головы ~window.headY. Расстановка — SmileModel.placeWindow().
//   • 'stand' — стоит посреди прохода: руки висят, голова наклонена, неестественное покачивание, подёргивания.
//   • 'pounce' — бросок (pounce 0…1: присела → прыжок → удар): к 1 распахнутая пасть у (0, pounce.mouthY,
//     pounce.reach) — жертва стоит там (глаза жертвы ~на этой точке); руки-когти вперёд.
//   • 'eat' — на коленях над жертвой на полу: рот у шеи жертвы eat.neck (локально), голова рвёт рывками; кровь из шеи
//     жертвы — BloodSpurt.frame(dt, шея в мире).
//   look — мировая точка: голова плавно поворачивается к ней (шея ±80° по курсу, −45…+35° по высоте), глаза — сразу.
//   headPos()/mouthPos()/neckPos() — мировые точки после setPose (звук, проверки взгляда), torn — torn кадра.
//   RedEyes: set(середина между зрачками в мире | null, куда смотрят?, t?) — два ярких красных зрачка с ореолом.
//   BloodSpurt: frame(dt, шея | null, куда бить?, пол y?) — пульсирующая (~1.3 Гц) струя капель с тяжестью; с полом —
//   лужица-кляксы на нём (живут SPURT.splatS); neck = null — струя кончилась, летящие капли догорают.
import type { Scene } from '@babylonjs/core/scene';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Material } from '@babylonjs/core/Materials/material';
import { RawTexture } from '@babylonjs/core/Materials/Textures/rawTexture';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Constants } from '@babylonjs/core/Engines/constants';
import '@babylonjs/core/Meshes/thinInstanceMesh';
import { makeRng, type Rng } from '../model/rng';
import { PORTAL_LAYER } from './portal';

/** Поза кадра. */
export interface SmilePose {
  pose: 'peek' | 'stand' | 'pounce' | 'eat' | 'window';
  /** peek: 0 — спряталась (тело за косяком), 1 — высунулась голова+плечо+рука на косяке */
  lean: number;
  side: -1 | 1;
  /** 0…1 разрыв лица */
  torn: number;
  /** часы анимации, с */
  t: number;
  /** мировая точка — куда повернуть голову (шея ограничена ±80°) */
  look: Vector3 | null;
  /** 0…1 фаза броска (к камере/жертве) */
  pounce?: number;
}

/**
 * Размеры поз для интеграции (локально, м; оси модели — см. шапку). Обычный изменяемый объект: читать в момент
 * использования.
 */
export const SMILE_MODEL = {
  /** макушка и центр головы стоя */
  height: 1.71,
  headY: 1.59,
  peek: {
    /** ребро косяка: x = side·jambX, z = jambZ; толщина простенка (куда пальцы заходят на коридорную грань) */
    jambX: 0.26,
    jambZ: 0.2,
    /** центр головы при lean 1 (side = 1) */
    head: { x: 0.347, y: 1.505, z: 0.02 },
  },
  window: {
    /** плоскость стекла z = glassZ: кончик носа на ней; центр головы на этой высоте */
    glassZ: 0.3,
    headY: 1.56,
  },
  pounce: {
    /** к pounce = 1 рот у (0, mouthY, reach) */
    reach: 0.78,
    mouthY: 1.5,
  },
  eat: {
    /** шея жертвы на полу (рот модели у неё) */
    neck: { x: 0, y: 0.12, z: 0.5 },
  },
};

// ───────────────────────── мелочи ─────────────────────────

const TAU = Math.PI * 2;
const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
const smooth = (k: number) => {
  const t = clamp(k, 0, 1);
  return t * t * (3 - 2 * t);
};
/** Гладкая ступень 0 → 1 между e0 и e1 (e0 > e1 — убывающая). */
const sstep = (e0: number, e1: number, x: number) => smooth((x - e0) / (e1 - e0));
const sgnPow = (v: number, e: number) => (v < 0 ? -Math.pow(-v, e) : Math.pow(v, e));
const gauss2 = (dx: number, dy: number, sx: number, sy: number) => Math.exp(-((dx / sx) ** 2) - (dy / sy) ** 2);
const fract = (x: number) => x - Math.floor(x);
/** Детерминированный хэш 0…1 (только облик и анимация). */
const hash1 = (n: number) => fract(Math.sin(n * 12.9898 + 78.233) * 43758.5453);
/** Гладкий шум 0…1 по времени. */
function noise1(x: number, seed = 0): number {
  const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f);
  return lerp(hash1(i + seed * 57.13), hash1(i + 1 + seed * 57.13), u);
}
/** Подёргивание: короткий импульс (быстрый рывок, плавный возврат) в случайный момент каждого периода; знак — по хэшу. */
function twitch(t: number, period: number, dur: number, seed: number): number {
  const k = Math.floor(t / period);
  const at = k * period + hash1(k * 3.17 + seed) * (period - dur);
  const x = (t - at) / dur;
  if (x < 0 || x > 1) return 0;
  const s = hash1(k * 7.73 + seed * 1.31) < 0.5 ? -1 : 1;
  return s * (x < 0.18 ? x / 0.18 : 1 - smooth((x - 0.18) / 0.82));
}

interface V {
  x: number;
  y: number;
  z: number;
}
const v3 = (x = 0, y = 0, z = 0): V => ({ x, y, z });
const vset = (o: V, x: number, y: number, z: number): V => {
  o.x = x;
  o.y = y;
  o.z = z;
  return o;
};
const vcp = (o: V, a: V): V => vset(o, a.x, a.y, a.z);
const vadd = (o: V, a: V, b: V): V => vset(o, a.x + b.x, a.y + b.y, a.z + b.z);
const vsub = (o: V, a: V, b: V): V => vset(o, a.x - b.x, a.y - b.y, a.z - b.z);
const vsc = (o: V, a: V, s: number): V => vset(o, a.x * s, a.y * s, a.z * s);
/** o = a + b·s */
const vma = (o: V, a: V, b: V, s: number): V => vset(o, a.x + b.x * s, a.y + b.y * s, a.z + b.z * s);
const vlerp = (o: V, a: V, b: V, k: number): V => vset(o, a.x + (b.x - a.x) * k, a.y + (b.y - a.y) * k, a.z + (b.z - a.z) * k);
const vdot = (a: V, b: V) => a.x * b.x + a.y * b.y + a.z * b.z;
const vlen = (a: V) => Math.hypot(a.x, a.y, a.z);
function vnorm(o: V, a: V): V {
  const l = vlen(a);
  if (l < 1e-12) return vset(o, 0, 1, 0);
  return vset(o, a.x / l, a.y / l, a.z / l);
}
function vcross(o: V, a: V, b: V): V {
  const x = a.y * b.z - a.z * b.y, y = a.z * b.x - a.x * b.z, z = a.x * b.y - a.y * b.x;
  return vset(o, x, y, z);
}
const AX_X = v3(1, 0, 0), AX_Y = v3(0, 1, 0), AX_Z = v3(0, 0, 1);
/** Компонента a, перпендикулярная единичному n, нормированная (вырождена — любой перпендикуляр). */
function vperp(o: V, a: V, n: V): V {
  const d = vdot(a, n);
  vset(o, a.x - n.x * d, a.y - n.y * d, a.z - n.z * d);
  if (vlen(o) < 1e-9) vcross(o, n, Math.abs(n.x) < 0.9 ? AX_X : AX_Y);
  return vnorm(o, o);
}
/** Поворот вектора a вокруг единичной оси k на угол t (Родригес). */
function vrot(o: V, a: V, k: V, t: number): V {
  const c = Math.cos(t), s = Math.sin(t), d = vdot(k, a) * (1 - c);
  const cx = k.y * a.z - k.z * a.y, cy = k.z * a.x - k.x * a.z, cz = k.x * a.y - k.y * a.x;
  return vset(o, a.x * c + cx * s + k.x * d, a.y * c + cy * s + k.y * d, a.z * c + cz * s + k.z * d);
}

/** Кадр кости: начало и оси (столбцы) в координатах тела. */
interface Frame {
  o: V;
  x: V;
  y: V;
  z: V;
}
const frame = (): Frame => ({ o: v3(), x: v3(1, 0, 0), y: v3(0, 1, 0), z: v3(0, 0, 1) });
const ID = frame();
function fpt(f: Frame, lx: number, ly: number, lz: number, o: V): V {
  return vset(
    o,
    f.o.x + f.x.x * lx + f.y.x * ly + f.z.x * lz,
    f.o.y + f.x.y * lx + f.y.y * ly + f.z.y * lz,
    f.o.z + f.x.z * lx + f.y.z * ly + f.z.z * lz,
  );
}
function fdir(f: Frame, lx: number, ly: number, lz: number, o: V): V {
  return vset(o, f.x.x * lx + f.y.x * ly + f.z.x * lz, f.x.y * lx + f.y.y * ly + f.z.y * lz, f.x.z * lx + f.y.z * ly + f.z.z * lz);
}
/** Точка p (тело) → координаты кадра. */
function floc(f: Frame, p: V, o: V): V {
  const dx = p.x - f.o.x, dy = p.y - f.o.y, dz = p.z - f.o.z;
  return vset(o, f.x.x * dx + f.x.y * dy + f.x.z * dz, f.y.x * dx + f.y.y * dy + f.y.z * dz, f.z.x * dx + f.z.y * dy + f.z.z * dz);
}
/**
 * Дочерний кадр: начало — смещение (ox, oy, oz) в родителе, поворот R = Ry(yaw)·Rx(pitch)·Rz(roll) в родителе:
 * pitch > 0 — наклон вперёд (+Y к +Z), yaw > 0 — поворот вправо (+Z к +X), roll > 0 — крен вправо (+Y к +X).
 */
function fchild(out: Frame, p: Frame, ox: number, oy: number, oz: number, pitch: number, yaw: number, roll: number) {
  fpt(p, ox, oy, oz, out.o);
  const cp = Math.cos(pitch), sp = Math.sin(pitch), cy = Math.cos(yaw), sy = Math.sin(yaw), cr = Math.cos(roll), sr = Math.sin(roll);
  const Xx = cr * cy - sr * sp * sy, Xy = -sr * cp, Xz = -cr * sy - sr * sp * cy;
  const Yx = sr * cy + cr * sp * sy, Yy = cr * cp, Yz = -sr * sy + cr * sp * cy;
  const Zx = cp * sy, Zy = -sp, Zz = cp * cy;
  const px = p.x, py = p.y, pz = p.z;
  vset(out.x, px.x * Xx + py.x * Xy + pz.x * Xz, px.y * Xx + py.y * Xy + pz.y * Xz, px.z * Xx + py.z * Xy + pz.z * Xz);
  vset(out.y, px.x * Yx + py.x * Yy + pz.x * Yz, px.y * Yx + py.y * Yy + pz.y * Yz, px.z * Yx + py.z * Yy + pz.z * Yz);
  vset(out.z, px.x * Zx + py.x * Zy + pz.x * Zz, px.y * Zx + py.y * Zy + pz.y * Zz, px.z * Zx + py.z * Zy + pz.z * Zz);
}
/** Кадр по оси y (yDir) и подсказке z (zHint, ортогонализуется). */
function faim(out: Frame, o: V, yDir: V, zHint: V) {
  vcp(out.o, o);
  vnorm(out.y, yDir);
  vperp(out.z, zHint, out.y);
  vcross(out.x, out.y, out.z);
}
/** Поворот кадра вокруг оси k (единичная, тело) через точку pivot. */
function frot(f: Frame, k: V, ang: number, pivot: V, tmp: V) {
  vsub(tmp, f.o, pivot);
  vrot(tmp, tmp, k, ang);
  vadd(f.o, pivot, tmp);
  vrot(f.x, f.x, k, ang);
  vrot(f.y, f.y, k, ang);
  vrot(f.z, f.z, k, ang);
}

/**
 * Двухзвенная ИК: колено/локоть по корню a, цели t (недостижимая подтягивается к корню — t меняется), длинам и
 * направлению сгиба pole. Пишет сустав в o.
 */
function ik2(o: V, a: V, t: V, l1: number, l2: number, pole: V, tmp: V, tmp2: V) {
  vsub(tmp, t, a);
  let d = vlen(tmp);
  const dmax = l1 + l2 - 1e-4, dmin = Math.abs(l1 - l2) + 0.02;
  if (d > dmax) {
    vma(t, a, tmp, dmax / d);
    vsub(tmp, t, a);
    d = dmax;
  } else if (d < dmin) {
    if (d < 1e-6) vset(tmp, 0, -1, 0);
    else vsc(tmp, tmp, 1 / d);
    vma(t, a, tmp, dmin);
    vsub(tmp, t, a);
    d = dmin;
  }
  vsc(tmp, tmp, 1 / d);
  const a1 = (l1 * l1 - l2 * l2 + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, l1 * l1 - a1 * a1));
  vperp(tmp2, pole, tmp);
  vma(o, a, tmp, a1);
  vma(o, o, tmp2, h);
}

/** Катмулл–Ром: точка и касательная на отрезке p1 → p2 (соседи p0, p3), t 0…1. */
function crPoint(o: V, p0: V, p1: V, p2: V, p3: V, t: number): V {
  const t2 = t * t, t3 = t2 * t;
  const a = -0.5 * t3 + t2 - 0.5 * t, b = 1.5 * t3 - 2.5 * t2 + 1, c = -1.5 * t3 + 2 * t2 + 0.5 * t, d = 0.5 * t3 - 0.5 * t2;
  return vset(o, p0.x * a + p1.x * b + p2.x * c + p3.x * d, p0.y * a + p1.y * b + p2.y * c + p3.y * d, p0.z * a + p1.z * b + p2.z * c + p3.z * d);
}
function crTan(o: V, p0: V, p1: V, p2: V, p3: V, t: number): V {
  const t2 = t * t;
  const a = -1.5 * t2 + 2 * t - 0.5, b = 4.5 * t2 - 5 * t, c = -4.5 * t2 + 4 * t + 0.5, d = 1.5 * t2 - t;
  vset(o, p0.x * a + p1.x * b + p2.x * c + p3.x * d, p0.y * a + p1.y * b + p2.y * c + p3.y * d, p0.z * a + p1.z * b + p2.z * c + p3.z * d);
  return vnorm(o, o);
}

// ───────────────────────── текстуры (чистые функции) ─────────────────────────

/** Решётка периодического шума nu × nv. */
function lattice(r: Rng, nu: number, nv = nu): Float32Array {
  const a = new Float32Array(nu * nv);
  for (let i = 0; i < a.length; i++) a[i] = r.next();
  return a;
}
/** Периодический шум значений 0…1 по решётке nu × nv; u, v — доли повтора. */
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
const ridge = (n: number) => 1 - Math.abs(2 * n - 1);
const mix3 = (o: number[], c: readonly number[], k: number) => {
  for (let i = 0; i < 3; i++) o[i] += (c[i] - o[i]) * k;
};

/** Кожа (RGBA, бесшовная): бледная серо-голубая, лиловые и зеленоватые пятна, тонкие синеватые вены, мелкая зернь. */
export function pallorTexels(size: number, seed = 11): Uint8Array {
  const r = makeRng(seed);
  const M4 = lattice(r, 4), M8 = lattice(r, 8), M16 = lattice(r, 16), P64 = lattice(r, 64), P128 = lattice(r, 128);
  const V6 = lattice(r, 6), V12 = lattice(r, 12), G5 = lattice(r, 5), S24 = lattice(r, 24);
  const out = new Uint8Array(size * size * 4);
  const base = [206, 211, 216], purple = [166, 152, 178], green = [188, 194, 178], vein = [118, 132, 168], spot = [176, 162, 160];
  const c = [0, 0, 0];
  for (let y = 0; y < size; y++) {
    const v = y / size;
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const m = 0.55 * vnoise(M4, 4, 4, u, v) + 0.3 * vnoise(M8, 8, 8, u, v) + 0.15 * vnoise(M16, 16, 16, u, v);
      const fine = 0.6 * vnoise(P64, 64, 64, u, v) + 0.4 * vnoise(P128, 128, 128, u, v);
      const gate = sstep(0.4, 0.62, vnoise(G5, 5, 5, u, v));
      const vn = Math.max(sstep(0.93, 0.985, ridge(vnoise(V6, 6, 6, u, v))), 0.6 * sstep(0.95, 0.99, ridge(vnoise(V12, 12, 12, u, v)))) * gate;
      const sp = sstep(0.76, 0.86, vnoise(S24, 24, 24, u, v));
      c[0] = base[0];
      c[1] = base[1];
      c[2] = base[2];
      mix3(c, purple, 0.6 * sstep(0.5, 0.78, m));
      mix3(c, green, 0.4 * sstep(0.42, 0.2, m));
      const sh = 0.94 + 0.1 * fine;
      c[0] *= sh;
      c[1] *= sh;
      c[2] *= sh;
      mix3(c, vein, 0.22 * vn);
      mix3(c, spot, 0.35 * sp);
      const o = (y * size + x) * 4;
      out[o] = clamp(Math.round(c[0]), 0, 255);
      out[o + 1] = clamp(Math.round(c[1]), 0, 255);
      out[o + 2] = clamp(Math.round(c[2]), 0, 255);
      out[o + 3] = 255;
    }
  }
  return out;
}

/** Ткань рубашки (RGBA, бесшовная): грязно-белая, переплетение, разводы с ободками, серые потёки сверху вниз. */
export function clothTexels(size: number, seed = 23): Uint8Array {
  const r = makeRng(seed);
  const S4 = lattice(r, 4), S8 = lattice(r, 8), P128 = lattice(r, 128), G = lattice(r, 24, 3), W6 = lattice(r, 6), D3 = lattice(r, 3);
  const out = new Uint8Array(size * size * 4);
  const base = [222, 220, 212], stain = [184, 174, 152], tide = [150, 140, 120], grime = [180, 178, 170], wet = [196, 198, 196];
  const c = [0, 0, 0];
  for (let y = 0; y < size; y++) {
    const v = y / size;
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const weave = ((x + (y >> 1)) & 1 ? 1.025 : 0.975) * ((y + (x >> 1)) & 1 ? 1.015 : 0.985) * (0.97 + 0.06 * vnoise(P128, 128, 128, u, v));
      const s = 0.6 * vnoise(S4, 4, 4, u, v) + 0.4 * vnoise(S8, 8, 8, u, v);
      const ks = sstep(0.56, 0.66, s);
      const tl = Math.exp(-(((s - 0.6) / 0.012) ** 2));
      const g = sstep(0.55, 0.85, vnoise(G, 24, 3, u, v));
      const w = sstep(0.6, 0.75, vnoise(W6, 6, 6, u, v)) * sstep(0.3, 0.6, vnoise(D3, 3, 3, u, v));
      c[0] = base[0];
      c[1] = base[1];
      c[2] = base[2];
      mix3(c, grime, 0.5 * g);
      mix3(c, stain, 0.32 * ks);
      mix3(c, tide, 0.25 * tl);
      mix3(c, wet, 0.5 * w);
      const o = (y * size + x) * 4;
      out[o] = clamp(Math.round(c[0] * weave), 0, 255);
      out[o + 1] = clamp(Math.round(c[1] * weave), 0, 255);
      out[o + 2] = clamp(Math.round(c[2] * weave), 0, 255);
      out[o + 3] = 255;
    }
  }
  return out;
}

/**
 * Кровь на рубашке (RGBA, не повторяется): u — поперёк груди (0.5 — середина), v — от выреза вниз. Альфа — «время
 * прихода» крови: у выреза посередине ~0.97, к концам потёков → 0; материал режет альфой (alphaCutOff = 1 − ~torn) —
 * пятно растёт и потёки ползут вниз.
 */
export function bloodTexels(size: number, seed = 31): Uint8Array {
  const r = makeRng(seed);
  const drips: { u: number; w: number; L: number; f: number; a: number; p: number }[] = [];
  for (let i = 0; i < 17; i++) {
    const u = 0.5 + (r.next() - 0.5) * (i < 9 ? 0.34 : 0.62);
    drips.push({ u, w: 0.006 + r.next() * 0.012, L: 0.3 + r.next() * 0.66, f: 3 + r.next() * 5, a: 0.003 + r.next() * 0.008, p: r.next() * TAU });
  }
  const dots: { u: number; v: number; r: number; a: number }[] = [];
  for (let i = 0; i < 26; i++) dots.push({ u: 0.2 + r.next() * 0.6, v: r.next() * 0.5, r: 0.003 + r.next() * 0.009, a: 0.3 + r.next() * 0.6 });
  const N4 = lattice(r, 5);
  const out = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    const v = y / size;
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const nn = vnoise(N4, 5, 5, u, v) - 0.5;
      // пропитанное «нагрудье»
      let a = Math.exp(-(((u - 0.5 + 0.04 * nn) / (0.12 + 0.05 * nn)) ** 2)) * (1 - v / (0.26 + 0.08 * nn));
      for (const d of drips) {
        if (v > d.L) continue;
        const cu = d.u + d.a * Math.sin(d.f * v * TAU + d.p);
        const k = 1 - v / d.L;
        // капля на конце потёка шире
        const w = d.w * (1 + 0.8 * Math.exp(-(((v - d.L * 0.97) / 0.03) ** 2)));
        a = Math.max(a, Math.exp(-(((u - cu) / w) ** 2)) * (0.15 + 0.82 * k));
      }
      for (const d of dots) {
        const dd = Math.hypot(u - d.u, v - d.v) / d.r;
        if (dd < 1) a = Math.max(a, d.a * (1 - dd * dd));
      }
      a = clamp(a * 0.97, 0, 1);
      const o = (y * size + x) * 4;
      const fresh = 1 - a;
      out[o] = Math.round(lerp(70, 118, fresh));
      out[o + 1] = Math.round(lerp(4, 8, fresh));
      out[o + 2] = Math.round(lerp(5, 9, fresh));
      out[o + 3] = Math.round(a * 255);
    }
  }
  return out;
}

/** Ореол (RGBA): белый, альфа — мягкий круг. */
function glowTexels(size: number): Uint8Array {
  const out = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.hypot((x + 0.5) / size - 0.5, (y + 0.5) / size - 0.5) * 2;
      const a = d >= 1 ? 0 : Math.pow(1 - d, 2.4);
      const o = (y * size + x) * 4;
      out[o] = out[o + 1] = out[o + 2] = 255;
      out[o + 3] = Math.round(a * 255);
    }
  }
  return out;
}

interface SmileTex {
  skin: RawTexture;
  cloth: RawTexture;
  blood: RawTexture;
  glow: RawTexture;
  refs: number;
}
const texByScene = new WeakMap<Scene, SmileTex>();
const TEX = 256;

function acquireTex(scene: Scene): SmileTex {
  const got = texByScene.get(scene);
  if (got) {
    got.refs++;
    return got;
  }
  const mk = (data: Uint8Array, size: number, name: string, wrap: boolean) => {
    const t = RawTexture.CreateRGBATexture(data, size, size, scene, true, false, Texture.TRILINEAR_SAMPLINGMODE);
    t.name = name;
    t.wrapU = t.wrapV = wrap ? Texture.WRAP_ADDRESSMODE : Texture.CLAMP_ADDRESSMODE;
    t.anisotropicFilteringLevel = 4;
    return t;
  };
  const tex: SmileTex = {
    skin: mk(pallorTexels(TEX), TEX, 'smile:skin', true),
    cloth: mk(clothTexels(TEX), TEX, 'smile:cloth', true),
    blood: mk(bloodTexels(TEX), TEX, 'smile:blood', false),
    glow: mk(glowTexels(64), 64, 'smile:glow', false),
    refs: 1,
  };
  tex.blood.hasAlpha = true;
  tex.glow.hasAlpha = true;
  texByScene.set(scene, tex);
  return tex;
}

function releaseTex(scene: Scene) {
  const got = texByScene.get(scene);
  if (!got || --got.refs > 0) return;
  got.skin.dispose();
  got.cloth.dispose();
  got.blood.dispose();
  got.glow.dispose();
  texByScene.delete(scene);
}

// ───────────────────────── сетки ─────────────────────────

/** Сетка вершин: ряды × столбцы (замкнутая — со шовным столбцом-копией), центр ряда — в Buf.cen. */
interface Grid {
  base: number;
  rows: number;
  cols: number;
  closed: boolean;
  flip: boolean;
  cb: number;
  inward: boolean;
}
/** вершин в ряду / четырёхугольников */
const gv = (g: Grid) => (g.closed ? g.cols + 1 : g.cols);
const gq = (g: Grid) => (g.rows - 1) * (g.closed ? g.cols : g.cols - 1);
const gi = (g: Grid, r: number, c: number) => g.base + r * gv(g) + c;

/** Буферы одного меша. */
class Buf {
  pos = new Float32Array(0);
  nor = new Float32Array(0);
  uv = new Float32Array(0);
  col = new Float32Array(0);
  cen = new Float32Array(0);
  grids: Grid[] = [];
  verts = 0;
  cenRows = 0;
  add(rows: number, cols: number, closed: boolean, inward = false): Grid {
    const g: Grid = { base: this.verts, rows, cols, closed, flip: false, cb: this.cenRows, inward };
    this.verts += rows * gv(g);
    this.cenRows += rows;
    this.grids.push(g);
    return g;
  }
  alloc() {
    this.pos = new Float32Array(this.verts * 3);
    this.nor = new Float32Array(this.verts * 3);
    this.uv = new Float32Array(this.verts * 2);
    this.col = new Float32Array(this.verts * 4).fill(1);
    this.cen = new Float32Array(this.cenRows * 3);
  }
  /** индексы всех сеток (порядок обхода — по первой позе, gridFlip) */
  indices(): Uint32Array {
    let n = 0;
    for (const g of this.grids) n += gq(g) * 6;
    const out = new Uint32Array(n);
    let at = 0;
    for (const g of this.grids) {
      g.flip = gridFlip(this.pos, this.nor, g);
      at = gridIdx(out, at, g);
    }
    return out;
  }
  put(i: number, p: V) {
    this.pos[i * 3] = p.x;
    this.pos[i * 3 + 1] = p.y;
    this.pos[i * 3 + 2] = p.z;
  }
  putN(i: number, n: V) {
    this.nor[i * 3] = n.x;
    this.nor[i * 3 + 1] = n.y;
    this.nor[i * 3 + 2] = n.z;
  }
  center(g: Grid, r: number, p: V) {
    const k = (g.cb + r) * 3;
    this.cen[k] = p.x;
    this.cen[k + 1] = p.y;
    this.cen[k + 2] = p.z;
  }
  /** центр ряда — среднее его вершин */
  centerAvg(g: Grid, r: number) {
    const n = g.cols, b = gi(g, r, 0);
    let x = 0, y = 0, z = 0;
    for (let c = 0; c < n; c++) {
      x += this.pos[(b + c) * 3];
      y += this.pos[(b + c) * 3 + 1];
      z += this.pos[(b + c) * 3 + 2];
    }
    const k = (g.cb + r) * 3;
    this.cen[k] = x / n;
    this.cen[k + 1] = y / n;
    this.cen[k + 2] = z / n;
  }
  /** шовный столбец замкнутой сетки — копия первого */
  seam(g: Grid) {
    if (!g.closed) return;
    const C = gv(g);
    for (let r = 0; r < g.rows; r++) {
      const a = (g.base + r * C) * 3, b = (g.base + r * C + g.cols) * 3;
      this.pos[b] = this.pos[a];
      this.pos[b + 1] = this.pos[a + 1];
      this.pos[b + 2] = this.pos[a + 2];
    }
  }
  rgb(i: number, r: number, g: number, b: number) {
    this.col[i * 4] = r;
    this.col[i * 4 + 1] = g;
    this.col[i * 4 + 2] = b;
    this.col[i * 4 + 3] = 1;
  }
}

/**
 * Нормали сетки центральными разностями (замкнутая — с переходом через шов), наружу от центра ряда (inward — внутрь).
 * Вырожденная точка (полюс) — по направлению от центра.
 */
function gridNormals(b: Buf, g: Grid) {
  const pos = b.pos, nor = b.nor, cen = b.cen;
  const C = gv(g), rows = g.rows, cols = g.cols;
  const last = g.closed ? cols : cols - 1;
  for (let r = 0; r < rows; r++) {
    const r0 = r > 0 ? r - 1 : 0, r1 = r < rows - 1 ? r + 1 : rows - 1;
    const k = (g.cb + r) * 3, cx = cen[k], cy = cen[k + 1], cz = cen[k + 2];
    for (let c = 0; c <= last; c++) {
      if (g.closed && c === cols) {
        const a = (g.base + r * C) * 3, s = (g.base + r * C + cols) * 3;
        nor[s] = nor[a];
        nor[s + 1] = nor[a + 1];
        nor[s + 2] = nor[a + 2];
        continue;
      }
      let c0: number, c1: number;
      if (g.closed) {
        c0 = c > 0 ? c - 1 : cols - 1;
        c1 = c < cols - 1 ? c + 1 : 0;
      } else {
        c0 = c > 0 ? c - 1 : 0;
        c1 = c < cols - 1 ? c + 1 : cols - 1;
      }
      const i = (g.base + r * C + c) * 3;
      const a0 = (g.base + r0 * C + c) * 3, a1 = (g.base + r1 * C + c) * 3;
      const b0 = (g.base + r * C + c0) * 3, b1 = (g.base + r * C + c1) * 3;
      const sx = pos[a1] - pos[a0], sy = pos[a1 + 1] - pos[a0 + 1], sz = pos[a1 + 2] - pos[a0 + 2];
      const ux = pos[b1] - pos[b0], uy = pos[b1 + 1] - pos[b0 + 1], uz = pos[b1 + 2] - pos[b0 + 2];
      let nx = uy * sz - uz * sy, ny = uz * sx - ux * sz, nz = ux * sy - uy * sx;
      const ox = pos[i] - cx, oy = pos[i + 1] - cy, oz = pos[i + 2] - cz;
      let l = Math.hypot(nx, ny, nz);
      if (l < 1e-14) {
        nx = ox;
        ny = oy;
        nz = oz;
        l = Math.hypot(nx, ny, nz);
        if (l < 1e-14) {
          ny = 1;
          l = 1;
        }
      }
      let d = nx * ox + ny * oy + nz * oz;
      if (g.inward) d = -d;
      if (d < 0) l = -l;
      nor[i] = nx / l;
      nor[i + 1] = ny / l;
      nor[i + 2] = nz / l;
    }
  }
}

/**
 * Порядок обхода: Babylon (левая система) считает лицевым треугольник, у которого cross(p1 − p0, p2 − p0) смотрит
 * против нормали. Проверка — на невырожденном четырёхугольнике в середине сетки.
 */
function gridFlip(pos: Float32Array, nor: Float32Array, g: Grid): boolean {
  const qc = g.closed ? g.cols : g.cols - 1;
  for (const rr of [g.rows >> 1, (g.rows - 1) >> 1, 1, 0]) {
    const r = Math.min(rr, g.rows - 2);
    for (const cc of [qc >> 2, qc >> 1, 0]) {
      const a = gi(g, r, cc), b = a + 1, d = a + gv(g) + 1;
      const ux = pos[b * 3] - pos[a * 3], uy = pos[b * 3 + 1] - pos[a * 3 + 1], uz = pos[b * 3 + 2] - pos[a * 3 + 2];
      const vx = pos[d * 3] - pos[a * 3], vy = pos[d * 3 + 1] - pos[a * 3 + 1], vz = pos[d * 3 + 2] - pos[a * 3 + 2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const dot = nx * nor[a * 3] + ny * nor[a * 3 + 1] + nz * nor[a * 3 + 2];
      if (Math.abs(dot) > 1e-12) return dot > 0;
    }
  }
  return false;
}

function gridIdx(out: Uint32Array, at: number, g: Grid): number {
  const C = gv(g), qc = g.closed ? g.cols : g.cols - 1;
  for (let r = 0; r < g.rows - 1; r++) {
    for (let c = 0; c < qc; c++) {
      const a = g.base + r * C + c, b = a + 1, e = a + C, d = e + 1;
      if (!g.flip) {
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

// ───────────────────────── тело: пропорции ─────────────────────────

/** Пропорции, м (кости — от таза вверх; руки и ноги — ИК). */
const B = {
  hipY: 0.952,
  hipX: 0.08,
  hipDrop: 0.04,
  thigh: 0.43,
  shin: 0.415,
  ankleY: 0.072,
  spine: 0.115,
  chest: 0.145,
  nb: 0.175,
  neck: 0.165,
  shX: 0.158,
  shY: -0.032,
  shZ: -0.012,
  upper: 0.285,
  fore: 0.252,
  palm: 0.082,
};
/** центр головы от шарнира шеи (кадр головы) */
const HC = { x: 0, y: 0.048, z: 0.022 };

/** Голова (координаты от центра головы): полуоси черепа, сетка, рот. */
const HEAD = { ax: 0.069, ayT: 0.118, ayB: 0.124, azF: 0.088, azB: 0.097 };
const NCH = 36;
const NU = 22;
const NL = 10;
const TH_HAIR = 0.85;
const TH_BOT = 2.98;
/**
 * Рот: середина на y0, уголки улыбки — на phiC (рад по кругу головы, ~под скулами) подняты на lift; разрыв при torn —
 * дальше вверх-назад до уха (phiEar, yEar); за ухом ряд обходит затылок на yBack.
 */
const MOUTH = { y0: -0.066, lift: 0.036, phiC: 1.3, phiEar: 1.74, yEar: -0.014, yBack: -0.034 };
/** ось челюсти (x — поперёк); широко раскрытая челюсть ещё и выезжает вниз-вперёд (вывих) */
const JAW = { y: -0.03, z: -0.02, drop: 0.034, fwd: 0.026 };
/** Челюсть: точка (y, z) от центра головы, поворот a (рад) и доля w → out.y, out.z. */
function jawXf(y: number, z: number, a: number, w: number, out: V): V {
  const ang = a * w, ca = Math.cos(ang), sa = Math.sin(ang);
  const qy = y - JAW.y, qz = z - JAW.z, k = sstep(0.12, 0.75, a) * w;
  out.y = JAW.y + qy * ca - qz * sa - JAW.drop * k;
  out.z = JAW.z + qy * sa + qz * ca + JAW.fwd * k;
  return out;
}
/** глаза (от центра головы): центры, радиусы; левый (−x) чуть ниже, крупнее и косит наружу */
const EYES = [
  { x: -0.0312, y: 0.0168, z: 0.0603, r: 0.0128, out: 0.08 },
  { x: 0.0318, y: 0.018, z: 0.0606, r: 0.0123, out: 0.0 },
];

const colPhi = (c: number) => {
  const s = -1 + (2 * c) / NCH;
  return Math.PI * s * (0.55 + 0.45 * s * s);
};
function mouthY(ph: number): number {
  const a = Math.abs(ph), M = MOUTH;
  if (a <= M.phiC) return M.y0 + M.lift * Math.pow(a / M.phiC, 2.2);
  const yc = M.y0 + M.lift;
  if (a <= M.phiEar) return yc + (M.yEar - yc) * smooth((a - M.phiC) / (M.phiEar - M.phiC));
  return M.yEar + (M.yBack - M.yEar) * smooth((a - M.phiEar) / (Math.PI - M.phiEar));
}
const thetaM = (ph: number) => Math.acos(clamp(mouthY(ph) / HEAD.ayB, -1, 1));
function thetaU(r: number, tm: number): number {
  const k0 = 5;
  if (r <= k0) return TH_HAIR * (r / k0);
  return TH_HAIR + (tm - TH_HAIR) * ((r - k0) / (NU - 1 - k0));
}
const thetaL = (j: number, tm: number) => tm + (TH_BOT - tm) * Math.pow((j - 1) / (NL - 2), 1.15);
/** доля «улыбки» по кругу (губы) и зона разрыва (за прежними уголками) */
const smileW = (ph: number) => 1 - sstep(MOUTH.phiC - 0.25, MOUTH.phiC + 0.02, Math.abs(ph));
const tornZone = (ph: number) => sstep(MOUTH.phiC - 0.12, MOUTH.phiC + 0.08, Math.abs(ph));

/** Рельеф лица вперёд (z) по точке черепа (X, Y), м. */
function faceRelief(X: number, Y: number, ph: number): number {
  const ax = Math.abs(X);
  let f = 0;
  // надбровья
  f += 0.0045 * Math.exp(-(((Y - 0.04) / 0.011) ** 2)) * sstep(0.064, 0.035, ax);
  // глазницы — глубокие, запавшие
  f -= 0.0135 * gauss2(ax - 0.031, Y - 0.017, 0.0175, 0.0128);
  f -= 0.004 * gauss2(ax - 0.017, Y - 0.011, 0.007, 0.008);
  // тяжёлое верхнее веко: прикрывает верх глаза — взгляд исподлобья
  f += 0.0052 * gauss2(ax - 0.031, Y - 0.0295, 0.016, 0.0052);
  // нос: тонкая спинка от переносицы, кончик, под кончиком — вниз
  const nh = 0.003 + 0.0195 * sstep(0.03, -0.031, Y);
  const nw = 0.0068 + 0.0045 * sstep(0.0, -0.034, Y);
  const nb = Y < -0.034 ? sstep(-0.046, -0.034, Y) : sstep(0.046, 0.032, Y);
  f += nh * nb * Math.exp(-((X / nw) ** 2));
  f += 0.0048 * gauss2(ax - 0.0125, Y + 0.033, 0.0055, 0.0055);
  // скулы — высокие; щёки — впалые
  f += 0.0068 * gauss2(ax - 0.048, Y + 0.002, 0.014, 0.011);
  f -= 0.0085 * gauss2(ax - 0.046, Y + 0.05, 0.015, 0.019);
  // рот выпуклый, подбородок острый
  f += 0.0075 * gauss2(X, Y + 0.066, 0.03, 0.026);
  f += 0.0068 * gauss2(X, Y + 0.109, 0.013, 0.0125);
  // улыбка: собранные щёки над уголками, тонкие растянутые губы, складка-линия рта
  const dy = Y - mouthY(ph), wsm = smileW(ph);
  f += 0.005 * gauss2(ax - 0.036, Y + 0.022, 0.011, 0.0095);
  f += wsm * (0.0026 * Math.exp(-(((dy - 0.0045) / 0.0038) ** 2)) + 0.0032 * Math.exp(-(((dy + 0.0055) / 0.0042) ** 2)));
  f -= 0.0016 * wsm * Math.exp(-((dy / 0.0016) ** 2));
  return f;
}

/** Точка черепа по широте θ (0 — макушка) и долготе φ (0 — лицо, + к правому уху), от центра головы. */
function headBase(th: number, ph: number, o: V): V {
  const st = Math.sin(th), ct = Math.cos(th);
  const y = ct * (ct > 0 ? HEAD.ayT : HEAD.ayB);
  const sp = Math.sin(ph), cp = Math.cos(ph);
  // узкая челюсть и острый подбородок спереди, виски чуть шире
  const jaw = sstep(-0.015, -0.115, y) * sstep(-0.2, 0.6, cp);
  const ax = HEAD.ax * (1 - 0.28 * jaw) * (1 + 0.01 * Math.exp(-((y / 0.03) ** 2))) * (1 - 0.06 * sstep(0.03, 0.11, y));
  const az = cp > 0 ? HEAD.azF * (1 - 0.1 * sstep(-0.05, -0.12, y)) : HEAD.azB * (1 - 0.25 * sstep(-0.02, -0.11, y));
  const x = ax * st * sgnPow(sp, 0.88);
  let z = az * st * sgnPow(cp, 0.88);
  const wf = sstep(0.1, 0.7, cp);
  if (wf > 0) z += wf * faceRelief(x, y, ph);
  return vset(o, x, y, z);
}

// ───────────────────────── поза ─────────────────────────

interface HandSpec {
  /** середина костяшек (тело), направление пальцев, тыл ладони, куда локоть */
  k: V;
  fd: V;
  dn: V;
  pole: V;
  /** сгибы суставов: 4 пальца × 3 (от основания) + большой × 3, рад; разведение пальцев */
  j: number[];
  spread: number;
}
interface FootSpec {
  a: V;
  fwd: V;
  up: V;
  pole: V;
}
interface Spec {
  hp: V;
  hr: V;
  sr: V;
  cr: V;
  nr: V;
  kr: V;
  dr: V;
  /** поправки плеч (dx наружу, dy, dz) */
  sh: [V, V];
  hand: [HandSpec, HandSpec];
  foot: [FootSpec, FootSpec];
  jaw: number;
  torn: number;
  /** доля поворота головы к look, предел взгляда вверх (рад); глаза к look */
  look: number;
  lookUp: number;
  gaze: number;
  /** ветер для волос и подола (тело, м/с) */
  wind: V;
  /** кровь на руках 0…1 */
  bloody: number;
  /** привязка: 0 — нет, 1 — кончик носа на плоскости z = fix.z, 2 — рот в точке fix; доля привязки */
  fixK: number;
  fixMode: number;
  fix: V;
}
const mkHand = (): HandSpec => ({ k: v3(), fd: v3(0, -1, 0), dn: v3(1, 0, 0), pole: v3(0, 0, -1), j: new Array(15).fill(0), spread: 0 });
const mkFoot = (): FootSpec => ({ a: v3(), fwd: v3(0, 0, 1), up: v3(0, 1, 0), pole: v3(0, 0, 1) });
const mkSpec = (): Spec => ({
  hp: v3(), hr: v3(), sr: v3(), cr: v3(), nr: v3(), kr: v3(), dr: v3(),
  sh: [v3(), v3()], hand: [mkHand(), mkHand()], foot: [mkFoot(), mkFoot()],
  jaw: 0, torn: 0, look: 1, lookUp: 0.61, gaze: 1, wind: v3(), bloody: 0, fixK: 0, fixMode: 0, fix: v3(),
});

/** Позы пальцев (сгибы по суставам: указательный, средний, безымянный, мизинец, большой). */
const RELAX = [0.2, 0.45, 0.3, 0.24, 0.5, 0.32, 0.3, 0.55, 0.35, 0.36, 0.62, 0.4, 0.3, 0.25, 0.2];
const GRIP = [0.1, 1.5, 0.5, 0.08, 1.55, 0.55, 0.12, 1.5, 0.5, 0.18, 1.45, 0.55, 0.2, 0.15, 0.15];
const FLAT = [-0.04, 0.03, -0.14, -0.04, 0.0, -0.12, -0.04, 0.03, -0.1, -0.02, 0.05, -0.06, 0.05, 0.0, -0.1];
const CLAW = [0.12, 0.95, 0.85, 0.1, 1.0, 0.9, 0.14, 1.0, 0.9, 0.2, 0.95, 0.85, 0.3, 0.4, 0.5];
const DIG = [0.45, 1.2, 0.9, 0.45, 1.25, 0.95, 0.5, 1.2, 0.9, 0.55, 1.15, 0.85, 0.5, 0.5, 0.5];

function handJ(h: HandSpec, a: readonly number[], b: readonly number[], k: number, t: number, twitchK: number, seed: number) {
  for (let i = 0; i < 15; i++) h.j[i] = lerp(a[i], b[i], k) + twitchK * (noise1(t * 1.7 + i * 3.1, seed) - 0.5);
}
function setHand(h: HandSpec, kx: number, ky: number, kz: number, fd: V, dn: V, pole: V) {
  vset(h.k, kx, ky, kz);
  vnorm(h.fd, fd);
  vnorm(h.dn, dn);
  vnorm(h.pole, pole);
}
const tv = (x: number, y: number, z: number) => v3(x, y, z);
// направления поз (константы, нормируются при установке)
const D_DOWN_R = tv(0.05, -1, 0.06), D_DOWN_L = tv(-0.05, -1, 0.06);
const D_OUT_R = tv(1, 0, -0.25), D_OUT_L = tv(-1, 0, -0.25);
const D_BACK_R = tv(0.3, 0, -1), D_BACK_L = tv(-0.3, 0, -1);
const D_GRIP_F = tv(0.75, 0.66, 0), D_GRIP_N = tv(0, 0, -1), D_GRIP_P = tv(-0.5, -1, 0.3);

/** Висящие руки (обе), пальцы расслаблены и подрагивают. */
function hangArms(s: Spec, t: number, sway: number) {
  const [L, R] = s.hand;
  setHand(R, 0.215 + 0.25 * sway, 0.765, 0.018, D_DOWN_R, D_OUT_R, D_BACK_R);
  setHand(L, -0.205 + 0.25 * sway, 0.775, 0.022, D_DOWN_L, D_OUT_L, D_BACK_L);
  handJ(R, RELAX, RELAX, 0, t, 0.18, 1);
  handJ(L, RELAX, RELAX, 0, t, 0.18, 2);
  R.spread = L.spread = 0.06;
}
function feet(s: Spec, lx: number, lz: number, rx: number, rz: number, lIn: number, rIn: number) {
  const [L, R] = s.foot;
  vset(L.a, lx, B.ankleY, lz);
  vset(R.a, rx, B.ankleY, rz);
  vnorm(L.fwd, vset(L.fwd, lIn, 0, 1));
  vnorm(R.fwd, vset(R.fwd, -rIn, 0, 1));
  vset(L.up, 0, 1, 0);
  vset(R.up, 0, 1, 0);
  vnorm(L.pole, vset(L.pole, -0.12, 0, 1));
  vnorm(R.pole, vset(R.pole, 0.12, 0, 1));
}
function resetSpec(s: Spec) {
  s.jaw = 0;
  s.torn = 0;
  s.look = 1;
  s.lookUp = 0.61;
  s.gaze = 1;
  vset(s.wind, 0, 0, 0);
  s.bloody = 0;
  s.fixK = 0;
  s.fixMode = 0;
  vset(s.sh[0], 0, 0, 0);
  vset(s.sh[1], 0, 0, 0);
}

/** Стоит посреди прохода: покачивание маятником от ступней (неровный ритм), голова набок, подёргивания. */
function poseStand(s: Spec, t: number) {
  resetSpec(s);
  const sw = 0.024 * Math.sin(TAU * 0.19 * t) + 0.011 * Math.sin(TAU * 0.47 * t + 1.3) + 0.012 * (noise1(t * 0.9, 3) - 0.5);
  const sf = 0.013 * Math.sin(TAU * 0.13 * t + 0.4) + 0.005 * Math.sin(TAU * 0.71 * t);
  vset(s.hp, 0.6 * sw, B.hipY - 0.004, 0.6 * sf - 0.01);
  vset(s.hr, 0.03 + sf, 0.02, 0.035 + 0.7 * sw);
  vset(s.sr, 0.05, -0.02, -0.03 - 0.4 * sw);
  vset(s.cr, 0.07, 0.03, -0.02 - 0.2 * sw);
  vset(s.nr, 0.1, 0, 0.0);
  const tw = twitch(t, 3.7, 0.24, 1), tw2 = twitch(t + 1.3, 5.3, 0.32, 2);
  vset(s.kr, -0.02, 0.05 * tw2, 0.1 + 0.12 * tw2 - 0.3 * sw);
  vset(s.dr, 0.17 + 0.07 * tw, 0.06 * tw, 0.24 + 0.22 * tw);
  // плечи: левое приподнято, правое ниже и вперёд — сутулится
  vset(s.sh[0], 0, 0.012, 0.012);
  vset(s.sh[1], 0, -0.012, 0.02);
  hangArms(s, t, sw);
  feet(s, -0.08, 0.0, 0.085, 0.03, 0.2, 0.12);
}

/**
 * Выглядывает из-за косяка (side = 1: косяк справа-спереди). Рука ложится на ребро раньше (lean ~0.05…0.38): ладонь на
 * торце простенка, пальцы обхватывают ребро на коридорную грань; тело — позже (0.1…1): таз к косяку, корпус клонится
 * вбок (~40° у основания шеи), шея и голова частью выпрямляются — голова наклонена ~30°, голова и плечо — в коридоре.
 */
function posePeek(s: Spec, lean: number, t: number) {
  resetSpec(s);
  const P = SMILE_MODEL.peek;
  const hk = sstep(0.04, 0.38, lean), bk = sstep(0.1, 1.0, lean);
  const idle = 0.018 * Math.sin(TAU * 0.27 * t) + 0.01 * (noise1(t * 0.7, 5) - 0.5);
  const tw = twitch(t, 4.3, 0.2, 3) * bk;
  // корпус клонится вбок (таз чуть к косяку), шея и голова частью выпрямляются: наклон головы ~30°
  vset(s.hp, 0.07 * bk, B.hipY - 0.006 - 0.02 * bk, 0.0);
  vset(s.hr, 0.02, 0.03 * bk, 0.05 * bk);
  vset(s.sr, 0.02, 0.03 * bk, 0.28 * bk);
  vset(s.cr, 0.04, 0.03 * bk, 0.24 * bk);
  vset(s.nr, 0.03, 0, 0.14 * bk);
  vset(s.kr, 0.0, 0, -0.1 * bk + idle * bk);
  vset(s.dr, 0.05, 0.0, -0.08 * bk + 0.1 * tw);
  vset(s.sh[1], 0, 0.01 * hk, 0.015 * hk);
  const [L, R] = s.hand;
  // левая висит
  setHand(L, -0.205, 0.78, 0.02, D_DOWN_L, D_OUT_L, D_BACK_L);
  handJ(L, RELAX, RELAX, 0, t, 0.14, 2);
  L.spread = 0.06;
  // правая: висит → на ребре (ладонь на торце z = jambZ, пальцы через ребро x = jambX)
  const gx = P.jambX - 0.03, gy = 1.44 + 0.01 * Math.sin(TAU * 0.11 * t), gz = P.jambZ - 0.013;
  vset(R.k, lerp(0.19, gx, hk), lerp(0.77, gy, hk), lerp(0.03, gz, hk));
  vnorm(R.fd, vlerp(R.fd, D_DOWN_R, D_GRIP_F, hk));
  vnorm(R.dn, vlerp(R.dn, D_OUT_R, D_GRIP_N, hk));
  vnorm(R.pole, vlerp(R.pole, D_BACK_R, D_GRIP_P, hk));
  handJ(R, RELAX, GRIP, hk, t, 0.06 + 0.08 * (1 - hk), 1);
  R.spread = lerp(0.06, 0.12, hk);
  feet(s, -0.09, -0.02, 0.075, 0.02, 0.15, 0.08);
}

/** Лицом и ладонями к стеклу (плоскость z = glassZ): сутулится, лицо прижато, указательный постукивает. */
function poseWindow(s: Spec, t: number) {
  resetSpec(s);
  const W = SMILE_MODEL.window;
  const sl = 0.006 * Math.sin(TAU * 0.09 * t);
  vset(s.hp, sl, 0.925, 0.04);
  vset(s.hr, 0.07, 0, 0.02);
  vset(s.sr, 0.12, 0, -0.01);
  vset(s.cr, 0.1, 0, 0.015);
  vset(s.nr, 0.08, 0, -0.02);
  vset(s.kr, -0.06, 0, 0.0);
  vset(s.dr, -0.12, 0.02 * Math.sin(TAU * 0.07 * t), 0.07 + 0.03 * Math.sin(TAU * 0.05 * t));
  vset(s.sh[0], 0, 0.02, 0.02);
  vset(s.sh[1], 0, 0.025, 0.02);
  s.look = 0.25;
  s.fixMode = 1;
  s.fixK = 1;
  vset(s.fix, 0, 0, W.glassZ);
  const [L, R] = s.hand;
  const hy = W.headY + 0.1;
  setHand(R, 0.165, hy, W.glassZ - 0.013, tv(0.18, 1, 0), tv(0, 0, -1), tv(1, -0.7, -0.4));
  setHand(L, -0.16, hy - 0.02, W.glassZ - 0.013, tv(-0.2, 1, 0), tv(0, 0, -1), tv(-1, -0.7, -0.4));
  handJ(R, FLAT, FLAT, 0, t, 0.05, 1);
  handJ(L, FLAT, FLAT, 0, t, 0.05, 2);
  // стук указательным: три удара раз в ~4 с
  const ph = t % 4.2;
  if (ph < 0.9) R.j[0] += 0.35 * Math.max(0, Math.sin((ph / 0.3) * Math.PI));
  R.spread = L.spread = 0.2;
  feet(s, -0.1, 0.0, 0.1, 0.0, 0.05, 0.05);
}

/** Бросок: присела (0…0.3) → прыжок (0.22…0.75, тело вперёд почти горизонтально, руки-когти вперёд) → удар (0.7…1). */
function posePounce(s: Spec, k: number, t: number) {
  resetSpec(s);
  const Pn = SMILE_MODEL.pounce;
  const a = sstep(0, 0.3, k), b = sstep(0.22, 0.75, k), c = sstep(0.7, 1.0, k);
  vset(s.hp, 0, B.hipY - 0.2 * a + 0.18 * b - 0.06 * c, -0.05 * a + 0.42 * b + 0.1 * c);
  vset(s.hr, 0.3 * a + 0.25 * b - 0.1 * c, 0, 0.03);
  vset(s.sr, 0.12 * a + 0.12 * b, 0, -0.02);
  vset(s.cr, 0.08 * a + 0.06 * b, 0, 0);
  vset(s.nr, 0.05 - 0.15 * b, 0, 0);
  vset(s.kr, -0.1 * a - 0.35 * b, 0, 0.05);
  vset(s.dr, 0.1 * a - 0.35 * b, 0, 0.12 * (1 - b) + 0.2 * twitch(t, 0.6, 0.15, 7));
  const [L, R] = s.hand;
  // руки: назад (замах) → вперёд когтями, ладони вниз
  const hy = lerp(0.82, 1.5, b), hz = lerp(-0.12, Pn.reach + 0.12, b);
  setHand(R, lerp(0.24, 0.2, b), hy, hz, vlerp(tv(0, 0, 0), D_DOWN_R, tv(0.1, 0.25, 1), b), vlerp(tv(0, 0, 0), D_OUT_R, tv(0.2, 1, -0.2), b), tv(0.6, -0.6, -0.4));
  setHand(L, lerp(-0.24, -0.2, b), hy + 0.03, hz - 0.04, vlerp(tv(0, 0, 0), D_DOWN_L, tv(-0.1, 0.25, 1), b), vlerp(tv(0, 0, 0), D_OUT_L, tv(-0.2, 1, -0.2), b), tv(-0.6, -0.6, -0.4));
  handJ(R, RELAX, CLAW, sstep(0.1, 0.6, k), t, 0.1, 1);
  handJ(L, RELAX, CLAW, sstep(0.1, 0.6, k), t, 0.1, 2);
  R.spread = L.spread = lerp(0.06, 0.35, b);
  // ноги: присела → толчок (правая сзади, носок вытянут), левая вперёд коленом
  const [FL, FR] = s.foot;
  feet(s, -0.09, 0.0, 0.09, 0.0, 0.1, 0.1);
  vset(FL.a, -0.1, B.ankleY + 0.32 * b * (1 - c) + 0.0 * c, 0.0 + 0.55 * b + 0.05 * c);
  vset(FR.a, 0.1, B.ankleY + 0.22 * b * (1 - c), -0.02 + 0.12 * b + 0.3 * c);
  vnorm(FL.fwd, vlerp(FL.fwd, FL.fwd, tv(0, -0.6, 1), b));
  vnorm(FR.fwd, vlerp(FR.fwd, FR.fwd, tv(0, -1, -0.2), b * (1 - c)));
  vnorm(FL.up, vlerp(FL.up, FL.up, tv(0, 1, 0.6), b));
  vnorm(FR.up, vlerp(FR.up, FR.up, tv(0, 0.3, 1), b * (1 - c)));
  s.jaw = 0.08 * a + 0.22 * b;
  s.torn = sstep(0.05, 0.5, k);
  vsc(s.wind, tv(0, 0.15, -1), 3.2 * b * (1 - 0.7 * c));
  s.bloody = 0;
  // к удару — пасть у точки жертвы
  s.lookUp = 1.2;
  s.fixMode = 2;
  s.fixK = c;
  vset(s.fix, 0, Pn.mouthY, Pn.reach);
}

/**
 * Ест: низко присела над жертвой «лягушкой» (стопы под собой, колени широко в стороны и вверх), корпус почти
 * горизонтально и ниже, шея вниз — рот у шеи жертвы; рывки головой вверх-вбок (оторвать кусок), жуёт; пальцы впились
 * в грудь и плечо жертвы.
 */
function poseEat(s: Spec, t: number) {
  resetSpec(s);
  const N = SMILE_MODEL.eat.neck;
  // рывок: резко вверх-вбок, медленно обратно; через раз — в другую сторону
  const cyc = t * 1.45, ci = Math.floor(cyc), f = cyc - ci;
  const pull = f < 0.16 ? smooth(f / 0.16) : 1 - smooth((f - 0.16) / 0.6);
  const side = hash1(ci * 3.3) < 0.5 ? -1 : 1;
  const chew = 0.5 + 0.5 * Math.sin(TAU * 2.6 * t);
  vset(s.hp, 0.01 * side * pull, 0.3, 0.1);
  vset(s.hr, 0.6, 0, 0.02);
  vset(s.sr, 0.45, 0, 0);
  vset(s.cr, 0.4 - 0.1 * pull, 0, 0.04 * side * pull);
  vset(s.nr, 0.25 - 0.15 * pull, 0.05 * side * pull, 0);
  vset(s.kr, 0.25 - 0.2 * pull, 0.15 * side * pull, 0.1 * side * pull);
  vset(s.dr, 0.1 - 0.25 * pull, 0.25 * side * pull, 0.25 * side * pull + 0.1);
  vset(s.sh[0], 0, 0.035 + 0.02 * pull, 0.02);
  vset(s.sh[1], 0, 0.04 + 0.02 * pull, 0.02);
  const [L, R] = s.hand;
  setHand(R, 0.11, 0.17, N.z + 0.22, tv(0.1, -0.5, 1), tv(0, 1, 0.1), tv(1, 0.6, -0.3));
  setHand(L, -0.17, 0.15, N.z + 0.02, tv(0.6, -0.4, 0.6), tv(0, 1, 0), tv(-1, 0.6, -0.3));
  handJ(R, DIG, DIG, 0, t, 0.25, 1);
  handJ(L, DIG, DIG, 0, t, 0.25, 2);
  R.spread = L.spread = 0.25;
  const [FL, FR] = s.foot;
  vset(FL.a, -0.2, B.ankleY + 0.004, 0.02);
  vset(FR.a, 0.21, B.ankleY + 0.004, 0.0);
  vnorm(FL.fwd, vset(FL.fwd, -0.35, 0, 1));
  vnorm(FR.fwd, vset(FR.fwd, 0.35, 0, 1));
  vset(FL.up, 0, 1, 0);
  vset(FR.up, 0, 1, 0);
  vnorm(FL.pole, vset(FL.pole, -1, 0.5, 0.35));
  vnorm(FR.pole, vset(FR.pole, 1, 0.5, 0.35));
  s.jaw = 0.22 * chew + 0.1 * pull - 0.1;
  s.torn = 1;
  s.look = 0;
  s.gaze = 0;
  s.bloody = 1;
  s.fixMode = 2;
  s.fixK = 1;
  vset(s.fix, N.x, N.y + 0.035 + 0.07 * pull, N.z - 0.01);
}

// ───────────────────────── скелет кадра ─────────────────────────

/** Пальцы: основание (x — к большому пальцу, y — от запястья, z — тыл), фаланги, радиусы у основания и у кончика, вес разведения. */
const FINGERS = [
  { b: [0.021, 0.081, 0.002], l: [0.047, 0.03, 0.025], r0: 0.0078, r1: 0.0058, sp: 0.9 },
  { b: [0.0065, 0.084, 0.003], l: [0.052, 0.034, 0.027], r0: 0.008, r1: 0.006, sp: 0.15 },
  { b: [-0.0085, 0.081, 0.002], l: [0.049, 0.032, 0.026], r0: 0.0076, r1: 0.0057, sp: -0.6 },
  { b: [-0.022, 0.074, 0.0], l: [0.038, 0.025, 0.022], r0: 0.0068, r1: 0.0052, sp: -1.25 },
  { b: [0.021, 0.024, -0.008], l: [0.043, 0.033, 0.028], r0: 0.0098, r1: 0.0072, sp: 0 },
];

class Rig {
  /** таз, поясница, грудь, основание шеи, шея, голова (начало — шарнир) */
  readonly bones = [frame(), frame(), frame(), frame(), frame(), frame()];
  readonly sh = [v3(), v3()];
  readonly el = [v3(), v3()];
  readonly wr = [v3(), v3()];
  readonly hand = [frame(), frame()];
  readonly hip = [v3(), v3()];
  readonly kn = [v3(), v3()];
  readonly an = [v3(), v3()];
  readonly foot = [frame(), frame()];
  readonly thigh = [frame(), frame()];
  /** пальцы [рука][палец]: 4 точки (основание … кончик), 3 направления фаланг, 3 «тыла» */
  readonly fj: V[][][] = [0, 1].map(() => [0, 1, 2, 3, 4].map(() => [v3(), v3(), v3(), v3()]));
  readonly fd: V[][][] = [0, 1].map(() => [0, 1, 2, 3, 4].map(() => [v3(), v3(), v3()]));
  readonly fz: V[][][] = [0, 1].map(() => [0, 1, 2, 3, 4].map(() => [v3(), v3(), v3()]));
  readonly eye = [v3(), v3()];
  readonly gaze = [v3(0, 0, 1), v3(0, 0, 1)];
  readonly hc = v3();
}

const T_RINGS = 9;
/** Кольца торса и шеи: кость (0 таз … 5 голова), смещение y, z в ней, полуоси x, z. T0, T1 — только под рубашку. */
const TORSO: readonly (readonly number[])[] = [
  [0, 0.0, 0.0, 0.14, 0.1],
  [1, 0.0, 0.0, 0.105, 0.078],
  [2, 0.0, 0.006, 0.118, 0.085],
  [2, 0.11, 0.0, 0.134, 0.082],
  [3, -0.036, -0.008, 0.162, 0.064],
  [3, 0.012, -0.01, 0.07, 0.054],
  [4, 0.05, 0.004, 0.05, 0.047],
  [4, 0.11, 0.008, 0.046, 0.045],
  [5, -0.03, 0.0, 0.038, 0.04],
];
/** кольца торса, что рисуются кожей (ниже — под рубашкой) */
const T_SKIN0 = 2;
const GC = 24;
const GU = 6;
const GS = 6;
const SKIRT_L = 0.43;
const SC = 12;
/** рукав: расстояния колец от плеча вдоль плеча и радиусы */
const SLEEVE = [
  [-0.03, 0.044],
  [0.02, 0.042],
  [0.065, 0.04],
  [0.098, 0.042],
];
/** трубы рук и ног: [отрезок, доля, радиус, выступ (локоть/колено вперёд), выступ назад (икра)] */
const ARM_R: readonly (readonly number[])[] = [
  [0, 0, 0.038, 0, 0], [0, 0.2, 0.032, 0, 0], [0, 0.4, 0.029, 0, 0], [0, 0.62, 0.027, 0, 0], [0, 0.84, 0.025, 0.004, 0],
  [1, 0, 0.026, 0.008, 0], [1, 0.12, 0.028, 0.003, 0], [1, 0.3, 0.027, 0, 0], [1, 0.5, 0.024, 0, 0], [1, 0.7, 0.021, 0, 0],
  [1, 0.88, 0.019, 0, 0], [2, 0, 0.0175, 0, 0], [2, 1, 0.019, 0, 0],
];
const LEG_R: readonly (readonly number[])[] = [
  [0, 0, 0.058, 0, 0], [0, 0.25, 0.054, 0, 0], [0, 0.5, 0.049, 0, 0], [0, 0.72, 0.044, 0, 0], [0, 0.9, 0.041, 0.004, 0],
  [1, 0, 0.041, 0.007, 0], [1, 0.1, 0.039, 0.003, 0], [1, 0.25, 0.04, 0, 0.007], [1, 0.42, 0.039, 0, 0.006], [1, 0.6, 0.033, 0, 0.002],
  [1, 0.76, 0.027, 0, 0], [1, 0.9, 0.023, 0, 0], [2, 0, 0.022, 0, 0], [2, 0.5, 0.024, 0, 0], [2, 1, 0.024, 0, 0],
];
/** ступня (кадр стопы: z — к пальцам, y — вверх): z, центр y, полуширина, полувысота */
const FOOT_R: readonly (readonly number[])[] = [
  [-0.068, -0.04, 0.012, 0.012], [-0.056, -0.038, 0.028, 0.03], [-0.02, -0.035, 0.03, 0.036], [0.03, -0.042, 0.032, 0.03],
  [0.085, -0.05, 0.04, 0.02], [0.13, -0.055, 0.044, 0.014], [0.165, -0.058, 0.04, 0.011], [0.192, -0.06, 0.025, 0.006],
];
const PALM_R: readonly (readonly number[])[] = [
  [-0.012, 0.021, 0.0135, 0], [0.018, 0.029, 0.0135, -0.001], [0.048, 0.033, 0.012, -0.001], [0.07, 0.034, 0.011, 0], [0.086, 0.027, 0.0075, 0.001],
];

// ───────────────────────── волосы (облик) ─────────────────────────

interface Strand {
  /** корень и направление «расчёски» (от центра головы, кадр головы), длина, ширина у корня, фаза, цвет */
  root: V;
  tan: V;
  len: number;
  w: number;
  ph: number;
  c: number;
  /** сторона лица, куда прядь уходит от середины */
  sx: number;
}
const HN = 11;
/** голова для волос (кадр головы, от центра): центр и полуоси (спереди / сзади по z) — пряди ложатся поверх */
const HAIR_HEAD = { cy: 0.004, cz: -0.004, ax: 0.079, ay: 0.127, azF: 0.114, azB: 0.106 };
/**
 * Лицо открыто: перед лицом (кадр головы, от центра: z > z0, y от y0 до y1) волосы не ближе w к середине по x
 * (у подбородка — wChin) — пряди сдвигаются вбок и обрамляют лицо, между ними видны щёки.
 */
const HAIR_FACE = { z0: -0.01, y0: -0.15, y1: 0.064, w: 0.056, wChin: 0.046 };

function makeStrands(seed: string): Strand[] {
  const r = makeRng(seed + ':hair');
  const out: Strand[] = [];
  const p = v3(), q = v3(), n = v3(), d = v3();
  const add = (th: number, ph: number, dir: V, len: number, w: number) => {
    headBase(th, ph, p);
    // нормаль черепа ~ по эллипсоиду
    vnorm(n, vset(n, p.x / (HEAD.ax * HEAD.ax), p.y / (p.y > 0 ? HEAD.ayT * HEAD.ayT : HEAD.ayB * HEAD.ayB), p.z / (HEAD.azB * HEAD.azB)));
    vma(q, p, n, 0.003);
    vperp(d, dir, n);
    out.push({ root: vcp(v3(), q), tan: vcp(v3(), d), len, w, ph: r.next() * TAU, c: 0.75 + 0.5 * r.next(), sx: q.x + d.x * 0.05 < 0 ? -1 : 1 });
  };
  // пробор (чуть правее середины): пряди вниз по обе стороны
  for (let i = 0; i < 14; i++) {
    const u = -0.8 + (1.75 * (i + 0.5)) / 14 + (r.next() - 0.5) * 0.06;
    const th = Math.abs(u), ph = u < 0 ? 0.13 / Math.max(0.2, th) : Math.PI - 0.13 / Math.max(0.2, th);
    const sd = i % 2 === 0 ? -1 : 1;
    add(Math.max(0.05, th), ph, vset(d, sd, -0.35, u < 0 ? 0.1 : -0.2), 0.5 + r.next() * 0.17, 0.025 + r.next() * 0.008);
  }
  // бока и затылок
  for (let i = 0; i < 22; i++) {
    const ph = (i < 11 ? -1 : 1) * (1.12 + ((i % 11) / 10) * 1.98) + (r.next() - 0.5) * 0.12;
    const th = 0.55 + r.next() * 0.75;
    add(th, ph, vset(d, 0, -1, 0), 0.52 + r.next() * 0.16, 0.026 + r.next() * 0.01);
  }
  // тонкие пряди от линии лба — в стороны, обрамляют лицо (лицо открыто: см. HAIR_FACE)
  for (const ph of [-0.7, -0.55, -0.4, -0.25, 0.27, 0.42, 0.57, 0.72]) {
    const sd = ph < 0 ? -1 : 1;
    add(0.7 + r.next() * 0.14, ph + (r.next() - 0.5) * 0.05, vset(d, sd, -0.75, 0.15), 0.4 + r.next() * 0.2, 0.012 + r.next() * 0.008);
  }
  // из-за ушей вперёд на плечи и грудь
  for (const ph of [-1.35, -1.2, 1.25, 1.4]) add(1.05 + r.next() * 0.1, ph, vset(d, 0, -1, 0.7), 0.55 + r.next() * 0.1, 0.022);
  return out;
}

// ───────────────────────── модель ─────────────────────────

export interface SmileModelOptions {
  /** слой мешей (по умолчанию PORTAL_LAYER — для PortalRenderer; без порталов — слой камеры) */
  layerMask?: number;
  /** сид облика (пряди, зубы) */
  seed?: string;
}

/** Девушка с улыбкой: см. шапку файла. */
export class SmileModel {
  readonly root: TransformNode;
  readonly meshes: Mesh[];
  private readonly scene: Scene;
  private readonly body: TransformNode;
  private readonly tex: SmileTex;
  private readonly mats: StandardMaterial[];
  private readonly matBlood: StandardMaterial;
  private readonly mSkin: Mesh;
  private readonly mGown: Mesh;
  private readonly mBlood: Mesh;
  private readonly mHair: Mesh;
  private readonly mWet: Mesh;
  private readonly bSkin = new Buf();
  private readonly bGown = new Buf();
  private readonly bBlood = new Buf();
  private readonly bHair = new Buf();
  private readonly bWet = new Buf();
  private readonly rig = new Rig();
  private readonly spec = mkSpec();
  private readonly strands: Strand[];
  private shown = true;
  private disposed = false;
  private lastPose: SmilePose | null = null;

  // сетки
  private gHeadU!: Grid;
  private gHeadL!: Grid;
  private gTorso!: Grid;
  private gArm: Grid[] = [];
  private gPalm: Grid[] = [];
  private gFing: Grid[] = [];
  private gLeg: Grid[] = [];
  private gFoot: Grid[] = [];
  private gGown!: Grid;
  private gSleeve: Grid[] = [];
  private gDecal!: Grid;
  private gHair: Grid[] = [];
  private gEye: Grid[] = [];
  private gTeeth: Grid[] = [];
  private gCav!: Grid;

  // голова: долготы столбцов, база вершин (от центра головы), статичные цвета и маски крови
  private readonly colPh = new Float32Array(NCH + 1);
  private readonly hbU = new Float32Array(NU * (NCH + 1) * 3);
  private readonly hbL = new Float32Array(NL * (NCH + 1) * 3);
  private readonly bloodMask: Float32Array;
  private readonly baseCol: Float32Array;
  /** зубы: долготы столбцов, точки на линии рта, длины, цвета */
  private readonly NT = 28;
  private readonly tPh: Float32Array;
  private readonly tB: Float32Array;
  private readonly tLen: Float32Array;
  /** торс: кольца (позиции, центры, радиальные нормали) */
  private readonly tor = new Float32Array(T_RINGS * (GC + 1) * 3);
  private readonly torC = new Float32Array(T_RINGS * 3);
  private readonly torN = new Float32Array(T_RINGS * (GC + 1) * 3);
  // взгляд: сглаженное направление головы (в кадре основания шеи), часы
  private readonly gz = v3(0, 0, 1);
  private lastT = NaN;
  private colTorn = -1;
  private colBloody = -1;
  private curTorn = 0;
  // скретч
  private readonly a = v3();
  private readonly b = v3();
  private readonly c = v3();
  private readonly d = v3();
  private readonly e = v3();
  private readonly f = v3();
  private readonly g = v3();
  private readonly h = v3();
  private readonly fr = frame();
  private readonly pts = [v3(), v3(), v3(), v3()];
  private readonly lookB = v3();
  private readonly inv = new Matrix();
  private readonly vtmp = new Vector3();

  constructor(scene: Scene, opts: SmileModelOptions = {}) {
    this.scene = scene;
    const seed = opts.seed ?? 'smile';
    this.root = new TransformNode('smile:root', scene);
    this.body = new TransformNode('smile:body', scene);
    this.body.parent = this.root;
    this.tex = acquireTex(scene);
    this.strands = makeStrands(seed);

    // ── раскладка сеток ──
    const s = this.bSkin;
    this.gHeadU = s.add(NU + 1, NCH, true);
    this.gHeadL = s.add(NL, NCH, true);
    this.gTorso = s.add(T_RINGS - T_SKIN0, GC, true);
    for (let i = 0; i < 2; i++) this.gArm.push(s.add(ARM_R.length, 8, true));
    for (let i = 0; i < 2; i++) this.gPalm.push(s.add(PALM_R.length, 10, true));
    for (let i = 0; i < 10; i++) this.gFing.push(s.add(5, 6, true));
    for (let i = 0; i < 2; i++) this.gLeg.push(s.add(LEG_R.length, 8, true));
    for (let i = 0; i < 2; i++) this.gFoot.push(s.add(FOOT_R.length, 10, true));
    s.alloc();
    this.gGown = this.bGown.add(GU + GS, GC, true);
    for (let i = 0; i < 2; i++) this.gSleeve.push(this.bGown.add(SLEEVE.length, SC, true));
    this.bGown.alloc();
    this.gDecal = this.bBlood.add(GU + 1, 11, false);
    this.bBlood.alloc();
    for (let i = 0; i < this.strands.length; i++) this.gHair.push(this.bHair.add(HN + 1, 2, false));
    this.bHair.alloc();
    for (let i = 0; i < 2; i++) this.gEye.push(this.bWet.add(7, 10, true));
    const TC = 2 * this.NT + 1;
    for (let i = 0; i < 2; i++) this.gTeeth.push(this.bWet.add(3, TC, false));
    this.gCav = this.bWet.add(7, 12, true, true);
    this.bWet.alloc();

    // ── голова: статичные таблицы ──
    const p = this.a;
    for (let c = 0; c <= NCH; c++) {
      const ph = c === NCH ? Math.PI : colPhi(c);
      this.colPh[c] = ph;
      const tm = thetaM(ph);
      for (let r = 0; r < NU; r++) {
        headBase(thetaU(r, tm), ph, p);
        const o = (r * (NCH + 1) + c) * 3;
        this.hbU[o] = p.x;
        this.hbU[o + 1] = p.y;
        this.hbU[o + 2] = p.z;
      }
      for (let j = 1; j < NL; j++) {
        headBase(thetaL(j, tm), ph, p);
        const o = (j * (NCH + 1) + c) * 3;
        this.hbL[o] = p.x;
        this.hbL[o + 1] = p.y;
        this.hbL[o + 2] = p.z;
      }
      // внутренняя нижняя губа — от края
      const o0 = c * 3, o1 = ((NCH + 1) + c) * 3;
      this.hbL[o0] = this.hbL[o1];
      this.hbL[o0 + 1] = this.hbL[o1 + 1];
      this.hbL[o0 + 2] = this.hbL[o1 + 2];
    }
    // c = 0 и c = NCH — один и тот же меридиан (−π ≡ π): шов
    this.colPh[0] = -Math.PI;
    // зубы
    const rt = makeRng(seed + ':teeth');
    this.tPh = new Float32Array(TC);
    this.tB = new Float32Array(TC * 3);
    this.tLen = new Float32Array(this.NT);
    for (let q = 0; q < TC; q++) {
      const ph = -MOUTH.phiEar + (2 * MOUTH.phiEar * q) / (TC - 1);
      this.tPh[q] = ph;
      headBase(thetaM(ph), ph, p);
      this.tB[q * 3] = p.x;
      this.tB[q * 3 + 1] = p.y;
      this.tB[q * 3 + 2] = p.z;
    }
    const missing = [rt.int(3, 7), this.NT - 1 - rt.int(2, 6)];
    for (let k = 0; k < this.NT; k++) {
      const ph = Math.abs(this.tPh[2 * k + 1]);
      let L = ph < 0.3 ? 0.0098 : ph < 0.5 ? 0.009 : ph < 0.9 ? 0.0078 : 0.0068;
      L *= 0.85 + 0.3 * rt.next();
      if (missing.includes(k)) L = 0.0012;
      this.tLen[k] = L;
    }
    this.bloodMask = new Float32Array(this.bSkin.verts + this.bWet.verts);
    this.baseCol = new Float32Array(this.bSkin.verts * 3);

    // ── материалы ──
    const mk = (name: string) => {
      const m = new StandardMaterial(name, scene);
      m.ambientColor = Color3.Black();
      m.maxSimultaneousLights = 6;
      return m;
    };
    const skin = mk('smile:skinMat');
    skin.diffuseTexture = this.tex.skin;
    skin.specularColor = new Color3(0.1, 0.1, 0.11);
    skin.specularPower = 28;
    skin.emissiveColor = new Color3(0.15, 0.155, 0.17);
    const gown = mk('smile:gownMat');
    gown.diffuseTexture = this.tex.cloth;
    gown.specularColor = new Color3(0.035, 0.035, 0.035);
    gown.emissiveColor = new Color3(0.15, 0.148, 0.14);
    gown.backFaceCulling = false;
    gown.twoSidedLighting = true;
    const blood = (this.matBlood = mk('smile:bloodMat'));
    blood.diffuseTexture = this.tex.blood;
    blood.transparencyMode = Material.MATERIAL_ALPHATEST;
    blood.useAlphaFromDiffuseTexture = true;
    blood.alphaCutOff = 0.99;
    blood.specularColor = new Color3(0.45, 0.25, 0.25);
    blood.specularPower = 48;
    blood.emissiveColor = new Color3(0.1, 0.02, 0.02);
    blood.zOffset = -2;
    const hair = mk('smile:hairMat');
    hair.diffuseColor = Color3.White();
    hair.specularColor = new Color3(0.5, 0.5, 0.55);
    hair.specularPower = 36;
    hair.emissiveColor = new Color3(0.012, 0.012, 0.014);
    hair.backFaceCulling = false;
    hair.twoSidedLighting = true;
    const wet = mk('smile:wetMat');
    wet.specularColor = new Color3(0.6, 0.6, 0.6);
    wet.specularPower = 90;
    wet.emissiveColor = new Color3(0.1, 0.1, 0.1);
    this.mats = [skin, gown, blood, hair, wet];

    // ── первая поза: топология, порядок обхода, цвета ──
    this.staticUv();
    this.update({ pose: 'stand', lean: 0, side: 1, torn: 0, t: 0, look: null });
    this.staticColors();
    const layer = opts.layerMask ?? PORTAL_LAYER;
    const mkMesh = (name: string, b: Buf, mat: StandardMaterial, colors: boolean) => {
      const m = new Mesh(name, scene);
      const vd = new VertexData();
      vd.positions = b.pos;
      vd.normals = b.nor;
      vd.uvs = b.uv;
      if (colors) vd.colors = b.col;
      vd.indices = b.indices();
      vd.applyToMesh(m, true);
      m.material = mat;
      m.parent = this.body;
      m.isPickable = false;
      m.checkCollisions = false;
      m.alwaysSelectAsActiveMesh = true;
      m.layerMask = layer;
      return m;
    };
    this.mSkin = mkMesh('smile:skin', this.bSkin, skin, true);
    this.mGown = mkMesh('smile:gown', this.bGown, gown, true);
    this.mBlood = mkMesh('smile:blood', this.bBlood, blood, false);
    this.mHair = mkMesh('smile:hair', this.bHair, hair, true);
    this.mWet = mkMesh('smile:wet', this.bWet, wet, true);
    this.meshes = [this.mSkin, this.mGown, this.mBlood, this.mHair, this.mWet];
    this.colTorn = -1;
    this.sync();
  }

  /** Поза кадра (после установки root). */
  setPose(p: SmilePose) {
    if (this.disposed) return;
    this.lastPose = p;
    if (!this.shown) return;
    this.update(p);
    this.upload();
  }

  setVisible(on: boolean) {
    if (this.shown === on) return;
    this.shown = on;
    this.root.setEnabled(on);
    if (on && this.lastPose) {
      this.lastT = NaN;
      this.update(this.lastPose);
      this.upload();
    }
  }

  get visible(): boolean {
    return this.shown;
  }

  /** torn последнего кадра (с поправкой поз 'pounce'/'eat') */
  get torn(): number {
    return this.curTorn;
  }

  /** Матрицы мира root и мешей (порталу — после сдвига root без setPose). */
  sync() {
    this.root.computeWorldMatrix(true);
    this.body.computeWorldMatrix(true);
    for (const m of this.meshes) m.computeWorldMatrix(true);
  }

  /** Мировые точки (после setPose): центр головы, рот, шея. */
  headPos(out = new Vector3()): Vector3 {
    return this.toWorld(this.rig.hc, out);
  }

  mouthPos(out = new Vector3()): Vector3 {
    fpt(this.rig.bones[5], HC.x, HC.y + MOUTH.y0, HC.z + 0.07, this.a);
    return this.toWorld(this.a, out);
  }

  neckPos(out = new Vector3()): Vector3 {
    fpt(this.rig.bones[4], 0, 0.07, 0.01, this.a);
    return this.toWorld(this.a, out);
  }

  /** То же в координатах модели (без root, side = 1) — для QA. */
  headLocal(): { x: number; y: number; z: number } {
    return { ...this.rig.hc };
  }

  private toWorld(p: V, out: Vector3): Vector3 {
    this.body.computeWorldMatrix(true);
    this.vtmp.set(p.x, p.y, p.z);
    return Vector3.TransformCoordinatesToRef(this.vtmp, this.body.getWorldMatrix(), out);
  }

  /**
   * Расстановка 'peek' по проёму: edge — точка ребра ближнего к зрителю косяка на полу (стык коридорной грани стены и
   * торца проёма), into — единичная горизонталь из стены в коридор, viewer — где зритель. Возвращает положение root,
   * поворот по Y и side (наклон — в коридор). Двери: edge = середина проёма ± вдоль стены на widthM/2 — тот край, что
   * ближе к зрителю (placePeekDoor).
   */
  static placePeek(edge: Vector3, into: Vector3, viewer: Vector3): { position: Vector3; yaw: number; side: -1 | 1 } {
    const P = SMILE_MODEL.peek;
    // вдоль стены — к зрителю
    let ax = into.z, az = -into.x;
    if ((viewer.x - edge.x) * ax + (viewer.z - edge.z) * az < 0) {
      ax = -ax;
      az = -az;
    }
    const yaw = Math.atan2(ax, az);
    // правая ось модели (левая система Babylon): (cos yaw, 0, −sin yaw) = (az, 0, −ax)
    const rx = az, rz = -ax;
    const side: -1 | 1 = rx * into.x + rz * into.z >= 0 ? 1 : -1;
    const position = new Vector3(edge.x - rx * side * P.jambX - ax * P.jambZ, edge.y, edge.z - rz * side * P.jambX - az * P.jambZ);
    return { position, yaw, side };
  }

  /** placePeek по двери: середина проёма (на коридорной грани, на полу), нормаль в коридор, ширина проёма, зритель. */
  static placePeekDoor(center: Vector3, into: Vector3, widthM: number, viewer: Vector3): { position: Vector3; yaw: number; side: -1 | 1 } {
    let ax = into.z, az = -into.x;
    if ((viewer.x - center.x) * ax + (viewer.z - center.z) * az < 0) {
      ax = -ax;
      az = -az;
    }
    const edge = new Vector3(center.x + ax * widthM * 0.5, center.y, center.z + az * widthM * 0.5);
    return SmileModel.placePeek(edge, into, viewer);
  }

  /** Расстановка 'window': точка стекла (на высоте лица), нормаль стекла к зрителю, пол её стороны. */
  static placeWindow(glass: Vector3, toViewer: Vector3, floorY: number): { position: Vector3; yaw: number } {
    const W = SMILE_MODEL.window;
    const l = Math.hypot(toViewer.x, toViewer.z) || 1;
    const nx = toViewer.x / l, nz = toViewer.z / l;
    return { position: new Vector3(glass.x - nx * W.glassZ, floorY, glass.z - nz * W.glassZ), yaw: Math.atan2(nx, nz) };
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const m of this.meshes) m.dispose(false, false);
    for (const m of this.mats) m.dispose(false, false);
    this.body.dispose();
    this.root.dispose();
    releaseTex(this.scene);
  }

  // ───────────────────────── кадр ─────────────────────────

  private update(p: SmilePose) {
    const s = this.spec;
    const t = p.t;
    switch (p.pose) {
      case 'peek':
        posePeek(s, clamp(p.lean, 0, 1), t);
        break;
      case 'window':
        poseWindow(s, t);
        break;
      case 'pounce':
        posePounce(s, clamp(p.pounce ?? 0, 0, 1), t);
        break;
      case 'eat':
        poseEat(s, t);
        break;
      default:
        poseStand(s, t);
    }
    const side = p.side < 0 ? -1 : 1;
    if (this.body.scaling.x !== side) this.body.scaling.x = side;
    let dt = t - this.lastT;
    const snap = !(dt >= 0 && dt < 0.5);
    dt = snap ? 0 : Math.min(dt, 0.1);
    this.lastT = t;
    // взгляд — в координаты тела
    let look: V | null = null;
    if (p.look) {
      this.body.computeWorldMatrix(true);
      this.body.getWorldMatrix().invertToRef(this.inv);
      Vector3.TransformCoordinatesToRef(p.look, this.inv, this.vtmp);
      look = vset(this.lookB, this.vtmp.x, this.vtmp.y, this.vtmp.z);
    }
    const torn = clamp(Math.max(p.torn, s.torn), 0, 1);
    this.curTorn = torn;
    this.evalRig(s, look, dt, snap);
    const tz = Math.min(1, torn);
    this.writeHead(tz, s.jaw + lerp(0.035, 0.55, tz * tz));
    this.writeTorso();
    for (let i = 0; i < 2; i++) {
      this.writeArm(i);
      this.writePalm(i);
      for (let f = 0; f < 5; f++) this.writeFinger(i, f);
      this.writeLeg(i);
      this.writeFoot(i);
    }
    for (const g of this.bSkin.grids) gridNormals(this.bSkin, g);
    this.writeGown(t, s);
    this.writeHair(t, s);
    this.writeWet(tz, s.jaw + lerp(0.035, 0.55, tz * tz));
    // кровь на рубашке: альфа-срез по torn
    this.matBlood.alphaCutOff = lerp(0.985, 0.2, sstep(0.0, 1.0, torn));
    if (Math.abs(torn - this.colTorn) > 0.01 || Math.abs(s.bloody - this.colBloody) > 0.02) this.bloodColors(torn, s.bloody);
  }

  private upload() {
    const up = (m: Mesh, b: Buf, colors: boolean) => {
      m.updateVerticesData(VertexBuffer.PositionKind, b.pos, false, false);
      m.updateVerticesData(VertexBuffer.NormalKind, b.nor, false, false);
      if (colors) m.updateVerticesData(VertexBuffer.ColorKind, b.col, false, false);
    };
    const colors = this.colDirty;
    up(this.mSkin, this.bSkin, colors);
    up(this.mGown, this.bGown, colors);
    up(this.mBlood, this.bBlood, false);
    up(this.mHair, this.bHair, false);
    up(this.mWet, this.bWet, colors);
    this.colDirty = false;
    this.mBlood.setEnabled(this.curTorn > 0.02);
    this.sync();
  }
  private colDirty = false;

  // ───────────────────────── скелет ─────────────────────────

  private spine(s: Spec) {
    const [hips, sp, ch, nb, nk, hd] = this.rig.bones;
    fchild(hips, ID, s.hp.x, s.hp.y, s.hp.z, s.hr.x, s.hr.y, s.hr.z);
    fchild(sp, hips, 0, B.spine, 0, s.sr.x, s.sr.y, s.sr.z);
    fchild(ch, sp, 0, B.chest, 0, s.cr.x, s.cr.y, s.cr.z);
    fchild(nb, ch, 0, B.nb, -0.01, s.nr.x, s.nr.y, s.nr.z);
    fchild(nk, nb, 0, 0.005, 0, s.kr.x, s.kr.y, s.kr.z);
    fchild(hd, nk, 0, B.neck, 0.012, s.dr.x, s.dr.y, s.dr.z);
  }

  private evalRig(s: Spec, look: V | null, dt: number, snap: boolean) {
    const R = this.rig;
    const [hips, , ch, nb, nk, hd] = R.bones;
    const a = this.a, b = this.b, c = this.c;
    this.spine(s);
    // привязка лица: нос к стеклу / рот к точке — сдвигом таза
    if (s.fixMode && s.fixK > 0) {
      if (s.fixMode === 1) {
        fpt(hd, HC.x, HC.y - 0.036, HC.z + 0.112, a);
        s.hp.z += (s.fix.z - 0.003 - a.z) * s.fixK;
      } else {
        fpt(hd, HC.x, HC.y + MOUTH.y0, HC.z + 0.075, a);
        vma(s.hp, s.hp, vsub(b, s.fix, a), s.fixK);
      }
      this.spine(s);
    }
    // голова к look: часть поворота — шее, остальное — голове; курс ±80°, высота −45…+35°
    fpt(hd, HC.x, HC.y, HC.z, R.hc);
    if (look && s.look > 0) {
      vsub(a, look, R.hc);
      const lx = vdot(a, nb.x), ly = vdot(a, nb.y), lz = vdot(a, nb.z);
      const yaw = clamp(Math.atan2(lx, lz), -1.396, 1.396);
      const pitch = clamp(Math.atan2(ly, Math.hypot(lx, lz)), -0.78, s.lookUp);
      vset(b, Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
      if (snap) vcp(this.gz, b);
      else vnorm(this.gz, vlerp(this.gz, this.gz, b, 1 - Math.exp(-dt * 5.5)));
      fdir(nb, this.gz.x, this.gz.y, this.gz.z, c);
      for (const [fr, share] of [[nk, 0.35], [hd, 1]] as const) {
        const ang = Math.acos(clamp(vdot(hd.z, c), -1, 1)) * s.look * share;
        if (ang > 1e-4) {
          vcross(b, hd.z, c);
          if (vlen(b) > 1e-6) {
            vnorm(b, b);
            frot(fr, b, ang, fr.o, a);
            if (fr === nk) fchild(hd, nk, 0, B.neck, 0.012, s.dr.x, s.dr.y, s.dr.z);
          }
        }
      }
      fpt(hd, HC.x, HC.y, HC.z, R.hc);
    } else if (snap) vset(this.gz, 0, 0, 1);
    // глаза: к look (не дальше 0.55 рад от лица), левый косит наружу
    for (let i = 0; i < 2; i++) {
      const E = EYES[i];
      fpt(hd, HC.x + E.x, HC.y + E.y, HC.z + E.z, R.eye[i]);
      const gz = R.gaze[i];
      vcp(gz, hd.z);
      if (look && s.gaze > 0) {
        vnorm(a, vsub(a, look, R.eye[i]));
        const ang = Math.acos(clamp(vdot(a, hd.z), -1, 1));
        if (ang > 0.55) {
          vcross(b, hd.z, a);
          if (vlen(b) > 1e-6) vrot(a, hd.z, vnorm(b, b), 0.55);
        }
        vnorm(gz, vlerp(gz, hd.z, a, s.gaze));
      }
      if (E.out) vrot(gz, gz, hd.y, -E.out);
    }
    // руки
    for (let i = 0; i < 2; i++) {
      const sg = i ? 1 : -1, H = s.hand[i];
      fpt(nb, sg * (B.shX + s.sh[i].x), B.shY + s.sh[i].y, B.shZ + s.sh[i].z, R.sh[i]);
      // запястье = костяшки − пальцы·ладонь
      vma(R.wr[i], H.k, H.fd, -B.palm);
      ik2(R.el[i], R.sh[i], R.wr[i], B.upper, B.fore, H.pole, a, b);
      faim(R.hand[i], R.wr[i], H.fd, H.dn);
      this.fingers(i, H);
    }
    // ноги
    for (let i = 0; i < 2; i++) {
      const sg = i ? 1 : -1, F = s.foot[i];
      fpt(hips, sg * B.hipX, -B.hipDrop, 0, R.hip[i]);
      vcp(R.an[i], F.a);
      ik2(R.kn[i], R.hip[i], R.an[i], B.thigh, B.shin, F.pole, a, b);
      faim(R.foot[i], R.an[i], F.up, F.fwd);
      vsub(a, R.hip[i], R.kn[i]);
      faim(R.thigh[i], R.hip[i], a, hips.z);
    }
    void ch;
  }

  private fingers(i: number, H: HandSpec) {
    const R = this.rig, hf = R.hand[i], ts = i ? 1 : -1;
    const d0 = this.d, bt = this.e, a = this.a;
    for (let f = 0; f < 5; f++) {
      const F = FINGERS[f], J = R.fj[i][f], D = R.fd[i][f], Z = R.fz[i][f];
      fpt(hf, ts * F.b[0], F.b[1], F.b[2], J[0]);
      let th = 0;
      if (f < 4) {
        const sa = H.spread * F.sp;
        vnorm(d0, vset(d0, hf.y.x * Math.cos(sa) + hf.x.x * ts * Math.sin(sa), hf.y.y * Math.cos(sa) + hf.x.y * ts * Math.sin(sa), hf.y.z * Math.cos(sa) + hf.x.z * ts * Math.sin(sa)));
        vcp(bt, hf.z);
        vsc(bt, bt, -1);
      } else {
        vnorm(d0, vset(d0, hf.x.x * ts * 0.72 + hf.y.x * 0.62 - hf.z.x * 0.3, hf.x.y * ts * 0.72 + hf.y.y * 0.62 - hf.z.y * 0.3, hf.x.z * ts * 0.72 + hf.y.z * 0.62 - hf.z.z * 0.3));
        vset(a, -hf.z.x * 0.75 - hf.x.x * ts * 0.45 + hf.y.x * 0.1, -hf.z.y * 0.75 - hf.x.y * ts * 0.45 + hf.y.y * 0.1, -hf.z.z * 0.75 - hf.x.z * ts * 0.45 + hf.y.z * 0.1);
        vperp(bt, a, d0);
      }
      for (let k = 0; k < 3; k++) {
        th += H.j[f * 3 + k];
        const co = Math.cos(th), si = Math.sin(th);
        vset(D[k], d0.x * co + bt.x * si, d0.y * co + bt.y * si, d0.z * co + bt.z * si);
        vset(Z[k], d0.x * si - bt.x * co, d0.y * si - bt.y * co, d0.z * si - bt.z * co);
        vma(J[k + 1], J[k], D[k], F.l[k]);
      }
    }
  }

  // ───────────────────────── кожа ─────────────────────────

  /** Кольцо трубы: центр c, ось tg (единичная), опора ref (поперёк), полуоси ru (по ref), rv; bump(ca, sa) — к радиусу. */
  private ring(buf: Buf, at: number, cols: number, c: V, tg: V, ref: V, ru: number, rv: number, bump: ((ca: number, sa: number) => number) | null) {
    const u = vperp(this.f, ref, tg), w = vcross(this.g, tg, u);
    const P = buf.pos;
    for (let j = 0; j <= cols; j++) {
      const ang = (TAU * (j % cols)) / cols, ca = Math.cos(ang), sa = Math.sin(ang);
      const bb = bump ? bump(ca, sa) : 0;
      const x = ca * (ru + bb), y = sa * (rv + bb);
      const o = (at + j) * 3;
      P[o] = c.x + u.x * x + w.x * y;
      P[o + 1] = c.y + u.y * x + w.y * y;
      P[o + 2] = c.z + u.z * x + w.z * y;
    }
  }

  private writeHead(torn: number, jaw: number) {
    const S = this.bSkin, H = this.rig.bones[5], gu = this.gHeadU, gl = this.gHeadL;
    const cutPh = lerp(MOUTH.phiC, MOUTH.phiEar, smooth(torn)), taper = lerp(0.3, 0.14, torn);
    const q = this.b, e = this.c, inw = this.d;
    const C = NCH + 1;
    const put = (g: Grid, r: number, c: number, x: number, y: number, z: number) => {
      fpt(H, HC.x + x, HC.y + y, HC.z + z, q);
      S.put(gi(g, r, c), q);
    };
    for (let c = 0; c < C; c++) {
      const ph = this.colPh[c], aph = Math.abs(ph);
      const wc = 1 - sstep(cutPh - taper, cutPh, aph);
      const wsm = smileW(ph), tz = tornZone(ph) * wc;
      // губы: разошлись в улыбке, при разрыве края рваные
      const jit = (hash1(c * 1.7 + 3.1) - 0.5) * tz;
      for (let r = 0; r < NU; r++) {
        const o = (r * C + c) * 3;
        let x = this.hbU[o], y = this.hbU[o + 1], z = this.hbU[o + 2];
        if (r === NU - 1) {
          vnorm(inw, vset(inw, -x, 0, -z));
          y += 0.003 * wsm + 0.004 * torn * wc + 0.004 * jit;
          x += inw.x * 0.0015 * wc;
          z += inw.z * 0.0015 * wc;
          vset(e, x, y, z);
        }
        put(gu, r, c, x, y, z);
      }
      // внутренняя сторона верхней губы
      put(gu, NU, c, e.x + inw.x * 0.008 * wc, e.y + (0.0035 + 0.004 * jit) * wc, e.z + inw.z * 0.008 * wc);
      // нижняя часть — с челюстью
      for (let j = 0; j < NL; j++) {
        const o = ((j === 0 ? 1 : j) * C + c) * 3;
        let x = this.hbL[o], y = this.hbL[o + 1], z = this.hbL[o + 2];
        if (j <= 1) {
          vnorm(inw, vset(inw, -x, 0, -z));
          y -= 0.0028 * wsm + 0.003 * torn * wc - 0.004 * jit;
          x += inw.x * 0.0015 * wc;
          z += inw.z * 0.0015 * wc;
          if (j === 0) {
            x += inw.x * 0.008 * wc;
            z += inw.z * 0.008 * wc;
            y -= (0.0035 - 0.004 * jit) * wc;
          }
        }
        const rw = j <= 6 ? 1 : lerp(1, 0.35, (j - 6) / 3);
        if (wc * rw > 1e-4) {
          jawXf(y, z, jaw, wc * rw, q);
          y = q.y;
          z = q.z;
        }
        put(gl, j, c, x, y, z);
      }
    }
    for (let r = 0; r <= NU; r++) S.center(gu, r, this.rig.hc);
    for (let j = 0; j < NL; j++) S.center(gl, j, this.rig.hc);
  }

  /** Кольца торса T0…T8 (для рубашки — все), кожей — от T_SKIN0. */
  private writeTorso() {
    const R = this.rig, S = this.bSkin, g = this.gTorso;
    const p = this.a, n = this.b, cc = this.c;
    for (let k = 0; k < T_RINGS; k++) {
      const [bi, oy, oz, rx, rz] = TORSO[k];
      const F = R.bones[bi];
      fpt(F, 0, oy, oz, cc);
      this.torC[k * 3] = cc.x;
      this.torC[k * 3 + 1] = cc.y;
      this.torC[k * 3 + 2] = cc.z;
      for (let c = 0; c <= GC; c++) {
        const ang = -Math.PI + (TAU * (c % GC)) / GC;
        const sa = Math.sin(ang), ca = Math.cos(ang);
        let x = rx * sgnPow(sa, k === 4 ? 0.7 : 0.85), z = rz * sgnPow(ca, 0.85), y = oy;
        let dr = 0;
        if (k === 4 || k === 5) {
          // ключицы, яремная ямка
          if (ca > 0) dr += 0.0065 * Math.exp(-(((Math.abs(sa) - 0.5) / 0.22) ** 2)) * Math.sqrt(ca) * (k === 4 ? 1 : 0.5);
          dr -= 0.006 * Math.exp(-((ang / 0.22) ** 2));
        }
        if (k === 3 && ca < 0) dr += 0.006 * Math.exp(-(((Math.abs(sa) - 0.55) / 0.2) ** 2));
        if (k === 6 || k === 7) dr += 0.0035 * Math.exp(-(((Math.abs(ang) - 0.65) / 0.25) ** 2));
        if (k === 4) y += 0.012 * Math.cos(ang * 2) * 0.5 - 0.006;
        const l = Math.hypot(x, z) || 1;
        x += (x / l) * dr;
        z += (z / l) * dr;
        fpt(F, x, y, z + oz, p);
        const o = (k * (GC + 1) + c) * 3;
        this.tor[o] = p.x;
        this.tor[o + 1] = p.y;
        this.tor[o + 2] = p.z;
        // радиальная нормаль кольца (для припуска рубашки)
        fdir(F, sa / rx, 0, ca / rz, n);
        vnorm(n, n);
        this.torN[o] = n.x;
        this.torN[o + 1] = n.y;
        this.torN[o + 2] = n.z;
        if (k >= T_SKIN0) S.put(gi(g, k - T_SKIN0, c), p);
      }
      if (k >= T_SKIN0) S.center(g, k - T_SKIN0, cc);
    }
  }

  /** Труба по 4 точкам (3 отрезка Катмулла–Рома) с кольцами spec [отрезок, доля, радиус, выступ по ref, выступ против]. */
  private tube(g: Grid, P: V[], spec: readonly (readonly number[])[], ref: (k: number, out: V) => V, flat: (k: number) => number) {
    const S = this.bSkin, c = this.c, tg = this.d, r = this.e;
    for (let k = 0; k < spec.length; k++) {
      const [sgi, fr, rad, bf, bb] = spec[k];
      const i = sgi;
      const p0 = i === 0 ? this.ghost(P[0], P[1], 0) : P[i - 1];
      const p1 = P[i], p2 = P[i + 1];
      const p3 = i + 2 < P.length ? P[i + 2] : this.ghost(P[P.length - 1], P[P.length - 2], 1);
      crPoint(c, p0, p1, p2, p3, fr);
      crTan(tg, p0, p1, p2, p3, fr);
      ref(k, r);
      const fl = flat(k);
      S.center(g, k, c);
      this.ring(S, gi(g, k, 0), g.cols, c, tg, r, rad * (1 + fl), rad * (1 - fl * 0.6), bf || bb ? (ca) => (ca > 0 ? bf * ca ** 6 : bb * (-ca) ** 3) : null);
    }
  }
  private readonly gh = [v3(), v3()];
  private ghost(a: V, b: V, k: number): V {
    return vset(this.gh[k], 2 * a.x - b.x, 2 * a.y - b.y, 2 * a.z - b.z);
  }

  private readonly tp = [v3(), v3(), v3(), v3()];
  private writeArm(i: number) {
    const R = this.rig, P = this.tp;
    const hf = R.hand[i];
    vsub(this.a, R.el[i], R.sh[i]);
    vnorm(this.a, this.a);
    vma(P[0], R.sh[i], this.a, -0.012);
    vcp(P[1], R.el[i]);
    vcp(P[2], R.wr[i]);
    vma(P[3], R.wr[i], hf.y, 0.02);
    // опора: у плеча и локтя — направление сгиба (локоть назад), к запястью — поперёк ладони
    const pole = this.spec.hand[i].pole;
    this.tube(this.gArm[i], P, ARM_R, (k, out) => {
      const w = sstep(6, 11, k);
      return vnorm(out, vlerp(out, pole, hf.x, w));
    }, (k) => 0.28 * sstep(8, 11, k));
  }

  private writeLeg(i: number) {
    const R = this.rig, P = this.tp;
    const hips = R.bones[0];
    fdir(hips, 0, 1, 0, this.a);
    vma(P[0], R.hip[i], this.a, 0.04);
    vcp(P[1], R.kn[i]);
    vcp(P[2], R.an[i]);
    vma(P[3], R.an[i], R.foot[i].y, -0.03);
    const pole = this.spec.foot[i].pole;
    this.tube(this.gLeg[i], P, LEG_R, (k, out) => vcp(out, pole), () => 0);
  }

  private writePalm(i: number) {
    const S = this.bSkin, g = this.gPalm[i], hf = this.rig.hand[i], ts = i ? 1 : -1;
    const c = this.c, P = S.pos;
    for (let k = 0; k < PALM_R.length; k++) {
      const [y, hw, ht, zo] = PALM_R[k];
      fpt(hf, 0, y, zo, c);
      S.center(g, k, c);
      for (let j = 0; j <= g.cols; j++) {
        const ang = (TAU * (j % g.cols)) / g.cols, ca = Math.cos(ang), sa = Math.sin(ang);
        let x = hw * sgnPow(ca, 0.7), z = ht * sgnPow(sa, 0.85);
        // подушка большого пальца, костяшки
        if ((k === 1 || k === 2) && sa < 0 && ts * ca > 0.1) z -= 0.006 * ts * ca * -sa;
        if (k === 3 && sa > 0.4) z += 0.0018;
        const o = (gi(g, k, j)) * 3;
        P[o] = c.x + hf.x.x * x + hf.z.x * z;
        P[o + 1] = c.y + hf.x.y * x + hf.z.y * z;
        P[o + 2] = c.z + hf.x.z * x + hf.z.z * z;
      }
    }
  }

  private writeFinger(i: number, f: number) {
    const S = this.bSkin, g = this.gFing[i * 5 + f], F = FINGERS[f];
    const J = this.rig.fj[i][f], D = this.rig.fd[i][f], Z = this.rig.fz[i][f];
    const c = this.c, tg = this.d, rf = this.e;
    for (let k = 0; k < 5; k++) {
      let rad: number;
      if (k === 0) {
        vma(c, J[0], D[0], -0.007);
        vcp(tg, D[0]);
        vcp(rf, Z[0]);
        rad = F.r0;
      } else if (k < 3) {
        vcp(c, J[k]);
        vnorm(tg, vadd(tg, D[k - 1], D[k]));
        vnorm(rf, vadd(rf, Z[k - 1], Z[k]));
        rad = k === 1 ? F.r0 * 1.07 : F.r1 * 1.06;
      } else if (k === 3) {
        vma(c, J[3], D[2], -0.0055);
        vcp(tg, D[2]);
        vcp(rf, Z[2]);
        rad = F.r1 * 0.95;
      } else {
        vma(c, J[3], D[2], 0.0018);
        vcp(tg, D[2]);
        vcp(rf, Z[2]);
        rad = F.r1 * 0.3;
      }
      S.center(g, k, k === 4 ? J[3] : c);
      // опора — «тыл» пальца: ru по тылу (rv поперёк)
      this.ring(S, gi(g, k, 0), g.cols, c, tg, rf, rad * 0.92, rad * 1.08, null);
    }
  }

  private writeFoot(i: number) {
    const S = this.bSkin, g = this.gFoot[i], F = this.rig.foot[i], inner = i ? -1 : 1;
    const c = this.c, P = S.pos;
    for (let k = 0; k < FOOT_R.length; k++) {
      const [z, cy, hw, hh] = FOOT_R[k];
      fpt(F, 0, cy, z, c);
      S.center(g, k, c);
      for (let j = 0; j <= g.cols; j++) {
        const ang = (TAU * (j % g.cols)) / g.cols, ca = Math.cos(ang), sa = Math.sin(ang);
        const x = hw * ca;
        let y = sa > 0 ? hh * sa : -hh * Math.pow(-sa, 0.45);
        // свод стопы с внутренней стороны
        if (k >= 2 && k <= 4 && sa < 0 && ca * inner > 0.2) y += 0.009 * ca * inner;
        // пальцы — гребешком
        if (k >= 6 && sa > 0) y *= 0.8 + 0.3 * Math.abs(Math.cos(ca * 7.5));
        const o = gi(g, k, j) * 3;
        P[o] = c.x + F.x.x * x + F.y.x * y;
        P[o + 1] = c.y + F.x.y * x + F.y.y * y;
        P[o + 2] = c.z + F.x.z * x + F.y.z * y;
      }
    }
  }

  // ───────────────────────── рубашка ─────────────────────────

  private writeGown(t: number, s: Spec) {
    const G = this.bGown, g = this.gGown, R = this.rig, hips = R.bones[0];
    const p = this.a, n = this.b, q = this.c, w = this.d, tmp = this.e;
    const tor = this.tor, torN = this.torN;
    const at = (k: number, c: number, o: V) => {
      const i = (k * (GC + 1) + c) * 3;
      return vset(o, tor[i], tor[i + 1], tor[i + 2]);
    };
    const atN = (k: number, c: number, o: V) => {
      const i = (k * (GC + 1) + c) * 3;
      return vset(o, torN[i], torN[i + 1], torN[i + 2]);
    };
    // верх: от выреза до бёдер — по кольцам торса с припуском
    for (let c = 0; c <= GC; c++) {
      const ang = -Math.PI + (TAU * (c % GC)) / GC, ca = Math.cos(ang), sa = Math.sin(ang);
      const neckH = ca >= 0 ? 4.35 - 1.8 * Math.pow(ca, 1.5) : 4.35 - 0.5 * Math.pow(-ca, 1.5);
      for (let k = 0; k < GU; k++) {
        const hh = neckH * (1 - k / (GU - 1));
        const i0 = Math.min(T_RINGS - 2, Math.floor(hh)), fr = hh - i0;
        vlerp(p, at(i0, c, p), at(i0 + 1, c, q), fr);
        vnorm(n, vlerp(n, atN(i0, c, n), atN(i0 + 1, c, w), fr));
        const ease = 0.0045 + 0.004 * sstep(4.0, 2.5, hh) + 0.024 * Math.exp(-(((hh - 1.0) / 0.75) ** 2)) + 0.008 * sstep(0.7, 0, hh);
        const wr = 0.0015 * Math.sin(9 * ang + hh * 3) + (k === 0 ? 0.0015 * Math.sin(14 * ang) : 0);
        vma(p, p, n, ease + wr);
        G.put(gi(g, k, c), p);
      }
    }
    // юбка: по тазу и бёдрам (смешение), подол под тяжестью
    const ease0 = 0.0045 + 0.004 + 0.024 * Math.exp(-((1 / 0.75) ** 2)) + 0.008;
    const rx0 = TORSO[0][3] + ease0, rz0 = TORSO[0][4] + ease0;
    for (let c = 0; c <= GC; c++) {
      const ang = -Math.PI + (TAU * (c % GC)) / GC, ca = Math.cos(ang), sa = Math.sin(ang);
      const hem = 1 + 0.07 * (hash1((c % GC) * 2.3 + 0.7) - 0.5) + 0.05 * Math.max(0, hash1((c % GC) * 5.1) - 0.8) * 5;
      const sR = clamp(0.5 + 0.8 * sa, 0, 1);
      for (let m = 1; m <= GS; m++) {
        const tt = (m / GS) * (m === GS ? hem : 1);
        const rx = rx0 + 0.07 * tt, rz = rz0 + 0.05 * tt;
        const lx = rx * sgnPow(sa, 0.85), ly = -SKIRT_L * tt, lz = rz * sgnPow(ca, 0.85) - 0.012 * tt;
        const wt = 0.9 * sstep(0, 0.85, tt) * (0.55 + 0.45 * Math.max(0, ca));
        const wR = wt * sR, wL = wt * (1 - sR), wH = 1 - wt;
        fpt(hips, lx, ly, lz, p);
        vsc(p, p, wH);
        // ляжки: точка покоя относительно сустава бедра в покое
        const by = B.hipY + ly, ty = B.hipY - B.hipDrop;
        fpt(R.thigh[0], lx + B.hipX, by - ty, lz, q);
        vma(p, p, q, wL);
        fpt(R.thigh[1], lx - B.hipX, by - ty, lz, q);
        vma(p, p, q, wR);
        G.put(gi(g, GU - 1 + m, c), p);
      }
    }
    // драпировка: нижние сегменты к тяжести (и ветру), пол; складки и качание
    const grav = vnorm(tmp, vma(tmp, vset(tmp, 0, -1, 0), s.wind, 0.25));
    for (let c = 0; c <= GC; c++) {
      const ang = -Math.PI + (TAU * (c % GC)) / GC, ca = Math.cos(ang), sa = Math.sin(ang);
      fdir(hips, sa, 0, ca, n);
      n.y = 0;
      vnorm(n, n);
      let prev = gi(g, GU - 1, c);
      for (let m = 1; m <= GS; m++) {
        const tt = m / GS, idx = gi(g, GU - 1 + m, c), P = G.pos;
        const gk = 0.55 * sstep(0.25, 1, tt);
        vset(p, P[prev * 3], P[prev * 3 + 1], P[prev * 3 + 2]);
        vset(q, P[idx * 3] - p.x, P[idx * 3 + 1] - p.y, P[idx * 3 + 2] - p.z);
        const L = vlen(q);
        if (gk > 0 && L > 1e-6) {
          vsc(q, q, 1 / L);
          vnorm(q, vlerp(q, q, grav, gk));
          vma(q, p, q, L);
        } else vadd(q, p, q);
        const fold = (0.002 + 0.011 * tt) * (0.55 * Math.sin(6 * ang + 0.7 + 0.4 * tt) + 0.3 * Math.sin(11 * ang + 2.1) + 0.15 * Math.sin(17 * ang + 4 - tt));
        vma(q, q, n, fold);
        // подол чуть отстаёт от тела (мягкое качание)
        fdir(hips, 1, 0, 0, w);
        vma(q, q, w, 0.008 * tt * tt * Math.sin(TAU * 0.19 * t - 0.8));
        if (q.y < 0.012) q.y = 0.012;
        G.put(idx, q);
        prev = idx;
      }
    }
    for (let r = 0; r < g.rows; r++) G.centerAvg(g, r);
    G.seam(g);
    gridNormals(G, g);
    // рукава
    for (let i = 0; i < 2; i++) {
      const sg = this.gSleeve[i], sh = R.sh[i], nb = R.bones[3];
      vnorm(w, vsub(w, R.el[i], sh));
      vperp(n, nb.z, w);
      for (let k = 0; k < SLEEVE.length; k++) {
        const [d, r0] = SLEEVE[k];
        vma(p, sh, w, d);
        if (k === 0) vma(p, p, nb.y, 0.006);
        G.center(sg, k, p);
        const rr = k === SLEEVE.length - 1 ? (ca: number, sa: number) => 0.003 * Math.sin(6 * Math.atan2(sa, ca)) : null;
        this.ring(G, gi(sg, k, 0), sg.cols, p, w, n, r0, r0, rr);
      }
      gridNormals(G, sg);
    }
    // кровь поверх рубашки: перед, от выреза до бёдер
    const D = this.bBlood, dg = this.gDecal;
    for (let r = 0; r < dg.rows; r++) {
      for (let k = 0; k < dg.cols; k++) {
        const src = gi(g, r, 7 + k), dst = gi(dg, r, k);
        for (let a = 0; a < 3; a++) {
          D.nor[dst * 3 + a] = G.nor[src * 3 + a];
          D.pos[dst * 3 + a] = G.pos[src * 3 + a] + G.nor[src * 3 + a] * 0.0025;
        }
      }
    }
  }

  // ───────────────────────── волосы ─────────────────────────

  private writeHair(t: number, s: Spec) {
    const Hb = this.bHair, R = this.rig, hd = R.bones[5], nb = R.bones[3], nk = R.bones[4], ch = R.bones[2];
    const p = this.a, d = this.b, q = this.c, n = this.d, wv = this.e, nr = this.f, tmp = this.g;
    const hh = HAIR_HEAD;
    const hcx = HC.x, hcy = HC.y + hh.cy, hcz = HC.z + hh.cz;
    const fr = this.fr;
    for (let si = 0; si < this.strands.length; si++) {
      const st = this.strands[si], g = this.gHair[si];
      const seg = st.len / HN;
      fpt(hd, HC.x + st.root.x, HC.y + st.root.y, HC.z + st.root.z, p);
      fdir(hd, st.tan.x, st.tan.y, st.tan.z, d);
      for (let i = 0; i <= HN; i++) {
        // ширина: у корня шире, к кончику клином (мокрые концы слипаются в острие)
        const k = i / HN;
        const w = st.w * (1 - 0.88 * Math.pow(k, 1.25)) * (1 + 0.25 * Math.exp(-((k / 0.12) ** 2)));
        // наружу: от центра головы, ниже головы — по горизонтали
        vsub(n, p, R.hc);
        const down = clamp((R.hc.y - p.y) / 0.15, 0, 1);
        n.y *= 1 - down;
        vnorm(n, n);
        vcross(wv, d, n);
        vnorm(wv, wv);
        vcross(nr, wv, d);
        if (vdot(nr, n) < 0) vsc(nr, nr, -1);
        vnorm(nr, nr);
        // нормали к краям ленты загнуты — прядь освещается как округлый мокрый жгут (блик по середине)
        vma(q, p, wv, -w * 0.5);
        Hb.put(gi(g, i, 0), q);
        Hb.putN(gi(g, i, 0), vnorm(tmp, vma(tmp, nr, wv, -0.85)));
        vma(q, p, wv, w * 0.5);
        Hb.put(gi(g, i, 1), q);
        Hb.putN(gi(g, i, 1), vnorm(tmp, vma(tmp, nr, wv, 0.85)));
        if (i === HN) break;
        // следующий сегмент: тяжесть, ветер, лёгкое качание
        const sw = 0.05 * Math.sin(TAU * 0.23 * t + st.ph) * k;
        vset(tmp, s.wind.x * 0.35 + sw * 0.6, -12 * seg + s.wind.y * 0.35, s.wind.z * 0.35 + sw * 0.3);
        vma(d, d, tmp, 1);
        vnorm(d, d);
        vma(q, p, d, seg);
        // голова (эллипсоид в кадре головы)
        floc(hd, q, tmp);
        const lx = tmp.x - hcx, ly = tmp.y - hcy, lz = tmp.z - hcz;
        const az = lz > 0 ? hh.azF : hh.azB;
        const m = Math.hypot(lx / hh.ax, ly / hh.ay, lz / az);
        if (m < 1 && m > 1e-6) fpt(hd, hcx + lx / m, hcy + ly / m, hcz + lz / m, q);
        // лицо открыто: перед лицом — вбок, к краю лица
        floc(hd, q, tmp);
        const fx = tmp.x - HC.x, fy = tmp.y - HC.y, fz = tmp.z - HC.z, HF = HAIR_FACE;
        if (fz > HF.z0 && fy > HF.y0 && fy < HF.y1) {
          const wf = lerp(HF.wChin, HF.w, sstep(-0.12, -0.02, fy)) + w * 0.5;
          if (Math.abs(fx) < wf) fpt(hd, HC.x + (Math.abs(fx) > 0.015 ? Math.sign(fx) : st.sx) * wf, tmp.y, tmp.z, q);
        }
        // шея, плечи, торс
        this.pushCapsule(q, nb.o, nk.o, 0.054);
        fpt(nb, -B.shX, B.shY + 0.018, B.shZ, fr.x);
        fpt(nb, B.shX, B.shY + 0.018, B.shZ, fr.y);
        this.pushCapsule(q, fr.x, fr.y, 0.058);
        floc(ch, q, tmp);
        const ex = tmp.x / 0.17, ey = (tmp.y - 0.05) / 0.24, ez = (tmp.z + 0.005) / 0.112;
        const em = Math.hypot(ex, ey, ez);
        if (em < 1 && em > 1e-6) fpt(ch, tmp.x / em, 0.05 + (tmp.y - 0.05) / em, -0.005 + (tmp.z + 0.005) / em, q);
        if (q.y < 0.004) q.y = 0.004;
        vsub(d, q, p);
        vnorm(d, d);
        vcp(p, q);
      }
      Hb.center(g, 0, R.hc);
    }
  }

  private pushCapsule(q: V, a: V, b: V, r: number) {
    const abx = b.x - a.x, aby = b.y - a.y, abz = b.z - a.z;
    const l2 = abx * abx + aby * aby + abz * abz;
    let k = l2 > 1e-12 ? ((q.x - a.x) * abx + (q.y - a.y) * aby + (q.z - a.z) * abz) / l2 : 0;
    k = clamp(k, 0, 1);
    const cx = a.x + abx * k, cy = a.y + aby * k, cz = a.z + abz * k;
    const dx = q.x - cx, dy = q.y - cy, dz = q.z - cz;
    const dl = Math.hypot(dx, dy, dz);
    if (dl < r && dl > 1e-9) vset(q, cx + (dx / dl) * r, cy + (dy / dl) * r, cz + (dz / dl) * r);
  }

  // ───────────────────────── глаза, зубы, пасть ─────────────────────────

  private writeWet(torn: number, jaw: number) {
    const W = this.bWet, R = this.rig, hd = R.bones[5];
    const p = this.a, q = this.b, x = this.c, y = this.d, n = this.e;
    // глаза: сфера с полюсом по взгляду
    const TH = [0, 0.28, 0.5, 0.9, 1.5, 2.3, Math.PI];
    for (let i = 0; i < 2; i++) {
      const g = this.gEye[i], gz = R.gaze[i], c = R.eye[i], r = EYES[i].r;
      vperp(x, hd.x, gz);
      vcross(y, gz, x);
      for (let k = 0; k < 7; k++) {
        const st = Math.sin(TH[k]), ct = Math.cos(TH[k]);
        for (let j = 0; j <= g.cols; j++) {
          const ph = (TAU * (j % g.cols)) / g.cols, cp = Math.cos(ph), sp = Math.sin(ph);
          vset(n, x.x * st * cp + y.x * st * sp + gz.x * ct, x.y * st * cp + y.y * st * sp + gz.y * ct, x.z * st * cp + y.z * st * sp + gz.z * ct);
          vma(p, c, n, r);
          const v = gi(g, k, j);
          W.put(v, p);
          W.putN(v, n);
        }
        W.center(g, k, c);
      }
    }
    // зубы: верхний ряд — от головы, нижний — с челюстью; за краем разреза — прячутся в щёку
    const cutPh = lerp(MOUTH.phiC, MOUTH.phiEar, smooth(torn)), taper = lerp(0.3, 0.14, torn);
    const TC = 2 * this.NT + 1;
    for (let row = 0; row < 2; row++) {
      const g = this.gTeeth[row], lower = row === 1;
      for (let qi = 0; qi < TC; qi++) {
        const ph = this.tPh[qi], aph = Math.abs(ph);
        const wc = 1 - sstep(cutPh - taper, cutPh, aph);
        const vis = 1 - sstep(cutPh - 0.12, cutPh + 0.02, aph);
        const bx = this.tB[qi * 3], by = this.tB[qi * 3 + 1], bz = this.tB[qi * 3 + 2];
        const hl = Math.hypot(bx, bz) || 1, ix = -bx / hl, iz = -bz / hl;
        const inset = lower ? 0.0088 : 0.0064;
        const ox = bx + ix * inset, oz = bz + iz * inset;
        const tooth = Math.min(this.NT - 1, qi >> 1), edge = (qi & 1) === 0;
        const len = this.tLen[tooth] * (edge ? 0.55 : 1) * vis * (lower ? 0.85 : 1);
        const sg = lower ? -1 : 1;
        const ys = [by + sg * (0.0075 * vis + 0.0015 * (1 - vis)), by + sg * 0.0015, by + sg * 0.0015 - sg * len];
        const tipIn = 0.0012 * (lower ? -1 : 1);
        for (let k = 0; k < 3; k++) {
          let px = ox + (k === 2 ? ix * tipIn : 0), py = ys[k], pz = oz + (k === 2 ? iz * tipIn : 0);
          let nx = -ix, ny = 0, nz = -iz;
          if (lower && wc > 0) {
            jawXf(py, pz, jaw, wc, n);
            py = n.y;
            pz = n.z;
            const ca = Math.cos(jaw * wc), sa = Math.sin(jaw * wc);
            const ny2 = ny * ca - nz * sa, nz2 = ny * sa + nz * ca;
            ny = ny2;
            nz = nz2;
          }
          fpt(hd, HC.x + px, HC.y + py, HC.z + pz, p);
          fdir(hd, nx, ny, nz, q);
          const v = gi(g, k, qi);
          W.put(v, p);
          W.putN(v, q);
        }
      }
    }
    // пасть: тёмный мешок внутри (нормали внутрь), нижняя половина — с челюстью, язык
    const g = this.gCav, CY = MOUTH.y0 + 0.004, CZ = -0.014, AX = 0.074, AY = 0.03, AZ = 0.066;
    for (let k = 0; k < 7; k++) {
      const th = 0.2 + ((Math.PI - 0.4) * k) / 6, st = Math.sin(th), ct = Math.cos(th);
      for (let j = 0; j <= g.cols; j++) {
        const ph = (TAU * (j % g.cols)) / g.cols, sp = Math.sin(ph), cp = Math.cos(ph);
        const px = AX * st * sp;
        let py = CY + AY * ct, pz = CZ + AZ * st * cp;
        if (ct < 0) {
          // язык — бугор на дне спереди
          if (cp > 0) py += 0.014 * cp * cp * (-ct) * Math.exp(-((sp / 0.5) ** 2));
          jawXf(py, pz, jaw, sstep(0, -0.5, ct), n);
          py = n.y;
          pz = n.z;
        }
        fpt(hd, HC.x + px, HC.y + py, HC.z + pz, p);
        W.put(gi(g, k, j), p);
      }
      fpt(hd, HC.x, HC.y + CY, HC.z + CZ, p);
      W.center(g, k, p);
    }
    gridNormals(W, g);
  }

  // ───────────────────────── развёртка и цвета ─────────────────────────

  private staticUv() {
    const S = this.bSkin;
    const uvGrid = (b: Buf, g: Grid, ur: number, vr: number) => {
      const C = gv(g);
      for (let r = 0; r < g.rows; r++) {
        for (let c = 0; c < C; c++) {
          const i = gi(g, r, c);
          b.uv[i * 2] = (c / (g.closed ? g.cols : g.cols - 1)) * ur;
          b.uv[i * 2 + 1] = (r / Math.max(1, g.rows - 1)) * vr;
        }
      }
    };
    uvGrid(S, this.gHeadU, 2, 1.6);
    uvGrid(S, this.gHeadL, 2, 0.8);
    uvGrid(S, this.gTorso, 2, 1.2);
    for (const g of this.gArm) uvGrid(S, g, 1, 2.5);
    for (const g of this.gPalm) uvGrid(S, g, 1, 0.4);
    for (const g of this.gFing) uvGrid(S, g, 0.5, 0.5);
    for (const g of this.gLeg) uvGrid(S, g, 1, 3);
    for (const g of this.gFoot) uvGrid(S, g, 1, 0.8);
    uvGrid(this.bGown, this.gGown, 2, 2.4);
    for (const g of this.gSleeve) uvGrid(this.bGown, g, 1, 0.3);
    uvGrid(this.bBlood, this.gDecal, 1, 1);
  }

  /** Статичные цвета вершин (кожа: лицо, глазницы, губы, кожа головы; рубашка: грязь; волосы; глаза, зубы, пасть) и маски крови. */
  private staticColors() {
    const S = this.bSkin, BC = this.baseCol, M = this.bloodMask;
    const C = NCH + 1;
    const p = this.a;
    const setBase = (i: number, r: number, g: number, b: number, m: number) => {
      BC[i * 3] = r;
      BC[i * 3 + 1] = g;
      BC[i * 3 + 2] = b;
      M[i] = m;
    };
    // голова
    const headCol = (x: number, y: number, z: number, ph: number, inner: number, rowEdge: boolean, lower: boolean, i: number) => {
      let r = 0.93, g = 0.955, b = 1.0;
      const front = sstep(0.2, 0.6, Math.cos(ph)), ax = Math.abs(x), a = Math.abs(ph);
      // глазницы и тёмные круги
      const sk = gauss2(ax - 0.031, y - 0.015, 0.02, 0.016) * front;
      const un = gauss2(ax - 0.034, y + 0.003, 0.016, 0.007) * front;
      r *= 1 - 0.62 * sk - 0.25 * un;
      g *= 1 - 0.72 * sk - 0.32 * un;
      b *= 1 - 0.58 * sk - 0.22 * un;
      // губы — тонкие, синюшно-серые, линия рта — тёмная дуга (читается издали)
      const dy = y - mouthY(ph), wsm = smileW(ph);
      const lip = wsm * Math.exp(-((dy / 0.013) ** 2)) * front;
      r = lerp(r, 0.3, lip);
      g = lerp(g, 0.17, lip);
      b = lerp(b, 0.2, lip);
      if (rowEdge) {
        r *= 0.5;
        g *= 0.38;
        b *= 0.42;
      }
      // ноздри
      const ns = gauss2(ax - 0.0085, y + 0.04, 0.0035, 0.0025) * front;
      r *= 1 - 0.4 * ns;
      g *= 1 - 0.45 * ns;
      b *= 1 - 0.4 * ns;
      // серо-зелёная тень под скулами
      const hol = gauss2(ax - 0.046, y + 0.048, 0.016, 0.02) * front;
      r *= 1 - 0.15 * hol;
      b *= 1 - 0.1 * hol;
      // кожа головы под волосами — чёрная
      const yh = a < 0.55 ? 0.074 + 0.012 * a : a < 1.5 ? lerp(0.081, 0.018, sstep(0.55, 1.5, a)) : lerp(0.018, -0.075, sstep(1.5, 2.3, a));
      const hk = sstep(yh - 0.004, yh + 0.008, y);
      r = lerp(r, 0.035, hk);
      g = lerp(g, 0.034, hk);
      b = lerp(b, 0.04, hk);
      if (inner) {
        r = 0.42;
        g = 0.05;
        b = 0.06;
      }
      // маска крови: края разреза, губы, потёки по подбородку
      const tzn = tornZone(ph);
      let m = Math.max(tzn * Math.exp(-((dy / 0.017) ** 2)), 0.85 * wsm * Math.exp(-((dy / 0.011) ** 2)) * front);
      if (inner) m = 1;
      if (lower && dy < 0 && a < MOUTH.phiEar) {
        const cc = Math.round(((ph + Math.PI) / TAU) * 97);
        const L = hash1(cc * 1.37) < 0.55 ? 0.04 + 0.1 * hash1(cc * 2.9) : 0.016;
        m = Math.max(m, (1 - -dy / L) * 0.97 * front);
        m = Math.max(m, 0.8 * gauss2(x, y + 0.1, 0.028, 0.022));
      }
      setBase(i, r, g, b, clamp(m, 0, 1));
    };
    for (let c = 0; c < C; c++) {
      const ph = this.colPh[c];
      for (let r = 0; r <= NU; r++) {
        const o = (Math.min(r, NU - 1) * C + c) * 3;
        headCol(this.hbU[o], this.hbU[o + 1], this.hbU[o + 2], ph, r === NU ? 1 : 0, r === NU - 1, false, gi(this.gHeadU, r, c));
      }
      for (let j = 0; j < NL; j++) {
        const o = ((j === 0 ? 1 : j) * C + c) * 3;
        headCol(this.hbL[o], this.hbL[o + 1], this.hbL[o + 2], ph, j === 0 ? 1 : 0, j === 1, true, gi(this.gHeadL, j, c));
      }
    }
    // торс и шея: чуть темнее у ключиц, кровь — потёки спереди по шее на грудь
    const gt = this.gTorso;
    for (let k = 0; k < gt.rows; k++) {
      for (let c = 0; c <= GC; c++) {
        const ang = -Math.PI + (TAU * (c % GC)) / GC, ca = Math.cos(ang);
        const ring = k + T_SKIN0;
        const sh = 0.96 - 0.05 * Math.exp(-(((Math.abs(Math.sin(ang)) - 0.5) / 0.2) ** 2)) * (ring === 4 ? 1 : 0);
        let m = 0;
        if (ca > 0.2) {
          const cc = c % GC;
          const L = hash1(cc * 4.1 + 1) < 0.45 ? 2.5 + 5 * hash1(cc * 1.9) : 0;
          // от головы (кольцо 8) вниз
          m = L > 0 ? clamp(1 - (8 - ring) / L, 0, 1) * 0.95 * ca : 0;
          // горло под отвисшей челюстью — сплошь в крови (видно сквозь пасть)
          if (ring >= 6 && ca > 0.35) m = Math.max(m, 0.97 * ca);
        }
        // кольцо в голове — горло: видно только сквозь раскрытую пасть — тёмное мясо
        if (ring === 8) setBase(gi(gt, k, c), 0.2, 0.025, 0.03, 1);
        else setBase(gi(gt, k, c), 0.93 * sh, 0.955 * sh, 1.0 * sh, m);
      }
    }
    // руки и ноги: синяки, грязь к ступням; кисти — грязные ногти, кровь (маска — шум)
    const limb = (g: Grid, dirtFrom: number, seed: number) => {
      const Cg = gv(g);
      for (let r = 0; r < g.rows; r++) {
        for (let c = 0; c < Cg; c++) {
          const i = gi(g, r, c);
          const bz = sstep(0.55, 0.85, noise1(r * 0.9 + (c % g.cols) * 2.3 + seed * 11, seed)) * 0.25;
          const dirt = sstep(dirtFrom, g.rows - 1, r) * 0.35;
          setBase(i, 0.93 * (1 - 0.12 * bz) * (1 - dirt), 0.955 * (1 - 0.3 * bz) * (1 - dirt * 1.1), 1.0 * (1 - 0.05 * bz) * (1 - dirt * 1.25), 0);
        }
      }
    };
    this.gArm.forEach((g, i) => limb(g, 99, i + 1));
    this.gLeg.forEach((g, i) => limb(g, 9, i + 5));
    for (let i = 0; i < 2; i++) {
      const g = this.gPalm[i];
      for (let r = 0; r < g.rows; r++) for (let c = 0; c <= g.cols; c++) setBase(gi(g, r, c), 0.9, 0.9, 0.93, 0.25 + 0.6 * hash1(r * 7 + c * 3 + i));
      const gf = this.gFoot[i];
      for (let r = 0; r < gf.rows; r++) {
        for (let c = 0; c <= gf.cols; c++) {
          const sa = Math.sin((TAU * (c % gf.cols)) / gf.cols);
          const dirt = sa < 0 ? 0.6 : 0.2 + 0.25 * sstep(5, 7, r);
          setBase(gi(gf, r, c), 0.93 * (1 - dirt), 0.94 * (1 - dirt * 1.08), 0.96 * (1 - dirt * 1.15), 0);
        }
      }
      for (let f = 0; f < 5; f++) {
        const g2 = this.gFing[i * 5 + f];
        for (let r = 0; r < g2.rows; r++) {
          for (let c = 0; c <= g2.cols; c++) {
            const ca = Math.cos((TAU * (c % g2.cols)) / g2.cols);
            const nail = r >= 3 && ca > 0.3;
            if (nail) setBase(gi(g2, r, c), 0.42, 0.38, 0.32, 0.3 + 0.6 * hash1(f + c));
            else setBase(gi(g2, r, c), 0.9, 0.91, 0.95, 0.15 + 0.8 * hash1(r * 5 + c + f * 13 + i));
          }
        }
      }
    }
    // рубашка: подол грязнее, подмышки, разводы
    const G = this.bGown, gg = this.gGown;
    for (let r = 0; r < gg.rows; r++) {
      for (let c = 0; c <= GC; c++) {
        const hem = sstep(GU + 2, gg.rows - 1, r);
        const n = noise1((c % GC) * 0.9 + r * 1.7, 9);
        const k = 1 - 0.28 * hem - 0.12 * sstep(0.6, 0.9, n);
        G.rgb(gi(gg, r, c), k, k * 0.985, k * 0.955);
      }
    }
    for (const sg of this.gSleeve) for (let r = 0; r < sg.rows; r++) for (let c = 0; c <= sg.cols; c++) G.rgb(gi(sg, r, c), 0.95, 0.94, 0.9);
    // волосы
    const H = this.bHair;
    this.strands.forEach((st, si) => {
      const g = this.gHair[si];
      for (let r = 0; r < g.rows; r++) {
        const k = st.c * (0.8 + 0.25 * (r / g.rows));
        for (let c = 0; c < 2; c++) H.rgb(gi(g, r, c), 0.03 * k, 0.028 * k, 0.032 * k);
      }
    });
    // глаза: зрачок, почти чёрная радужка, грязный белок с красными прожилками к краям
    const W = this.bWet, off = S.verts;
    const EYE_C = [[0.004, 0.004, 0.004], [0.022, 0.017, 0.016], [0.05, 0.038, 0.034], [0.5, 0.47, 0.43], [0.47, 0.34, 0.32], [0.3, 0.17, 0.16], [0.15, 0.08, 0.08]];
    for (const g of this.gEye) for (let k = 0; k < 7; k++) for (let c = 0; c <= g.cols; c++) W.rgb(gi(g, k, c), EYE_C[k][0], EYE_C[k][1], EYE_C[k][2]);
    // зубы
    const TC = 2 * this.NT + 1;
    for (let row = 0; row < 2; row++) {
      const g = this.gTeeth[row];
      for (let qi = 0; qi < TC; qi++) {
        const tooth = Math.min(this.NT - 1, qi >> 1), edge = (qi & 1) === 0;
        const y = 0.7 + 0.2 * hash1(tooth * 3.7 + row);
        const missing = this.tLen[tooth] < 0.002;
        for (let k = 0; k < 3; k++) {
          const i = gi(g, k, qi);
          let r = 0.84 * y, gg2 = 0.8 * y, b = 0.68 * y;
          if (k === 0) {
            r = 0.42;
            gg2 = 0.12;
            b = 0.13;
          } else if (k === 2 && edge) {
            r *= 0.4;
            gg2 *= 0.36;
            b *= 0.34;
          }
          if (missing && k > 0) {
            r = 0.05;
            gg2 = 0.02;
            b = 0.02;
          }
          W.rgb(i, r, gg2, b);
          this.wetBase(i, r, gg2, b);
          M[off + i] = k === 0 ? 1 : 0.35 + 0.6 * hash1(qi * 1.3 + k);
        }
      }
    }
    // пасть: спереди тёмно-красная, глубже — почти чёрная; язык
    const gc = this.gCav;
    for (let k = 0; k < 7; k++) {
      for (let c = 0; c <= gc.cols; c++) {
        const ph = (TAU * (c % gc.cols)) / gc.cols, cp = Math.cos(ph), front = Math.max(0, cp);
        const tongue = k >= 4 && cp > 0.5 ? 0.6 : 0;
        const r = lerp(0.07, 0.4, front) + 0.12 * tongue, g = lerp(0.008, 0.06, front) + 0.06 * tongue, b = lerp(0.012, 0.07, front) + 0.06 * tongue;
        W.rgb(gi(gc, k, c), r, g, b);
      }
    }
    for (const g of this.gEye) for (let k = 0; k < 7; k++) for (let c = 0; c <= g.cols; c++) {
      const i = gi(g, k, c);
      this.wetBase(i, W.col[i * 4], W.col[i * 4 + 1], W.col[i * 4 + 2]);
    }
    for (let k = 0; k < 7; k++) for (let c = 0; c <= gc.cols; c++) {
      const i = gi(gc, k, c);
      this.wetBase(i, W.col[i * 4], W.col[i * 4 + 1], W.col[i * 4 + 2]);
    }
    void p;
    this.bloodColors(0, 0);
  }
  private wetCol: Float32Array | null = null;
  private wetBase(i: number, r: number, g: number, b: number) {
    if (!this.wetCol) this.wetCol = new Float32Array(this.bWet.verts * 3);
    this.wetCol[i * 3] = r;
    this.wetCol[i * 3 + 1] = g;
    this.wetCol[i * 3 + 2] = b;
  }

  /** Кровь по маскам: видна, где маска ≥ 1 − torn (мягкий край); руки — по bloody. */
  private bloodColors(torn: number, bloody: number) {
    this.colTorn = torn;
    this.colBloody = bloody;
    this.colDirty = true;
    const S = this.bSkin, BC = this.baseCol, M = this.bloodMask;
    const thr = 1 - 0.95 * torn;
    const handFrom = this.gPalm[0].base, handTo = this.gLeg[0].base;
    for (let i = 0; i < S.verts; i++) {
      let k = torn > 0 ? clamp((M[i] - thr) / 0.08, 0, 1) : 0;
      if (i >= handFrom && i < handTo) k = bloody > 0 ? clamp((bloody - (1 - M[i])) / 0.2, 0, 1) * 0.9 : 0;
      // у разреза — яркое мясо, по потёкам — темнее
      const dark = (0.75 + 0.25 * hash1(i * 0.37)) * (0.55 + 0.55 * M[i]);
      S.col[i * 4] = lerp(BC[i * 3], 0.62 * dark, k);
      S.col[i * 4 + 1] = lerp(BC[i * 3 + 1], 0.035 * dark, k);
      S.col[i * 4 + 2] = lerp(BC[i * 3 + 2], 0.035 * dark, k);
      S.col[i * 4 + 3] = 1;
    }
    // зубы: кровь у дёсен и на кончиках
    const W = this.bWet, off = S.verts, wc = this.wetCol;
    if (!wc) return;
    const tFrom = this.gTeeth[0].base, tTo = this.gCav.base;
    for (let i = tFrom; i < tTo; i++) {
      const k = torn > 0 ? clamp((M[off + i] - (1 - torn)) / 0.15, 0, 1) * 0.85 : 0;
      W.col[i * 4] = lerp(wc[i * 3], 0.38, k);
      W.col[i * 4 + 1] = lerp(wc[i * 3 + 1], 0.03, k);
      W.col[i * 4 + 2] = lerp(wc[i * 3 + 2], 0.03, k);
    }
  }
}

// ───────────────────────── красные зрачки ─────────────────────────

/** Зрачки в темноте: расстояние между ними, радиус зрачка, размер ореола, м. */
export const RED_EYES = { sep: 0.064, r: 0.0064, halo: 0.14 };

export class RedEyes {
  readonly meshes: Mesh[];
  private readonly node: TransformNode;
  private readonly scene: Scene;
  private readonly mats: StandardMaterial[];
  private readonly q = new Quaternion();
  private readonly fwd = new Vector3();
  private disposed = false;

  constructor(scene: Scene, opts: { layerMask?: number } = {}) {
    this.scene = scene;
    const tex = acquireTex(scene);
    this.node = new TransformNode('smile:redEyes', scene);
    this.node.rotationQuaternion = new Quaternion();
    const layer = opts.layerMask ?? PORTAL_LAYER;
    // зрачки: два вытянутых по вертикали шарика
    const pos: number[] = [], nor: number[] = [], idx: number[] = [];
    const R = 7, Cn = 8;
    for (const sx of [-1, 1]) {
      const base = pos.length / 3;
      for (let k = 0; k <= R; k++) {
        const th = (Math.PI * k) / R;
        for (let j = 0; j <= Cn; j++) {
          const ph = (TAU * j) / Cn;
          const nx = Math.sin(th) * Math.cos(ph), ny = Math.cos(th), nz = Math.sin(th) * Math.sin(ph);
          pos.push(sx * RED_EYES.sep * 0.5 + nx * RED_EYES.r, ny * RED_EYES.r * 1.25, nz * RED_EYES.r * 0.7);
          nor.push(nx, ny, nz);
        }
      }
      for (let k = 0; k < R; k++) {
        for (let j = 0; j < Cn; j++) {
          const a = base + k * (Cn + 1) + j, b = a + 1, c = a + Cn + 1, d = c + 1;
          idx.push(a, b, d, a, d, c);
        }
      }
    }
    const pupil = new Mesh('smile:redEyesPupils', scene);
    const vd = new VertexData();
    vd.positions = pos;
    vd.normals = nor;
    vd.indices = idx;
    vd.applyToMesh(pupil);
    const pm = new StandardMaterial('smile:redEyesMat', scene);
    pm.disableLighting = true;
    pm.emissiveColor = new Color3(1, 0.07, 0.03);
    pm.diffuseColor = Color3.Black();
    pm.specularColor = Color3.Black();
    pm.backFaceCulling = false;
    pm.fogEnabled = false;
    pupil.material = pm;
    // ореол: по квадрату на зрачок, сложение
    const hp: number[] = [], hu: number[] = [], hi: number[] = [], hn: number[] = [];
    for (const sx of [-1, 1]) {
      const b = hp.length / 3, s = RED_EYES.halo * 0.5, cx = sx * RED_EYES.sep * 0.5;
      hp.push(cx - s, -s, 0.002, cx + s, -s, 0.002, cx + s, s, 0.002, cx - s, s, 0.002);
      hu.push(0, 0, 1, 0, 1, 1, 0, 1);
      hn.push(0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1);
      hi.push(b, b + 1, b + 2, b, b + 2, b + 3);
    }
    const halo = new Mesh('smile:redEyesHalo', scene);
    const hv = new VertexData();
    hv.positions = hp;
    hv.uvs = hu;
    hv.normals = hn;
    hv.indices = hi;
    hv.applyToMesh(halo);
    const hm = new StandardMaterial('smile:redEyesHaloMat', scene);
    hm.disableLighting = true;
    hm.emissiveColor = new Color3(1, 0.06, 0.02);
    hm.diffuseColor = Color3.Black();
    hm.specularColor = Color3.Black();
    hm.opacityTexture = tex.glow;
    hm.alphaMode = Constants.ALPHA_ADD;
    hm.backFaceCulling = false;
    hm.disableDepthWrite = true;
    hm.fogEnabled = false;
    halo.material = hm;
    this.mats = [pm, hm];
    this.meshes = [pupil, halo];
    for (const m of this.meshes) {
      m.parent = this.node;
      m.isPickable = false;
      m.alwaysSelectAsActiveMesh = true;
      m.layerMask = layer;
    }
    this.node.setEnabled(false);
  }

  /** Где зрачки (середина между ними, мир) и куда смотрят; null — погасли. t — часы для моргания. */
  set(pos: Vector3 | null, look?: Vector3, t?: number) {
    if (this.disposed) return;
    if (!pos) {
      this.node.setEnabled(false);
      return;
    }
    this.node.setEnabled(true);
    this.node.position.copyFrom(pos);
    if (look) {
      look.subtractToRef(pos, this.fwd);
      if (this.fwd.lengthSquared() > 1e-8) {
        this.fwd.normalize();
        Quaternion.FromLookDirectionLHToRef(this.fwd, Vector3.UpReadOnly, this.q);
        this.node.rotationQuaternion!.copyFrom(this.q);
      }
    }
    // моргание: раз в ~2.5…5 с на 0.12 с
    let sy = 1;
    if (t !== undefined) {
      const k = Math.floor(t / 3.1), at = k * 3.1 + hash1(k * 5.3) * 2.6, x = (t - at) / 0.12;
      if (x >= 0 && x <= 1) sy = 0.08 + 0.92 * Math.abs(2 * x - 1);
    }
    this.node.scaling.set(1, sy, 1);
    this.node.computeWorldMatrix(true);
    for (const m of this.meshes) m.computeWorldMatrix(true);
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const m of this.meshes) m.dispose(false, false);
    for (const m of this.mats) m.dispose(false, false);
    this.node.dispose();
    releaseTex(this.scene);
  }
}

// ───────────────────────── струя крови ─────────────────────────

/** Струя: пульс, Гц; капли (скорости, разброс, размеры, жизнь), кляксы на полу. */
export const SPURT = { hz: 1.3, base: 30, peak: 420, speed0: 0.6, speedPulse: 2.9, spread: 0.2, life: 1.6, max: 260, splats: 160, splatS: 40, gravity: 9.8 };

export class BloodSpurt {
  readonly meshes: Mesh[];
  private readonly drop: Mesh;
  private readonly splat: Mesh;
  private readonly mats: StandardMaterial[];
  private readonly rng: Rng;
  // капли
  private readonly px: Float32Array;
  private readonly py: Float32Array;
  private readonly pz: Float32Array;
  private readonly vx: Float32Array;
  private readonly vy: Float32Array;
  private readonly vz: Float32Array;
  private readonly age: Float32Array;
  private readonly life: Float32Array;
  private readonly rad: Float32Array;
  private n = 0;
  // кляксы
  private readonly sx: Float32Array;
  private readonly sy: Float32Array;
  private readonly sz: Float32Array;
  private readonly sr: Float32Array;
  private readonly sa: Float32Array;
  private readonly sRot: Float32Array;
  private sn = 0;
  private sHead = 0;
  private readonly dBuf: Float32Array;
  private readonly sBuf: Float32Array;
  private phase = 0;
  private acc = 0;
  private disposed = false;

  constructor(scene: Scene, opts: { layerMask?: number; seed?: string } = {}) {
    this.rng = makeRng((opts.seed ?? 'smile') + ':spurt');
    const M = SPURT.max, Sn = SPURT.splats;
    this.px = new Float32Array(M);
    this.py = new Float32Array(M);
    this.pz = new Float32Array(M);
    this.vx = new Float32Array(M);
    this.vy = new Float32Array(M);
    this.vz = new Float32Array(M);
    this.age = new Float32Array(M);
    this.life = new Float32Array(M);
    this.rad = new Float32Array(M);
    this.sx = new Float32Array(Sn);
    this.sy = new Float32Array(Sn);
    this.sz = new Float32Array(Sn);
    this.sr = new Float32Array(Sn);
    this.sa = new Float32Array(Sn);
    this.sRot = new Float32Array(Sn);
    this.dBuf = new Float32Array(M * 16);
    this.sBuf = new Float32Array(Sn * 16);
    const layer = opts.layerMask ?? PORTAL_LAYER;
    // капля — икосаэдр радиуса 1 (масштаб — матрицей)
    const t = (1 + Math.sqrt(5)) / 2;
    const ico = [-1, t, 0, 1, t, 0, -1, -t, 0, 1, -t, 0, 0, -1, t, 0, 1, t, 0, -1, -t, 0, 1, -t, t, 0, -1, t, 0, 1, -t, 0, -1, -t, 0, 1];
    for (let i = 0; i < ico.length; i += 3) {
      const l = Math.hypot(ico[i], ico[i + 1], ico[i + 2]);
      ico[i] /= l;
      ico[i + 1] /= l;
      ico[i + 2] /= l;
    }
    const faces = [0, 11, 5, 0, 5, 1, 0, 1, 7, 0, 7, 10, 0, 10, 11, 1, 5, 9, 5, 11, 4, 11, 10, 2, 10, 7, 6, 7, 1, 8, 3, 9, 4, 3, 4, 2, 3, 2, 6, 3, 6, 8, 3, 8, 9, 4, 9, 5, 2, 4, 11, 6, 2, 10, 8, 6, 7, 9, 8, 1];
    const drop = (this.drop = new Mesh('smile:bloodDrops', scene));
    const vd = new VertexData();
    vd.positions = ico.slice();
    vd.normals = ico.slice();
    vd.indices = faces;
    vd.applyToMesh(drop);
    // клякса — приплюснутый диск
    const sp: number[] = [0, 0.35, 0], sn: number[] = [0, 1, 0], si: number[] = [];
    const K = 12;
    for (let k = 0; k < K; k++) {
      const a = (TAU * k) / K, rr = 0.85 + 0.3 * hash1(k * 2.7);
      sp.push(Math.cos(a) * rr, 0, Math.sin(a) * rr);
      sn.push(Math.cos(a) * 0.3, 0.95, Math.sin(a) * 0.3);
      si.push(0, 1 + k, 1 + ((k + 1) % K));
    }
    const splat = (this.splat = new Mesh('smile:bloodSplats', scene));
    const sv = new VertexData();
    sv.positions = sp;
    sv.normals = sn;
    sv.indices = si;
    sv.applyToMesh(splat);
    const dm = new StandardMaterial('smile:bloodDropMat', scene);
    dm.diffuseColor = new Color3(0.45, 0.015, 0.015);
    dm.specularColor = new Color3(0.6, 0.3, 0.3);
    dm.specularPower = 64;
    dm.emissiveColor = new Color3(0.4, 0.012, 0.012);
    dm.ambientColor = Color3.Black();
    const smt = new StandardMaterial('smile:bloodSplatMat', scene);
    smt.diffuseColor = new Color3(0.24, 0.01, 0.01);
    smt.specularColor = new Color3(0.5, 0.25, 0.25);
    smt.specularPower = 50;
    smt.emissiveColor = new Color3(0.07, 0.0, 0.0);
    smt.ambientColor = Color3.Black();
    smt.backFaceCulling = false;
    smt.zOffset = -2;
    drop.material = dm;
    splat.material = smt;
    this.mats = [dm, smt];
    for (const [m, buf] of [[drop, this.dBuf], [splat, this.sBuf]] as const) {
      m.thinInstanceSetBuffer('matrix', buf, 16, false);
      m.thinInstanceCount = 1;
      m.isPickable = false;
      m.alwaysSelectAsActiveMesh = true;
      m.layerMask = layer;
      m.computeWorldMatrix(true);
      m.freezeWorldMatrix();
    }
    this.meshes = [drop, splat];
  }

  /** Есть ли что рисовать (летящие капли или кляксы). */
  get active(): boolean {
    return this.n > 0 || this.sn > 0;
  }

  /**
   * Кадр: neck — мировая точка шеи (null — не бьёт), dir — куда бьёт (по умолчанию вверх-вбок), floorY — пол (кляксы;
   * нет — капли просто гаснут).
   */
  frame(dt: number, neck: Vector3 | null, dir?: Vector3, floorY?: number) {
    if (this.disposed) return;
    dt = clamp(dt, 0, 0.05);
    const r = this.rng, S = SPURT;
    if (neck) {
      this.phase += dt * S.hz;
      const f = fract(this.phase);
      const pulse = Math.exp(-(((f - 0.1) / 0.075) ** 2));
      this.acc += (S.base + S.peak * pulse) * dt;
      let dx = dir?.x ?? 0.35, dy = dir?.y ?? 0.75, dz = dir?.z ?? 0.4;
      const dl = Math.hypot(dx, dy, dz) || 1;
      dx /= dl;
      dy /= dl;
      dz /= dl;
      while (this.acc >= 1) {
        this.acc -= 1;
        if (this.n >= S.max) break;
        const i = this.n++;
        const sp = (S.speed0 + S.speedPulse * pulse) * (0.7 + 0.4 * r.next());
        const spr = S.spread * (0.6 + 1.4 * (1 - pulse));
        let ex = dx + (r.next() - 0.5) * 2 * spr, ey = dy + (r.next() - 0.5) * 2 * spr, ez = dz + (r.next() - 0.5) * 2 * spr;
        const el = Math.hypot(ex, ey, ez) || 1;
        ex /= el;
        ey /= el;
        ez /= el;
        this.px[i] = neck.x + (r.next() - 0.5) * 0.012;
        this.py[i] = neck.y + (r.next() - 0.5) * 0.012;
        this.pz[i] = neck.z + (r.next() - 0.5) * 0.012;
        this.vx[i] = ex * sp;
        this.vy[i] = ey * sp;
        this.vz[i] = ez * sp;
        this.age[i] = 0;
        this.life[i] = S.life * (0.6 + 0.5 * r.next());
        this.rad[i] = (0.004 + 0.006 * r.next()) * (0.7 + 0.6 * pulse);
      }
    } else this.acc = 0;
    // полёт
    const drag = Math.max(0, 1 - 0.6 * dt);
    for (let i = 0; i < this.n; ) {
      this.vy[i] -= S.gravity * dt;
      this.vx[i] *= drag;
      this.vy[i] *= drag;
      this.vz[i] *= drag;
      this.px[i] += this.vx[i] * dt;
      this.py[i] += this.vy[i] * dt;
      this.pz[i] += this.vz[i] * dt;
      this.age[i] += dt;
      let dead = this.age[i] > this.life[i];
      if (floorY !== undefined && this.py[i] <= floorY + this.rad[i]) {
        const sp = Math.hypot(this.vx[i], this.vy[i], this.vz[i]);
        this.addSplat(this.px[i], floorY + 0.0015, this.pz[i], this.rad[i] * (2.2 + sp * 0.9));
        dead = true;
      }
      if (dead) {
        const j = --this.n;
        this.px[i] = this.px[j];
        this.py[i] = this.py[j];
        this.pz[i] = this.pz[j];
        this.vx[i] = this.vx[j];
        this.vy[i] = this.vy[j];
        this.vz[i] = this.vz[j];
        this.age[i] = this.age[j];
        this.life[i] = this.life[j];
        this.rad[i] = this.rad[j];
      } else i++;
    }
    // кляксы: растут, живут splatS, тают
    for (let i = 0; i < this.sn; i++) this.sa[i] += dt;
    this.writeDrops();
    this.writeSplats();
  }

  /** Убрать всё (новая жертва, уход из биома). */
  clear() {
    this.n = 0;
    this.sn = 0;
    this.sHead = 0;
    this.acc = 0;
    this.writeDrops();
    this.writeSplats();
  }

  private addSplat(x: number, y: number, z: number, r: number) {
    const S = SPURT;
    // рядом уже есть — растёт она (лужа), иначе новая (по кругу)
    for (let i = 0; i < this.sn; i++) {
      if (Math.hypot(this.sx[i] - x, this.sz[i] - z) < this.sr[i] * 0.6) {
        this.sr[i] = Math.min(0.22, Math.hypot(this.sr[i], r * 0.5));
        this.sa[i] = Math.min(this.sa[i], 1);
        return;
      }
    }
    let i: number;
    if (this.sn < S.splats) i = this.sn++;
    else {
      i = this.sHead;
      this.sHead = (this.sHead + 1) % S.splats;
    }
    this.sx[i] = x;
    this.sy[i] = y;
    this.sz[i] = z;
    this.sr[i] = Math.min(0.06, r);
    this.sa[i] = 0;
    this.sRot[i] = this.rng.next() * TAU;
  }

  private writeDrops() {
    const b = this.dBuf;
    let n = 0;
    for (let i = 0; i < this.n; i++) {
      const vx = this.vx[i], vy = this.vy[i], vz = this.vz[i], sp = Math.hypot(vx, vy, vz);
      const fade = 1 - sstep(0.7, 1, this.age[i] / this.life[i]);
      const r = this.rad[i] * fade;
      if (r < 1e-4) continue;
      // ось Y капли — по скорости (вытянута), X и Z — поперёк
      let ux = 0, uy = 1, uz = 0;
      if (sp > 1e-4) {
        ux = vx / sp;
        uy = vy / sp;
        uz = vz / sp;
      }
      let ax = uy * 0 - uz * 1, ay = uz * 0 - ux * 0, az = ux * 1 - uy * 0;
      let al = Math.hypot(ax, ay, az);
      if (al < 1e-4) {
        ax = 1;
        ay = 0;
        az = 0;
        al = 1;
      }
      ax /= al;
      ay /= al;
      az /= al;
      const cx = uy * az - uz * ay, cy = uz * ax - ux * az, cz = ux * ay - uy * ax;
      const len = r + sp * 0.008;
      const o = n * 16;
      b[o] = ax * r; b[o + 1] = ay * r; b[o + 2] = az * r; b[o + 3] = 0;
      b[o + 4] = ux * len; b[o + 5] = uy * len; b[o + 6] = uz * len; b[o + 7] = 0;
      b[o + 8] = cx * r; b[o + 9] = cy * r; b[o + 10] = cz * r; b[o + 11] = 0;
      b[o + 12] = this.px[i]; b[o + 13] = this.py[i]; b[o + 14] = this.pz[i]; b[o + 15] = 1;
      n++;
    }
    if (n === 0) {
      b.fill(0, 0, 16);
      n = 1;
    }
    this.drop.thinInstanceBufferUpdated('matrix');
    this.drop.thinInstanceCount = n;
  }

  private writeSplats() {
    const b = this.sBuf, S = SPURT;
    let n = 0;
    for (let i = 0; i < this.sn; i++) {
      const a = this.sa[i];
      const grow = sstep(0, 0.35, a), fade = 1 - sstep(S.splatS, S.splatS + 3, a);
      const r = this.sr[i] * (0.4 + 0.6 * grow) * fade;
      if (r < 1e-4) continue;
      const c = Math.cos(this.sRot[i]), s = Math.sin(this.sRot[i]);
      const o = n * 16;
      b[o] = c * r; b[o + 1] = 0; b[o + 2] = s * r; b[o + 3] = 0;
      b[o + 4] = 0; b[o + 5] = r * 0.12; b[o + 6] = 0; b[o + 7] = 0;
      b[o + 8] = -s * r; b[o + 9] = 0; b[o + 10] = c * r; b[o + 11] = 0;
      b[o + 12] = this.sx[i]; b[o + 13] = this.sy[i]; b[o + 14] = this.sz[i]; b[o + 15] = 1;
      n++;
    }
    if (n === 0) {
      b.fill(0, 0, 16);
      n = 1;
    }
    this.splat.thinInstanceBufferUpdated('matrix');
    this.splat.thinInstanceCount = n;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const m of this.meshes) m.dispose(false, false);
    for (const m of this.mats) m.dispose(false, false);
  }
}
