// Кооп «Прогулки» (docs/COOP.md): другие игроки в сцене и своё положение для них.
//
//  • Аватар — капсула цвета игрока, голова с тёмным «визором» (куда смотрит) и табличка с именем над головой. Положение —
//    комната (её ведёт портальный рендер) + камера; между сообщениями — плавно (экспонента), скачок (шов хода, лифт,
//    телепорт) — сразу.
//  • Портальный рендер (src/view3d/portal.ts): аватар рисуется вместе со своей комнатой — в её области стенсила, с её
//    отсечением (PortalRenderer.extras), — поэтому виден ровно там, где видна его комната: сквозь проёмы, но не сквозь
//    стены и не в комнатах других слоёв W, стоящих в 3D там же. У самого проёма (ближе NEAR_PORTAL_M) — ещё и с
//    соседом за ним: половина тела, вышедшая за плоскость проёма, не обрезается. Набор (PVS) — обычные меши, пока
//    комната аватара в наборе; облёт — не видны.
//  • Сквозь друг друга проходят (коллизий нет), но рядом (ближе SLOW_RADIUS_M, в той же комнате или у общего проёма)
//    оба идут на 75% медленнее: сдвиг камеры за кадр урезается до SLOW_FACTOR (после ввода и коллизий).
//  • Своё положение — серверу ~15 раз в секунду (только когда изменилось; иначе раз в секунду) — по таймеру, не по кадрам
//    сцены: в спец-локации (лифт, лестница) рисуется её сцена, а другим надо узнать «он в локации». С ним — высота глаз:
//    в снежных лазах игрок ползёт (аватар лежит), в берлоге — скрючен (аватар ниже); и «засыпан обвалом».
//  • Засыпанный напарник рядом (ближе DIG_RADIUS_M) — nearBuried: страница показывает «E — откапывать» и шлёт ему
//    действие dig (CoopSession.act); у него — SnowWalk.mateDig.
//  • Общага (src/view3d/obshagaWalk.ts): держит лампу — у аватара в руке керосиновая лампа (свет у неё ставит общага);
//    погиб — аватар не виден. Свои флаги — PlayerState.lamp / dead (геттеры flags).
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
import { CreateCapsule } from '@babylonjs/core/Meshes/Builders/capsuleBuilder';
import { CreateSphere } from '@babylonjs/core/Meshes/Builders/sphereBuilder';
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder';
import { CreatePlane } from '@babylonjs/core/Meshes/Builders/planeBuilder';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { Observer } from '@babylonjs/core/Misc/observable';
import type { Scene } from '@babylonjs/core/scene';
import type { Camera } from '@babylonjs/core/Cameras/camera';
import { PORTAL_LAYER } from '../view3d/portal';
import type { BlockoutViewer } from '../view3d/viewer';
import type { FoldDriver } from '../view3d/fold';
import type { RunExport } from '../blockout/types';
import type { PlayerInfo, PlayerState } from './protocol';
import type { CoopSession } from './session';

/** Рядом с другим игроком скорость — столько от обычной (замедление на 75%). */
export const SLOW_FACTOR = 0.25;
/** «Рядом»: по горизонтали ближе, м (капсулы игроков — 0.3 м радиусом, перекрылись — уже рядом). */
export const SLOW_RADIUS_M = 0.75;
/** …и по высоте (ног) ближе, м (лестница, другой этаж в том же месте 3D — не рядом). */
const SLOW_DY_M = 1.2;
/** Засыпанного напарника можно откапывать ближе этого, м (по горизонтали). */
export const DIG_RADIUS_M = 1.6;
/** Ниже этого (глаза над полом, м) — ползком: аватар лежит. */
const CRAWL_EYE = 0.8;
/** Аватар ближе этого к проёму своей комнаты рисуется и с соседом за проёмом, м. */
const NEAR_PORTAL_M = 0.8;
/** Скачок дальше этого — без сглаживания, м. */
const SNAP_M = 3;
/** Глаза над полом, м (как у камеры просмотрщика). */
const EYE = 1.6;
/** Сдвиг камеры за кадр больше этого — телепорт (переход, шов, лифт), не замедляется, м. */
const TELEPORT_M = 0.5;
const SEND_MS = 66;
const HEARTBEAT_MS = 1000;
/** обычный слой камер (всё, кроме PORTAL_LAYER) */
const SCENE_LAYER = 0x0fffffff;

