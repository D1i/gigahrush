// Руки «Прогулки» (./inventory.ts): чистое (ключ, загрузка хотбара, клавиши, id выброшенного, возврат в ячейку, HUD, лут,
// события руки, поза «лежит») и
// контроллер на NullEngine с поддельным хостом: выбросить (ячейка пустеет, операция drop; не легло — обратно), подобрать
// (операция pick; вернул id — в хотбар; руки полны — операция не уходит), фонарь в руке — по выбранной ячейке, F;
// керосиновая лампа общаги — предмет хотбара (в руке — модель и свет, на пол и обратно, со спота при полных руках — на
// пол, старое сохранение «лампа в руке» — в хотбар).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { UniversalCamera } from '@babylonjs/core/Cameras/universalCamera';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { HOTBAR_SIZE, START_KIT, hotbarJSON, newHotbar, type Hotbar } from '../game/hotbar';
import { normDrop, type WorldDrop } from '../gen4d/stream';
import type { WorldOp } from './walk';
import type { BlockoutViewer } from './viewer';
import { Flashlight } from './flashlight';
import {
  DURAK_HEAL, Inventory, LootFeed, SAVE_MS, SWEARS, dropId, eventText, fxChips, holdItem, hotbarKey, inventoryHud, isLootId, itemInfo, itemTip,
  loadHotbar, migrateObshLamp, obshLampKey, pickInto, putBack, slotOfDrop, slotOfKey,
} from './inventory';
import { downPose } from './inventoryFx';
import { newFx } from '../game/effects';
import { KEROLAMP_ITEM } from '../locations/obshaga';

const T = { timeout: 30000 };

describe('руки: чистое', () => {
  it('ключ хотбара — рядом с миром', () => {
    expect(hotbarKey('room-forge/world/abc')).toBe('room-forge/world/abc/hotbar');
  });

  it('нет сохранения или мусор — набор новой игры, иначе — как сохранено', () => {
    for (const t of [null, '', 'не json', '{"format":"чужой"}', '[1,2]']) {
      const h = loadHotbar(t);
      expect(h.sel).toBe(0);
      expect(h.slots).toHaveLength(HOTBAR_SIZE);
      expect(h.slots.slice(0, START_KIT.length)).toEqual(START_KIT);
      expect(h.slots.slice(START_KIT.length).every((s) => s === null)).toBe(true);
    }
    const saved = { slots: [null, { item: 'it_flashlight', on: false }, null, null, null], sel: 3 };
    expect(loadHotbar(hotbarJSON(saved))).toEqual(saved);
  });

  it('клавиши 1…5 (и цифровой блок) — ячейки, прочие — нет', () => {
    expect(slotOfKey('Digit1')).toBe(0);
    expect(slotOfKey('Digit5')).toBe(4);
    expect(slotOfKey('Numpad3')).toBe(2);
    expect(slotOfKey('Digit6')).toBeNull();
    expect(slotOfKey('Digit0')).toBeNull();
    expect(slotOfKey('KeyE')).toBeNull();
  });

  it('id выброшенного: годен для WorldDrop, разный по времени и случаю', () => {
    const a = dropId('3f1c2a9e-uuid-very-long-player-id-0000', 1760000000000, 0.123);
    const b = dropId('3f1c2a9e-uuid-very-long-player-id-0000', 1760000000001, 0.123);
    const c = dropId(null, 1760000000000, 0.999999999);
    expect(a).not.toBe(b);
    expect(c.startsWith('p-')).toBe(true);
    for (const id of [a, b, c, dropId('', 0, 0), dropId('<>"', 1, 1)]) {
      expect(id.length).toBeLessThanOrEqual(64);
      expect(normDrop({ id, item: 'it_flashlight', inst: 'i1', x: 0, y: 0, z: 0, yaw: 0 })).not.toBeNull();
    }
  });

  it('вернуть в ячейку: в свою, если пуста, иначе как add; полно — null', () => {
    const h = newHotbar([{ item: 'a' }, { item: 'b' }]);
    expect(putBack({ ...h, slots: [null, ...h.slots.slice(1)] }, 0, { item: 'a' })?.slots[0]).toEqual({ item: 'a' });
    // своя занята — в первую пустую
    expect(putBack(h, 0, { item: 'c' })?.slots[2]).toEqual({ item: 'c' });
    const full = newHotbar([1, 2, 3, 4, 5].map((n) => ({ item: 'x' + n })));
    expect(putBack(full, 0, { item: 'c' })).toBeNull();
  });

  it('HUD: имена и цвета из таблицы предметов, в руке — выбранная, неизвестное — id', () => {
    const h = { slots: [{ item: 'it_flashlight', on: true }, { item: 'it_unknown_zz' }, null, null, null], sel: 1 };
    const hud = inventoryHud(h, 'E — подобрать: Фонарик', 7);
    expect(hud.slots[0]).toEqual({
      item: 'it_flashlight', name: 'Фонарик П-2', color: itemInfo('it_flashlight').color, on: true, glyph: 'flash', n: 1, bar: 1, wear: 0, dead: false, rarity: '#f0a04b',
    });
    expect(hud.slots[1]).toMatchObject({ name: 'it_unknown_zz', glyph: 'box', on: false, n: 1, bar: null, wear: null, rarity: null });
    expect(hud.held).toBe('it_unknown_zz');
    expect(hud.prompt).toBe('E — подобрать: Фонарик');
    expect(hud.seq).toBe(7);
    expect(inventoryHud({ ...h, sel: 2 }, null, 0).held).toBeNull();
  });

  it('керосиновая лампа — предмет: имя из таблицы, значок «лампа», горит, пока on !== false', () => {
    expect(itemInfo(KEROLAMP_ITEM).name).toBe('Керосинка');
    const hud = inventoryHud(newHotbar([{ item: 'it_flashlight' }, { item: KEROLAMP_ITEM }, { item: KEROLAMP_ITEM, on: false }]), null, 0);
    expect(hud.slots[1]).toMatchObject({ name: 'Керосинка', glyph: 'lamp', on: true, bar: 1 });
    expect(hud.slots[2]).toMatchObject({ on: false });
  });

  it('предмет в руку: есть — выбрать его ячейку, нет — положить и выбрать, полно — null', () => {
    const h = newHotbar([{ item: 'it_flashlight', on: true }, { item: 'it_canned' }, { item: KEROLAMP_ITEM }]);
    expect(holdItem(h, KEROLAMP_ITEM)).toEqual({ slots: h.slots, sel: 2 });
    const h2 = holdItem(newHotbar([{ item: 'it_flashlight', on: true }]), KEROLAMP_ITEM)!;
    expect(h2.sel).toBe(1);
    expect(h2.slots[1]).toEqual({ item: KEROLAMP_ITEM });
    const full = newHotbar([1, 2, 3, 4, 5].map((n) => ({ item: 'x' + n })));
    expect(holdItem(full, KEROLAMP_ITEM)).toBeNull();
  });

  it('старое сохранение общаги: «лампа в руке» — в хотбар и в руку; иначе — как было', () => {
    expect(obshLampKey('room-forge/world/abc')).toBe('room-forge/world/abc/obsh-lamp');
    const h = newHotbar([{ item: 'it_flashlight', on: true }]);
    const m = migrateObshLamp(h, '1');
    expect(m.slots[1]).toEqual({ item: KEROLAMP_ITEM });
    expect(m.sel).toBe(1);
    // лампа уже в хотбаре — не задвоить, только выбрать
    expect(migrateObshLamp({ ...m, sel: 0 }, '1')).toEqual(m);
    expect(migrateObshLamp(h, '0')).toBe(h);
    expect(migrateObshLamp(h, null)).toBe(h);
  });
});

