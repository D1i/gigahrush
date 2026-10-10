// «Прогулка» в метро (биом «Метро», docs/LOCATIONS.md §18 «Метро: эскалаторы»): то, чего нет у обычных комнат.
// Механика — src/locations/metroEscalator.ts, картинка — ./metroScene.ts, звук — ./metroAudio.ts.
//
//  • Метро — комнаты с первым тегом «метро» (RunInstance.roomTags[0]). Пока игрок в метро: свет сцены холодный белый
//    (BiomeMood.light), свой туман к тёмному фону (бесконечный зал растворяется во тьме), звук метро.
//  • Эскалатор (тег «эскалатор», марши стиля 'escalator'): дорожка везёт — сдвиг камеры вдоль подъёма марша после её
//    хода (onAfterCheckInputs, как замедление рядом с напарником в src/coop/presence.ts); высоту держит опора марша
//    (src/view3d/stairWalk.ts). Скорость шага (cam.speed, posture.speedMul) не трогается — их пишут поза и бег.
//  • Срыв: при входе на целую дорожку — бросок (rideRoll); выпал — срыв начнётся на доле пути at. Стадии — по часам срыва
//    (stepCollapse): рывок (тряска, торшеры мигают, скрежет) → лента бежит вниз (несёт игрока; E — перелезть через
//    балюстраду на соседнюю целую дорожку) → обрыв: операция мира 'esc' (у всех навсегда), лента сползает в приямок;
//    игрок ещё на ленте — падение (escFallPose), затемнение, «Эскалатор сорвался», «Ещё раз» — в ближайшем зале или
//    вестибюле метро (кооп — у живого напарника). Донесло до низа — выбросило на нижнюю площадку, жив.
//  • Фоновый срыв: пока в кадре (≤ 30 м) целая дорожка — изредка (bgDue), только зрелище.
//  • Кооп: начало срыва — fx 'esc' {inst, lane}: у других та же анимация; кто стоит на этой дорожке — свой срыв. Операцию
//    'esc' в конце шлёт каждый, кто видел срыв (повтор — null: кто первый, тот и сорвал). Погиб — PlayerState.dead (страница
//    складывает флаг с общагой).
import type { Scene } from '@babylonjs/core/scene';
import type { UniversalCamera } from '@babylonjs/core/Cameras/universalCamera';
import type { Camera } from '@babylonjs/core/Cameras/camera';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { Observer } from '@babylonjs/core/Misc/observable';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { RunExport, RunInstance } from '../blockout/types';
import {
  bgDue, carryStep, climbTarget, collapseShake, createCollapse, createDice, ESC, escDeadAt, escFallPose, escLandAt, escLanes, isEscalator,
  isMetroRoom, isRespawnRoom, lampFlicker, laneAt, laneAxes, lanePoint, laneStep, metroRule, nearestRoom, noseZ, noteBreak, rideRoll,
  slideAt, stepCollapse, tickDice, type EscCollapse, type EscDice, type EscLane, type EscStage,
} from '../locations/metroEscalator';
import type { FoldDriver } from './fold';
import type { PortalRenderer } from './portal';
import type { Posture } from './posture';
import type { CoopSession } from '../coop/session';
import { COLD_TINT, METRO_FOG, METRO_LIGHT, MetroEscScene, type LaneView } from './metroScene';
import { MetroAudio } from './metroAudio';
import { isAbyss } from '../locations/fractalEntry'; // fractal

/** Ноги над линией носков (опора марша, src/view3d/stairWalk.ts), м; на ленте — ноги ближе к ней, м. */
const GAP = 0.06;
const ON_BELT = 0.5;
/** Выше дна приямка сорвавшейся дорожки больше чем на столько — падение, м. */
const PIT_FALL = 1.0;
/** Срыв не начался на доле пути (стоит на месте / идёт навстречу) — начнётся через столько секунд на ленте. */
const ARM_MAX_S = 14;
/** Выбросило внизу: толчок по инерции не быстрее, м/с; гаснет за ~0.4 с. */
const THROW_V = 4;
/** Срыв доиграл, а мир так и не сломал дорожку (кооп: операция потерялась) — забыть через столько секунд. */
const FORGET_S = 12;

export interface MetroHud {
  /** игрок в метро */
  on: boolean;
  /** «E — …» */
  prompt: string | null;
  /** срыв под ногами / рядом: стадия (тревога) */
  alarm: EscStage | null;
  /** чёрный экран 0…1 */
  black: number;
  /** погиб: панель «Ещё раз» */
  dead: boolean;
  /** подсказка (правило биома) */
  hint: string | null;
  /** звук метро включён */
  sound: boolean;
}

