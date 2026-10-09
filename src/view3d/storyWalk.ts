// «Прогулка» по сюжету (src/game/story.ts): переходы «Люк в погреб» и «Дверь в снег» от первого лица — то, что видит и
// делает игрок. Сценарии — src/locations/hatch.ts и src/locations/snowDoor.ts; куда ведёт переход — мир (операция
// descend страницы: кооп — через лобби, у всех одна и та же комната-выход; сценарий у каждого игрока свой).
//
//  • Комната Room.location.kind 'hatch' («Люк в погреб»): в середине габаритов экземпляра — люк в полу (рама, крышка из
//    досок с кольцом; петли — на дальней от вошедшего стороне). Ближе 1.3 м — «E — открыть люк»: крышка откидывается
//    (скрип, стук об пол), взгляд уходит в чёрный проём, из него торчит верх лестницы; спуск — затемнение (шаги по
//    перекладинам); в темноте — host.descend(id): операция мира и посадка в комнату-выход (погреб); проявление.
//  • Комната 'snowdoor' («Дверь в снег»: погреб, общага): дверь — метка 'snowdoor' на стене (её дверь-панель —
//    FoldDriver.doorAt и анимация распаха FoldDriver.doors; панели нет — своя дверь). Ближе 1.3 м — «E — открыть дверь»:
//    распах, за дверью — снег до притолоки; треск (сыплется, гул, тряска сильнее, снег выпирает) → обвал: снег валит в
//    комнату, игрока опрокидывает — белая пелена, всё глохнет, сердце. «Засыпало! E — выкапываться (n/N)» (n — розыгрыш
//    мира): каждое нажатие — хруст, толчок и часть пелены долой; последнее — host.descend(id) → игрок в снежном ходе
//    (снег сам сажает на четвереньки, ./snowWalk.ts): пелена спадает, подъём из лёжа — взгляд с потолка к горизонту.
//  • Пока идёт сценарий — игрок стоит (Posture.frozen), тряска и крен — Posture.roll, взгляд ведёт сценарий (люк — в
//    проём; снег — вверх, лёжа). Наблюдатель кадра создаётся после снега и общаги — их «сброс» позы перекрывается.
//  • Меши — свои меши комнаты портального рендера (PortalRenderer.extraProviders, слой PORTAL_LAYER): видны там, где
//    видна их комната (и сквозь проёмы из соседних), и не видны в комнатах других слоёв W в том же месте 3D. Строятся
//    для комнат с переходом, которые портальный рендер рисовал в прошлом кадре (и комнаты игрока).
//  • Звук: снег — свой SnowAudio (./snowAudio.ts: треск, удар, глухо засыпанному, хруст откопки; 'room-forge/snow-sound'
//    = '0' — выкл.); люк — скрип, стук, шаги по перекладинам (WebAudio). Контекст — по нажатию E (автоплей).
import type { Scene } from '@babylonjs/core/scene';
import type { UniversalCamera } from '@babylonjs/core/Cameras/universalCamera';
import type { Observer } from '@babylonjs/core/Misc/observable';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder';
import { CreateGround } from '@babylonjs/core/Meshes/Builders/groundBuilder';
import { CreateSphere } from '@babylonjs/core/Meshes/Builders/sphereBuilder';
import { CreateTorus } from '@babylonjs/core/Meshes/Builders/torusBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { RawTexture } from '@babylonjs/core/Materials/Textures/rawTexture';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { Matrix, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { ParticleSystem } from '@babylonjs/core/Particles/particleSystem';
import '@babylonjs/core/Particles/particleSystemComponent';
import type { DoorSlot, RunInstance } from '../blockout/types';
import { propHeightM } from '../blockout/core';
import {
  arriveHatch, createHatch, hatchCenter, hatchSize, hatchView, nearHatch, openHatch, stepHatch,
  HATCH_LID_OPEN, HATCH_PROMPT, type HatchState,
} from '../locations/hatch';
import {
  arriveSnowDoor, createSnowDoor, digSnowDoor, openSnowDoor, snowDoorPlace, snowDoorPrompt, snowDoorView, stepSnowDoor,
  SNOWDOOR_CONN, SNOWDOOR_NEAR, SNOWDOOR_PROMPT, type SnowDoorState,
} from '../locations/snowDoor';
import { puffTexture } from '../locations/liftTextures';
import { snowMaterials } from './snowView';
import { SnowAudio } from './snowAudio';
import { PORTAL_LAYER, type PortalRenderer } from './portal';
import type { Posture } from './posture';

/** Переход сюжета комнаты (из мира: LocationInfo 'hatch' / 'snowdoor'). */
export type StoryKind = { kind: 'hatch' } | { kind: 'snowdoor'; digs: number };

export interface StoryHud {
  /** «E — открыть люк» / «E — открыть дверь» / «Засыпало! E — выкапываться (n/N)» */
  prompt: string | null;
  /** люк: затемнение 0…1 */
  black: number | null;
  /** дверь в снег: белая пелена 0…1 */
  white: number | null;
  /** дверь в снег: треск — тёмная виньетка 0…1 */
  crack: number | null;
  /** идёт сценарий перехода (E — его; чужие подсказки «E — …» прячутся) */
  active: boolean;
}