// ───────────────────────── контроллер ─────────────────────────

const g = globalThis as unknown as Record<string, unknown>;
const saved: Record<string, unknown> = {};
const store = new Map<string, string>();

beforeAll(() => {
  for (const k of ['window', 'localStorage']) saved[k] = g[k];
  g.window = new EventTarget();
  g.localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
  };
  store.set('room-forge/flashlight-sound', '0');
});
afterAll(() => {
  for (const k of Object.keys(saved)) g[k] = saved[k];
});

function setup(opts: { drop?: (d: WorldDrop) => boolean; down?: () => boolean; loot?: WorldDrop[]; partner?: { id: string; name: string } | null } = {}) {
  const engine = new NullEngine();
  const scene = new Scene(engine);
  const cam = new UniversalCamera('fps', new Vector3(0, 1.6, 0), scene);
  scene.activeCamera = cam;
  const sprint = { state: { mul: 1, sprinting: false, v: 1 }, extraMul: 1, refilled: 0, spent: 0, refill() { this.refilled++; }, spend(x: number) { this.spent += x; } };
  const posture = { eye: 1.6, pose: 'stand', frozen: false };
  const v = { scene, engine, fps: cam, mode: 'fps', hasOverlay: false, posture, sprint } as unknown as BlockoutViewer;
  let drops: WorldDrop[] = [];
  const ops: WorldOp[] = [];
  let saves = 0;
  const flashes: string[] = [];
  const healed: number[] = [];
  const duraks: string[] = [];
  let loot: WorldDrop[] = opts.loot ?? [];
  const inv = new Inventory(v, {
    key: 'qa-world',
    portal: () => null,
    room: () => 'i1',
    drops: () => drops,
    saveWorld: () => void saves++,
    request: async (op) => {
      ops.push(op);
      if (op.k === 'drop') {
        if (opts.drop && !opts.drop(op.d)) return null;
        drops = [...drops, op.d];
        return op.d.id;
      }
      if (op.k === 'pick') {
        const n = drops.length;
        drops = drops.filter((d) => d.id !== op.id);
        if (drops.length === n) return null;
        return op.id;
      }
      if (op.k === 'loot') {
        const n = loot.length;
        loot = loot.filter((d) => d.id !== op.id);
        return loot.length === n ? null : op.id;
      }
      return null;
    },
    loot: () => loot,
    handsDown: opts.down,
    heal: (hp) => void healed.push(hp),
    partner: () => opts.partner ?? null,
    durak: (to) => void duraks.push(to),
    flash: (t) => void flashes.push(t),
  });
  const frames = (n: number) => {
    for (let i = 0; i < n; i++) scene.render();
  };
  return {
    engine, scene, cam, inv, ops, flashes, frames, sprint, posture, healed, duraks,
    drops: () => drops, setDrops: (d: WorldDrop[]) => void (drops = d), saves: () => saves, loot: () => loot,
  };
}

