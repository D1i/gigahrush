// «Прогулка» в снежных ходах (биом «Снежные тоннели», docs/GENERATOR-4D.md §20): то, чего нет у обычных комнат.
//
//  • Поза: в лазе — ползком (глаз ~0.5 м, медленно), в берлоге — скрючившись (глаз ~1.15 м); высота глаза — по своду
//    над головой (луч вверх в коллайдер снега), меняется плавно; эллипсоид камеры — низкий (0.56 м), коллизии —
//    полость снега (src/view3d/snowView.ts). Ушёл из снега — поза и скорость как были.
//  • Туман и холодный свет: вдаль почти ничего не видно (линейный туман 1.2…7 м), свет у игрока — холодный.
//  • Обвал (src/locations/snowCollapse.ts): метры ползком в лазах → место (host.pickSite) → треск и сыплется снег →
//    обвал: проём завален навсегда (host.collapse), глыбы набора (snow_chunks.glb) падают; игрок у места — засыпан:
//    белая пелена, E — откапываться (digSelf нажатий; напарник — digMate), откопался — на своей стороне завала.
//  • Подтаявший снег (src/locations/hangar.ts): в подтаявшей берлоге пятно в полу (меш куска — snowView), тёплый свет
//    снизу, капли; ближе 1.1 м — «E — бить»; трещины растут; последний удар — host.onBreak (сцена ангара, падение).
import type { Scene } from '@babylonjs/core/scene';
import type { UniversalCamera } from '@babylonjs/core/Cameras/universalCamera';
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

/** Эллипсоид в снегу: низкий — пролезает в лаз 0.9 м. */
const ELL = new Vector3(0.25, 0.28, 0.25);
const EYE_CRAWL = 0.5;
const EYE_CROUCH = 1.15;
const SPEED_CRAWL = 0.075;
const SPEED_CROUCH = 0.11;
const THAW_NEAR = 1.1;
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
  /** пятно пробито — провал в ангар */
  onBreak(roomId: string): void;
  onHud(h: SnowHud): void;
  /** можно ли сейчас управлять (нет спец-сцены поверх, режим от первого лица) */
  live(): boolean;
}

export class SnowWalk {
  private on = false;
  private saved: { ell: Vector3; off: Vector3; speed: number; fog: number; fogStart: number; fogEnd: number; fogColor: Color3 } | null = null;
  private eye = EYE_CRAWL;
  private last: Vector3 | null = null;
  private obs: Observer<Scene> | null = null;
  private col: CollapseState;
  private spec: CollapseSpec = DEFAULT_COLLAPSE;
  private crumbs: ParticleSystem | null = null;
  private puff: ParticleSystem | null = null;
  private thaw = new Map<string, ThawState>();
  private nearThaw: string | null = null;
  private drips: ParticleSystem | null = null;
  private glow: PointLight | null = null;
  private chunks: Mesh[] = [];
  private falling: { mesh: Mesh; v: Vector3; floor: number }[] = [];
  private hudKey = '';
  private shake = 0;
  private onKey = (e: KeyboardEvent) => this.key(e);
  private colliders: AbstractMesh[] = [];
  private collidersAt = 0;

