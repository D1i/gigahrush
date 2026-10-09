// «Прогулка» в снежных ходах (биом «Снежные тоннели», docs/GENERATOR-4D.md §20): то, чего нет у обычных комнат.
//
//  • Поза — общая поза от первого лица (./posture.ts, клавиша C): вошёл в снег — игрок опускается на четвереньки
//    (глаз 0.5 м, эллипсоид 0.56 м — пролезает в лаз 0.9 м; ход и руки в варежках); в берлоге можно встать скрючившись
//    (C); скрючившись упёрся в низкий свод лаза — снова на четвереньки сам. Ушёл из снега — встаёт.
//    Коллизии — полость снега (src/view3d/snowView.ts); камеру поставили выше пола лаза — сразу на пол.
//  • Туман и холодный свет: вдаль почти ничего не видно (линейный туман 1.2…7 м), свет у игрока — холодный.
//  • Обвал (src/locations/snowCollapse.ts): метры ползком в лазах → место (host.pickSite) → треск и сыплется снег →
//    обвал: проём завален навсегда (host.collapse), глыбы набора (snow_chunks.glb) падают; игрок у места — засыпан:
//    белая пелена, E — откапываться (digSelf нажатий; напарник — digMate), откопался — на своей стороне завала.
//  • Раскопка завала: у пробки (ближе 1.2 м к проёму с завалом) — «Завал. E — разгребать (n/N)»; каждое нажатие —
//    работа 1/clear (мир — host.dig → WorldOp 'dig': в коопе нажатия всех игроков складываются, у всех одинаково);
//    четверть раскопана — пробка меньше; до конца — лаз снова открыт, глыбы у него убираются.
//  • Звук (./snowAudio.ts): ветер над снегом, хруст ползком, треск свода со стороны обвала, удар, засыпан — глухо и
//    сердце, капли у подтаявшего пятна, удары по нему. Включается первым нажатием клавиши / кликом (автоплей);
//    выключить — localStorage 'room-forge/snow-sound' = '0'.
//  • Подтаявший снег (src/locations/hangar.ts): в подтаявшей берлоге пятно в полу (меш куска — snowView), тёплый свет
//    снизу, капли; ближе 1.1 м — «E — бить»; трещины растут; последний удар — host.onBreak (сцена ангара, падение).
import type { Scene } from '@babylonjs/core/scene';
import type { UniversalCamera } from '@babylonjs/core/Cameras/universalCamera';
import type { Camera } from '@babylonjs/core/Cameras/camera';
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh';
import type { Observer } from '@babylonjs/core/Misc/observable';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { PointLight } from '@babylonjs/core/Lights/pointLight';
import { Ray } from '@babylonjs/core/Culling/ray';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { ParticleSystem } from '@babylonjs/core/Particles/particleSystem';
import '@babylonjs/core/Particles/particleSystemComponent';
import { LoadAssetContainerAsync } from '@babylonjs/core/Loading/sceneLoader';
import '@babylonjs/loaders/glTF/2.0/glTFLoader';
import '@babylonjs/loaders/glTF/2.0/Extensions/KHR_mesh_quantization';
import chunksUrl from './assets/snow_chunks.glb?url';
import type { RunInstance } from '../blockout/types';
import {
  createCollapse, digCollapse, postponeCollapse, startCollapse, stepCollapse, DEFAULT_COLLAPSE,
  type CollapseEvent, type CollapseSite, type CollapseSpec, type CollapseState,
} from '../locations/snowCollapse';
import { createThaw, strikeThaw, type HangarRoll, type ThawState } from '../locations/hangar';
import { puffTexture } from '../locations/liftTextures';
import { isSnowRoom, snowMaterials, thawPatchOf } from './snowView';
import { SnowAudio } from './snowAudio';
import { ROOM_CROUCH, type Posture } from './posture';

const SOUND_KEY = 'room-forge/snow-sound';

const THAW_NEAR = 1.1;
/** раскопка: ближе стольких метров к проёму с завалом */
const PLUG_NEAR = 1.2;
const COLD = new Color3(0.88, 0.93, 1);
/** свет у игрока в снегу: ярче и дальше, чем в тёмных биомах (снег отражает) */
const LAMP = { intensity: 0.95, range: 5.5 };
/** туман в снегу: вдаль почти ничего не видно */
const FOG = { start: 1.2, end: 7, color: new Color3(0.012, 0.015, 0.022) };
const CELL = 0.1;