describe('руки: контроллер', () => {
  it('новая игра: фонарик в первой ячейке, включён, в руке — модель и свет', T, () => {
    store.delete('qa-world/hotbar');
    const { inv, frames, engine } = setup();
    frames(2);
    expect(inv.hotbar.slots[0]).toMatchObject({ item: 'it_flashlight', on: true });
    expect(inv.flashlight.held).toBe(true);
    expect(inv.flashlight.on).toBe(true);
    expect(inv.torchOn).toBe(true);
    // пустая ячейка — фонарь убран
    inv.select(1);
    frames(1);
    expect(inv.flashlight.held).toBe(false);
    expect(inv.torchOn).toBe(false);
    inv.select(0);
    // F: выкл — сохранилось в ячейке и в localStorage
    expect(inv.toggleLight()).toBe(true);
    frames(1);
    expect(inv.flashlight.on).toBe(false);
    expect(loadHotbar(store.get('qa-world/hotbar') ?? null).slots[0]).toMatchObject({ item: 'it_flashlight', on: false });
    inv.dispose();
    engine.dispose();
  });

  it('G: ячейка пустеет, уходит drop с on; E у подсвеченного — pick, предмет снова в руке', T, async () => {
    store.delete('qa-world/hotbar');
    const { inv, ops, frames, cam, engine, drops, saves } = setup();
    cam.rotation.set(0.9, 0, 0); // под ноги
    frames(2);
    expect(await inv.dropHeld()).toBe(true);
    expect(inv.hotbar.slots[0]).toBeNull();
    // мир сохранён сразу, хотбар — тоже
    expect(saves()).toBe(1);
    expect(loadHotbar(store.get('qa-world/hotbar') ?? null).slots[0]).toBeNull();
    const op = ops[0];
    expect(op.k).toBe('drop');
    if (op.k !== 'drop') return;
    expect(op.d).toMatchObject({ item: 'it_flashlight', inst: 'i1', on: true });
    expect(Math.hypot(op.d.x, op.d.z)).toBeGreaterThan(0.3);
    frames(3);
    expect(inv.flashlight.held).toBe(false);
    expect(inv.items.size).toBe(1);
    expect(inv.aimed?.id).toBe(op.d.id);
    expect(await inv.pickUp()).toBe(true);
    expect(ops[1]).toEqual({ k: 'pick', id: op.d.id });
    expect(inv.hotbar.slots[0]).toMatchObject({ item: 'it_flashlight', on: true });
    // заряд и износ лампочки — с предметом через мир
    expect(inv.hotbar.slots[0]?.q).toBe(op.d.q);
    expect(drops()).toHaveLength(0);
    expect(saves()).toBe(2);
    expect(loadHotbar(store.get('qa-world/hotbar') ?? null).slots[0]).toMatchObject({ item: 'it_flashlight', on: true });
    inv.dispose();
    engine.dispose();
  });

  it('не легло — предмет обратно в свою ячейку; руки полны — pick не уходит', T, async () => {
    store.set('qa-world/hotbar', hotbarJSON(newHotbar([{ item: 'it_flashlight', on: false }, { item: 'it_canned' }])));
    const { inv, ops, flashes, frames, cam, engine } = setup({ drop: (d) => d.item !== 'it_canned' });
    cam.rotation.set(0.9, 0, 0);
    frames(2);
    inv.select(1);
    expect(await inv.dropHeld()).toBe(false);
    expect(inv.hotbar.slots[1]).toEqual({ item: 'it_canned' });
    // фонарик лёг; руки заняли — подобрать нельзя
    inv.select(0);
    expect(await inv.dropHeld()).toBe(true);
    frames(3);
    expect(inv.aimed).not.toBeNull();
    store.set('qa-world/hotbar', '');
    const full = newHotbar([1, 2, 3, 4, 5].map((n) => ({ item: 'x' + n })));
    (inv as unknown as { h: typeof full }).h = full;
    const n = ops.length;
    expect(await inv.pickUp()).toBe(false);
    expect(ops.length).toBe(n);
    expect(flashes).toContain('Руки заняты');
    inv.dispose();
    engine.dispose();
  });

  it('копия мира пересобрана (кооп: dropsRev снова с 0) — предметы по новому массиву', T, () => {
    store.delete('qa-world/hotbar');
    const { inv, frames, engine, setDrops } = setup();
    const a: WorldDrop = { id: 'a', item: 'it_canned', inst: 'i1', x: 0.5, y: 0, z: 0.5, yaw: 0 };
    const b: WorldDrop = { id: 'b', item: 'it_canned', inst: 'i1', x: -0.5, y: 0, z: 0.5, yaw: 0 };
    setDrops([a]);
    frames(2);
    expect(inv.items.has('a')).toBe(true);
    setDrops([b]);
    frames(2);
    expect(inv.items.has('a')).toBe(false);
    expect(inv.items.has('b')).toBe(true);
    inv.dispose();
    engine.dispose();
  });

  it('керосиновая лампа выбрана — в руке лампа и её свет, фонаря нет; другая ячейка — лампа убрана; погиб — не видна', T, () => {
    store.set('qa-world/hotbar', hotbarJSON(newHotbar([{ item: 'it_flashlight', on: true }])));
    let down = false;
    const { inv, frames, engine } = setup({ down: () => down });
    frames(2);
    expect(inv.receive({ item: KEROLAMP_ITEM })).toBe(true);
    frames(2);
    expect(inv.hotbar.sel).toBe(1);
    expect(inv.lampHeld).toBe(true);
    expect(inv.lantern.shown).toBe(true);
    expect(inv.lantern.light.isEnabled()).toBe(true);
    expect(inv.lantern.light.intensity).toBeGreaterThan(0.5);
    expect(inv.flashlight.held).toBe(false);
    expect(inv.torchOn).toBe(false);
    // хотбар — сразу в localStorage
    expect(loadHotbar(store.get('qa-world/hotbar') ?? null)).toMatchObject({ sel: 1, slots: [{ item: 'it_flashlight' }, { item: KEROLAMP_ITEM }, null, null, null] });
    // 1 — фонарь в руке (в правой: в руке всегда один предмет), лампа убрана
    inv.select(0);
    frames(2);
    expect(inv.lampHeld).toBe(false);
    expect(inv.lantern.shown).toBe(false);
    expect(inv.lantern.light.isEnabled()).toBe(false);
    expect(inv.flashlight.held).toBe(true);
    expect(inv.flashlight.handSide).toBe(1);
    // погиб (общага: чёрный экран) — лампы не видно, но она по-прежнему выбрана
    inv.select(1);
    down = true;
    frames(1);
    expect(inv.lampHeld).toBe(true);
    expect(inv.lantern.shown).toBe(false);
    inv.dispose();
    engine.dispose();
  });

  it('лампа: G — стоит на полу (предмет мира без on), E — снова в хотбаре и в руке', T, async () => {
    store.set('qa-world/hotbar', hotbarJSON({ slots: [{ item: 'it_flashlight', on: true }, { item: KEROLAMP_ITEM }, null, null, null], sel: 1 }));
    const { inv, ops, frames, cam, engine, drops } = setup();
    cam.rotation.set(0.9, 0, 0);
    frames(2);
    expect(inv.lampHeld).toBe(true);
    expect(await inv.dropHeld()).toBe(true);
    const op = ops[0];
    expect(op).toMatchObject({ k: 'drop', d: { item: KEROLAMP_ITEM, inst: 'i1' } });
    if (op.k === 'drop') expect('on' in op.d).toBe(false);
    expect(inv.lampHeld).toBe(false);
    frames(3);
    expect(inv.lantern.shown).toBe(false);
    expect(inv.aimed?.item).toBe(KEROLAMP_ITEM);
    expect(await inv.pickUp()).toBe(true);
    // горела в руке — керосин и фитиль чуть убыли (q, w); на полу не тратится
    expect(inv.hotbar.slots[1]).toMatchObject({ item: KEROLAMP_ITEM });
    expect(inv.hotbar.slots[1]?.on).toBeUndefined();
    expect(inv.lampHeld).toBe(true);
    expect(drops()).toHaveLength(0);
    inv.dispose();
    engine.dispose();
  });

  it('лампа со спота, а руки полны (заняли, пока шёл ответ) — на пол перед собой, «Руки заняты»', T, () => {
    store.set('qa-world/hotbar', hotbarJSON(newHotbar([1, 2, 3, 4, 5].map((n) => ({ item: 'x' + n })))));
    const { inv, ops, flashes, frames, cam, engine, drops } = setup();
    cam.rotation.set(0.9, 0, 0);
    frames(2);
    expect(inv.free).toBe(0);
    expect(inv.receive({ item: KEROLAMP_ITEM })).toBe(false);
    expect(ops[0]).toMatchObject({ k: 'drop', d: { item: KEROLAMP_ITEM, inst: 'i1' } });
    expect(drops().map((d) => d.item)).toEqual([KEROLAMP_ITEM]);
    expect(flashes).toContain('Руки заняты');
    inv.dispose();
    engine.dispose();
  });

  it('старое сохранение общаги (obsh-lamp = 1): лампа — в хотбаре и в руке, ключ стёрт; второй раз не задваивается', T, () => {
    store.delete('qa-world/hotbar');
    store.set('qa-world/obsh-lamp', '1');
    const a = setup();
    a.frames(1);
    // набор новой игры — ячейки 1–3, лампа — в первую пустую
    expect(a.inv.hotbar.slots[START_KIT.length]).toMatchObject({ item: KEROLAMP_ITEM });
    expect(a.inv.lampHeld).toBe(true);
    expect(store.has('qa-world/obsh-lamp')).toBe(false);
    expect(loadHotbar(store.get('qa-world/hotbar') ?? null).sel).toBe(START_KIT.length);
    a.inv.dispose();
    a.engine.dispose();
    const b = setup();
    expect(b.inv.hotbar.slots.filter((s) => s?.item === KEROLAMP_ITEM)).toHaveLength(1);
    b.inv.dispose();
    b.engine.dispose();
    // «не держал» ('0') — хотбар как был, ключ стёрт
    store.delete('qa-world/hotbar');
    store.set('qa-world/obsh-lamp', '0');
    const c = setup();
    expect(c.inv.hotbar.slots.some((s) => s?.item === KEROLAMP_ITEM)).toBe(false);
    expect(store.has('qa-world/obsh-lamp')).toBe(false);
    c.inv.dispose();
    c.engine.dispose();
  });

  it('Flashlight.setSide до сборки модели — свет сразу со своей стороны', T, () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const cam = new UniversalCamera('c', new Vector3(0, 1.6, 0), scene);
    const f = new Flashlight(scene, cam, { sound: () => false });
    const x = f.light.position.x;
    f.setSide(-1);
    expect(f.light.position.x).toBeCloseTo(-x, 6);
    expect(f.light.direction.x).toBeGreaterThan(0);
    f.dispose();
    engine.dispose();
  });
});

