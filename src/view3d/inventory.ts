// Руки игрока «Прогулки»: хотбар (src/game/hotbar.ts), фонарик в руке (./flashlight.ts) и предметы на полу
// (./worldItems.ts) — одним контроллером (Babylon + DOM-события, без React; HUD — через onHud, только когда изменился).
//  • Хотбар: HOTBAR_SIZE ячеек, в руке — выбранная. Сохраняется в localStorage `${walk.key}/hotbar` (у каждого мира и
//    лобби — свой); нет или мусор — START_KIT (включённый фонарик в первой ячейке).
//  • Клавиши (от первого лица, без спец-локации поверх, не в поле ввода): 1…5 — ячейка, колесо (мышь захвачена) — по
//    кругу, F — фонарь вкл/выкл (если он в руке; on хранится в ячейке), G — выбросить предмет из руки, E — подобрать
//    подсвеченный с пола.
//  • Мир меняется только операциями (кооп-журнал): выбросить — request({k:'drop'}) (ячейка пустеет сразу, не легло —
//    вернуть), подобрать — request({k:'pick'}) (кто первый — того и предмет; вернул id — в хотбар: в выбранную ячейку,
//    если пуста, иначе в первую пустую).
//  • E у подсвеченного предмета — раньше всех: слушатель окна в фазе захвата, stopImmediatePropagation (двери, лампа
//    общаги, раскопка напарника не срабатывают). Нечего подбирать — E не трогается.
//  • В руке — модель у фонаря и у керосиновой лампы общаги (KEROLAMP_ITEM: модель p_obsh_lantern у камеры и тёплый
//    свет — HeldLantern, ./obshagaScene.ts; в любом биоме); остальное пока без модели. В руке всегда один предмет — фонарь
//    в правой. Лампа выбрана в хотбаре — поле лампы (общага спрашивает lampHeld); на полу — тоже поле (общага берёт
//    лежащие лампы из drops()). Лампа со спота общаги — receive: в хотбар и в руку.
//  • Старое сохранение общаги (`${key}/obsh-lamp` = '1' — лампа была в руке до хотбара): лампа — в хотбар и в руку,
//    ключ стирается (один раз, в конструкторе).
//  • Кадр: фонарь (качание — по сдвигу камеры, бег — Sprint.state.mul, четвереньки — поза), предметы — по массиву
//    drops() (новый на каждое изменение; dropsRev у пересобранной копии мира начинается с 0 — по нему не решать),
//    подсветка ближайшего под взглядом (10 раз в секунду).
//  • Без дюпа и потерь: хотбар пишется сразу при каждом изменении, мир после удачного drop / pick — тоже сразу
//    (saveWorld, а не через 400 мс автосохранения); на pagehide — оба ещё раз.
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { Observer } from '@babylonjs/core/Misc/observable';
import type { Scene } from '@babylonjs/core/scene';
import type { WorldDrop } from '../gen4d/stream';
import { buildItems } from '../data/items';
import { HOTBAR_SIZE, START_KIT, add, cycle, held, hotbarJSON, newHotbar, parseHotbar, patch, select, take, type Hotbar, type Slot } from '../game/hotbar';
import { KEROLAMP_ITEM } from '../locations/obshaga';
import { Flashlight } from './flashlight';
import { HeldLantern } from './obshagaScene';
import type { PortalRenderer } from './portal';
import { RUN_MUL } from './sprint';
import type { BlockoutViewer } from './viewer';
import type { WorldOp } from './walk';
import { FLASHLIGHT_ITEM, WorldItems, dropPose } from './worldItems';

/** Подобрать — не дальше, м (по горизонтали, от глаза). */
const PICK_M = 1.6;
/** Как часто искать предмет под взглядом, мс. */
const AIM_MS = 100;
/** Колесо: шагов на «щелчок» — по накопленной прокрутке, px; пауза дольше — копить заново, мс. */
const WHEEL_STEP = 40;
const WHEEL_IDLE = 220;
/** Сдвиг камеры за кадр больше — перенос (шов, телепорт), не ход, м. */
const TELEPORT = 1.5;

