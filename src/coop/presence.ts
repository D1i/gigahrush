// Кооп «Прогулки» (docs/COOP.md): другие игроки в сцене и своё положение для них.
//
//  • Аватар — модель игрока «забинтованный в шинели» (src/coop/avatarModel.ts: свой скелет и клипы; шинель — по месту в
//    лобби PlayerInfo.slot, у второго — слегка другого цвета) и табличка с именем (полоска — цвет игрока) над головой.
//    Поза — по высоте глаз (стоя / скрючившись / ползком, лёжа) и скорости (на месте / идёт), голова — по наклону
//    взгляда. Положение — комната (её ведёт портальный рендер) + камера; между сообщениями — плавно (экспонента), скачок
//    (шов хода, лифт, телепорт) — сразу. Пока модель грузится — видна только табличка.
//  • Портальный рендер (src/view3d/portal.ts): аватар рисуется вместе со своей комнатой — в её области стенсила, с её
//    отсечением (PortalRenderer.extras), — поэтому виден ровно там, где видна его комната: сквозь проёмы, но не сквозь
//    стены и не в комнатах других слоёв W, стоящих в 3D там же. У самого проёма (ближе NEAR_PORTAL_M) — ещё и с
//    соседом за ним: половина тела, вышедшая за плоскость проёма, не обрезается. Набор (PVS) — обычные меши, пока
//    комната аватара в наборе; облёт — не видны.
//  • Сквозь друг друга проходят (коллизий нет), но рядом (ближе SLOW_RADIUS_M, в той же комнате или у общего проёма)
//    оба идут на 75% медленнее: сдвиг камеры за кадр урезается до SLOW_FACTOR (после ввода и коллизий).
//  • Своё положение — серверу ~15 раз в секунду (только когда изменилось; иначе раз в секунду) — по таймеру, не по кадрам
//    сцены: в спец-локации (лифт, лестница) рисуется её сцена, а другим надо узнать «он в локации». С ним — высота глаз
//    над ногами (Posture.eye): скрючившись, на четвереньках, лёжа — ниже (аватар в позе); и «засыпан обвалом».
//  • Засыпанный напарник рядом (ближе DIG_RADIUS_M) — nearBuried: страница показывает «E — откапывать» и шлёт ему
//    действие dig (CoopSession.act); у него — SnowWalk.mateDig.
//  • Общага (src/view3d/obshagaWalk.ts): держит лампу — у аватара в правой руке керосиновая лампа (свет у неё ставит
//    общага); погиб — аватар не виден. Свои флаги — PlayerState.lamp / dead (геттеры flags).
//  • Горящий фонарик в руке (PlayerState.torch, хотбар src/view3d/inventory.ts) — у аватара модель фонаря в правой руке
//    (лампа общаги в правой — фонарь в левой) и SpotLight по взгляду (yaw, pitch).
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
import { CreatePlane } from '@babylonjs/core/Meshes/Builders/planeBuilder';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { Observer } from '@babylonjs/core/Misc/observable';
import type { Scene } from '@babylonjs/core/scene';
import type { Camera } from '@babylonjs/core/Cameras/camera';
import { SpotLight } from '@babylonjs/core/Lights/spotLight';
import { FLASH_ANGLE, FLASH_COLOR, FLASH_EXP, FLASH_RANGE, FlashlightModel, LIGHT_SLOTS, ensureLightSlots, flashIntensity, sceneLitness } from '../view3d/flashlight';
import { PORTAL_LAYER } from '../view3d/portal';
import type { BlockoutViewer } from '../view3d/viewer';
import type { FoldDriver } from '../view3d/fold';
import type { RunExport } from '../blockout/types';
import type { PlayerInfo, PlayerState } from './protocol';
import type { CoopSession } from './session';
import { AvatarModels, type AvatarBody } from './avatarModel';