// ───────────────────────── лут: чистое ─────────────────────────

describe('руки: лут, чистое', () => {
  it('точка лута и выброшенное: id различимы; состояние — туда и обратно', () => {
    expect(isLootId('i12:L3')).toBe(true);
    expect(isLootId(dropId('p1', 1760000000000, 0.5))).toBe(false);
    const d: WorldDrop = { id: 'a', item: 'it_matches', inst: 'i1', x: 0, y: 0, z: 0, yaw: 0, n: 7 };
    expect(slotOfDrop(d)).toEqual({ item: 'it_matches', n: 7 });
    expect(slotOfDrop({ ...d, item: 'it_flashlight', n: undefined, on: true, q: 0.4, w: 0.2, u: 1 })).toEqual({ item: 'it_flashlight', on: true, q: 0.4, w: 0.2, u: 1 });
  });

  it('подобрать сумку при пустой спине — сразу на спину; спина занята — в хотбар; ничего не влезло — null', () => {
    const h = newHotbar([{ item: 'it_flashlight' }]);
    const a = pickInto(h, { item: 'it_sack' })!;
    expect(a.wore).toBe(true);
    expect(a.h.back).toEqual({ item: 'it_sack', slots: [null, null, null] });
    expect(a.h.slots).toEqual(h.slots);
    const b = pickInto(a.h, { item: 'it_briefcase' })!;
    expect(b.wore).toBe(false);
    expect(b.h.slots[1]).toEqual({ item: 'it_briefcase' });
    const full: Hotbar = { ...newHotbar([1, 2, 3, 4, 5].map((n) => ({ item: 'x' + n }))), back: { item: 'it_sack', slots: [{ item: 'y' }, { item: 'y' }, { item: 'y' }] } };
    expect(pickInto(full, { item: 'it_bread' })).toBeNull();
  });

  it('HUD: стек, заряд, износ, перегорел, редкость; сумка; подпись в руке с клавишами', () => {
    const h: Hotbar = {
      slots: [{ item: 'it_flashlight', on: true, q: 0.333, w: 1 }, { item: 'it_matches', n: 12 }, { item: 'it_bread' }, null, null],
      sel: 0,
      back: { item: 'it_backpack', slots: [{ item: 'it_batteries', n: 4 }, ...new Array(9).fill(null)] },
    };
    const hud = inventoryHud(h, null, 1, { bagOpen: true });
    expect(hud.slots[0]).toMatchObject({ bar: 0.34, wear: 1, dead: true, on: false });
    expect(hud.slots[1]).toMatchObject({ n: 12, bar: null, rarity: '#7fb069' });
    expect(hud.back?.name).toBe('Походный рюкзак');
    expect(hud.back?.slots[0]).toMatchObject({ item: 'it_batteries', n: 4 });
    expect(hud.bagOpen).toBe(true);
    expect(hud.tip).toMatchObject({ name: 'Фонарик П-2', rarity: 'Крайне дефицитный', left: 'лампочка перегорела' });
    expect(hud.tip!.keys).toContain('R — лампочка');
    expect(inventoryHud({ ...h, sel: 2 }, null, 1).tip?.keys).toBe('ЛКМ — съесть');
    expect(inventoryHud({ ...h, sel: 1 }, null, 1).tip).toMatchObject({ keys: 'F — чиркнуть', left: '×12' });
  });

  it('подсказка предмета: редкость, цена; керосинка — «не продаётся»', () => {
    expect(itemTip('it_kerolamp')).toMatchObject({ name: 'Керосинка', rarity: 'Уникальный', price: 'не продаётся' });
    expect(itemTip('it_flashlight').price).toBe('3 р.');
    expect(itemTip('it_radiolamp').price).toBe('1 р. 50 коп.');
    expect(itemTip('it_unknown_zz')).toMatchObject({ name: 'it_unknown_zz', rarity: null, price: null });
  });

  it('события руки — по-русски; таймеры эффектов', () => {
    expect(eventText(['blown', 'match_out'], 'it_matches')).toBe('Спичку задуло на бегу');
    expect(eventText(['drowned', 'match_out'], 'it_matches')).toBe('Спичка погасла в воде');
    expect(eventText(['match_out'], null)).toBe('Спичка погасла');
    expect(eventText(['burnout'], 'it_flashlight')).toBe('Лампочка перегорела — нужна запасная (R)');
    expect(eventText(['burnout'], 'it_bug_flash')).toContain('Жучок');
    expect(eventText(['empty'], 'it_flashlight')).toContain('Батарейки сели');
    expect(eventText(['out_fuel'], 'it_zippo')).toContain('Кончился керосин');
    expect(eventText(['out_wick'], 'it_zippo')).toContain('Фитиль прогорел');
    expect(eventText(['blown'], 'it_zippo')).toBe('Зиппу задуло на бегу');
    expect(eventText([], 'it_zippo')).toBeNull();
    const chips = fxChips({ ...newFx(), speedT: 61.2, faintT: 3.1 });
    expect(chips.map((c) => [c.k, c.s])).toEqual([['faint', 4], ['speed', 62]]);
  });

  it('поза «лежит»: падает за 0.7 с, лежит на боку, встаёт к концу; обморок — темно', () => {
    expect(downPose(0, 10, 'faint', 1).drop).toBe(0);
    const lie = downPose(3, 7, 'faint', -1);
    expect(lie.drop).toBe(1);
    expect(lie.roll).toBeLessThan(-1.2);
    expect(lie.black).toBeGreaterThan(0.9);
    const up = downPose(10, 0, 'faint', 1);
    expect(up.drop).toBe(0);
    expect(up.roll).toBeCloseTo(0, 6);
    expect(downPose(3, 12, 'collapse', 1).black).toBeLessThan(0.5);
  });

  it('лента лута: новый массив — только на изменение (WorldItems.sync сверяет по массиву)', () => {
    const f = new LootFeed();
    const spot = (id: string): WorldDrop => ({ id, item: 'it_kopeyki', inst: id.split(':')[0], x: 0, y: 0, z: 0, yaw: 0 });
    const byInst: Record<string, WorldDrop[]> = { a: [spot('a:L0'), spot('a:L1')], b: [spot('b:L0')] };
    const taken = new Set<string>();
    const rx = {};
    const rooms = new Set(['a', 'b']);
    const a1 = f.get(rx, rooms, 0, (i) => byInst[i] ?? [], (id) => taken.has(id));
    expect(a1.map((d) => d.id)).toEqual(['a:L0', 'a:L1', 'b:L0']);
    expect(f.get(rx, rooms, 0, (i) => byInst[i] ?? [], (id) => taken.has(id))).toBe(a1);
    // версия выросла, а не подобрано ничего из этих комнат — тот же массив
    expect(f.get(rx, rooms, 1, (i) => byInst[i] ?? [], (id) => taken.has(id))).toBe(a1);
    taken.add('a:L1');
    const a2 = f.get(rx, rooms, 2, (i) => byInst[i] ?? [], (id) => taken.has(id));
    expect(a2).not.toBe(a1);
    expect(a2.map((d) => d.id)).toEqual(['a:L0', 'b:L0']);
  });
});