// ───────────────────────── чистое (тесты — inventory.test.ts) ─────────────────────────

/** Ключ хотбара в localStorage: рядом с сохранением мира / лобби. */
export const hotbarKey = (walkKey: string): string => walkKey + '/hotbar';

/** Хотбар из сохранения; нет или мусор — набор новой игры. */
export function loadHotbar(text: string | null): Hotbar {
  return parseHotbar(text) ?? newHotbar(START_KIT);
}

/** Клавиша → ячейка 0…HOTBAR_SIZE − 1 (цифры над буквами и на цифровом блоке) или null. */
export function slotOfKey(code: string): number | null {
  const m = /^(?:Digit|Numpad)([1-9])$/.exec(code);
  if (!m) return null;
  const i = Number(m[1]) - 1;
  return i < HOTBAR_SIZE ? i : null;
}

/** id выброшенного предмета: игрок, время, случайный хвост (≤ 64 символов — предел WorldDrop). */
export function dropId(player: string | null | undefined, now: number, rnd: number): string {
  const p = (player || 'p').replace(/[^\w-]/g, '').slice(0, 12) || 'p';
  return `${p}-${Math.max(0, Math.floor(now)).toString(36)}-${Math.floor(Math.min(0.999999, Math.max(0, rnd)) * 36 ** 4).toString(36)}`;
}

/** Положить предмет в ячейку i (пуста) — иначе как add: в выбранную, если пуста, или в первую пустую. Полно — null. */
export function putBack(h: Hotbar, i: number, s: Slot): Hotbar | null {
  if (i >= 0 && i < HOTBAR_SIZE && !h.slots[i]) {
    const slots = h.slots.slice();
    slots[i] = { ...s };
    return { slots, sel: h.sel };
  }
  return add(h, s)?.h ?? null;
}

/** Предмет в руку: уже есть в хотбаре — выбрать его ячейку, нет — положить (как add) и выбрать. Места нет — null. */
export function holdItem(h: Hotbar, item: string): Hotbar | null {
  const i = h.slots.findIndex((s) => s?.item === item);
  if (i >= 0) return select(h, i);
  const a = add(h, { item });
  return a ? select(a.h, a.at) : null;
}

/** Старый ключ общаги (до хотбара): '1' — керосиновая лампа была в руке. */
export const obshLampKey = (walkKey: string): string => walkKey + '/obsh-lamp';

/** Старое сохранение общаги: лампа была в руке ('1') — в хотбар и в руку (уже есть — выбрать её); иначе или места нет —
 *  хотбар как был. */
export function migrateObshLamp(h: Hotbar, legacy: string | null): Hotbar {
  return legacy === '1' ? (holdItem(h, KEROLAMP_ITEM) ?? h) : h;
}

/** Ячейка для HUD. glyph — какой значок рисовать. */
export interface InvSlotHud {
  item: string;
  name: string;
  color: string;
  on: boolean;
  glyph: 'flash' | 'lamp' | 'box';
}

/** HUD рук: ячейки, выбранная, подсказка «E — подобрать», что в руке; seq растёт при смене предмета в руке (подпись
 *  над хотбаром проигрывается заново). */
export interface InventoryHud {
  slots: (InvSlotHud | null)[];
  sel: number;
  prompt: string | null;
  held: string | null;
  seq: number;
}

export interface ItemInfo {
  name: string;
  color: string;
}

let table: Map<string, ItemInfo> | null = null;
/** Имя и цвет предмета (src/data/items.ts); неизвестный — id и серый. */
export function itemInfo(item: string): ItemInfo {
  table ??= new Map(buildItems().map((i) => [i.id, { name: i.name, color: i.color }]));
  return table.get(item) ?? { name: item, color: '#9a9a9a' };
}