export interface SnowHud {
  /** засыпан: прогресс откопки 0…1 */
  buried: number | null;
  /** треск: сыплется снег (0…1 — скоро рухнет) */
  crack: number | null;
  /** подсказка у пятна */
  prompt: string | null;
  /** поза */
  pose: 'crawl' | 'crouch' | null;
}

export interface SnowWalkHost {
  /** комната под ногами (экземпляр экспорта) */
  room(): { id: string; inst: RunInstance } | null;
  /** место обвала у игрока (план, метры) или null — нельзя (запрёт игрока) */
  pickSite(roomId: string, x: number, y: number): CollapseSite | null;
  /** обвал: мир заваливает проём навсегда (кусок — с пробкой) */
  collapse(site: CollapseSite): void;
  /** розыгрыш ангара подтаявшей берлоги (null — не подтаявшая) */
  thawOf(roomId: string): HangarRoll | null;
  /** доля раскопки завала у метки (0…1; null — завала нет) */
  digProgress(inst: string, conn: string): number | null;
  /** раскопать завал: работа amount (доля); в коопе — операция мира у всех */
  dig(inst: string, conn: string, amount: number): void;
  /** пятно пробито — провал в ангар */
  onBreak(roomId: string): void;
  onHud(h: SnowHud): void;
  /** можно ли сейчас управлять (нет спец-сцены поверх, режим от первого лица) */
  live(): boolean;
}

export class SnowWalk {
  on = false;
  private saved: { fog: number; fogStart: number; fogEnd: number; fogColor: Color3 } | null = null;
  private lampObs: Observer<Camera> | null = null;
  private last: Vector3 | null = null;
  private obs: Observer<Scene> | null = null;
  private col: CollapseState;
  private spec: CollapseSpec = DEFAULT_COLLAPSE;
  private crumbs: ParticleSystem | null = null;
  private puff: ParticleSystem | null = null;
  private thaw = new Map<string, ThawState>();
  private nearThaw: string | null = null;
  /** завал рядом (проём с пробкой в комнате игрока) */
  private nearPlug: { inst: string; conn: string; x: number; y: number } | null = null;
  private chunkCheck = 0;
  private drips: ParticleSystem | null = null;
  private glow: PointLight | null = null;
  private chunks: Mesh[] = [];
  private falling: { mesh: Mesh; v: Vector3; floor: number; site?: CollapseSite }[] = [];
  private hudKey = '';
  private shake = 0;
  private onKey = (e: KeyboardEvent) => this.key(e);
  /** звук снега; запускается по жесту (клавиша, клик) */
  readonly audio = new SnowAudio(typeof localStorage === 'undefined' || localStorage.getItem(SOUND_KEY) !== '0');
  private onGesture = () => {
    if (this.on) void this.audio.start();
  };
  /** обвал, пока глыбы набора ещё грузятся, — глыбы упадут, как загрузятся */
  private pendingChunks: { site: CollapseSite; y: number }[] = [];
  private colliders: AbstractMesh[] = [];
  private collidersAt = 0;

  constructor(
    private readonly scene: Scene,
    private readonly cam: UniversalCamera,
    private readonly host: SnowWalkHost,
    seed: string,
    /** поза от первого лица (BlockoutViewer.posture) */
    readonly posture: Posture,
  ) {
    this.col = createCollapse(this.spec, seed);
    this.obs = scene.onBeforeRenderObservable.add(() => this.frame());
    window.addEventListener('keydown', this.onKey);
    window.addEventListener('keydown', this.onGesture);
    window.addEventListener('pointerdown', this.onGesture);
    void LoadAssetContainerAsync(chunksUrl, scene, { pluginExtension: '.glb' }).then((c) => {
      for (const m of c.meshes) {
        if (!(m instanceof Mesh) || !m.getTotalVertices()) continue;
        const W = m.computeWorldMatrix(true).clone();
        m.setParent(null);
        m.bakeTransformIntoVertices(W);
        m.material = snowMaterials(scene).snow;
        m.setEnabled(false);
        m.isPickable = false;
        scene.addMesh(m);
        this.chunks.push(m);
      }
      for (const p of this.pendingChunks.splice(0)) this.dropChunks(p.site, p.y);
    }, () => {});
  }