// ───────────────────────── лут: контроллер ─────────────────────────

/** Нажатие клавиши (окно — EventTarget: поля события — свои). */
const key = (code: string, type = 'keydown') => {
  const e = new Event(type, { cancelable: true }) as Event & { code: string };
  e.code = code;
  (globalThis as unknown as { window: EventTarget }).window.dispatchEvent(e);
};

const kit = (slots: Hotbar['slots'], sel = 0, back?: Hotbar['back']) => store.set('qa-world/hotbar', hotbarJSON(back ? { slots, sel, back } : { slots, sel }));

describe('руки: предметы лута', () => {
  it('F: спичка — чиркнуть (коробок −1, свет у руки), ещё F — задуть; П-2 — вкл/выкл', T, () => {
    kit([{ item: 'it_flashlight', on: true }, { item: 'it_batteries', n: 2 }, { item: 'it_matches', n: 5 }, null, null], 2);
    const { inv, frames, engine } = setup();
    frames(2);
    key('KeyF');
    frames(2);
    expect(inv.hotbar.slots[2]).toEqual({ item: 'it_matches', n: 4 });
    expect(inv.qa().tr().match).toMatchObject({ item: 'it_matches', sel: 2 });
    expect(inv.qa().light()).toMatchObject({ kind: 'point' });
    expect(inv.torchOn).toBe(false);
    expect(inventoryHud(inv.hotbar, null, 0, { lit: true }).slots[2]?.on).toBe(true);
    key('KeyF');
    frames(1);
    expect(inv.qa().tr().match).toBeNull();
    // П-2: F — выкл / вкл
    key('Digit1');
    frames(1);
    expect(inv.torchOn).toBe(true);
    key('KeyF');
    frames(1);
    expect(inv.hotbar.slots[0]?.on).toBe(false);
    expect(inv.torchOn).toBe(false);
    inv.dispose();
    engine.dispose();
  });

  it('R: П-2 — свежие батарейки из хотбара (2 штуки), нет — подсказка', T, () => {
    kit([{ item: 'it_flashlight', on: true, q: 0.2 }, { item: 'it_batteries', n: 3 }, null, null, null]);
    const { inv, flashes, frames, engine } = setup();
    frames(1);
    key('KeyR');
    expect(inv.hotbar.slots[0]?.q).toBe(1);
    expect(inv.hotbar.slots[1]).toEqual({ item: 'it_batteries' });
    expect(flashes.at(-1)).toBe('Батарейки заменены');
    // хотбар — в localStorage сразу (действие игрока)
    expect(loadHotbar(store.get('qa-world/hotbar') ?? null).slots[1]).toEqual({ item: 'it_batteries' });
    inv.reload();
    expect(flashes.at(-1)).toBe('Батарейки свежие');
    inv.dispose();
    engine.dispose();
  });

  it('ЛКМ: хлеб — съеден, +35 здоровья, стамина до полной', T, () => {
    kit([{ item: 'it_bread' }, null, null, null, null]);
    const { inv, frames, engine, healed, sprint } = setup();
    frames(1);
    expect(inv.use()).toBe(true);
    expect(inv.hotbar.slots[0]).toBeNull();
    expect(healed).toEqual([35]);
    expect(sprint.refilled).toBe(1);
    inv.dispose();
    engine.dispose();
  });

  it('эффекты → скорость: закрутка ×1.3, мешок ×0.85 (ЛКМ — надеть), вместе — произведение', T, () => {
    kit([{ item: 'it_preserves' }, { item: 'it_sack' }, null, null, null]);
    const { inv, frames, engine, sprint } = setup();
    frames(1);
    expect(sprint.extraMul).toBe(1);
    inv.use();
    frames(1);
    expect(sprint.extraMul).toBeCloseTo(1.3, 6);
    inv.select(1);
    inv.use();
    expect(inv.hotbar.back).toEqual({ item: 'it_sack', slots: [null, null, null] });
    expect(inv.hotbar.slots[1]).toBeNull();
    frames(1);
    expect(sprint.extraMul).toBeCloseTo(1.3 * 0.85, 6);
    expect(inv.qa().hud()?.back?.name).toBe('Мешок');
    inv.dispose();
    expect(sprint.extraMul).toBe(1);
    engine.dispose();
  });

  it('Tab — панель сумки (HUD bagOpen), Tab / Esc — закрыть; клик — в сумку и обратно; непустую не снять', T, () => {
    kit([{ item: 'it_flashlight', on: true }, { item: 'it_matches', n: 3 }, null, null, null], 0, { item: 'it_briefcase', slots: [null, null, null, null, null] });
    const { inv, flashes, frames, engine } = setup();
    frames(1);
    key('Tab');
    expect(inv.bagOpen).toBe(true);
    expect(inv.qa().hud()?.bagOpen).toBe(true);
    // пока панель открыта, F не действует
    key('KeyF');
    expect(inv.hotbar.slots[0]?.on).toBe(true);
    expect(inv.autoMove({ bag: false, i: 1 })).toBe(true);
    expect(inv.hotbar.slots[1]).toBeNull();
    expect(inv.hotbar.back?.slots[0]).toEqual({ item: 'it_matches', n: 3 });
    expect(inv.takeOffBag()).toBe(false);
    expect(flashes.at(-1)).toBe('Сначала выложи вещи');
    expect(inv.moveSlot({ bag: true, i: 0 }, { bag: false, i: 4 })).toBe(true);
    expect(inv.hotbar.slots[4]).toEqual({ item: 'it_matches', n: 3 });
    expect(inv.takeOffBag()).toBe(true);
    expect(inv.hotbar.back).toBeUndefined();
    key('Escape');
    expect(inv.bagOpen).toBe(false);
    key('Tab');
    key('Tab');
    expect(inv.bagOpen).toBe(false);
    inv.dispose();
    engine.dispose();
  });

  it('юзграм: лежит (камера на полу, ход 0, frozen, неуязвим, пелена), встал — взгляд ровно прежний', T, () => {
    kit([{ item: 'it_yuzgram' }, null, null, null, null]);
    const { inv, frames, engine, sprint, posture, cam, scene } = setup();
    cam.rotation.set(0.1, 0.7, 0);
    frames(1);
    inv.use();
    frames(3);
    expect(inv.fx).toMatchObject({ down: true, invuln: true, speedMul: 0 });
    expect(sprint.extraMul).toBe(0);
    expect(posture.frozen).toBe(true);
    // мышь двигалась, пока лежал — взгляд держится
    cam.cameraRotation.set(0.3, 0.3);
    cam.rotation.y = 2;
    frames(1);
    expect(cam.rotation.y).toBeCloseTo(0.7, 6);
    // в кадре (между onBeforeRender и onAfterRender) камера ниже и с креном, после — чистая
    let seen: { y: number; z: number } | null = null;
    const o = scene.onAfterRenderTargetsRenderObservable.add(() => (seen = { y: cam.position.y, z: cam.rotation.z }));
    (inv as unknown as { down: { on: { t: number } } }).down.on.t = 2;
    frames(1);
    scene.onAfterRenderTargetsRenderObservable.remove(o);
    expect(seen!.y).toBeLessThan(cam.position.y - 1);
    expect(Math.abs(seen!.z)).toBeGreaterThan(1);
    expect(cam.rotation.z).toBeCloseTo(0, 6);
    expect(inv.qa().hud()?.veil).not.toBeNull();
    expect(inv.qa().hud()?.fx.map((c) => c.k)).toContain('faint');
    // F, ЛКМ, выбросить — нельзя
    expect(inv.pressF()).toBe(false);
    // таймер кончился — встал
    const fx = (inv as unknown as { fxs: { faintT: number } }).fxs;
    fx.faintT = 0;
    frames(2);
    expect(inv.fx.down).toBe(false);
    expect(posture.frozen).toBe(false);
    expect(sprint.extraMul).toBe(1);
    expect(cam.rotation.x).toBeCloseTo(0.1, 6);
    expect(cam.rotation.y).toBeCloseTo(0.7, 6);
    expect(inv.qa().hud()?.veil).toBeNull();
    inv.dispose();
    engine.dispose();
  });

  it('пузырь: меченый и пьян; увидел тварь — ругается (субтитр); второй — падение', T, () => {
    kit([{ item: 'it_bubble' }, { item: 'it_bubble' }, null, null, null]);
    const { inv, frames, engine, healed } = setup();
    frames(1);
    inv.use();
    frames(1);
    expect(inv.fx).toMatchObject({ drunk: true, marked: true, down: false });
    expect(healed).toEqual([40]);
    inv.sawCreature('hand');
    expect(SWEARS).toContain(inv.qa().hud()?.sub);
    inv.select(1);
    inv.use();
    frames(2);
    expect(inv.fx.down).toBe(true);
    expect(inv.qa().hud()?.fx.map((c) => c.k)).toContain('collapse');
    inv.dispose();
    engine.dispose();
  });

  it('дурак: один — «не с кем»; напарник рядом — действие ему, партия, +30; потом — перерыв', T, () => {
    kit([{ item: 'it_cards' }, null, null, null, null]);
    const a = setup();
    a.frames(1);
    a.inv.use();
    expect(a.flashes.at(-1)).toBe('Не с кем сыграть в дурака');
    a.inv.dispose();
    a.engine.dispose();
    const b = setup({ partner: { id: 'p2', name: 'Вася' } });
    b.frames(1);
    b.inv.use();
    expect(b.duraks).toEqual(['p2']);
    b.frames(1);
    expect(b.inv.qa().hud()?.sub).toContain('Партия в дурака с Вася');
    (b.inv as unknown as { durak: { left: number } }).durak.left = 0.001;
    b.frames(1);
    expect(b.healed).toEqual([DURAK_HEAL]);
    b.inv.use();
    expect(b.duraks).toHaveLength(1);
    expect(b.flashes.at(-1)).toContain('Карты пока надоели');
    // напарник позвал сам — играет и без карт
    b.inv.durakFrom('Петя');
    expect(b.inv.qa().hud()?.sub).toContain('Петя');
    b.inv.dispose();
    b.engine.dispose();
  });

  it('хотбар без действия игрока (горит П-2) — в localStorage не чаще SAVE_MS; pagehide — сразу', T, () => {
    kit([{ item: 'it_flashlight', on: true }, null, null, null, null]);
    const { inv, frames, engine } = setup();
    let t = 1000;
    inv.clock = () => t;
    frames(3);
    expect(inv.hotbar.slots[0]?.q).toBeLessThan(1);
    const saved = () => loadHotbar(store.get('qa-world/hotbar') ?? null).slots[0];
    expect(saved()?.q).toBeUndefined();
    t += SAVE_MS + 10;
    frames(1);
    expect(saved()?.q).toBeLessThan(1);
    const q1 = saved()?.q;
    frames(3);
    expect(saved()?.q).toBe(q1);
    (globalThis as unknown as { window: EventTarget }).window.dispatchEvent(new Event('pagehide'));
    expect(saved()?.q).toBe(inv.hotbar.slots[0]?.q);
    inv.dispose();
    engine.dispose();
  });

  it('G — стек целиком (n и состояние в WorldDrop); E на точке лута — операция loot, в хотбар со стеком', T, async () => {
    kit([{ item: 'it_matches', n: 5 }, null, null, null, null]);
    const { inv, ops, frames, cam, engine, loot } = setup({ loot: [{ id: 'i1:L0', item: 'it_kopeyki', n: 9, inst: 'i1', x: 0, y: 0, z: 0.9, yaw: 0 }] });
    cam.rotation.set(0.9, 0, 0);
    frames(3);
    expect(inv.items.has('i1:L0')).toBe(true);
    expect(await inv.dropHeld()).toBe(true);
    expect(ops[0]).toMatchObject({ k: 'drop', d: { item: 'it_matches', n: 5 } });
    frames(3);
    // под взглядом — что-то из двух; подобрать точку лута напрямую
    (inv as unknown as { target: WorldDrop }).target = loot()[0];
    inv.items.highlight('i1:L0');
    expect(inv.aimed?.id).toBe('i1:L0');
    expect(await inv.pickUp()).toBe(true);
    expect(ops.at(-1)).toEqual({ k: 'loot', id: 'i1:L0' });
    expect(inv.hotbar.slots[0]).toEqual({ item: 'it_kopeyki', n: 9 });
    expect(loot()).toHaveLength(0);
    inv.dispose();
    engine.dispose();
  });
});