interface Avatar {
  id: string;
  name: string;
  color: string;
  body: Mesh;
  head: Mesh;
  visor: Mesh;
  label: Mesh;
  /** керосиновая лампа в руке (общага) — клон модели p_obsh_lantern, создаётся, когда понадобилась */
  lamp: Mesh | null;
  meshes: Mesh[];
  mats: StandardMaterial[];
  tex: DynamicTexture;
  room: string | null;
  /** показанное положение глаз, их высота над полом и поворот */
  x: number;
  y: number;
  z: number;
  eye: number;
  yaw: number;
  has: boolean;
  visible: boolean;
}

/** Расстояние (план) от точки до прямоугольника. */
function rectDist(r: { x0: number; y0: number; x1: number; y1: number }, x: number, y: number): number {
  return Math.hypot(Math.max(0, r.x0 - x, x - r.x1), Math.max(0, r.y0 - y, y - r.y1));
}

const angleLerp = (a: number, b: number, k: number): number => {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * k;
};

export class CoopPresence {
  private readonly scene: Scene;
  private readonly avatars = new Map<string, Avatar>();
  private byRoom = new Map<string, Mesh[]>();
  private obs: Observer<Scene> | null;
  private camObs: Observer<Camera> | null;
  private sendTimer: ReturnType<typeof setInterval> | null;
  private prev: Vector3 | null = null;
  /** свой игрок сейчас рядом с другим — идёт медленнее */
  slowed = false;
  /** засыпанный обвалом напарник рядом — его можно откапывать (E) */
  nearBuried: { id: string; name: string } | null = null;
  private last = performance.now();
  private sentAt = 0;
  private sent: PlayerState | null = null;
  private nbCache: { rx: RunExport; room: string; set: Set<string> } | null = null;
  private visCache: { rx: RunExport; room: string; set: Set<string> } | null = null;
  private rooms = new WeakMap<RunExport, Set<string>>();
  private disposed = false;

  constructor(
    private readonly v: BlockoutViewer,
    private readonly co: CoopSession,
    private readonly driver: () => FoldDriver | null,
    /** вид спец-локации, в сцене которой игрок (null — в мире) */
    private readonly inLoc: () => string | null,
    /** свой игрок засыпан обвалом (снежные ходы) */
    private readonly buried: () => boolean = () => false,
    /** общага: свой игрок держит лампу / погиб (PlayerState.lamp / dead) */
    private readonly flags: { lamp?: () => boolean; dead?: () => boolean } = {},
  ) {
    this.scene = v.scene;
    this.obs = this.scene.onBeforeRenderObservable.add(() => this.update());
    this.camObs = v.fps.onAfterCheckInputsObservable.add(() => this.slowStep());
    this.sendTimer = setInterval(() => this.sendState(performance.now()), SEND_MS);
  }

  /** Комната своего игрока (её ведёт портальный рендер; в наборе PVS — центр набора). */
  private myRoom(): string | null {
    const d = this.driver();
    if (!d) return null;
    return d.portal?.isActive ? d.portal.current : d.current.center;
  }

  // ───────────────────────── кадр ─────────────────────────