export interface StoryWalkHost {
  /** комната под ногами (экземпляр экспорта) */
  room(): { id: string; inst: RunInstance } | null;
  /** экземпляр по id (комнаты, которые видно) */
  inst(id: string): RunInstance | null;
  /** клетка плана, м (RunExport.cellM) */
  cellM(): number;
  /** предметы прогона (RunExport.props): плоский проп люка в полу — люк ложится поверх него */
  props(): readonly { id: string; name: string; tags: string[]; w: number; h: number }[];
  /** переход сюжета комнаты; null — обычная */
  kindOf(id: string): StoryKind | null;
  /** дверь-панель метки в куске комнаты (портальный рендер); null — нет (рисуется своя дверь) */
  doorSlot(inst: string, conn: string): DoorSlot | null;
  /** распахнуть дверь-панель (анимация FoldDriver.doors); false — не вышло */
  openDoor(slot: DoorSlot): boolean;
  /** портальный рендер прогулки (свои меши комнат) */
  portal(): PortalRenderer | null;
  /** переход: операция мира descend и посадка в комнату-выход; true — игрок уже там */
  descend(id: string): Promise<boolean>;
  /** E сейчас у другого (дверь квартиры рядом, предмет под взглядом) */
  busy(): boolean;
  /** можно управлять: нет спец-сцены поверх, от первого лица */
  live(): boolean;
  onHud(h: StoryHud): void;
}

const SOUND_KEY = 'room-forge/snow-sound';
/** Опрокинуло на спину: взгляд вверх, рад; крен лёжа, рад. */
const LIE_PITCH = 1.1;
const LIE_ROLL = 0.22;
/** Взгляд в проём люка — не круче, рад. */
const LOOK_MAX = 1.3;
/** Своя дверь (нет панели в куске): размеры по умолчанию, м. */
const DOOR_W = 0.9;
const DOOR_H = 2.05;
/** низкая дощатая дверь погреба */
const DOOR_H_LOW = 1.8;
const DOOR_T = 0.045;
const DOOR_OPEN = (100 * Math.PI) / 180;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const ease = (dt: number, rate: number) => 1 - Math.exp(-dt * rate);
/** угол a → b кратчайшим путём на долю k */
const lerpAngle = (a: number, b: number, k: number) => {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * k;
};

/** Убранство комнаты с переходом: меши (в мировых координатах прогона) и место. */
interface Deco {
  id: string;
  kind: 'hatch' | 'snowdoor';
  meshes: Mesh[];
  /** план, м: середина люка / проёма двери; пол, м */
  x: number;
  y: number;
  y0: number;
  /** люк: крышка, верх лестницы */
  lid?: Mesh;
  ladder?: Mesh[];
  /** дверь в снег: нормаль внутрь (Babylon), снег в проёме, бугры, куча, своя дверь */
  u?: Vector3;
  snow?: Mesh;
  heap?: Mesh;
  leaf?: Mesh;
  slot?: DoorSlot | null;
  yaw?: number;
  w?: number;
  h?: number;
}

type Act =
  | { kind: 'hatch'; id: string; s: HatchState }
  | { kind: 'snowdoor'; id: string; s: SnowDoorState; pitch0: number; side: number };

export class StoryWalk {
  private obs: Observer<Scene> | null;
  private decos = new Map<string, Deco>();
  private act: Act | null = null;
  /** рядом с люком / дверью в покое (подсказка, E) */
  private near: { kind: 'hatch' | 'snowdoor'; id: string } | null = null;
  /** комнаты, где переход уже открыт игроком (крышка откинута, дверь распахнута, снег у порога) */
  private used = new Set<string>();
  private hudKey = '';
  private checkAt = 0;
  private shake = 0;
  private attached: PortalRenderer | null = null;
  private provider = (room: string) => this.decos.get(room)?.meshes;
  private mats: { wood: StandardMaterial; iron: StandardMaterial; black: StandardMaterial; door: StandardMaterial } | null = null;
  private crumbs: ParticleSystem | null = null;
  private puff: ParticleSystem | null = null;
  private snowAudio: SnowAudio | null = null;
  private hatchAudio = new HatchAudio();
  private onKey = (e: KeyboardEvent) => this.key(e);
  private disposed = false;
  /** QA: сценарий на паузе (скриншот фазы в медленном рендере) */
  private hold = false;

  constructor(
    private readonly scene: Scene,
    private readonly cam: UniversalCamera,
    private readonly host: StoryWalkHost,
    /** поза от первого лица (BlockoutViewer.posture) */
    private readonly posture: Posture,
  ) {
    this.obs = scene.onBeforeRenderObservable.add(() => this.frame());
    window.addEventListener('keydown', this.onKey);
  }

  /** E сейчас за переходом (рядом с люком / дверью или идёт сценарий) — другим не брать. */
  get busy(): boolean {
    return !!this.act || !!this.near;
  }

  /** Идёт сценарий перехода (игрок стоит, E — его). */
  get active(): boolean {
    return !!this.act;
  }

  /** Для QA: фаза сценария и подсказка. */
  qa() {
    const self = this;
    return {
      get phase(): string | null {
        return self.act ? `${self.act.kind}:${self.act.s.phase}` : null;
      },
      get near() {
        return self.near;
      },
      /** время в фазе, с */
      get t(): number | null {
        return self.act ? self.act.s.t : null;
      },
      get decos(): string[] {
        return [...self.decos.keys()];
      },
      /** E без клавиатуры (QA) */
      press: () => self.press(),
      /** пауза сценария (вид держится) — скриншот фазы */
      hold: (on: boolean) => void (self.hold = on),
      /** убранство комнаты: место, поворот, меши (габариты в мире) */
      info: (id: string) => {
        const d = self.decos.get(id);
        if (!d) return null;
        const r3 = (v: { x: number; y: number; z: number }) => [+v.x.toFixed(3), +v.y.toFixed(3), +v.z.toFixed(3)];
        return {
          kind: d.kind, x: d.x, y: d.y, y0: d.y0, yaw: d.yaw ?? 0, slot: !!d.slot, leaf: !!d.leaf,
          meshes: d.meshes.map((m) => {
            m.computeWorldMatrix(true);
            const b = m.getBoundingInfo().boundingBox;
            return { name: m.name, on: m.isEnabled(), rot: r3(m.rotation), min: r3(b.minimumWorld), max: r3(b.maximumWorld) };
          }),
        };
      },
    };
  }