  /** Состояние обвалов (для сохранения/QA). */
  get collapse(): CollapseState {
    return this.col;
  }

  private frame() {
    const dt = Math.min(0.1, this.scene.getEngine().getDeltaTime() / 1000 || 1 / 60);
    // комната на миг не определилась (мир пересобирается) — состояние не трогать: иначе поза дёргалась бы
    // «встал — на четвереньки», и в лаз было не пролезть
    const live = this.host.live();
    const r = live ? this.host.room() : null;
    if (live && !r) return;
    const snow = !!r && isSnowRoom(r.inst);
    if (snow !== this.on) (snow ? this.enter() : this.leave());
    this.audio.setInSnow(snow);
    this.chunksStep(dt);
    if (!snow || !r) {
      this.emit({ buried: null, crack: null, prompt: null, pose: null });
      return;
    }
    const den = r.inst.roomTags.includes('берлога');
    this.fog();
    // свет у игрока — холодный (поверх тёплого «настроения» биома, src/view3d/biomeMood.ts)
    const lamp = this.scene.getLightByName('mood:lamp') as PointLight | null;
    if (lamp && !lamp.diffuse.equals(COLD)) {
      lamp.diffuse = COLD.clone();
      lamp.intensity = LAMP.intensity;
      lamp.range = LAMP.range;
    }
    // ── поза — общая (C); здесь: камеру поставили выше пола лаза (переход, загрузка — стоя, над сводом лаза) — сразу на
    // пол; скрючившись упёрся в низкий свод впереди — на четвереньки
    const P = this.posture;
    const c = this.cam.position;
    // высота низа комнаты (за настоящими лестницами мир выше/ниже — RunInstance.z; кусок и оболочка уже подняты)
    const z0 = Number(r.inst.z) || 0;
    const floor = this.floorBelow(c.x, c.z, z0);
    if (floor !== null && c.y - P.eye > floor + 0.3) {
      c.y = floor + P.eye + 0.02;
      this.last = null;
    }
    if (P.pose !== 'crawl') {
      const fwd = this.cam.getDirection(Vector3.Forward());
      const ahead = this.ceiling(c.x + fwd.x * 0.45, P.feet, c.z + fwd.z * 0.45);
      if (ahead < ROOM_CROUCH || this.ceiling(c.x, P.feet, c.z) < ROOM_CROUCH) P.set('crawl');
    }
    const crouch = P.pose !== 'crawl';
    P.frozen = this.col.phase === 'buried';
    const p = new Vector3(c.x, 0, c.z);
    const moved = this.last ? Vector3.Distance(p, this.last) : 0;
    this.last = p;
    const px = c.x, py = -c.z;
    for (const e of stepCollapse(this.spec, this.col, dt, den || crouch || moved > 1 ? 0 : moved, { x: px, y: py })) this.onEvent(e, r.id);
    // тряска (треск, обвал) — крен поверх хода
    this.shake = Math.max(0, this.shake - dt * 1.5);
    P.roll = this.shake > 0 ? (Math.random() - 0.5) * 0.03 * this.shake : 0;
    // ── подтаявший снег
    const roll = this.host.thawOf(r.id);
    let prompt: string | null = null;
    this.nearThaw = null;
    if (roll) {
      this.thawFx(r.inst, true);
      const s = this.thawState(r.id, roll);
      const pc = this.patchCenter(r.inst);
      if (pc && Math.hypot(px - pc.x, py - pc.y) < THAW_NEAR && !s.broken) {
        this.nearThaw = r.id;
        prompt = s.hits ? `E — бить подтаявший снег (${s.hits}/${s.need})` : 'Подтаявший снег. E — бить';
      }
    } else this.thawFx(null, false);
    // ── завал рядом: раскопка (E)
    this.nearPlug = null;
    if (!this.nearThaw) {
      let bd = PLUG_NEAR;
      for (const k of r.inst.connectors) {
        if (!k.collapsed || k.len < 1) continue;
        const x = ((k.line[0] + k.line[2]) / 2) * CELL, y = ((k.line[1] + k.line[3]) / 2) * CELL;
        const d = Math.hypot(px - x, py - y);
        if (d < bd) {
          bd = d;
          this.nearPlug = { inst: r.id, conn: k.id, x, y };
        }
      }
      if (this.nearPlug) {
        const p = this.host.digProgress(this.nearPlug.inst, this.nearPlug.conn) ?? 0;
        prompt = `Завал. E — разгребать (${Math.round(p * this.spec.clear)}/${this.spec.clear})`;
      }
    }
    // глыбы у раскопанных завалов — убрать
    this.chunkCheck -= dt;
    if (this.chunkCheck <= 0) {
      this.chunkCheck = 0.5;
      this.falling = this.falling.filter((f) => {
        if (!f.site || this.host.digProgress(f.site.inst, f.site.connector) !== null) return true;
        f.mesh.dispose();
        return false;
      });
    }
    const buried = this.col.phase === 'buried' ? this.col.dig : null;
    const crack = this.col.phase === 'warn' ? Math.min(1, this.col.t / this.spec.warnS) : null;
    if (buried !== null) prompt = `Засыпало! E — откапываться (${Math.round(buried * this.spec.digSelf)}/${this.spec.digSelf})`;
    this.emit({ buried, crack, prompt, pose: crouch ? 'crouch' : 'crawl' });
    // звук: хруст по пути, треск — со стороны обвала, капли — по близости к пятну
    let crackPan = 0;
    const site = this.col.site;
    if (site) {
      const dx = site.x - c.x, dz = -site.y - c.z, l = Math.hypot(dx, dz) || 1;
      const yaw = this.cam.rotation.y;
      crackPan = (dx / l) * Math.cos(yaw) - (dz / l) * Math.sin(yaw);
    }
    let thaw = 0;
    if (roll) {
      const pc = this.patchCenter(r.inst)!;
      thaw = Math.max(0, 1 - Math.hypot(px - pc.x, py - pc.y) / 4);
    }
    this.audio.update(dt, { moved: moved > 1 ? 0 : moved, crouch, buried: buried !== null, crack, crackPan, thaw });
  }