/** Рядом с другим игроком скорость — столько от обычной (замедление на 75%). */
export const SLOW_FACTOR = 0.25;
/** «Рядом»: по горизонтали ближе, м (эллипсоиды коллизий игроков — 0.3 м радиусом, перекрылись — уже рядом). */
export const SLOW_RADIUS_M = 0.75;
/** …и по высоте (ног) ближе, м (лестница, другой этаж в том же месте 3D — не рядом). */
const SLOW_DY_M = 1.2;
/** Засыпанного напарника можно откапывать ближе этого, м (по горизонтали). */
export const DIG_RADIUS_M = 1.6;
/** Ниже этого (глаза над полом, м) — ползком: лампа и фонарь — у пола. */
const CRAWL_EYE = 0.8;
/** Аватар ближе этого к проёму своей комнаты рисуется и с соседом за проёмом, м. */
const NEAR_PORTAL_M = 0.8;
/** Скачок дальше этого — без сглаживания, м. */
const SNAP_M = 3;
/** Глаза над полом, м (как у камеры просмотрщика). */
const EYE = 1.6;
/** Сдвиг камеры за кадр больше этого — телепорт (переход, шов, лифт), не замедляется, м. */
const TELEPORT_M = 0.5;
/** Скорость аватара (для клипа ходьбы) сглаживается так, 1/с. */
const SPEED_RATE = 6;
/** Табличка с именем — выше головы (кости Head) на столько, м. */
const LABEL_DY = 0.6;
/** Ручка лампы / фонарь в кулаке — ниже кости кисти (запястья) на столько, м. */
const GRIP_M = 0.08;
const SEND_MS = 66;
const HEARTBEAT_MS = 1000;
/** обычный слой камер (всё, кроме PORTAL_LAYER) */
const SCENE_LAYER = 0x0fffffff;