export interface MetroHost {
  rx(): RunExport | null;
  driver(): FoldDriver | null;
  /** можно ли сейчас управлять (нет спец-сцены поверх, от первого лица) */
  live(): boolean;
  /** операция мира 'esc' (кооп — у всех по порядку сервера): сорвал ли её этот запрос */
  breakEsc(inst: string, lane: number): Promise<boolean>;
  /** свет сцены поверх темноты биома (BiomeMood.light) */
  light(mul: number, tint: Color3 | null): void;
  flash(text: string, color: string, ms?: number): void;
  onHud(h: MetroHud): void;
  /** E занята другой подсказкой (дверь, напарник) */
  busy(): boolean;
  /** кооп: лобби (null — одиночная игра) */
  co: CoopSession | null;
}

interface Run {
  c: EscCollapse;
  /** начал этот игрок (разослал fx) */
  mine: boolean;
}

const smooth = (t: number) => {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
};

export class MetroWalk {
  /** игрок в метро */
  on = false;
  /** погиб (панель «Ещё раз») */
  dead = false;
  readonly audio = new MetroAudio();
  private readonly view3d: MetroEscScene;
  private dice: EscDice;
  /** срывы: «inst/lane» → срыв */
  private runs = new Map<string, Run>();
  /** выпал срыв: начнётся на доле пути at от места входа s0 (или через ARM_MAX_S) */
  private armed: { key: string; inst: string; lane: number; at: number; s0: number; t: number } | null = null;
  /** дорожка под ногами (на ленте) — «inst/lane» */
  private rideKey: string | null = null;
  private fall: { t: number; h: number; B: number; pitch0: number } | null = null;
  private climb: { t: number; from: Vector3; to: Vector3 } | null = null;
  private thrown: { vx: number; vz: number; t: number } | null = null;
  private nearClimb: { lane: EscLane; s: number } | null = null;
  private deadAt = 0;
  private shake = 0;
  private hudKey = '';
  private hint: { text: string; until: number } | null = null;
  private hinted = { enter: false, ride: false };
  private saved: { fog: number; fogStart: number; fogEnd: number; fogColor: Color3 } | null = null;
  private obs: Observer<Scene> | null;
  private camObs: Observer<Camera> | null;
  private extrasOf: PortalRenderer | null = null;
  private idx: { rx: RunExport | null; by: Map<string, RunInstance> } = { rx: null, by: new Map() };
  private lanesBy = new WeakMap<RunInstance, EscLane[]>();
  private cur: string | null = null;
  private camPrev: Vector3 | null = null;
  private speed = 0;
  private onKey = (e: KeyboardEvent) => this.key(e);
  private onGesture = () => {
    if (this.on && !this.frMuted) this.audio.start(); // fractal: на станции звук метро жестом не будить
  };
  private onFx = (from: string, k: string, d: unknown) => this.fx(from, k, d);

  constructor(
    private readonly scene: Scene,
    private readonly cam: UniversalCamera,
    private readonly host: MetroHost,
    private readonly seed: string,
    /** поза от первого лица (BlockoutViewer.posture) */
    readonly posture: Posture,
  ) {
    this.view3d = new MetroEscScene(scene);
    this.dice = createDice(`${seed}/metro/${host.co?.me.id ?? 'me'}`);
    // после ObshagaWalk: она каждый кадр обнуляет posture.roll — тряска метро пишется позже
    this.obs = scene.onBeforeRenderObservable.add(() => this.frame());
    this.camObs = cam.onAfterCheckInputsObservable.add(() => this.carry());
    window.addEventListener('keydown', this.onKey);
    window.addEventListener('keydown', this.onGesture);
    window.addEventListener('pointerdown', this.onGesture);
    host.co?.onFx.add(this.onFx);
  }

  // ───────────────────────── экземпляры и дорожки ─────────────────────────

  private instOf(rx: RunExport, id: string | null): RunInstance | null {
    if (!id) return null;
    if (this.idx.rx !== rx) this.idx = { rx, by: new Map(rx.instances.map((i) => [i.id, i])) };
    return this.idx.by.get(id) ?? null;
  }

  /** Дорожки эскалатора (пусто — не эскалатор); кэш по объекту экземпляра (новый — при пересборке). */
  private lanesOf(rx: RunExport, inst: RunInstance | null): EscLane[] {
    if (!inst || !isEscalator(inst)) return [];
    let l = this.lanesBy.get(inst);
    if (!l) this.lanesBy.set(inst, (l = escLanes(inst, rx.cellM, `${this.seed}/${inst.id}`)));
    return l;
  }

  private laneOf(rx: RunExport, inst: string, lane: number): EscLane | null {
    return this.lanesOf(rx, this.instOf(rx, inst)).find((l) => l.lane === lane) ?? null;
  }