  // ───────────────────────── кадр ─────────────────────────

  private frame() {
    if (this.disposed) return;
    const dt = Math.min(0.1, this.scene.getEngine().getDeltaTime() / 1000 || 1 / 60);
    const live = this.host.live();
    const now = performance.now();
    // убранство — комнатам с переходом, которые видно (раз в 0.25 с) и комнате игрока
    const r = live ? this.host.room() : null;
    if (live && (now - this.checkAt > 250 || (r && !this.decos.has(r.id) && this.host.kindOf(r.id)))) {
      this.checkAt = now;
      this.syncDecos(r?.id ?? null);
    }
    this.attach(live);
    const a = this.act;
    if (a && live && !this.hold) this.stepAct(a, dt);
    // рядом в покое — подсказка
    this.near = null;
    if (!this.act && live && r) {
      const d = this.decos.get(r.id);
      if (d && !this.host.busy()) {
        const c = this.cam.position, feet = c.y - this.posture.eye;
        if (Math.abs(feet - d.y0) < 1.5) {
          const px = c.x, py = -c.z;
          if (d.kind === 'hatch' ? nearHatch(px, py, d) : Math.hypot(px - d.x, py - d.y) < SNOWDOOR_NEAR) this.near = { kind: d.kind, id: d.id };
        }
      }
    }
    this.view(dt);
  }

  /** Убранство: построить комнатам с переходом из набора кадра (и комнате игрока), убрать невидимые. */
  private syncDecos(cur: string | null) {
    const want = new Set<string>();
    const p = this.host.portal();
    const ids = p?.isActive ? [...p.lastRooms] : [];
    if (cur) ids.push(cur);
    for (const id of ids) if (!want.has(id) && this.host.kindOf(id)) want.add(id);
    // идущий сценарий держит своё убранство
    if (this.act) want.add(this.act.id);
    for (const [id, d] of this.decos) {
      if (want.has(id)) continue;
      for (const m of d.meshes) m.dispose();
      this.decos.delete(id);
    }
    for (const id of want) {
      if (this.decos.has(id)) {
        // дверь-панель появилась (кусок пересобран) — своя дверь не нужна
        const d = this.decos.get(id)!;
        if (d.kind === 'snowdoor' && d.leaf && !d.slot) {
          const slot = this.host.doorSlot(id, SNOWDOOR_CONN);
          if (slot) {
            d.leaf.dispose();
            d.meshes = d.meshes.filter((m) => m !== d.leaf);
            d.leaf = undefined;
            d.slot = slot;
          }
        }
        continue;
      }
      const k = this.host.kindOf(id);
      const inst = this.host.inst(id);
      if (!k || !inst) continue;
      const d = k.kind === 'hatch' ? this.buildHatch(id, inst) : this.buildSnowDoor(id, inst);
      if (d) this.decos.set(id, d);
    }
  }

  private attach(live: boolean) {
    const p = this.host.portal();
    const portal = live && p?.isActive ? p : null;
    if (portal === this.attached) return;
    this.attached?.extraProviders.delete(this.provider);
    portal?.extraProviders.add(this.provider);
    this.attached = portal;
  }

  // ───────────────────────── E ─────────────────────────