/** HUD по хотбару. */
export function inventoryHud(h: Hotbar, prompt: string | null, seq: number, info: (item: string) => ItemInfo = itemInfo): InventoryHud {
  const slots = h.slots.map((s): InvSlotHud | null => {
    if (!s) return null;
    const i = info(s.item);
    return { item: s.item, name: i.name, color: i.color, on: !!s.on, glyph: s.item === FLASHLIGHT_ITEM ? 'flash' : s.item === KEROLAMP_ITEM ? 'lamp' : 'box' };
  });
  return { slots, sel: h.sel, prompt, held: slots[h.sel]?.name ?? null, seq };
}

// ───────────────────────── контроллер ─────────────────────────

export interface InventoryHost {
  /** ключ мира прогулки (WalkSession.key): хотбар — `${key}/hotbar` */
  key: string;
  /** id игрока (кооп) — в id выброшенных предметов */
  playerId?: string | null;
  /** портальный рендер (FoldDriver.portal) */
  portal(): PortalRenderer | null;
  /** комната под ногами (портальный рендер — portal.current, иначе центр набора) */
  room(): string | null;
  /** без портального рендера: видна ли комната (набор PVS) */
  roomShown?(inst: string): boolean;
  /** лежащие предметы (WalkSession.drops: массив новый на каждое изменение) */
  drops(): readonly WorldDrop[];
  /** операция мира (WalkSession.request) */
  request(op: WorldOp): Promise<string | null>;
  /** сохранить мир сейчас (WalkSession.saveNow; кооп-мир — на сервере, ничего) */
  saveWorld?(): void;
  /** лампу в руке не показывать (общага: погиб — чёрный экран) */
  handsDown?(): boolean;
  /** вспышка-сообщение по центру */
  flash?(text: string, color?: string): void;
  onHud?(h: InventoryHud): void;
}

const typing = (e: Event): boolean => {
  const t = e.target as HTMLElement | null;
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
};

export class Inventory {
  readonly flashlight: Flashlight;
  /** керосиновая лампа общаги в руке (модель у камеры и тёплый свет) */
  readonly lantern: HeldLantern;
  readonly items: WorldItems;
  private h: Hotbar;
  private readonly scene: Scene;
  private readonly storeKey: string;
  private obs: Observer<Scene> | null;
  /** предмет под взглядом (подсвечен) */
  private target: WorldDrop | null = null;
  private aimAt = 0;
  /** подбираются / выбрасываются сейчас (ответ операции ещё не пришёл) */
  private picking = new Set<string>();
  private lastX: number | null = null;
  private lastZ = 0;
  /** скорость хода, сглаженная (покачивание лампы в руке), м/с */
  private speed = 0;
  private wheelAcc = 0;
  private wheelAt = 0;
  private seq = 0;
  private heldKey = '';
  private hudKey = '';
  private disposed = false;

  constructor(
    private readonly v: BlockoutViewer,
    private readonly host: InventoryHost,
  ) {
    this.scene = v.scene;
    this.storeKey = hotbarKey(host.key);
    let saved: string | null = null;
    try {
      saved = localStorage.getItem(this.storeKey);
    } catch {}
    this.h = loadHotbar(saved);
    // старое сохранение общаги: лампа была в руке до хотбара — в хотбар и в руку (один раз: ключ стирается)
    try {
      const lk = obshLampKey(host.key);
      const legacy = localStorage.getItem(lk);
      if (legacy !== null) {
        this.h = migrateObshLamp(this.h, legacy);
        this.persist();
        localStorage.removeItem(lk);
      }
    } catch {}
    this.flashlight = new Flashlight(v.scene, v.fps);
    this.lantern = new HeldLantern(v.scene, v.fps, () => v.props?.get('p_obsh_lantern') ?? null);
    const live = () => this.live;
    this.items = new WorldItems(v.scene, {
      portal: host.portal,
      roomShown: host.roomShown,
      shown: live,
      camera: () => v.fps,
      // лампа общаги на полу — её модель (фонарик — своя)
      itemModel: (item) => (item === KEROLAMP_ITEM ? (v.props?.get('p_obsh_lantern') ?? null) : null),
    });
    this.obs = v.scene.onBeforeRenderObservable.add(() => this.frame());
    window.addEventListener('pagehide', this.onHide);
    window.addEventListener('keydown', this.onPickKey, true);
    window.addEventListener('keydown', this.onKey);
    window.addEventListener('wheel', this.onWheel, { passive: true });
    this.emit(true);
  }