  /** Вид дорожки для сцены: скорость ленты, сползание, торшеры. */
  private laneView(inst: string, lane: number): LaneView {
    const key = `${inst}/${lane}`;
    const r = this.runs.get(key);
    if (r) {
      const c = r.c;
      if (c.stage === 'fall') return { v: 0, slide: slideAt(c.t - ESC.shudderS - ESC.runawayS), lamps: lampFlicker(c.t, key) };
      if (c.stage === 'broken') return { v: 0, slide: 1, lamps: 0 };
      return { v: c.v, slide: null, lamps: lampFlicker(c.t, key) };
    }
    const rx = this.host.rx();
    const l = rx ? this.laneOf(rx, inst, lane) : null;
    return { v: !l || l.broken ? 0 : l.dir * ESC.speed, slide: null, lamps: l?.broken ? 0 : 1 };
  }

  // ───────────────────────── кадр ─────────────────────────

  private frame() {
    const dt = Math.min(0.1, this.scene.getEngine().getDeltaTime() / 1000 || 1 / 60);
    const rx = this.host.rx();
    const d = this.host.driver();
    if (!rx || !d) return;
    const live = this.host.live();
    const portal = d.portal?.isActive ? d.portal : null;
    this.ensureExtras(portal);
    const room = live ? (portal?.current ?? d.current.center) : null;
    this.cur = room;
    const inst = this.instOf(rx, room);
    // комната на миг не определилась (мир пересобирается) — не входить и не выходить
    if (!live || room) {
      const inMetro = !!inst && isMetroRoom(inst.roomTags);
      if (inMetro !== this.on) (inMetro ? this.enter() : this.leave());
    }
    if (this.on) tickDice(this.dice, dt);
    // ── срывы (все — и вне метро: доигрывают, операция мира уходит)
    this.stepRuns(dt, rx);
    // ── игрок
    const c = this.cam.position;
    const moved = this.camPrev ? Math.hypot(c.x - this.camPrev.x, c.z - this.camPrev.z) : 0;
    this.camPrev = c.clone();
    const sp = moved < 0.5 ? moved / dt : 0;
    this.speed += (sp - this.speed) * Math.min(1, dt * 6);
    const lanes = this.on ? this.lanesOf(rx, inst) : [];
    this.nearClimb = null;
    if (this.on && live) this.playerFrame(dt, rx, inst, lanes);
    else this.rideKey = null;
    // ── фоновый срыв
    if (this.on && live && !this.dead && portal) this.background(dt, rx, portal);
    // ── картинка
    const coll = new Set(portal?.colliding ?? []);
    this.view3d.update(dt, (i, l) => this.laneView(i, l), (i) => coll.has(i));
    // ── свет, туман
    let flick = 1;
    if (this.on) {
      for (const [k, r] of this.runs) if (r.c.inst === room && r.c.stage !== 'broken') flick = Math.min(flick, lampFlicker(r.c.t, k));
      this.fog();
      this.host.light(METRO_LIGHT * (0.7 + 0.3 * flick), COLD_TINT);
    }
    // ── тряска (после общаги: она обнуляет крен каждый кадр)
    this.shake = Math.max(0, this.shake - dt * 1.4);
    if (this.on && !this.dead && !this.fall && this.shake > 0) this.posture.roll = (Math.random() - 0.5) * 0.05 * this.shake;
    else if (this.on && !this.fall && this.posture.roll !== 0 && this.shakeWas) this.posture.roll = 0;
    this.shakeWas = this.shake > 0 || !!this.fall;
    // ── звук
    this.sound(dt, rx, inst, lanes);
    this.emitHud(room);
  }

  private shakeWas = false;

  private enter() {
    this.on = true;
    const s = this.scene;
    this.saved = { fog: s.fogMode, fogStart: s.fogStart, fogEnd: s.fogEnd, fogColor: s.fogColor.clone() };
    this.fog();
    if (!this.hinted.enter) {
      this.hinted.enter = true;
      this.hint = { text: `Метро. ${metroRule()}`, until: performance.now() + 8000 };
    }
  }

  private leave() {
    this.on = false;
    this.host.light(1, null);
    this.rideKey = null;
    this.armed = null;
    if (this.shakeWas) this.posture.roll = 0;
    this.shakeWas = false;
    const s = this.scene, sv = this.saved;
    if (!sv) return;
    s.fogMode = sv.fog;
    s.fogStart = sv.fogStart;
    s.fogEnd = sv.fogEnd;
    s.fogColor = sv.fogColor;
    this.saved = null;
  }