  private key(e: KeyboardEvent) {
    if (e.code !== 'KeyE' || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
    if (!this.host.live()) return;
    this.press();
  }

  private press() {
    const a = this.act;
    if (a) {
      if (a.kind === 'snowdoor' && a.s.phase === 'buried') {
        for (const ev of digSnowDoor(a.s)) {
          if (ev.type === 'dig') {
            this.snowAudio?.dig();
            this.shake = Math.max(this.shake, 0.45);
          }
          if (ev.type === 'descend') this.descend(a);
        }
      }
      return;
    }
    const n = this.near;
    const d = n ? this.decos.get(n.id) : null;
    if (!n || !d || this.host.busy()) return;
    this.near = null;
    if (n.kind === 'hatch') {
      const s = createHatch();
      openHatch(s);
      this.act = { kind: 'hatch', id: n.id, s };
      void this.hatchAudio.start().then(() => this.hatchAudio.creak());
      return;
    }
    const k = this.host.kindOf(n.id);
    const s = createSnowDoor(k?.kind === 'snowdoor' ? k.digs : undefined);
    openSnowDoor(s);
    // дверь слева или справа от взгляда — туда и опрокидывает (крен)
    const c = this.cam.position, fwd = this.cam.getDirection(Vector3.Forward());
    const side = Math.sign(fwd.x * (-d.y - c.z) - fwd.z * (d.x - c.x)) || 1;
    this.act = { kind: 'snowdoor', id: n.id, s, pitch0: this.cam.rotation.x, side };
    if (d.slot && this.host.openDoor(d.slot)) {
      // дверь-панель распахивает аниматор дверей
    } else if (!d.leaf) d.leaf = this.ownLeaf(d);
    if (!this.snowAudio) this.snowAudio = new SnowAudio(typeof localStorage === 'undefined' || localStorage.getItem(SOUND_KEY) !== '0');
    void this.snowAudio.start().then(() => this.snowAudio?.setInSnow(true));
  }

  /** Сценарий дошёл до перехода: операция мира и посадка (страница), потом — проявление / выбрался. */
  private descend(a: Act) {
    void this.host.descend(a.id).then(
      (ok) => this.arrive(a, ok),
      () => this.arrive(a, false),
    );
  }

  private arrive(a: Act, ok: boolean) {
    if (this.act !== a || this.disposed) return;
    if (a.kind === 'hatch') arriveHatch(a.s, ok);
    else {
      arriveSnowDoor(a.s, ok);
      // в снежном ходе свой звук снега (./snowWalk.ts) — этот гасим
      this.snowAudio?.setInSnow(false);
    }
    if (ok) this.used.add(a.id);
  }

  // ───────────────────────── сценарий ─────────────────────────

  private stepAct(a: Act, dt: number) {
    if (a.kind === 'hatch') {
      for (const ev of stepHatch(a.s, dt)) {
        if (ev.type === 'lid') {
          this.hatchAudio.thud();
          this.hatchAudio.steps();
          this.shake = Math.max(this.shake, 0.25);
        }
        if (ev.type === 'descend') this.descend(a);
        if (ev.type === 'done') this.finish();
      }
      return;
    }
    const d = this.decos.get(a.id);
    for (const ev of stepSnowDoor(a.s, dt)) {
      if (ev.type === 'crack' && d) this.crumbsFx(d, true);
      if (ev.type === 'fall') {
        if (d) {
          this.crumbsFx(d, false);
          this.puffFx(d);
        }
        this.snowAudio?.fall(0, true);
        a.pitch0 = this.cam.rotation.x;
      }
      if (ev.type === 'done') this.finish();
    }
    const v = snowDoorView(a.s);
    if (v.crack !== null && this.crumbs) this.crumbs.emitRate = 60 + 340 * v.crack;
    this.snowAudio?.update(dt, { moved: 0, crouch: false, buried: a.s.phase === 'buried' || a.s.phase === 'out', crack: v.crack, crackPan: 0, thaw: 0 });
  }

  /** Сценарий окончен: позу отпустить. */
  private finish() {
    this.act = null;
    this.posture.frozen = false;
    this.posture.roll = 0;
    this.shake = 0;
    this.snowAudio?.setInSnow(false);
  }

  /** Вид кадра: меши (крышка, дверь, снег), поза и взгляд, HUD. */
  private view(dt: number) {
    const a = this.act;
    const c = this.cam;
    let prompt: string | null = null;
    let black: number | null = null, white: number | null = null, crack: number | null = null;
    this.shake = Math.max(0, this.shake - dt * 1.6);
    // убранство в покое: открытые раньше — открыты
    for (const d of this.decos.values()) {
      if (a?.id === d.id) continue;
      const open = this.used.has(d.id) ? 1 : 0;
      if (d.kind === 'hatch') this.poseHatch(d, open);
      else this.poseSnowDoor(d, open ? { door: 1, snow: true, bulge: 1, heap: 1 } : { door: 0, snow: false, bulge: 0, heap: 0 });
    }
    if (!a) {
      const n = this.near;
      if (n) prompt = n.kind === 'hatch' ? HATCH_PROMPT : SNOWDOOR_PROMPT;
      this.emit({ prompt, black, white, crack, active: false });
      return;
    }
    const d = this.decos.get(a.id);
    const P = this.posture;
    if (a.kind === 'hatch') {
      const v = hatchView(a.s);
      if (d) this.poseHatch(d, v.lid);
      black = v.black > 0.001 ? v.black : null;
      P.frozen = v.frozen;
      P.roll = this.shake > 0 ? (Math.random() - 0.5) * 0.03 * this.shake : 0;
      // взгляд — в проём (пока игрок ещё в комнате люка)
      if (v.look > 0 && d && this.host.room()?.id === a.id) {
        const hx = d.x, hz = -d.y;
        const dx = hx - c.position.x, dz = hz - c.position.z, dist = Math.hypot(dx, dz);
        const yaw = Math.atan2(dx, dz);
        const pitch = clamp(Math.atan2(c.position.y - d.y0, Math.max(0.2, dist)) + 0.25 * (a.s.phase === 'down' ? 1 : 0), 0, LOOK_MAX);
        const k = ease(dt, 5) * v.look;
        if (dist > 0.05) c.rotation.y = lerpAngle(c.rotation.y, yaw, k);
        c.rotation.x += (pitch - c.rotation.x) * k;
        c.cameraRotation.set(0, 0);
      }
    } else {
      const v = snowDoorView(a.s);
      if (d) this.poseSnowDoor(d, v);
      white = v.white !== null && v.white > 0.001 ? v.white : null;
      crack = v.crack;
      P.frozen = v.frozen;
      const sh = v.shake + this.shake;
      P.roll = a.side * LIE_ROLL * v.lie + (sh > 0 ? (Math.random() - 0.5) * 0.05 * sh : 0);
      // опрокинуло: взгляд вверх; подъём — к горизонту
      if (v.lie > 0) {
        const base = a.s.phase === 'fall' ? a.pitch0 : 0;
        c.rotation.x = base + (-LIE_PITCH - base) * v.lie;
        c.cameraRotation.set(0, 0);
      }
      prompt = snowDoorPrompt(a.s, false);
    }
    this.emit({ prompt, black, white, crack, active: true });
  }

  private emit(h: StoryHud) {
    const r = (v: number | null) => (v === null ? '' : Math.round(v * 50));
    const k = `${h.prompt}|${r(h.black)}|${r(h.white)}|${r(h.crack)}|${h.active ? 1 : 0}`;
    if (k === this.hudKey) return;
    this.hudKey = k;
    this.host.onHud(h);
  }

  // ───────────────────────── люк ─────────────────────────

  private materials() {
    if (this.mats) return this.mats;
    const sc = this.scene;
    const wood = new StandardMaterial('story:wood', sc);
    wood.diffuseTexture = plankTexture(sc);
    wood.specularColor = new Color3(0.05, 0.04, 0.03);
    const iron = new StandardMaterial('story:iron', sc);
    iron.diffuseColor = new Color3(0.16, 0.15, 0.14);
    iron.specularColor = new Color3(0.35, 0.33, 0.3);
    iron.specularPower = 40;
    const black = new StandardMaterial('story:hole', sc);
    black.diffuseColor = new Color3(0, 0, 0);
    black.specularColor = new Color3(0, 0, 0);
    black.disableLighting = true;
    // поверх картинки пропа люка (у неё zOffset −2)
    black.zOffset = -4;
    const door = new StandardMaterial('story:door', sc);
    // крашеная дверь общаги: серо-голубая масляная краска
    door.diffuseColor = new Color3(0.5, 0.56, 0.58);
    door.specularColor = new Color3(0.08, 0.08, 0.08);
    this.mats = { wood, iron, black, door };
    return this.mats;
  }

  /** Деталь в своих координатах (x — вдоль, z — «вперёд» убранства): геометрия сдвинута, меш — в точке o с поворотом yaw. */
  private part(m: Mesh, lx: number, ly: number, lz: number, o: Vector3, yaw: number, mat: StandardMaterial): Mesh {
    m.bakeTransformIntoVertices(Matrix.Translation(lx, ly, lz));
    m.position.copyFrom(o);
    m.rotation.set(0, yaw, 0);
    m.material = mat;
    m.layerMask = PORTAL_LAYER;
    m.isPickable = false;
    m.computeWorldMatrix(true);
    return m;
  }

  private buildHatch(id: string, inst: RunInstance): Deco {
    const cell = this.host.cellM();
    const c = hatchCenter(inst.bbox, cell), S = hatchSize(inst.bbox, cell);
    // плоский проп люка в полу под серединой (мир: p_cellar_hatch, доска 5 см) — рама и крышка ложатся поверх него
    const y0 = (Number(inst.z) || 0) + this.flatPropTop(inst, c.x, c.y);
    const M = this.materials(), sc = this.scene;
    const o = new Vector3(c.x, y0, -c.y);
    // петли — на дальней стороне от игрока (кто вошёл — тот видит кольцо), вдоль осей комнаты
    const cp = this.cam.position;
    const raw = Math.atan2(c.x - cp.x, -c.y - cp.z);
    const yaw = Math.round(raw / (Math.PI / 2)) * (Math.PI / 2);
    const ms: Mesh[] = [];
    // проём: чернота над полом и над картинкой пропа люка (её плоскость — на 3 мм выше верха пропа, со сдвигом глубины)
    const hole = CreateGround('story:hatch:hole', { width: S, height: S }, sc);
    ms.push(this.part(hole, 0, 0.008, 0, o, yaw, M.black));
    // рама: брусья по краям, чуть над полом
    const fw = 0.08, fh = 0.025;
    for (const [w, d, x, z] of [[S + 2 * fw, fw, 0, S / 2 + fw / 2], [S + 2 * fw, fw, 0, -S / 2 - fw / 2], [fw, S, S / 2 + fw / 2, 0], [fw, S, -S / 2 - fw / 2, 0]] as const) {
      ms.push(this.part(CreateBox('story:hatch:frame', { width: w, height: fh, depth: d }, sc), x, fh / 2, z, o, yaw, M.wood));
    }
    // верх лестницы в проёме (виден, когда крышка поднята): у края со стороны игрока
    const ladder: Mesh[] = [];
    for (const x of [-0.2, 0.2]) {
      ladder.push(this.part(CreateBox('story:hatch:rail', { width: 0.05, height: 1.3, depth: 0.05 }, sc), x, 0.4 - 0.65, -S / 2 + 0.1, o, yaw, M.wood));
    }
    ladder.push(this.part(CreateBox('story:hatch:rung', { width: 0.44, height: 0.035, depth: 0.035 }, sc), 0, 0.22, -S / 2 + 0.1, o, yaw, M.wood));
    ladder.push(this.part(CreateBox('story:hatch:rung', { width: 0.44, height: 0.035, depth: 0.035 }, sc), 0, -0.1, -S / 2 + 0.1, o, yaw, M.wood));
    ms.push(...ladder);
    // крышка: доски; две железные полосы-петли поперёк и кольцо у свободного края; петли — по краю z = +S/2
    // (вращение вокруг x)
    const hinge = new Vector3(o.x + Math.sin(yaw) * (S / 2), y0 + fh, o.z + Math.cos(yaw) * (S / 2));
    const L = S + 0.04;
    const lidMesh = CreateBox('story:hatch:lid', { width: L, height: 0.045, depth: L }, sc);
    lidMesh.bakeTransformIntoVertices(Matrix.Translation(0, 0.0225, -L / 2));
    const iron: Mesh[] = [];
    for (const x of [-L / 2 + 0.16, L / 2 - 0.16]) {
      const strap = CreateBox('story:hatch:strap', { width: 0.05, height: 0.006, depth: L * 0.72 }, sc);
      strap.bakeTransformIntoVertices(Matrix.Translation(x, 0.048, -L * 0.36 + 0.005));
      iron.push(strap);
    }
    const ring = CreateTorus('story:hatch:ring', { diameter: 0.11, thickness: 0.014, tessellation: 18 }, sc);
    ring.bakeTransformIntoVertices(Matrix.Translation(0, 0.052, -L + 0.11));
    iron.push(ring);
    const ringMesh = Mesh.MergeMeshes(iron, true, true)!;
    ringMesh.name = 'story:hatch:iron';
    for (const m of [lidMesh, ringMesh]) {
      m.position.copyFrom(hinge);
      m.rotation.set(0, yaw, 0);
      m.layerMask = PORTAL_LAYER;
      m.isPickable = false;
    }
    lidMesh.material = M.wood;
    ringMesh.material = M.iron;
    ms.push(lidMesh, ringMesh);
    const d: Deco = { id, kind: 'hatch', meshes: ms, x: c.x, y: c.y, y0, lid: lidMesh, ladder, yaw };
    (d as Deco & { ring: Mesh }).ring = ringMesh;
    this.poseHatch(d, this.used.has(id) ? 1 : 0);
    return d;
  }

  /** Верх плоских пропов пола (ниже 0.2 м) под точкой плана (м), над полом; нет — 0. */
  private flatPropTop(inst: RunInstance, x: number, y: number): number {
    const cell = this.host.cellM();
    let top = 0;
    for (const dc of inst.decor ?? []) {
      const p = this.host.props().find((q) => q.id === dc.propId);
      if (!p) continue;
      const h = propHeightM(p.tags, p.name);
      if (h > 0.2) continue;
      const r = Math.max(p.w, p.h) / 2 + 0.05;
      if (Math.abs(x - dc.x * cell) <= r && Math.abs(y - dc.y * cell) <= r) top = Math.max(top, h);
    }
    return top;
  }

  private poseHatch(d: Deco, lid: number) {
    const ring = (d as Deco & { ring?: Mesh }).ring;
    const th = HATCH_LID_OPEN * lid;
    for (const m of [d.lid, ring]) {
      if (!m || m.rotation.x === th) continue;
      m.rotation.x = th;
      m.computeWorldMatrix(true);
    }
    for (const m of d.ladder ?? []) m.setEnabled(lid > 0.25);
  }

  // ───────────────────────── дверь в снег ─────────────────────────

  private buildSnowDoor(id: string, inst: RunInstance): Deco | null {
    const k = inst.connectors.find((x) => x.id === SNOWDOOR_CONN);
    const slot = this.host.doorSlot(id, SNOWDOOR_CONN);
    const y0 = slot?.z ?? (Number(inst.z) || 0);
    let x: number, y: number, u: Vector3, w: number;
    if (slot) {
      const [x1, y1, x2, y2] = slot.line;
      x = (x1 + x2) / 2;
      y = (y1 + y2) / 2;
      u = new Vector3(slot.normal[0], 0, -slot.normal[1]);
      w = slot.widthM;
    } else if (k) {
      const p = snowDoorPlace(k, this.host.cellM());
      x = p.x;
      y = p.y;
      u = new Vector3(p.nx, 0, -p.ny);
      w = Math.min(DOOR_W, p.widthM);
    } else return null;
    // своя дверь: погреб — низкая дощатая, общага — во весь рост
    const h = slot?.heightM ?? (inst.roomTags.includes('общага') ? DOOR_H : DOOR_H_LOW);
    const sc = this.scene;
    const yaw = Math.atan2(u.x, u.z);
    const o = new Vector3(x, y0, -y);
    const snowMat = snowMaterials(sc).snow;
    const ms: Mesh[] = [];
    // снег в проёме: плотная неровная стена до притолоки (края вровень со стеной, внизу осыпается в комнату)
    const snow = snowFace(sc, w, h, hashStr(id));
    this.part(snow, 0, 0, 0, o, yaw, snowMat);
    ms.push(snow);
    // куча у порога: полусфера (низ — под полом), растёт при обвале
    const heap = CreateSphere('story:snow:heap', { diameter: 1, segments: 12 }, sc);
    this.part(heap, 0, 0, 0, o, yaw, snowMat);
    ms.push(heap);
    const d: Deco = { id, kind: 'snowdoor', meshes: ms, x, y, y0, u, snow, heap, slot, yaw, w, h };
    // панели нет — своя дверь
    if (!slot) d.leaf = this.ownLeaf(d);
    this.poseSnowDoor(d, this.used.has(id) ? { door: 1, snow: true, bulge: 1, heap: 1 } : { door: 0, snow: false, bulge: 0, heap: 0 });
    return d;
  }

  /** Своя дверь в проёме (в куске нет двери-панели метки): полотно у стены, петли слева; погреб — низкая дощатая,
   *  общага — крашеная. */
  private ownLeaf(d: Deco): Mesh {
    const M = this.materials(), sc = this.scene;
    const tags = this.host.inst(d.id)?.roomTags ?? [];
    const plank = !tags.includes('общага');
    const w = d.w ?? DOOR_W, h = Math.min(d.h ?? DOOR_H, plank ? DOOR_H_LOW : DOOR_H), yaw = d.yaw ?? 0;
    const along = new Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
    const hinge = new Vector3(d.x, d.y0, -d.y).subtract(along.scale(w / 2 + 0.02));
    const leaf = CreateBox('story:door:leaf', { width: w + 0.04, height: h + 0.02, depth: DOOR_T }, sc);
    leaf.bakeTransformIntoVertices(Matrix.Translation((w + 0.04) / 2, (h + 0.02) / 2, DOOR_T / 2 + 0.01));
    const knob = CreateBox('story:door:knob', { width: 0.12, height: 0.03, depth: 0.05 }, sc);
    knob.bakeTransformIntoVertices(Matrix.Translation(w - 0.08, 1.0, DOOR_T + 0.035));
    const m = Mesh.MergeMeshes([leaf, knob], true, true)!;
    m.name = 'story:door';
    m.material = plank ? M.wood : M.door;
    m.position.copyFrom(hinge);
    m.rotation.set(0, yaw, 0);
    m.layerMask = PORTAL_LAYER;
    m.isPickable = false;
    m.computeWorldMatrix(true);
    d.meshes.push(m);
    return m;
  }

  private poseSnowDoor(d: Deco, v: { door: number; snow: boolean; bulge: number; heap: number }) {
    const yaw = d.yaw ?? 0, u = d.u!;
    // своя дверь: распах в комнату (свободный край — к нормали)
    if (d.leaf) {
      const th = yaw - DOOR_OPEN * v.door;
      if (d.leaf.rotation.y !== th) {
        d.leaf.rotation.y = th;
        d.leaf.computeWorldMatrix(true);
      }
    }
    d.snow?.setEnabled(v.snow);
    if (v.snow && d.snow) {
      // треск: снег выпирает из проёма в комнату
      const o = new Vector3(d.x, d.y0, -d.y).add(u.scale(0.22 * v.bulge));
      if (!d.snow.position.equalsWithEpsilon(o, 1e-4)) {
        d.snow.position.copyFrom(o);
        d.snow.computeWorldMatrix(true);
      }
    }
    if (d.heap) {
      const k = v.heap;
      d.heap.setEnabled(k > 0.01);
      if (k > 0.01) {
        const w = d.w ?? DOOR_W;
        d.heap.scaling.set(w * 1.5 * (0.5 + 0.5 * k), 1.0 * k, 1.5 * k);
        const p = new Vector3(d.x, d.y0 - 0.05, -d.y).add(u.scale(0.15 + 0.35 * k));
        d.heap.position.copyFrom(p);
        d.heap.computeWorldMatrix(true);
      }
    }
  }

  private crumbsFx(d: Deco, on: boolean) {
    if (!on) {
      this.crumbs?.stop();
      return;
    }
    if (!this.crumbs) {
      const p = (this.crumbs = new ParticleSystem('story:crumbs', 600, this.scene));
      p.particleTexture = puffTexture(this.scene);
      p.minSize = 0.02;
      p.maxSize = 0.07;
      p.minLifeTime = 0.5;
      p.maxLifeTime = 0.9;
      p.gravity = new Vector3(0, -6, 0);
      p.direction1 = new Vector3(-0.15, -0.2, -0.15);
      p.direction2 = new Vector3(0.15, -0.5, 0.15);
      p.color1 = new Color4(0.92, 0.95, 1, 1);
      p.color2 = new Color4(0.8, 0.85, 0.92, 0.9);
      p.colorDead = new Color4(0.8, 0.85, 0.92, 0);
      p.blendMode = ParticleSystem.BLENDMODE_STANDARD;
    }
    const u = d.u!, w = d.w ?? DOOR_W, h = d.h ?? DOOR_H;
    const along = new Vector3(Math.cos(d.yaw ?? 0), 0, -Math.sin(d.yaw ?? 0));
    const c = new Vector3(d.x, d.y0 + h - 0.05, -d.y).add(u.scale(0.25));
    this.crumbs.emitter = c;
    const half = along.scale(w / 2);
    this.crumbs.minEmitBox = new Vector3(-Math.abs(half.x) - 0.02, 0, -Math.abs(half.z) - 0.02);
    this.crumbs.maxEmitBox = new Vector3(Math.abs(half.x) + 0.02, 0.05, Math.abs(half.z) + 0.02);
    this.crumbs.emitRate = 60;
    this.crumbs.start();
  }

  private puffFx(d: Deco) {
    if (!this.puff) {
      const p = (this.puff = new ParticleSystem('story:puff', 400, this.scene));
      p.particleTexture = puffTexture(this.scene);
      p.minSize = 0.25;
      p.maxSize = 0.8;
      p.minLifeTime = 0.8;
      p.maxLifeTime = 1.8;
      p.minEmitPower = 0.8;
      p.maxEmitPower = 2.4;
      p.color1 = new Color4(0.9, 0.93, 1, 0.6);
      p.color2 = new Color4(0.85, 0.9, 0.97, 0.4);
      p.colorDead = new Color4(0.85, 0.9, 0.97, 0);
      p.targetStopDuration = 0.3;
      p.blendMode = ParticleSystem.BLENDMODE_STANDARD;
    }
    const u = d.u!;
    // облако — из проёма в комнату
    this.puff.direction1 = new Vector3(u.x - 0.6, 0.1, u.z - 0.6);
    this.puff.direction2 = new Vector3(u.x + 0.6, 0.7, u.z + 0.6);
    this.puff.emitter = new Vector3(d.x, d.y0 + 1.0, -d.y).add(u.scale(0.3));
    this.puff.manualEmitCount = 300;
    this.puff.start();
  }

  dispose() {
    this.disposed = true;
    if (this.act) {
      this.posture.frozen = false;
      this.posture.roll = 0;
    }
    this.act = null;
    if (this.obs) this.scene.onBeforeRenderObservable.remove(this.obs);
    this.obs = null;
    window.removeEventListener('keydown', this.onKey);
    this.attached?.extraProviders.delete(this.provider);
    this.attached = null;
    for (const d of this.decos.values()) for (const m of d.meshes) m.dispose();
    this.decos.clear();
    this.crumbs?.dispose();
    this.puff?.dispose();
    this.snowAudio?.dispose();
    this.hatchAudio.dispose();
    if (this.mats) for (const m of Object.values(this.mats)) m.dispose(true, true);
    this.mats = null;
  }
}

/** Хэш строки (FNV-1a) — неровности снега у каждой двери свои. */
function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0) % 2147483647 || 1;
}