  private update() {
    if (this.disposed) return;
    const t = performance.now();
    const dt = Math.min(0.25, (t - this.last) / 1000);
    this.last = t;
    this.syncAvatars();
    const d = this.driver();
    const v = this.v;
    const portal = d?.portal?.isActive ? d.portal : null;
    if (portal && portal.extras !== this.extras) portal.extras = this.extras;
    const fps = v.mode === 'fps' && !v.hasOverlay;
    const me = this.myRoom();
    const rx = d?.run ?? null;
    const near = me && rx ? this.neighbors(rx, me) : null;
    const vis = fps && !portal && d && rx && me ? this.visibleSet(d, rx, me) : null;
    const cam = v.fps.position;
    const k = 1 - Math.exp(-dt * 12);
    this.byRoom = new Map();
    let slow = false;
    let dig: { id: string; name: string; d: number } | null = null;
    const myFeet = cam.y - eyeOf(v.fps);
    for (const a of this.avatars.values()) {
      const s = this.co.players.get(a.id)?.state ?? null;
      a.visible = false;
      const room = s?.room ?? null;
      // в спец-локации (своя сцена), погиб или в комнате, которой в копии мира ещё нет, — не виден
      if (!s || s.loc || s.dead || !room || (rx && !this.hasRoom(rx, room))) {
        for (const m of a.meshes) m.setEnabled(false);
        a.lamp?.setEnabled(false);
        continue;
      }
      // плавно к последнему положению; скачок — сразу
      const [tx, ty, tz] = s.p;
      const te = s.eye ?? EYE;
      if (!a.has || Math.hypot(tx - a.x, ty - a.y, tz - a.z) > SNAP_M) {
        a.x = tx;
        a.y = ty;
        a.z = tz;
        a.eye = te;
        a.yaw = s.yaw;
        a.has = true;
      } else {
        a.x += (tx - a.x) * k;
        a.y += (ty - a.y) * k;
        a.z += (tz - a.z) * k;
        a.eye += (te - a.eye) * k;
        a.yaw = angleLerp(a.yaw, s.yaw, k);
      }
      a.room = room;
      this.pose(a, cam);
      const lamp = this.lampOf(a, !!s.lamp && fps);
      // рядом ли (та же комната или сосед через общий проём, не шов хода; по высоте — ноги)
      const here = fps && !!me && (room === me || !!near?.has(room)) && Math.abs(a.y - a.eye - myFeet) < SLOW_DY_M;
      const dist = Math.hypot(a.x - cam.x, a.z - cam.z);
      if (here && dist < SLOW_RADIUS_M) slow = true;
      if (here && s.buried && dist < DIG_RADIUS_M && (!dig || dist < dig.d)) dig = { id: a.id, name: a.name, d: dist };
      if (!fps) {
        for (const m of a.meshes) m.setEnabled(false);
        continue;
      }
      if (portal) {
        for (const m of a.meshes) {
          m.setEnabled(true);
          m.layerMask = PORTAL_LAYER;
        }
        this.addTo(room, a);
        if (lamp) {
          lamp.layerMask = PORTAL_LAYER;
          this.byRoom.get(room)!.push(lamp);
        }
        // у проёма — и с соседом за ним (тело, вышедшее за плоскость проёма, не обрезается)
        const piece = portal.cache.peek(room);
        for (const q of piece?.portals ?? []) {
          if (q.shiftB || q.to === room) continue;
          if (rectDist(q.rect, a.x, -a.z) < NEAR_PORTAL_M) this.addTo(q.to, a);
        }
        a.visible = true;
      } else {
        const on = !!vis?.has(room);
        for (const m of a.meshes) {
          m.setEnabled(on);
          m.layerMask = SCENE_LAYER;
        }
        a.visible = on;
        if (lamp) {
          lamp.layerMask = SCENE_LAYER;
          lamp.setEnabled(on);
        }
      }
    }
    this.slowed = slow;
    this.nearBuried = dig && !this.buried() ? { id: dig.id, name: dig.name } : null;
  }

  private hasRoom(rx: RunExport, id: string): boolean {
    let set = this.rooms.get(rx);
    if (!set) this.rooms.set(rx, (set = new Set(rx.instances.map((i) => i.id))));
    return set.has(id);
  }