  /** Туман метро — к цвету фона (портал заливает им дальние проёмы); поменял его кто-то другой (страница: «туман» в
   *  панели) — это его новое «как было», метро — поверх. */
  private fog() {
    const s = this.scene, sv = this.saved;
    if (s.fogMode === 3 && s.fogEnd === METRO_FOG.end && s.fogStart === METRO_FOG.start) return;
    if (sv) {
      sv.fog = s.fogMode;
      sv.fogStart = s.fogStart;
      sv.fogEnd = s.fogEnd;
      sv.fogColor = s.fogColor.clone();
    }
    s.fogMode = 3; // LINEAR
    s.fogStart = METRO_FOG.start;
    s.fogEnd = METRO_FOG.end;
    const cc = s.clearColor;
    s.fogColor = new Color3(cc.r, cc.g, cc.b);
  }

  // ───────────────────────── игрок на эскалаторе ─────────────────────────

  private playerFrame(dt: number, rx: RunExport, inst: RunInstance | null, lanes: EscLane[]) {
    if (this.dead) {
      this.rideKey = null;
      return;
    }
    if (this.fall) {
      this.fallFrame(dt);
      return;
    }
    if (this.climb) {
      this.climbFrame(dt);
      return;
    }
    if (!inst || !lanes.length) {
      this.rideKey = null;
      this.armed = null;
      return;
    }
    const c = this.cam.position;
    const hit = laneAt(lanes, c.x, -c.z);
    const feet = c.y - this.posture.eye;
    // над приямком сорвавшейся дорожки (мир сломал её под ногами: операция пришла раньше fx) — падение
    if (hit && hit.lane.broken && hit.s > 0 && hit.s < hit.lane.len && feet > hit.lane.z0 + PIT_FALL) {
      this.startFall(inst);
      return;
    }
    const onBelt = !!hit && !hit.lane.broken && Math.abs(feet - noseZ(hit.lane, hit.s) - GAP) < ON_BELT;
    const key = onBelt ? `${inst.id}/${hit!.lane.lane}` : null;
    // ── вход на дорожку: бросок
    if (key !== this.rideKey) {
      this.rideKey = key;
      this.armed = null;
      if (key && !this.runs.has(key)) {
        // fractal: бездонный эскалатор не срывается и молчит — тьма говорит сама (src/locations/fractalEntry.ts)
        const abyss = isAbyss(inst.roomTags);
        const roll = abyss ? null : rideRoll(this.dice);
        if (roll) this.armed = { key, inst: inst.id, lane: hit!.lane.lane, at: roll.at, s0: hit!.s, t: 0 };
        if (!this.hinted.ride && hit!.lane.dir !== 0 && !abyss) {
          this.hinted.ride = true;
          this.hint = { text: 'Эскалатор везёт сам. Срывается редко — но срывается: дёрнулся — будь готов перелезть (E).', until: performance.now() + 6000 };
        }
      }
    }
    const A = this.armed;
    if (A && key === A.key && hit) {
      A.t += dt;
      if (Math.abs(hit.s - A.s0) / hit.lane.len >= A.at || A.t > ARM_MAX_S) {
        this.armed = null;
        this.start(A.inst, A.lane, true);
      }
    }
    // ── срыв под ногами
    const r = key ? this.runs.get(key) : null;
    if (r && hit) {
      this.shake = Math.max(this.shake, collapseShake(r.c.t));
      if (r.c.stage === 'fall' || r.c.stage === 'broken') {
        // у самого низа — не падение: сбросило на нижнюю площадку
        if (feet - hit.lane.z0 < 0.8) this.throwOff(hit.lane, 2);
        else this.startFall(inst);
        return;
      }
      const busy = (n: number) => this.runs.has(`${inst.id}/${n}`);
      const to = climbTarget(lanes, hit.lane, hit.s, hit.a, busy);
      if (to) this.nearClimb = { lane: to, s: hit.s };
    }
  }

  /** Сдвиг лентой — после хода камеры (до кадра): дорожка под ногами, ноги у линии носков. */
  private carry() {
    if (!this.on || this.dead || this.fall || this.climb || !this.host.live()) return;
    const dt = Math.min(0.1, this.scene.getEngine().getDeltaTime() / 1000 || 1 / 60);
    const c = this.cam.position;
    // выбросило внизу: толчок по инерции
    const th = this.thrown;
    if (th) {
      c.x += th.vx * dt;
      c.z += th.vz * dt;
      const k = Math.exp(-dt * 6);
      th.vx *= k;
      th.vz *= k;
      th.t += dt;
      if (th.t > 0.6) this.thrown = null;
      return;
    }
    const rx = this.host.rx();
    if (!rx) return;
    const inst = this.instOf(rx, this.cur);
    const lanes = this.lanesOf(rx, inst);
    if (!inst || !lanes.length) return;
    const hit = laneAt(lanes, c.x, -c.z);
    if (!hit || hit.lane.broken) return;
    const l = hit.lane;
    const feet = c.y - this.posture.eye;
    if (Math.abs(feet - noseZ(l, hit.s) - GAP) > ON_BELT) return;
    const r = this.runs.get(`${inst.id}/${l.lane}`);
    const v = r ? (r.c.stage === 'shudder' || r.c.stage === 'runaway' ? r.c.v : 0) : l.dir * ESC.speed;
    if (!v) return;
    const [dx, dy] = carryStep(l, v, dt);
    c.x += dx;
    c.z -= dy;
    const s2 = laneAxes(l, c.x, -c.z).s;
    if (r && v < 0) {
      const { t } = laneStep(l);
      if (s2 < -t) {
        // донесло до низа — выбросило на нижнюю площадку
        this.throwOff(l, -v);
        return;
      }
      // лента бежит быстрее, чем опора марша опускает (3 м/с), — ноги на линии носков сразу
      const target = noseZ(l, s2) + GAP;
      const cam = this.cam;
      const bottom = c.y - 2 * cam.ellipsoid.y + cam.ellipsoidOffset.y;
      if (bottom > target) c.y -= bottom - target;
    }
  }