  /** Пол полости под (x, z): первое пересечение луча снизу вверх с коллайдерами снега (полость замкнута — снизу первым
   *  встречается её пол); null — коллайдера под точкой нет. */
  private floorBelow(x: number, z: number, z0 = 0): number | null {
    const ray = new Ray(new Vector3(x, z0 - 1.6, z), Vector3.Up(), 3.2);
    let best: number | null = null;
    for (const m of this.colliders) {
      const hit = ray.intersectsMesh(m as Mesh, false);
      if (hit.hit && (best === null || hit.distance < best)) best = hit.distance;
    }
    return best === null ? null : z0 - 1.6 + best;
  }

  /** Свод над (x, feet, z): ближайшее пересечение луча вверх с коллайдерами снега. */
  private ceiling(x: number, feet: number, z: number): number {
    const now = performance.now();
    if (now - this.collidersAt > 150) {
      this.collidersAt = now;
      this.colliders = this.scene.meshes.filter((m) => m.checkCollisions && m.name.endsWith(':snowcol'));
    }
    const ray = new Ray(new Vector3(x, feet + 0.25, z), Vector3.Up(), 2);
    let best = 1.6;
    for (const m of this.colliders) {
      const hit = ray.intersectsMesh(m as Mesh, false);
      if (hit.hit && hit.distance + 0.25 < best) best = hit.distance + 0.25;
    }
    return best;
  }

  private enter() {
    this.on = true;
    const c = this.cam, s = this.scene;
    this.saved = { fog: s.fogMode, fogStart: s.fogStart, fogEnd: s.fogEnd, fogColor: s.fogColor.clone() };
    // вошёл в снег — на четвереньки (эллипсоид сразу низкий, глаз опускается плавно)
    this.posture.set('crawl');
    this.fog();
    this.last = null;
    // свет у игрока — у глаз (настроение биома вешает его на 0.35 м выше: в лазе 0.9 м это над сводом — стены светились
    // бы снаружи и в кадре была бы темнота); после всех onBeforeRender — перед кадром камеры
    if (!this.lampObs) {
      this.lampObs = s.onBeforeCameraRenderObservable.add(() => {
        if (!this.on) return;
        const lamp = s.getLightByName('mood:lamp') as PointLight | null;
        if (!lamp) return;
        const p = c.position, fwd = c.getDirection(Vector3.Forward());
        lamp.position.set(p.x + fwd.x * 0.15, p.y - 0.04, p.z + fwd.z * 0.15);
      });
    }
  }