  private readonly extras = (room: string): readonly Mesh[] | undefined => this.byRoom.get(room);

  private addTo(room: string, a: Avatar) {
    let l = this.byRoom.get(room);
    if (!l) this.byRoom.set(room, (l = []));
    if (!l.includes(a.body)) l.push(...a.meshes);
  }

  /** Аватар в позу: ноги на полу (глаза — eye над ним), визор — по взгляду, табличка — лицом к камере. Ползком —
   *  лежит вдоль взгляда, голова впереди; скрючившись — ниже (капсула сжата по высоте). */
  private pose(a: Avatar, cam: Vector3) {
    const feet = a.y - a.eye;
    const fx = Math.sin(a.yaw), fz = Math.cos(a.yaw);
    let headY: number;
    if (a.eye < CRAWL_EYE) {
      // лёжа: капсула 1.44 м вдоль взгляда, голова — у переднего конца
      a.body.scaling.y = 1;
      a.body.rotation.set(Math.PI / 2, a.yaw, 0);
      a.body.position.set(a.x - fx * 0.35, feet + 0.25, a.z - fz * 0.35);
      headY = feet + 0.3;
      a.head.position.set(a.x + fx * 0.45, headY, a.z + fz * 0.45);
      a.visor.position.set(a.x + fx * 0.58, headY + 0.03, a.z + fz * 0.58);
    } else {
      const k = Math.min(1.2, a.eye / EYE);
      a.body.scaling.y = k;
      a.body.rotation.set(0, a.yaw, 0);
      a.body.position.set(a.x, feet + 0.72 * k, a.z);
      headY = feet + Math.max(0.3, a.eye - 0.1);
      a.head.position.set(a.x, headY, a.z);
      a.visor.position.set(a.x + fx * 0.13, headY + 0.03, a.z + fz * 0.13);
    }
    a.visor.rotation.y = a.yaw;
    a.label.position.set(a.x, headY + 0.45, a.z);
    // лицевая сторона плоскости — −Z: развернуть её к камере
    a.label.rotation.y = Math.atan2(-(cam.x - a.x), -(cam.z - a.z));
    for (const m of a.meshes) m.computeWorldMatrix(true);
  }

  /** Лампа в руке аватара (общага): справа у бедра, по взгляду; null — не держит (или модели ещё нет). */
  private lampOf(a: Avatar, on: boolean): Mesh | null {
    if (!on) {
      a.lamp?.setEnabled(false);
      return null;
    }
    if (!a.lamp) {
      const tpl = this.v.props.get('p_obsh_lantern');
      const m = tpl?.clone(`coop:lamp:${a.id}`, null, false) ?? null;
      if (!m) return null;
      m.isPickable = false;
      m.checkCollisions = false;
      m.metadata = { coop: a.id };
      a.lamp = m;
    }
    const m = a.lamp;
    const feet = a.y - a.eye;
    const fx = Math.sin(a.yaw), fz = Math.cos(a.yaw);
    // правая рука: вправо от взгляда (Babylon: (cos yaw, −sin yaw)) и чуть вперёд; лёжа — у головы
    const low = a.eye < CRAWL_EYE;
    const side = low ? 0.2 : 0.3, fwd = low ? 0.55 : 0.22;
    m.position.set(a.x + fz * side + fx * fwd, feet + (low ? 0.02 : 0.55), a.z - fx * side + fz * fwd);
    m.rotation.y = a.yaw;
    m.setEnabled(true);
    m.isVisible = true;
    m.computeWorldMatrix(true);
    return m;
  }

  /** Соседи комнаты через проёмы (без швов бесконечного хода — там сосед на своём месте, не рядом). */
  private neighbors(rx: RunExport, room: string): Set<string> {
    if (this.nbCache?.rx === rx && this.nbCache.room === room) return this.nbCache.set;
    const set = new Set<string>();
    for (const l of rx.links) {
      if (l.wrap) continue;
      if (l.a.inst === room) set.add(l.b.inst);
      else if (l.b.inst === room) set.add(l.a.inst);
    }
    this.nbCache = { rx, room, set };
    return set;
  }