/**
 * Снег в проёме двери: сетка w × h (локально: x вдоль стены от середины, y вверх от пола, z — в комнату) с буграми; края
 * по бокам и у притолоки — вровень со стеной (за закрытым полотном не видно), внизу снег осыпается в комнату.
 */
function snowFace(scene: Scene, w: number, h: number, seed: number): Mesh {
  const nx = 12, ny = 20;
  let s = seed;
  const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
  const ph = Array.from({ length: 6 }, () => rnd() * Math.PI * 2);
  const pos: number[] = [], uv: number[] = [], col: number[] = [];
  const idx: number[] = [];
  for (let j = 0; j <= ny; j++) {
    for (let i = 0; i <= nx; i++) {
      const u = i / nx, v = j / ny;
      const side = Math.min(1, 5 * Math.min(u, 1 - u));
      const edge = side * Math.min(1, 6 * (1 - v));
      const bump = 0.5 + 0.25 * Math.sin(u * 7 + ph[0] + Math.sin(v * 5 + ph[1])) + 0.25 * Math.sin(v * 11 + ph[2] + u * 3 * Math.sin(ph[3]));
      const slump = 0.2 * (1 - v) ** 3 * (0.4 + 0.6 * side);
      const z = 0.004 + edge * (0.05 * bump + 0.015 * rnd()) + slump;
      pos.push((u - 0.5) * w, v * h, z);
      uv.push(u * w, v * h);
      // у косяков и притолоки — в тени проёма, впадины темнее бугров (холодный оттенок)
      const sh = (0.62 + 0.38 * Math.min(1, side * 1.4) * Math.min(1, (1 - v) * 9)) * (0.9 + 0.1 * bump);
      col.push(sh * 0.93, sh * 0.96, sh, 1);
    }
  }
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const a = j * (nx + 1) + i;
      idx.push(a, a + nx + 1, a + 1, a + 1, a + nx + 1, a + nx + 2);
    }
  }
  const nrm: number[] = [];
  VertexData.ComputeNormals(pos, idx, nrm);
  // нормали — в комнату (+z): обход граней мог дать наоборот
  let nz = 0;
  for (let k = 2; k < nrm.length; k += 3) nz += nrm[k];
  if (nz < 0) for (let k = 0; k < nrm.length; k++) nrm[k] = -nrm[k];
  const vd = new VertexData();
  vd.positions = pos;
  vd.indices = idx;
  vd.normals = nrm;
  vd.uvs = uv;
  vd.colors = col;
  const m = new Mesh('story:snow:face', scene);
  vd.applyToMesh(m);
  return m;
}