  /** Выбросило на нижнюю площадку (лента донесла до низа / оборвалась у самого низа): толчок вниз по маршу, тряска. */
  private throwOff(l: EscLane, v: number) {
    const k = Math.min(THROW_V, Math.abs(v));
    const u = lanePoint(l, -1, 0), o = lanePoint(l, 0, 0);
    this.thrown = { vx: (u[0] - o[0]) * k, vz: -(u[1] - o[1]) * k, t: 0 };
    this.shake = Math.max(this.shake, 1.1);
    this.rideKey = null;
    this.armed = null;
    this.audio.thrown();
    this.host.flash('Выбросило внизу!', '#e8b04b', 1400);
  }

  // ───────────────────────── срыв ─────────────────────────

  /** Начать срыв дорожки (свой — разослать fx 'esc'). */
  private start(inst: string, lane: number, mine: boolean): boolean {
    const key = `${inst}/${lane}`;
    const rx = this.host.rx();
    const l = rx ? this.laneOf(rx, inst, lane) : null;
    if (!l || l.broken || this.runs.has(key)) return false;
    this.runs.set(key, { c: createCollapse(inst, lane, l.dir * ESC.speed), mine });
    noteBreak(this.dice);
    if (this.armed?.key === key) this.armed = null;
    const p = this.lanePos(l, l.len / 2);
    this.audio.shudder(p);
    if (mine && this.host.co && this.host.co.status === 'online') this.host.co.fx('esc', { inst, lane });
    return true;
  }

  private stepRuns(dt: number, rx: RunExport) {
    for (const [key, r] of this.runs) {
      const c = r.c;
      const l = this.laneOf(rx, c.inst, c.lane);
      for (const st of stepCollapse(c, dt)) {
        const p = l ? this.lanePos(l, l.len / 2) : null;
        if (st === 'runaway' && p) this.audio.snap(p);
        if (st === 'fall') {
          if (p) this.audio.crash(p);
          // обрыв — навсегда: операция мира (кооп — шлёт каждый, кто видел; повтор — null)
          void this.host.breakEsc(c.inst, c.lane);
        }
      }
      // мир сломал дорожку и анимация доиграла — срыв больше не нужен
      if (c.stage === 'broken' && (l?.broken || c.t > ESC.shudderS + ESC.runawayS + ESC.fallS + FORGET_S)) this.runs.delete(key);
    }
  }

  /** Фоновый срыв: в кадре целая дорожка ближе bgM — изредка срывается ближайшая (не под игроком). */
  private background(dt: number, rx: RunExport, portal: PortalRenderer) {
    const c = this.cam.position;
    let best: { inst: string; lane: number; d: number } | null = null;
    const rooms = new Set(portal.lastRooms);
    if (this.cur) rooms.add(this.cur);
    for (const id of rooms) {
      if (isAbyss(this.instOf(rx, id)?.roomTags)) continue; // fractal: бездна не срывается
      for (const l of this.lanesOf(rx, this.instOf(rx, id))) {
        if (l.broken || l.dir === 0 || this.runs.has(`${id}/${l.lane}`) || this.rideKey === `${id}/${l.lane}`) continue;
        const [mx, my] = lanePoint(l, l.len / 2, l.width / 2);
        const d = Math.hypot(mx - c.x, my + c.z);
        if (d <= ESC.bgM && (!best || d < best.d)) best = { inst: id, lane: l.lane, d };
      }
    }
    if (bgDue(this.dice, dt, !!best) && best) this.start(best.inst, best.lane, true);
  }

  // ───────────────────────── перелезть, падение, смерть ─────────────────────────