  private visibleSet(d: FoldDriver, rx: RunExport, room: string): Set<string> {
    if (this.visCache?.rx === rx && this.visCache.room === room) return this.visCache.set;
    const set = d.setOf(room);
    this.visCache = { rx, room, set };
    return set;
  }

  // ───────────────────────── замедление ─────────────────────────

  /** После ввода и коллизий камеры: рядом с другим игроком — сдвиг за кадр урезается до SLOW_FACTOR. */
  private slowStep() {
    const c = this.v.fps.position;
    const p = this.prev;
    if (p && this.slowed && this.v.mode === 'fps' && !this.v.hasOverlay) {
      const dx = c.x - p.x, dz = c.z - p.z;
      // телепорт (переход, шов, лифт) — не трогать
      if (dx * dx + dz * dz < TELEPORT_M * TELEPORT_M) {
        c.x = p.x + dx * SLOW_FACTOR;
        c.z = p.z + dz * SLOW_FACTOR;
      }
    }
    if (p) p.copyFrom(c);
    else this.prev = c.clone();
  }

  // ───────────────────────── своё положение ─────────────────────────

  private sendState(t: number) {
    if (this.disposed) return;
    const c = this.v.fps;
    const s: PlayerState = {
      room: this.myRoom(),
      p: [round(c.position.x), round(c.position.y), round(c.position.z)],
      yaw: round(c.rotation.y),
      pitch: round(c.rotation.x),
      loc: this.inLoc(),
      fps: this.v.mode === 'fps',
    };
    // глаза не на 1.6 (снежные лазы) и «засыпан» — только когда есть (сообщение короче)
    const eye = round(eyeOf(c));
    if (Math.abs(eye - EYE) > 0.01) s.eye = eye;
    if (this.buried()) s.buried = true;
    if (this.flags.lamp?.()) s.lamp = 1;
    if (this.flags.dead?.()) s.dead = 1;
    const o = this.sent;
    const same =
      o && o.room === s.room && o.loc === s.loc && o.fps === s.fps && o.eye === s.eye && o.buried === s.buried && o.lamp === s.lamp && o.dead === s.dead &&
      Math.abs(o.p[0] - s.p[0]) < 0.01 && Math.abs(o.p[1] - s.p[1]) < 0.01 && Math.abs(o.p[2] - s.p[2]) < 0.01 && Math.abs(o.yaw - s.yaw) < 0.01;
    if (same && t - this.sentAt < HEARTBEAT_MS) return;
    this.co.sendState(s);
    this.sent = s;
    this.sentAt = t;
  }

  // ───────────────────────── аватары ─────────────────────────

  private syncAvatars() {
    const players = this.co.players;
    for (const [id, a] of this.avatars) {
      const p = players.get(id);
      if (!p || p.name !== a.name || p.color !== a.color) {
        this.drop(a);
        this.avatars.delete(id);
      }
    }
    for (const p of players.values()) if (!this.avatars.has(p.id)) this.avatars.set(p.id, this.make(p));
  }