  /** От первого лица, без спец-локации поверх. */
  get live(): boolean {
    return this.v.mode === 'fps' && !this.v.hasOverlay;
  }

  /** Хотбар (только чтение). */
  get hotbar(): Hotbar {
    return this.h;
  }

  /** Предмет в руке. */
  get held(): Slot | null {
    return held(this.h);
  }

  /** Держит горящий фонарь (кооп: PlayerState.torch). */
  get torchOn(): boolean {
    const s = held(this.h);
    return this.live && s?.item === FLASHLIGHT_ITEM && !!s.on;
  }

  /** В руке керосиновая лампа общаги (выбрана в хотбаре): поле лампы, кооп — PlayerState.lamp. */
  get lampHeld(): boolean {
    return held(this.h)?.item === KEROLAMP_ITEM;
  }

  /** Свободных ячеек (за вычетом подбираемых сейчас). */
  get free(): number {
    return this.h.slots.filter((x) => !x).length - this.picking.size;
  }

  /** Предмет, который подберёт E (подсвечен), или null. */
  get aimed(): WorldDrop | null {
    return this.target && this.items.highlighted === this.target.id ? this.target : null;
  }

  // ───────────────────────── действия ─────────────────────────

  private set(h: Hotbar) {
    if (h === this.h) return;
    this.h = h;
    this.persist();
    this.emit();
  }

  private persist() {
    try {
      localStorage.setItem(this.storeKey, hotbarJSON(this.h));
    } catch {}
  }

  /** Вкладку закрывают / уходят: хотбар и мир — сейчас. */
  private onHide = () => {
    if (this.disposed) return;
    this.persist();
    this.host.saveWorld?.();
  };

  select(i: number) {
    this.set(select(this.h, i));
  }

  cycle(dir: 1 | -1) {
    this.set(cycle(this.h, dir));
  }

  /** F: фонарь в руке — вкл/выкл (состояние — в ячейке). false — в руке не фонарь. */
  toggleLight(): boolean {
    const s = held(this.h);
    if (s?.item !== FLASHLIGHT_ITEM) return false;
    this.set(patch(this.h, this.h.sel, { on: !s.on }));
    this.flashlight.setOn(!s.on);
    return true;
  }

  /** Предмет s, положенный перед игроком (куда ляжет выброшенный), или null — некуда. */
  private dropOf(s: Slot): WorldDrop | null {
    const inst = this.host.room();
    const p = inst ? dropPose(this.scene, this.v.fps, { inst, portal: this.host.portal(), eye: this.v.posture.eye, item: s.item }) : null;
    if (!p) return null;
    const id = dropId(this.host.playerId, Date.now(), Math.random());
    return { id, item: s.item, inst: p.inst, x: p.x, y: p.y, z: p.z, yaw: p.yaw, ...(s.item === FLASHLIGHT_ITEM ? { on: !!s.on } : s.on !== undefined ? { on: s.on } : {}) };
  }

  /** G: выбросить предмет из руки перед собой. Ячейка пустеет сразу; не легло — предмет обратно. */
  async dropHeld(): Promise<boolean> {
    const i = this.h.sel;
    const s = held(this.h);
    if (!s || this.disposed) return false;
    const d = this.dropOf(s);
    if (!d) {
      this.host.flash?.('Некуда положить', '#e0563f');
      return false;
    }
    this.set(take(this.h, i).h);
    const r = await this.host.request({ k: 'drop', d }).catch(() => null);
    if (r) {
      // мир — сразу вслед за хотбаром (иначе закрыл вкладку в эти 0.4 с — предмет пропал)
      this.host.saveWorld?.();
      return true;
    }
    if (this.disposed) return false;
    const back = putBack(this.h, i, s);
    if (back) this.set(back);
    this.host.flash?.('Не положить', '#e0563f');
    return false;
  }