  /** Туман снега; поменял его кто-то другой (страница: «туман» в панели) — это его новое «как было», снег — поверх. */
  private fog() {
    const s = this.scene, sv = this.saved;
    if (s.fogMode === 3 && s.fogEnd === FOG.end && s.fogStart === FOG.start) return;
    if (sv) {
      sv.fog = s.fogMode;
      sv.fogStart = s.fogStart;
      sv.fogEnd = s.fogEnd;
      sv.fogColor = s.fogColor.clone();
    }
    s.fogMode = 3; // LINEAR
    s.fogStart = FOG.start;
    s.fogEnd = FOG.end;
    s.fogColor = FOG.color.clone();
  }

  private leave() {
    this.on = false;
    const s = this.scene, sv = this.saved;
    if (!sv) return;
    // ушёл из снега (ангар, другой биом, облёт) — встаёт
    this.posture.frozen = false;
    this.posture.roll = 0;
    if (this.posture.pose !== 'stand') this.posture.set('stand');
    if (this.lampObs) s.onBeforeCameraRenderObservable.remove(this.lampObs);
    this.lampObs = null;
    s.fogMode = sv.fog;
    s.fogStart = sv.fogStart;
    s.fogEnd = sv.fogEnd;
    s.fogColor = sv.fogColor;
    this.saved = null;
    this.thawFx(null, false);
  }

  // ───────────────────────── обвал ─────────────────────────

  private onEvent(e: CollapseEvent, roomId: string) {
    if (e.type === 'due') {
      const c = this.cam.position;
      const site = this.host.pickSite(roomId, c.x, -c.z);
      if (site) startCollapse(this.spec, this.col, site);
      else postponeCollapse(this.spec, this.col);
      if (site) this.crackFx(site, true);
      return;
    }
    if (e.type === 'crumbs') {
      if (this.crumbs) this.crumbs.emitRate = 40 + 260 * e.k;
      this.shake = Math.max(this.shake, 0.3 + 0.7 * e.k);
      return;
    }
    if (e.type === 'fall') {
      this.crackFx(e.site, false);
      this.fallFx(e.site);
      {
        const c = this.cam.position;
        const dx = e.site.x - c.x, dz = -e.site.y - c.z, l = Math.hypot(dx, dz) || 1, yaw = this.cam.rotation.y;
        this.audio.fall((dx / l) * Math.cos(yaw) - (dz / l) * Math.sin(yaw), e.buried);
      }
      this.host.collapse(e.site);
      this.shake = 1.5;
      return;
    }
    if (e.type === 'freed') this.freed(e.site);
  }

  private key(e: KeyboardEvent) {
    if (e.code !== 'KeyE' || e.repeat || !this.on || !this.host.live()) return;
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
    if (this.col.phase === 'buried') {
      for (const ev of digCollapse(this.spec, this.col, 'self')) if (ev.type === 'freed') this.freed(ev.site);
      this.audio.dig();
      this.shake = Math.max(this.shake, 0.35);
      return;
    }
    if (this.nearPlug && !this.nearThaw) {
      const pl = this.nearPlug;
      this.host.dig(pl.inst, pl.conn, 1 / this.spec.clear);
      this.audio.dig();
      this.shake = Math.max(this.shake, 0.25);
      // снег из-под рук
      if (this.puff) {
        this.puff.emitter = new Vector3(pl.x, this.cam.position.y - this.posture.eye + 0.3, -pl.y);
        this.puff.manualEmitCount = 25;
        this.puff.start();
      }
      return;
    }
    if (this.nearThaw) {
      const id = this.nearThaw;
      const roll = this.host.thawOf(id);
      if (!roll) return;
      const s = this.thawState(id, roll);
      for (const ev of strikeThaw(s)) {
        if (ev.type === 'strike') {
          thawPatchOf(this.scene, id)?.crack(ev.stage);
          this.audio.strike(ev.stage);
          this.shake = Math.max(this.shake, 0.6);
        }
        if (ev.type === 'break') {
          this.thawFx(null, false);
          this.audio.breakIn();
          this.host.onBreak(id);
        }
      }
    }
  }