/** Доски крышки: 5 досок вдоль, щели темнее, волокна. */
function plankTexture(scene: Scene): RawTexture {
  const n = 64;
  const px = new Uint8Array(n * n * 4);
  let seed = 9173;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const tone = Array.from({ length: 5 }, () => 0.8 + 0.35 * rnd());
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const b = Math.floor((x / n) * 5);
      const gap = x % (n / 5) < 1.2;
      // волокна — вдоль доски (по v), чуть волнистые
      const grain = 0.9 + 0.08 * Math.sin(x * 2.3 + b * 5 + 1.6 * Math.sin(y * 0.11 + b * 3)) + 0.05 * (rnd() - 0.5);
      const k = gap ? 0.35 : tone[b] * grain;
      const i = (y * n + x) * 4;
      px[i] = Math.min(255, 104 * k);
      px[i + 1] = Math.min(255, 78 * k);
      px[i + 2] = Math.min(255, 54 * k);
      px[i + 3] = 255;
    }
  }
  const t = RawTexture.CreateRGBATexture(px, n, n, scene, true, false, Texture.TRILINEAR_SAMPLINGMODE);
  t.name = 'story:planks';
  return t;
}

/** Звук люка — процедурный WebAudio (по образцу ./snowAudio.ts): скрип петель, стук крышки об пол, шаги по перекладинам. */
class HatchAudio {
  private ctx: AudioContext | null = null;
  private noise: AudioBuffer | null = null;