  /** E: подобрать подсвеченный предмет. Хотбар полон — «Руки заняты», операция не уходит. */
  async pickUp(): Promise<boolean> {
    const d = this.aimed;
    if (!d || this.disposed || this.picking.has(d.id)) return false;
    const free = this.h.slots.filter((x) => !x).length - this.picking.size;
    if (free <= 0) {
      this.host.flash?.('Руки заняты', '#e0563f');
      return false;
    }
    this.picking.add(d.id);
    const r = await this.host.request({ k: 'pick', id: d.id }).catch(() => null);
    this.picking.delete(d.id);
    if (!r || this.disposed) return false;
    const s: Slot = d.on !== undefined ? { item: d.item, on: d.on } : { item: d.item };
    const a = add(this.h, s);
    if (a) {
      this.set(a.h);
      // мир — сразу вслед за хотбаром (иначе закрыл вкладку в эти 0.4 с — предмет задвоился)
      this.host.saveWorld?.();
      return true;
    }
    // руки заняли, пока шёл ответ (не должно быть: место считается заранее) — положить обратно, где лежал
    void this.host.request({ k: 'drop', d });
    this.host.flash?.('Руки заняты', '#e0563f');
    return false;
  }

  /** Предмет со стороны (лампа со спота общаги: операция мира уже прошла) — в хотбар и в руку; мир — сразу (закрыл
   *  вкладку — не задвоился). Руки заняли, пока шёл ответ (место проверяют заранее — free), — на пол перед собой. */
  receive(s: Slot): boolean {
    if (this.disposed) return false;
    const a = add(this.h, s);
    if (a) {
      this.set(select(a.h, a.at));
      this.host.saveWorld?.();
      return true;
    }
    const d = this.dropOf(s);
    if (d) void this.host.request({ k: 'drop', d }).then((r) => r && this.host.saveWorld?.(), () => null);
    this.host.flash?.('Руки заняты', '#e0563f');
    return false;
  }

  /** QA (общага giveLantern): on — предмет в руку (есть в хотбаре — выбрать, нет — положить), off — убрать из хотбара. */
  qaHold(item: string, on: boolean): boolean {
    if (on) {
      const h = holdItem(this.h, item);
      if (h) this.set(h);
      return !!h;
    }
    if (this.h.slots.some((s) => s?.item === item)) this.set({ slots: this.h.slots.map((s) => (s?.item === item ? null : s)), sel: this.h.sel });
    return true;
  }

  // ───────────────────────── ввод ─────────────────────────

  /** E — раньше всех (фаза захвата): есть что подобрать — подобрать, остальным E не достаётся. */
  private onPickKey = (e: KeyboardEvent) => {
    if (e.code !== 'KeyE' || this.disposed || !this.live || typing(e) || e.ctrlKey || e.metaKey || e.altKey) return;
    if (!this.aimed) return;
    e.stopImmediatePropagation();
    e.preventDefault();
    if (!e.repeat) void this.pickUp();
  };

  private onKey = (e: KeyboardEvent) => {
    if (this.disposed || !this.live || typing(e) || e.ctrlKey || e.metaKey || e.altKey) return;
    const i = slotOfKey(e.code);
    if (i !== null) {
      if (!e.repeat) this.select(i);
      return;
    }
    if (e.repeat) return;
    if (e.code === 'KeyF') this.toggleLight();
    else if (e.code === 'KeyG') void this.dropHeld();
  };

  /** Колесо — по кругу, пока мышь захвачена (от первого лица колесо больше ничего не делает). */
  private onWheel = (e: WheelEvent) => {
    if (this.disposed || !this.live || !document.pointerLockElement) return;
    const now = performance.now();
    if (now - this.wheelAt > WHEEL_IDLE) this.wheelAcc = 0;
    this.wheelAt = now;
    this.wheelAcc += e.deltaMode === 1 ? e.deltaY * 33 : e.deltaMode === 2 ? e.deltaY * 400 : e.deltaY;
    if (Math.abs(this.wheelAcc) < WHEEL_STEP) return;
    this.cycle(this.wheelAcc > 0 ? 1 : -1);
    this.wheelAcc = 0;
  };