interface Avatar {
  id: string;
  name: string;
  color: string;
  /** место в лобби (цвет шинели) */
  slot: number | undefined;
  /** модель игрока (null — ещё грузится) */
  model: AvatarBody | null;
  label: Mesh;
  /** керосиновая лампа в руке (общага) — клон модели p_obsh_lantern, создаётся, когда понадобилась */
  lamp: Mesh | null;
  /** горящий фонарик в руке — модель и луч, создаются, когда понадобились */
  torch: { m: FlashlightModel; l: SpotLight } | null;
  /** меши модели и табличка */
  meshes: Mesh[];
  mats: StandardMaterial[];
  tex: DynamicTexture;
  room: string | null;
  /** показанное положение глаз, их высота над полом, поворот, наклон взгляда и скорость (м/с, сглажена) */
  x: number;
  y: number;
  z: number;
  eye: number;
  yaw: number;
  pitch: number;
  speed: number;
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
  private readonly models: AvatarModels;
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
    private readonly flags: { lamp?: () => boolean; dead?: () => boolean; torch?: () => boolean } = {},
  ) {
    this.scene = v.scene;
    this.models = new AvatarModels(this.scene);
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
    const myFeet = cam.y - (v.posture?.eye ?? eyeOf(v.fps));
    for (const a of this.avatars.values()) {
      const s = this.co.players.get(a.id)?.state ?? null;
      a.visible = false;
      const room = s?.room ?? null;
      // в спец-локации (своя сцена), погиб или в комнате, которой в копии мира ещё нет, — не виден
      if (!s || s.loc || s.dead || !room || (rx && !this.hasRoom(rx, room))) {
        this.show(a, false);
        a.lamp?.setEnabled(false);
        this.torchOf(a, null);
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
        a.pitch = s.pitch;
        a.speed = 0;
        a.has = true;
      } else {
        const ox = a.x, oz = a.z;
        a.x += (tx - a.x) * k;
        a.y += (ty - a.y) * k;
        a.z += (tz - a.z) * k;
        a.eye += (te - a.eye) * k;
        a.yaw = angleLerp(a.yaw, s.yaw, k);
        a.pitch += (s.pitch - a.pitch) * k;
        if (dt > 0) a.speed += (Math.hypot(a.x - ox, a.z - oz) / dt - a.speed) * (1 - Math.exp(-dt * SPEED_RATE));
      }
      if (!a.model) this.attachModel(a);
      a.room = room;
      this.pose(a, cam);
      const lamp = this.lampOf(a, !!s.lamp && fps);
      const torch = this.torchOf(a, s.torch && fps ? s : null);
      // рядом ли (та же комната или сосед через общий проём, не шов хода; по высоте — ноги)
      const here = fps && !!me && (room === me || !!near?.has(room)) && Math.abs(a.y - a.eye - myFeet) < SLOW_DY_M;
      const dist = Math.hypot(a.x - cam.x, a.z - cam.z);
      if (here && dist < SLOW_RADIUS_M) slow = true;
      if (here && s.buried && dist < DIG_RADIUS_M && (!dig || dist < dig.d)) dig = { id: a.id, name: a.name, d: dist };
      if (!fps) {
        this.show(a, false);
        continue;
      }
      if (portal) {
        this.show(a, true, PORTAL_LAYER);
        this.addTo(room, a);
        if (lamp) {
          lamp.layerMask = PORTAL_LAYER;
          this.byRoom.get(room)!.push(lamp);
        }
        for (const m of torch ?? []) {
          m.layerMask = PORTAL_LAYER;
          this.byRoom.get(room)!.push(m);
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
        this.show(a, on, SCENE_LAYER);
        a.visible = on;
        if (lamp) {
          lamp.layerMask = SCENE_LAYER;
          lamp.setEnabled(on);
        }
        for (const m of torch ?? []) m.layerMask = SCENE_LAYER;
        if (torch) a.torch!.m.root.setEnabled(on);
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
    if (!l.includes(a.label)) l.push(...a.meshes);
  }

  /** Модель загрузилась — аватару своя копия (шинель — по месту в лобби). */
  private attachModel(a: Avatar) {
    const body = this.models.make(a.id, a.slot);
    if (!body) return;
    for (const m of body.meshes) {
      m.layerMask = PORTAL_LAYER;
      m.metadata = { coop: a.id };
    }
    a.model = body;
    a.meshes = [...body.meshes, a.label];
  }

  /** Показать / скрыть аватар (модель и табличку); layer — слой камер его мешей. */
  private show(a: Avatar, on: boolean, layer?: number) {
    a.model?.setEnabled(on);
    a.label.setEnabled(on);
    if (layer !== undefined) for (const m of a.meshes) m.layerMask = layer;
  }

  /** Аватар в позу: модель — ноги на полу (глаза — eye над ним), голова у глаз, клипы — по позе и скорости
   *  (avatarModel.ts); табличка — над головой, лицом к камере. */
  private pose(a: Avatar, cam: Vector3) {
    let headY = a.y - a.eye + Math.max(0.3, a.eye - 0.1);
    if (a.model) {
      a.model.update({ x: a.x, y: a.y, z: a.z, eye: a.eye, yaw: a.yaw, pitch: a.pitch, speed: a.speed });
      headY = a.model.head.getAbsolutePosition().y;
    }
    a.label.position.set(a.x, headY + LABEL_DY, a.z);
    // лицевая сторона плоскости — −Z: развернуть её к камере
    a.label.rotation.y = Math.atan2(-(cam.x - a.x), -(cam.z - a.z));
    a.label.computeWorldMatrix(true);
  }

  /** Лампа в руке аватара (общага): висит в правой руке модели (ползком — стоит на полу у кисти), по взгляду; пока
   *  модели игрока нет — справа у бедра. null — не держит (или модели лампы ещё нет). */
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
    if (a.model) {
      // ручка (верх лампы) — в кулаке
      const h = a.model.handPos('R');
      const top = m.getBoundingInfo().boundingBox.maximum.y * m.scaling.y;
      m.position.set(h.x, Math.max(feet, h.y - GRIP_M - top), h.z);
    } else {
      // правая рука: вправо от взгляда (Babylon: (cos yaw, −sin yaw)) и чуть вперёд; лёжа — у головы
      const fx = Math.sin(a.yaw), fz = Math.cos(a.yaw);
      const low = a.eye < CRAWL_EYE;
      const side = low ? 0.2 : 0.3, fwd = low ? 0.55 : 0.22;
      m.position.set(a.x + fz * side + fx * fwd, feet + (low ? 0.02 : 0.55), a.z - fx * side + fz * fwd);
    }
    m.rotation.y = a.yaw;
    m.setEnabled(true);
    m.isVisible = true;
    m.computeWorldMatrix(true);
    return m;
  }

  /** Фонарик в руке аватара: в кулаке правой руки модели (лампа общаги в правой — в левой; пока модели игрока нет — у
   *  груди), по взгляду; свет — от линзы. s null — не держит (модель и свет гаснут). Возвращает меши модели. */
  private torchOf(a: Avatar, s: PlayerState | null): Mesh[] | null {
    if (!s) {
      if (a.torch) {
        a.torch.m.root.setEnabled(false);
        a.torch.l.setEnabled(false);
      }
      return null;
    }
    if (!a.torch) {
      // свои источники у материалов: фонари напарников сверх обычных
      ensureLightSlots(this.scene, LIGHT_SLOTS + 3);
      const m = new FlashlightModel(this.scene, `coop:torch:${a.id}`);
      m.setKnob(true);
      m.setLensLit(true);
      for (const x of m.meshes) x.metadata = { coop: a.id };
      const l = new SpotLight(`coop:torch:${a.id}`, new Vector3(), new Vector3(0, 0, 1), FLASH_ANGLE, FLASH_EXP, this.scene);
      l.diffuse = FLASH_COLOR.clone();
      l.specular = FLASH_COLOR.scale(0.3);
      l.range = FLASH_RANGE;
      a.torch = { m, l };
    }
    const { m, l } = a.torch;
    const fx = Math.sin(a.yaw), fz = Math.cos(a.yaw);
    if (a.model) {
      // в кулаке; ползком кисть на полу — фонарь чуть над ним
      const h = a.model.handPos(s.lamp ? 'L' : 'R');
      m.root.position.set(h.x + fx * 0.04, Math.max(a.y - a.eye + 0.05, h.y - GRIP_M), h.z + fz * 0.04);
    } else {
      const low = a.eye < CRAWL_EYE;
      // вправо от взгляда — (cos yaw, −sin yaw); лёжа — у головы
      const side = (s.lamp ? -1 : 1) * (low ? 0.15 : 0.24), fwd = low ? 0.6 : 0.3;
      m.root.position.set(a.x + fz * side + fx * fwd, a.y - (low ? 0.12 : 0.42), a.z - fx * side + fz * fwd);
    }
    m.root.rotation.set(s.pitch, a.yaw, 0);
    m.root.setEnabled(true);
    const w = m.root.computeWorldMatrix(true);
    for (const x of m.meshes) x.computeWorldMatrix(true);
    Vector3.TransformCoordinatesToRef(new Vector3(0, 0, 0.09), w, l.position);
    l.direction.set(fx * Math.cos(s.pitch), -Math.sin(s.pitch), fz * Math.cos(s.pitch));
    l.intensity = flashIntensity(sceneLitness(this.scene)) * 0.9;
    if (!l.isEnabled()) l.setEnabled(true);
    return m.meshes;
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
    // глаза не на 1.6 (скрючившись, ползком, лёжа) и «засыпан» — только когда есть (сообщение короче)
    const eye = round(this.v.posture?.eye ?? eyeOf(c));
    if (Math.abs(eye - EYE) > 0.01) s.eye = eye;
    if (this.buried()) s.buried = true;
    if (this.flags.lamp?.()) s.lamp = 1;
    if (this.flags.torch?.()) s.torch = 1;
    if (this.flags.dead?.()) s.dead = 1;
    const o = this.sent;
    const same =
      o && o.room === s.room && o.loc === s.loc && o.fps === s.fps && o.eye === s.eye && o.buried === s.buried && o.lamp === s.lamp && o.torch === s.torch && o.dead === s.dead &&
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
      if (!p || p.name !== a.name || p.color !== a.color || p.slot !== a.slot) {
        this.drop(a);
        this.avatars.delete(id);
      }
    }
    for (const p of players.values()) if (!this.avatars.has(p.id)) this.avatars.set(p.id, this.make(p));
  }

  /** Аватар игрока: табличка с именем сразу, модель — когда загрузится (attachModel). */
  private make(p: PlayerInfo): Avatar {
    const sc = this.scene;
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
    label.isPickable = false;
    label.checkCollisions = false;
    label.layerMask = PORTAL_LAYER;
    label.setEnabled(false);
    label.metadata = { coop: p.id };
    const a: Avatar = { id: p.id, name: p.name, color: p.color, slot: p.slot, model: null, label, meshes: [label], mats: [mLabel], tex, lamp: null, torch: null, room: null, x: 0, y: 0, z: 0, eye: EYE, yaw: 0, pitch: 0, speed: 0, has: false, visible: false };
    this.attachModel(a);
    return a;
  }

  private drop(a: Avatar) {
    a.model?.dispose();
    a.label.dispose(false, false);
    a.lamp?.dispose(false, false);
    a.torch?.m.dispose();
    a.torch?.l.dispose();
    for (const m of a.mats) m.dispose(false, false);
    a.tex.dispose();
  }

  /** Аватары, видимые в последнем кадре (для HUD и QA): глаза, скорость (м/с), веса клипов модели, цвет шинели. */
  get shown(): { id: string; room: string | null; pos: [number, number, number]; speed: number; clips: Partial<Record<string, number>> | null; coat: string | null }[] {
    return [...this.avatars.values()]
      .filter((a) => a.visible)
      .map((a) => ({ id: a.id, room: a.room, pos: [a.x, a.y, a.z], speed: a.speed, clips: a.model?.weights ?? null, coat: this.models.coatColor(a.slot)?.toHexString() ?? null }));
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
    this.models.dispose();
  }
}

const round = (x: number): number => Math.round(x * 1000) / 1000;

/** Глаза камеры над низом её эллипсоида, м: 2·ellipsoid.y − ellipsoidOffset.y — запасной, если у просмотрщика нет позы
 *  (Posture.eye — глаз над ногами; низ эллипсоида в низких позах выше ног на «шаг» lift). */
function eyeOf(c: { ellipsoid: Vector3; ellipsoidOffset: Vector3 }): number {
  return 2 * c.ellipsoid.y - c.ellipsoidOffset.y;
}