  /** Напарник откапывает (кооператив; одиночная игра — для QA). */
  mateDig() {
    for (const ev of digCollapse(this.spec, this.col, 'mate')) if (ev.type === 'freed') this.freed(ev.site);
  }

  /** Откопался: на своей стороне завала — отступ от места обвала вглубь своего куска. */
  private freed(site: CollapseSite) {
    const c = this.cam.position;
    const dx = c.x - site.x, dz = c.z + site.y;
    const l = Math.hypot(dx, dz) || 1;
    const need = this.spec.buryM + 0.25;
    if (l < need) {
      c.x = site.x + (dx / l) * need;
      c.z = -site.y + (dz / l) * need;
    }
    this.shake = 0.5;
  }

  private crackFx(site: CollapseSite, on: boolean) {
    if (!on) {
      this.crumbs?.stop();
      return;
    }
    const y = this.cam.position.y - this.posture.eye;
    if (!this.crumbs) {
      const p = (this.crumbs = new ParticleSystem('snow:crumbs', 500, this.scene));
      p.particleTexture = puffTexture(this.scene);
      p.minSize = 0.015;
      p.maxSize = 0.06;
      p.minLifeTime = 0.5;
      p.maxLifeTime = 0.9;
      p.gravity = new Vector3(0, -6, 0);
      p.direction1 = new Vector3(-0.1, -0.2, -0.1);
      p.direction2 = new Vector3(0.1, -0.5, 0.1);
      p.color1 = new Color4(0.92, 0.95, 1, 1);
      p.color2 = new Color4(0.8, 0.85, 0.92, 0.9);
      p.colorDead = new Color4(0.8, 0.85, 0.92, 0);
      p.minEmitBox = new Vector3(-0.45, 0, -0.45);
      p.maxEmitBox = new Vector3(0.45, 0, 0.45);
      p.blendMode = ParticleSystem.BLENDMODE_STANDARD;
    }
    this.crumbs.emitter = new Vector3(site.x, y + 0.82, -site.y);
    this.crumbs.emitRate = 40;
    this.crumbs.start();
  }

  private fallFx(site: CollapseSite) {
    const y = this.cam.position.y - this.posture.eye;
    // облако снежной пыли
    if (!this.puff) {
      const p = (this.puff = new ParticleSystem('snow:puff', 300, this.scene));
      p.particleTexture = puffTexture(this.scene);
      p.minSize = 0.2;
      p.maxSize = 0.6;
      p.minLifeTime = 0.8;
      p.maxLifeTime = 1.6;
      p.minEmitPower = 0.3;
      p.maxEmitPower = 1.2;
      p.direction1 = new Vector3(-1, 0.2, -1);
      p.direction2 = new Vector3(1, 0.6, 1);
      p.color1 = new Color4(0.9, 0.93, 1, 0.55);
      p.color2 = new Color4(0.85, 0.9, 0.97, 0.35);
      p.colorDead = new Color4(0.85, 0.9, 0.97, 0);
      p.targetStopDuration = 0.25;
      p.manualEmitCount = 0;
      p.blendMode = ParticleSystem.BLENDMODE_STANDARD;
    }
    this.puff.emitter = new Vector3(site.x, y + 0.4, -site.y);
    this.puff.manualEmitCount = 220;
    this.puff.start();
    // глыбы набора падают с наста и ложатся у пробки (ещё грузятся — упадут, как загрузятся)
    if (!this.chunks.length) this.pendingChunks.push({ site, y });
    else this.dropChunks(site, y);
  }

  private dropChunks(site: CollapseSite, y: number) {
    for (let k = 0; k < this.chunks.length * 2; k++) {
      const src = this.chunks[k % this.chunks.length];
      const m = src.clone(`snow:chunk${Date.now()}_${k}`, null)!;
      m.setEnabled(true);
      m.position.set(site.x + (Math.random() - 0.5) * 0.9, y + 0.75 + Math.random() * 0.15, -site.y + (Math.random() - 0.5) * 0.9);
      m.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
      const s = 0.8 + Math.random() * 0.6;
      m.scaling.setAll(s);
      this.falling.push({ mesh: m, v: new Vector3((Math.random() - 0.5) * 0.6, 0, (Math.random() - 0.5) * 0.6), floor: y + 0.02 + Math.random() * 0.12, site });
    }
  }