  // ───────────────────────── кадр ─────────────────────────

  private frame() {
    if (this.disposed) return;
    const v = this.v;
    const live = this.live;
    const dt = Math.min(0.1, v.engine.getDeltaTime() / 1000 || 1 / 60);
    // в руке — выбранный: фонарь или керосиновая лампа (в руке всегда один предмет — фонарь в правой)
    const s = held(this.h);
    const flash = live && s?.item === FLASHLIGHT_ITEM;
    const f = this.flashlight;
    if (flash) f.setOn(!!s.on);
    f.setHeld(flash);
    this.lantern.show(live && s?.item === KEROLAMP_ITEM && !this.host.handsDown?.());
    // ход: сдвиг камеры за кадр (переносы — не ход)
    const c = v.fps.position;
    let step = 0;
    if (live && this.lastX !== null) {
      const d = Math.hypot(c.x - this.lastX, c.z - this.lastZ);
      if (d < TELEPORT) step = d;
    }
    this.lastX = live ? c.x : null;
    this.lastZ = c.z;
    f.update(dt, { speed: step / dt, sprint: (v.sprint.state.mul - 1) / (RUN_MUL - 1), crawl: v.posture.pose === 'crawl' ? 1 : v.posture.side ? 0.45 : 0 }); // side — боком в щели погреба: фонарь ниже
    this.speed += (step / dt - this.speed) * Math.min(1, dt * 6);
    this.lantern.update(dt, this.speed);
    // предметы на полу; под взглядом — подсветка и подсказка
    // по массиву, не по номеру версии: у пересобранной копии мира (кооп) dropsRev снова с 0
    const changed = this.items.sync(this.host.drops());
    const now = performance.now();
    if (!live) {
      if (this.target) {
        this.target = null;
        this.items.highlight(null);
      }
    } else if (now - this.aimAt > AIM_MS) {
      this.aimAt = now;
      const t = this.items.nearest(c, v.fps.getDirection(Vector3.Forward()), PICK_M);
      this.target = t;
      this.items.highlight(t?.id ?? null);
    }
    // выбросили / подобрали: построенные видны со следующего кадра — тогда и искать заново
    if (changed) this.aimAt = 0;
    this.emit();
  }

  /** HUD — только когда изменился (onHud зовёт setState страницы). */
  private emit(force = false) {
    const d = this.aimed;
    const prompt = d && this.live ? `E — подобрать: ${itemInfo(d.item).name}` : null;
    const s = held(this.h);
    const hk = `${this.h.sel}|${s?.item ?? ''}`;
    if (hk !== this.heldKey) {
      this.heldKey = hk;
      this.seq++;
    }
    const hud = inventoryHud(this.h, prompt, this.seq);
    const key = JSON.stringify(hud);
    if (!force && key === this.hudKey) return;
    this.hudKey = key;
    this.host.onHud?.(hud);
  }

  /** Для QA-скриптов (window.__rfInv). */
  qa() {
    return {
      inv: this,
      hotbar: () => this.h,
      hud: () => JSON.parse(this.hudKey || 'null') as InventoryHud | null,
      flash: () => ({ held: this.flashlight.held, on: this.flashlight.on, hand: this.flashlight.handSide, intensity: this.flashlight.light.intensity }),
      lamp: () => ({ held: this.lampHeld, shown: this.lantern.shown, light: this.lantern.light.isEnabled(), intensity: this.lantern.light.intensity }),
      aimed: () => this.aimed,
      items: this.items,
    };
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    if (this.obs) this.scene.onBeforeRenderObservable.remove(this.obs);
    this.obs = null;
    window.removeEventListener('pagehide', this.onHide);
    window.removeEventListener('keydown', this.onPickKey, true);
    window.removeEventListener('keydown', this.onKey);
    window.removeEventListener('wheel', this.onWheel);
    this.items.dispose();
    this.flashlight.dispose();
    this.lantern.dispose();
  }
}