  constructor(
    private readonly scene: Scene,
    private readonly cam: UniversalCamera,
    private readonly host: SnowWalkHost,
    seed: string,
  ) {
    this.col = createCollapse(this.spec, seed);
    this.obs = scene.onBeforeRenderObservable.add(() => this.frame());
    window.addEventListener('keydown', this.onKey);
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
    }, () => {});
  }

  /** Состояние обвалов (для сохранения/QA). */
  get collapse(): CollapseState {
    return this.col;
  }

  private frame() {
    const dt = Math.min(0.1, this.scene.getEngine().getDeltaTime() / 1000 || 1 / 60);
    const r = this.host.live() ? this.host.room() : null;
    const snow = !!r && isSnowRoom(r.inst);
    if (snow !== this.on) (snow ? this.enter() : this.leave());
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
    // ── поза: глаз — по своду над головой
    const c = this.cam.position;
    const feet = c.y - this.eye;
    const room = this.ceiling(c.x, feet, c.z);
    const want = Math.max(EYE_CRAWL - 0.08, Math.min(EYE_CROUCH, room - 0.2));
    const eye = this.eye + (want - this.eye) * Math.min(1, dt * 6);
    c.y += eye - this.eye;
    this.eye = eye;
    this.cam.ellipsoidOffset.y = 2 * ELL.y - eye;
    const crouch = eye > 0.85;
    this.cam.speed = this.col.phase === 'buried' ? 0 : crouch ? SPEED_CROUCH : SPEED_CRAWL;
    // ── обвал: метры ползком в лазах
    const p = new Vector3(c.x, 0, c.z);
    const moved = this.last ? Vector3.Distance(p, this.last) : 0;
    this.last = p;
    const px = c.x, py = -c.z;
    for (const e of stepCollapse(this.spec, this.col, dt, den || moved > 1 ? 0 : moved, { x: px, y: py })) this.onEvent(e, r.id);
    if (this.shake > 0) {
      this.shake = Math.max(0, this.shake - dt * 1.5);
      this.cam.rotation.z = (Math.random() - 0.5) * 0.03 * this.shake;
    } else if (this.cam.rotation.z !== 0) this.cam.rotation.z = 0;
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
    const buried = this.col.phase === 'buried' ? this.col.dig : null;
    const crack = this.col.phase === 'warn' ? Math.min(1, this.col.t / this.spec.warnS) : null;
    if (buried !== null) prompt = `Засыпало! E — откапываться (${Math.round(buried * this.spec.digSelf)}/${this.spec.digSelf})`;
    this.emit({ buried, crack, prompt, pose: crouch ? 'crouch' : 'crawl' });
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
    this.saved = {
      ell: c.ellipsoid.clone(),
      off: c.ellipsoidOffset.clone(),
      speed: c.speed,
      fog: s.fogMode,
      fogStart: s.fogStart,
      fogEnd: s.fogEnd,
      fogColor: s.fogColor.clone(),
    };
    // глаз — с прежней высоты (стоя 1.6) на уровень лаза: камера опускается, эллипсоид — низкий, ноги на месте
    const was = c.ellipsoid.y * 2 - c.ellipsoidOffset.y;
    const feet = c.position.y - was;
    this.eye = EYE_CRAWL;
    c.ellipsoid.copyFrom(ELL);
    c.ellipsoidOffset.set(0, 2 * ELL.y - this.eye, 0);
    c.position.y = feet + this.eye;
    this.fog();
    this.last = null;
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
    const c = this.cam, s = this.scene, sv = this.saved;
    if (!sv) return;
    const feet = c.position.y - this.eye;
    c.ellipsoid.copyFrom(sv.ell);
    c.ellipsoidOffset.copyFrom(sv.off);
    c.speed = sv.speed;
    c.position.y = feet + (sv.ell.y * 2 - sv.off.y);
    c.rotation.z = 0;
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
      this.shake = Math.max(this.shake, 0.35);
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
          this.shake = Math.max(this.shake, 0.6);
        }
        if (ev.type === 'break') {
          this.thawFx(null, false);
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
    const y = this.cam.position.y - this.eye;
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
    const y = this.cam.position.y - this.eye;
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
    // глыбы набора падают с наста и ложатся у пробки
    for (let k = 0; k < this.chunks.length * 2 && this.chunks.length; k++) {
      const src = this.chunks[k % this.chunks.length];
      const m = src.clone(`snow:chunk${Date.now()}_${k}`, null)!;
      m.setEnabled(true);
      m.position.set(site.x + (Math.random() - 0.5) * 0.9, y + 0.75 + Math.random() * 0.15, -site.y + (Math.random() - 0.5) * 0.9);
      m.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
      const s = 0.8 + Math.random() * 0.6;
      m.scaling.setAll(s);
      this.falling.push({ mesh: m, v: new Vector3((Math.random() - 0.5) * 0.6, 0, (Math.random() - 0.5) * 0.6), floor: y + 0.02 + Math.random() * 0.12 });
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
    const y0 = 0; // этажи в «Прогулке» не поднимаются (портальный рендер)
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
    this.crumbs?.dispose();
    this.puff?.dispose();
    this.drips?.dispose();
    this.glow?.dispose();
    for (const f of this.falling) f.mesh.dispose();
    for (const m of this.chunks) m.dispose();
  }
}