  private key(e: KeyboardEvent) {
    if (e.code !== 'KeyE' || e.repeat || !this.on || this.dead || this.fall || this.climb || !this.host.live() || this.host.busy()) return;
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
    const n = this.nearClimb;
    if (!n) return;
    const l = n.lane;
    const s = Math.min(l.len - ESC.climbEndM, Math.max(ESC.climbEndM, n.s));
    const [x, y] = lanePoint(l, s, l.width / 2);
    const c = this.cam.position;
    this.climb = { t: 0, from: c.clone(), to: new Vector3(x, noseZ(l, s) + GAP + this.posture.eye, -y) };
    this.posture.frozen = true;
    this.cam.checkCollisions = false;
    this.shake = Math.max(this.shake, 0.5);
    this.rideKey = null;
    this.armed = null;
  }

  private climbFrame(dt: number) {
    const cl = this.climb!;
    cl.t += dt;
    const k = smooth(cl.t / ESC.climbS);
    const c = this.cam.position;
    c.x = cl.from.x + (cl.to.x - cl.from.x) * k;
    c.z = cl.from.z + (cl.to.z - cl.from.z) * k;
    c.y = cl.from.y + (cl.to.y - cl.from.y) * k + 0.45 * Math.sin(Math.PI * Math.min(1, cl.t / ESC.climbS));
    this.cam.cameraDirection.setAll(0);
    if (cl.t >= ESC.climbS) {
      this.climb = null;
      this.posture.frozen = false;
      this.cam.checkCollisions = true;
      this.host.flash('Перелез!', '#9fd3ff', 1100);
    }
  }

  /** Лента оборвалась под ногами (или под ногами уже приямок): падение на дно. */
  private startFall(inst: RunInstance) {
    if (this.fall || this.dead) return;
    const B = Number(inst.z) || 0;
    const h = Math.max(0.4, this.cam.position.y - B);
    this.fall = { t: 0, h, B, pitch0: this.cam.rotation.x };
    this.posture.frozen = true;
    this.cam.checkCollisions = false;
    this.rideKey = null;
    this.armed = null;
    this.thrown = null;
  }

  private fallFrame(dt: number) {
    const f = this.fall!;
    f.t += dt;
    const p = escFallPose(f.t, f.h);
    const c = this.cam.position;
    c.y = f.B + p.y;
    this.cam.cameraDirection.setAll(0);
    // взгляд — от своего к позе падения за 0.3 с
    const k = smooth(f.t / 0.3);
    this.cam.rotation.x = f.pitch0 + (-p.pitch - f.pitch0) * k;
    this.posture.roll = p.roll + (Math.random() - 0.5) * 0.06 * p.shake;
    if (f.t >= escDeadAt(f.h)) this.die();
  }

  private die() {
    if (this.dead) return;
    this.dead = true;
    this.fall = null;
    this.deadAt = performance.now();
    this.posture.frozen = true;
    this.cam.checkCollisions = true;
    this.audio.death();
  }

  /** «Ещё раз»: в коопе — к живому напарнику, иначе в ближайшем зале или вестибюле метро (или на старте). */
  retry() {
    if (!this.dead) return;
    this.dead = false;
    this.fall = null;
    this.posture.frozen = false;
    this.posture.roll = 0;
    this.cam.checkCollisions = true;
    this.cam.rotation.x = 0.05;
    this.audio.reset();
    this.posture.set('stand');
    this.posture.finish();
    this.respawn();
  }

  private respawn() {
    const d = this.host.driver();
    const rx = this.host.rx();
    if (!d || !rx) return;
    const co = this.host.co;
    if (co) {
      for (const pl of co.players.values()) {
        const s = pl.state;
        if (!s || s.dead || s.loc || !s.room || !s.fps || !this.instOf(rx, s.room)) continue;
        d.goTo(s.room);
        this.cam.position.set(s.p[0], s.p[1] - (s.eye ?? 1.6) + this.posture.eye + 0.05, s.p[2]);
        this.cam.rotation.set(0.05, s.yaw, 0);
        this.cam.cameraDirection.setAll(0);
        return;
      }
    }
    const hall = this.cur ? nearestRoom(rx.links, this.cur, (id) => isRespawnRoom(this.instOf(rx, id)?.roomTags)) : null;
    if (hall) d.goTo(hall);
    else d.toStart();
  }

  // ───────────────────────── кооп ─────────────────────────

  private fx(_from: string, k: string, d: unknown) {
    if (k !== 'esc') return;
    const o = d as { inst?: unknown; lane?: unknown } | null;
    if (!o || typeof o.inst !== 'string' || o.inst.length > 80 || typeof o.lane !== 'number' || !Number.isInteger(o.lane)) return;
    this.start(o.inst, o.lane, false);
  }

  // ───────────────────────── меши в портальном рендере ─────────────────────────