  private chunksStep(dt: number) {
    for (const f of this.falling) {
      if (f.mesh.position.y <= f.floor) continue;
      f.v.y -= 9.8 * dt;
      f.mesh.position.addInPlace(f.v.scale(dt));
      if (f.mesh.position.y < f.floor) f.mesh.position.y = f.floor;
    }
    // старые глыбы (далеко позади) — убрать
    if (this.falling.length > 80) for (const f of this.falling.splice(0, this.falling.length - 80)) f.mesh.dispose();
  }

  // ───────────────────────── подтаявший снег ─────────────────────────

  private thawState(id: string, roll: HangarRoll): ThawState {
    let s = this.thaw.get(id);
    if (!s) this.thaw.set(id, (s = createThaw(roll)));
    return s;
  }

  /** Середина пятна (план, метры) — середина берлоги (клетка плана — 0.1 м, как у всех пресетов). */
  private patchCenter(inst: RunInstance): { x: number; y: number } | null {
    const b = inst.bbox;
    return { x: ((b.x0 + b.x1) / 2) * CELL, y: ((b.y0 + b.y1) / 2) * CELL };
  }

  /** Тёплый свет снизу и капли в подтаявшей берлоге. */
  private thawFx(inst: RunInstance | null, on: boolean) {
    if (!on || !inst) {
      this.drips?.stop();
      if (this.glow) this.glow.setEnabled(false);
      return;
    }
    const pc = this.patchCenter(inst)!;
    const y0 = Number(inst.z) || 0; // низ комнаты (RunInstance.z — за настоящими лестницами); этажи (floor) не поднимаются
    if (!this.glow) {
      const g = (this.glow = new PointLight('snow:thawGlow', Vector3.Zero(), this.scene));
      g.diffuse = new Color3(1, 0.6, 0.28);
      g.specular = new Color3(0.4, 0.25, 0.1);
      g.range = 2.4;
      g.intensity = 0.9;
    }
    this.glow.setEnabled(true);
    this.glow.position.set(pc.x, y0 + 0.12, -pc.y);
    this.glow.intensity = 0.75 + 0.15 * Math.sin(performance.now() / 700);
    if (!this.drips) {
      const p = (this.drips = new ParticleSystem('snow:drips', 60, this.scene));
      p.particleTexture = puffTexture(this.scene);
      p.minSize = 0.012;
      p.maxSize = 0.022;
      p.minLifeTime = 0.45;
      p.maxLifeTime = 0.6;
      p.gravity = new Vector3(0, -9.8, 0);
      p.direction1 = new Vector3(0, -0.1, 0);
      p.direction2 = new Vector3(0, -0.2, 0);
      p.color1 = new Color4(0.75, 0.85, 1, 0.9);
      p.color2 = new Color4(0.7, 0.8, 0.95, 0.8);
      p.colorDead = new Color4(0.7, 0.8, 0.95, 0);
      p.minEmitBox = new Vector3(-0.5, 0, -0.5);
      p.maxEmitBox = new Vector3(0.5, 0, 0.5);
      p.emitRate = 9;
      p.blendMode = ParticleSystem.BLENDMODE_STANDARD;
    }
    this.drips.emitter = new Vector3(pc.x, y0 + 1.2, -pc.y);
    if (!this.drips.isStarted()) this.drips.start();
  }

  private emit(h: SnowHud) {
    const k = `${h.buried?.toFixed(2)}|${h.crack !== null ? Math.round(h.crack * 10) : ''}|${h.prompt}|${h.pose}`;
    if (k === this.hudKey) return;
    this.hudKey = k;
    this.host.onHud(h);
  }

  dispose() {
    if (this.on) this.leave();
    if (this.obs) this.scene.onBeforeRenderObservable.remove(this.obs);
    window.removeEventListener('keydown', this.onKey);
    window.removeEventListener('keydown', this.onGesture);
    window.removeEventListener('pointerdown', this.onGesture);
    this.audio.dispose();
    this.crumbs?.dispose();
    this.puff?.dispose();
    this.drips?.dispose();
    this.glow?.dispose();
    for (const f of this.falling) f.mesh.dispose();
    for (const m of this.chunks) m.dispose();
  }
}