  async start(): Promise<void> {
    if (!this.ctx) {
      const AC = (window as unknown as { AudioContext?: typeof AudioContext }).AudioContext;
      if (!AC) return;
      this.ctx = new AC();
      const n = Math.floor(this.ctx.sampleRate * 1.5);
      const b = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
      const d = b.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
      this.noise = b;
    }
    if (this.ctx.state !== 'running') {
      try {
        await this.ctx.resume();
      } catch {}
    }
  }

  /** Скрип петель: пила с дрожащей высотой сквозь узкий фильтр. */
  creak() {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(70, t);
    for (let k = 1; k <= 8; k++) o.frequency.linearRampToValueAtTime(70 + 50 * Math.random() + k * 4, t + k * 0.09);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 780;
    bp.Q.value = 7;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.22, t + 0.08);
    g.gain.setValueAtTime(0.22, t + 0.6);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.85);
    o.connect(bp).connect(g).connect(ctx.destination);
    o.start(t);
    o.stop(t + 0.9);
  }

  /** Крышка упала на пол: глухой деревянный удар. */
  thud(at = 0, gain = 0.7) {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running' || !this.noise) return;
    const t = ctx.currentTime + at;
    const s = ctx.createBufferSource();
    s.buffer = this.noise;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 260;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
    s.connect(lp).connect(g).connect(ctx.destination);
    s.start(t);
    s.stop(t + 0.4);
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(95, t);
    o.frequency.exponentialRampToValueAtTime(48, t + 0.2);
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.0001, t);
    og.gain.exponentialRampToValueAtTime(gain * 0.6, t + 0.01);
    og.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
    o.connect(og).connect(ctx.destination);
    o.start(t);
    o.stop(t + 0.3);
  }

  /** Спуск: шаги по перекладинам — тише и глуше с каждым. */
  steps() {
    for (let k = 0; k < 3; k++) this.thud(0.35 + k * 0.38, 0.22 * (1 - k * 0.25));
  }

  dispose() {
    void this.ctx?.close();
    this.ctx = null;
  }
}