  private extrasFn = (room: string): readonly Mesh[] | undefined => {
    const rx = this.host.rx();
    if (!rx) return undefined;
    const inst = this.instOf(rx, room);
    const lanes = this.lanesOf(rx, inst);
    return lanes.length ? this.view3d.meshes(inst!, lanes, rx.cellM) : undefined;
  };

  private ensureExtras(portal: PortalRenderer | null) {
    if (portal === this.extrasOf) return;
    this.extrasOf?.extraProviders.delete(this.extrasFn);
    this.extrasOf = portal;
    portal?.extraProviders.add(this.extrasFn);
  }

  // ───────────────────────── звук, HUD ─────────────────────────

  private lanePos(l: EscLane, s: number): { x: number; y: number; z: number } {
    const [x, y] = lanePoint(l, s, l.width / 2);
    return { x, y: noseZ(l, s) + 0.6, z: -y };
  }

  private sound(dt: number, rx: RunExport, inst: RunInstance | null, lanes: EscLane[]) {
    const c = this.cam.position;
    let esc: { x: number; y: number; z: number; k: number } | null = null;
    let runaway: { x: number; y: number; z: number; v: number } | null = null;
    if (this.on) {
      // ближайшая работающая дорожка — гул (точка ленты напротив игрока)
      let bd = Infinity;
      for (const l of lanes) {
        if (l.broken || this.runs.has(`${inst!.id}/${l.lane}`)) continue;
        const { s } = laneAxes(l, c.x, -c.z);
        const ss = Math.min(l.len, Math.max(0, s));
        const p = this.lanePos(l, ss);
        const d = Math.hypot(p.x - c.x, p.y - c.y, p.z - c.z);
        if (d < bd) (bd = d), (esc = { ...p, k: Math.max(0, 1 - d / 22) });
      }
      let rd = Infinity;
      for (const r of this.runs.values()) {
        if (r.c.stage !== 'shudder' && r.c.stage !== 'runaway') continue;
        const l = this.laneOf(rx, r.c.inst, r.c.lane);
        if (!l) continue;
        const { s } = laneAxes(l, c.x, -c.z);
        const p = this.lanePos(l, Math.min(l.len, Math.max(0, s)));
        const d = Math.hypot(p.x - c.x, p.z - c.z);
        if (d < rd && d < 40) (rd = d), (runaway = { ...p, v: r.c.v });
      }
    }
    this.audio.update(dt, {
      inBiome: this.on && !this.frMuted, // fractal: на станции метро молчит
      moving: this.speed > 0.3,
      speed: this.speed,
      esc,
      onBelt: !!this.rideKey,
      runaway,
      listener: { x: c.x, y: c.y, z: c.z, yaw: this.cam.rotation.y },
      dead: this.dead,
    });
  }

  private alarm(room: string | null): EscStage | null {
    if (!this.on) return null;
    const mine = this.rideKey ? this.runs.get(this.rideKey) : null;
    if (mine) return mine.c.stage;
    for (const r of this.runs.values()) if (r.c.inst === room && r.c.stage !== 'broken') return r.c.stage;
    return null;
  }

  private emitHud(room: string | null) {
    const now = performance.now();
    if (this.hint && now > this.hint.until) this.hint = null;
    let black = this.dead ? Math.min(1, (now - this.deadAt) / 350) : 0;
    if (this.fall) black = Math.max(black, Math.min(1, Math.max(0, (this.fall.t - escLandAt(this.fall.h) + 0.15) / 0.35)));
    const h: MetroHud = {
      on: this.on,
      prompt: this.on && !this.dead && !this.fall && !this.climb && this.nearClimb ? 'E — перелезть через балюстраду' : null,
      alarm: this.alarm(room),
      black: Math.round(black * 20) / 20,
      dead: this.dead && black >= 1,
      hint: this.on ? (this.hint?.text ?? null) : null,
      sound: this.audio.enabled,
    };
    const k = JSON.stringify(h);
    if (k === this.hudKey) return;
    this.hudKey = k;
    this.host.onHud(h);
  }

  /** Звук метро вкл/выкл (кнопка HUD). */
  setSound(on: boolean) {
    this.audio.setEnabled(on);
    if (on && !this.frMuted) this.audio.start(); // fractal: на станции — не будить
    this.hudKey = '';
  }