  private make(p: PlayerInfo): Avatar {
    const sc = this.scene;
    const col = Color3.FromHexString(/^#[0-9a-f]{6}$/i.test(p.color) ? p.color : '#e8b04b');
    const mat = (name: string, c: Color3, emissive: number) => {
      const m = new StandardMaterial(`coop:${name}:${p.id}`, sc);
      m.diffuseColor = c;
      m.specularColor = new Color3(0.08, 0.08, 0.08);
      // немного свечения: в тёмных биомах игрока видно
      m.emissiveColor = c.scale(emissive);
      return m;
    };
    const mBody = mat('body', col, 0.35);
    const mHead = mat('head', Color3.Lerp(col, Color3.White(), 0.35), 0.35);
    const mVisor = mat('visor', new Color3(0.06, 0.07, 0.08), 0);
    const body = CreateCapsule(`coop:body:${p.id}`, { height: 1.44, radius: 0.24, tessellation: 14, subdivisions: 2 }, sc);
    body.material = mBody;
    const head = CreateSphere(`coop:head:${p.id}`, { diameter: 0.3, segments: 10 }, sc);
    head.material = mHead;
    const visor = CreateBox(`coop:visor:${p.id}`, { width: 0.22, height: 0.07, depth: 0.06 }, sc);
    visor.material = mVisor;
    // табличка с именем
    const tex = new DynamicTexture(`coop:name:${p.id}`, { width: 512, height: 128 }, sc, true);
    const ctx = tex.getContext() as unknown as CanvasRenderingContext2D;
    ctx.fillStyle = '#121316';
    ctx.fillRect(0, 0, 512, 128);
    ctx.fillStyle = p.color;
    ctx.fillRect(0, 118, 512, 10);
    ctx.font = 'bold 64px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#f2f2f2';
    ctx.fillText(p.name.length > 16 ? p.name.slice(0, 15) + '…' : p.name, 256, 60, 496);
    tex.update();
    const mLabel = new StandardMaterial(`coop:label:${p.id}`, sc);
    mLabel.diffuseColor = Color3.Black();
    mLabel.specularColor = Color3.Black();
    mLabel.emissiveTexture = tex;
    mLabel.disableLighting = true;
    mLabel.backFaceCulling = false;
    const label = CreatePlane(`coop:labelPlane:${p.id}`, { width: 0.8, height: 0.2 }, sc);
    label.material = mLabel;
    const meshes = [body, head, visor, label];
    for (const m of meshes) {
      m.isPickable = false;
      m.checkCollisions = false;
      m.layerMask = PORTAL_LAYER;
      m.setEnabled(false);
      m.metadata = { coop: p.id };
    }
    return { id: p.id, name: p.name, color: p.color, body, head, visor, label, meshes, mats: [mBody, mHead, mVisor, mLabel], tex, lamp: null, room: null, x: 0, y: 0, z: 0, eye: EYE, yaw: 0, has: false, visible: false };
  }

  private drop(a: Avatar) {
    for (const m of a.meshes) m.dispose(false, false);
    a.lamp?.dispose(false, false);
    for (const m of a.mats) m.dispose(false, false);
    a.tex.dispose();
  }

  /** Аватары, видимые в последнем кадре (для HUD и QA). */
  get shown(): { id: string; room: string | null; pos: [number, number, number] }[] {
    return [...this.avatars.values()].filter((a) => a.visible).map((a) => ({ id: a.id, room: a.room, pos: [a.x, a.y, a.z] }));
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    // ушёл со вкладки «3D» (или сцена пересобирается) — для других «не в мире», пока не вернулся
    if (this.sent) this.co.sendState({ ...this.sent, loc: 'away' });
    if (this.sendTimer) clearInterval(this.sendTimer);
    this.sendTimer = null;
    if (this.obs) this.scene.onBeforeRenderObservable.remove(this.obs);
    if (this.camObs) this.v.fps.onAfterCheckInputsObservable.remove(this.camObs);
    this.obs = this.camObs = null;
    const portal = this.driver()?.portal;
    if (portal && portal.extras === this.extras) portal.extras = null;
    for (const a of this.avatars.values()) this.drop(a);
    this.avatars.clear();
    this.byRoom.clear();
  }
}

const round = (x: number): number => Math.round(x * 1000) / 1000;

/** Глаза камеры над её низом (полом), м: эллипсоид коллизий — 2·ellipsoid.y − ellipsoidOffset.y (стоя — 1.6, в снежных
 *  лазах SnowWalk делает его ниже). */
function eyeOf(c: { ellipsoid: Vector3; ellipsoidOffset: Vector3 }): number {
  return 2 * c.ellipsoid.y - c.ellipsoidOffset.y;
}