  // ── fractal: «Фрактальная станция» (src/view3d/FractalLayer.tsx) — своя сцена поверх прогулки, кадр прогулки стоит, и
  // MetroAudio застывал на последнем кадре (гул ламп, «поршень», гул ленты бездны). На время станции звук метро гаснет
  // (fade 0.5 с) и его контекст засыпает; по выходу — просыпается, фон возвращает ближайший кадр прогулки (update
  // inBiome). Настройку «звук метро» (localStorage) не трогает.
  private frMuted = false;
  private frMuteT: ReturnType<typeof setTimeout> | null = null;
  /** fractal: заглушить звук метро (true) / вернуть (false). */
  muteSound(on: boolean) {
    if (on === this.frMuted) return;
    this.frMuted = on;
    if (this.frMuteT) clearTimeout(this.frMuteT);
    this.frMuteT = null;
    const a = this.audio;
    if (on) {
      const c = this.cam.position;
      const listener = { x: c.x, y: c.y, z: c.z, yaw: this.cam.rotation.y };
      a.update(0, { inBiome: false, moving: false, speed: 0, esc: null, onBelt: false, runaway: null, listener, dead: false });
      this.frMuteT = setTimeout(() => {
        this.frMuteT = null;
        if (this.frMuted && a.ctx?.state === 'running') void a.ctx.suspend().catch(() => {});
      }, 1500);
    } else if (a.ctx && a.enabled) a.start();
  }
  /** fractal: звук метро заглушён на время станции (QA) */
  get soundMuted(): boolean {
    return this.frMuted;
  }

  // ───────────────────────── QA ─────────────────────────

  /** Хуки для браузерных проверок (window.__rfMetro). */
  qa() {
    const self = this;
    const here = () => {
      const rx = self.host.rx();
      const inst = rx ? self.instOf(rx, self.cur) : null;
      return { rx, inst, lanes: rx ? self.lanesOf(rx, inst) : [] };
    };
    return {
      /** сорвать дорожку lane эскалатора под ногами (нет — под игроком, иначе первую целую); ключ «inst/lane» или null */
      forceCollapse(lane?: number): string | null {
        const { inst, lanes } = here();
        if (!inst || !lanes.length) return null;
        const c = self.cam.position;
        const n = lane ?? laneAt(lanes, c.x, -c.z)?.lane.lane ?? lanes.find((l) => !l.broken)?.lane;
        if (n === undefined) return null;
        return self.start(inst.id, n, true) ? `${inst.id}/${n}` : null;
      },
      /** дорожки комнаты игрока: номер, направление, сломана, срывается (стадия), геометрия */
      lanes() {
        const { inst, lanes } = here();
        return lanes.map((l) => ({ ...l, stage: inst ? (self.runs.get(`${inst.id}/${l.lane}`)?.c.stage ?? null) : null }));
      },
      state() {
        const { inst, lanes } = here();
        const c = self.cam.position;
        const hit = lanes.length ? laneAt(lanes, c.x, -c.z) : null;
        return {
          on: self.on, dead: self.dead, falling: !!self.fall, climbing: !!self.climb, thrown: !!self.thrown, room: self.cur,
          escalator: !!inst && isEscalator(inst), ride: self.rideKey, armed: self.armed ? { ...self.armed } : null,
          lane: hit ? { lane: hit.lane.lane, s: hit.s, a: hit.a, nose: noseZ(hit.lane, hit.s), feet: c.y - self.posture.eye } : null,
          runs: [...self.runs.entries()].map(([k, r]) => ({ key: k, stage: r.c.stage, t: r.c.t, v: r.c.v, belt: r.c.belt, mine: r.mine })),
          dice: { ...self.dice }, climb: self.nearClimb ? self.nearClimb.lane.lane : null, alarm: self.alarm(self.cur), sound: self.audio.counters,
          muted: self.frMuted, audio: self.audio.ctx?.state ?? null, // fractal: звук на время станции
        };
      },
      /** QA: снять первые 60 с и паузу (бросок — как обычно) */
      noGrace() {
        self.dice.t = Math.max(self.dice.t, ESC.graceS + ESC.pauseS + 1);
        self.dice.last = -Infinity;
        self.dice.rides = Math.max(self.dice.rides, 1);
      },
      retry() {
        self.retry();
      },
    };
  }

  dispose() {
    if (this.frMuteT) clearTimeout(this.frMuteT); // fractal
    if (this.on) this.leave();
    if (this.obs) this.scene.onBeforeRenderObservable.remove(this.obs);
    if (this.camObs) this.cam.onAfterCheckInputsObservable.remove(this.camObs);
    this.obs = this.camObs = null;
    if (this.fall || this.climb || this.dead) {
      this.posture.frozen = false;
      this.posture.roll = 0;
      this.cam.checkCollisions = true;
    }
    this.fall = this.climb = null;
    this.extrasOf?.extraProviders.delete(this.extrasFn);
    this.extrasOf = null;
    window.removeEventListener('keydown', this.onKey);
    window.removeEventListener('keydown', this.onGesture);
    window.removeEventListener('pointerdown', this.onGesture);
    this.host.co?.onFx.delete(this.onFx);
    this.audio.dispose();
    this.view3d.dispose();
  }
}
