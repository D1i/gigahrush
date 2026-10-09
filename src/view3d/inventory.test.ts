// Руки «Прогулки» (./inventory.ts): чистое (ключ, загрузка хотбара, клавиши, id выброшенного, возврат в ячейку, HUD) и
// контроллер на NullEngine с поддельным хостом: выбросить (ячейка пустеет, операция drop; не легло — обратно), подобрать
// (операция pick; вернул id — в хотбар; руки полны — операция не уходит), фонарь в руке — по выбранной ячейке, F;
// керосиновая лампа общаги — предмет хотбара (в руке — модель и свет, на пол и обратно, со спота при полных руках — на
// пол, старое сохранение «лампа в руке» — в хотбар).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { UniversalCamera } from '@babylonjs/core/Cameras/universalCamera';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { HOTBAR_SIZE, START_KIT, hotbarJSON, newHotbar } from '../game/hotbar';
import { normDrop, type WorldDrop } from '../gen4d/stream';
import type { WorldOp } from './walk';
import type { BlockoutViewer } from './viewer';
import { Flashlight } from './flashlight';
import { Inventory, dropId, holdItem, hotbarKey, inventoryHud, itemInfo, loadHotbar, migrateObshLamp, obshLampKey, putBack, slotOfKey } from './inventory';
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
      expect(h.slots[0]).toEqual(START_KIT[0]);
      expect(h.slots.slice(1).every((s) => s === null)).toBe(true);
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
    expect(hud.slots[0]).toEqual({ item: 'it_flashlight', name: 'Фонарик', color: itemInfo('it_flashlight').color, on: true, glyph: 'flash' });
    expect(hud.slots[1]).toMatchObject({ name: 'it_unknown_zz', glyph: 'box', on: false });
    expect(hud.held).toBe('it_unknown_zz');
    expect(hud.prompt).toBe('E — подобрать: Фонарик');
    expect(hud.seq).toBe(7);
    expect(inventoryHud({ ...h, sel: 2 }, null, 0).held).toBeNull();
  });

  it('керосиновая лампа — предмет: имя из таблицы, значок «лампа»', () => {
    expect(itemInfo(KEROLAMP_ITEM).name).toBe('Керосиновая лампа');
    const hud = inventoryHud(newHotbar([{ item: 'it_flashlight' }, { item: KEROLAMP_ITEM }]), null, 0);
    expect(hud.slots[1]).toMatchObject({ name: 'Керосиновая лампа', glyph: 'lamp', on: false });
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

function setup(opts: { drop?: (d: WorldDrop) => boolean; down?: () => boolean } = {}) {
  const engine = new NullEngine();
  const scene = new Scene(engine);
  const cam = new UniversalCamera('fps', new Vector3(0, 1.6, 0), scene);
  scene.activeCamera = cam;
  const v = { scene, engine, fps: cam, mode: 'fps', hasOverlay: false, posture: { eye: 1.6, pose: 'stand' }, sprint: { state: { mul: 1 } } } as unknown as BlockoutViewer;
  let drops: WorldDrop[] = [];
  const ops: WorldOp[] = [];
  let saves = 0;
  const flashes: string[] = [];
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
      return null;
    },
    handsDown: opts.down,
    flash: (t) => void flashes.push(t),
  });
  const frames = (n: number) => {
    for (let i = 0; i < n; i++) scene.render();
  };
  return { engine, scene, cam, inv, ops, flashes, frames, drops: () => drops, setDrops: (d: WorldDrop[]) => void (drops = d), saves: () => saves };
}

describe('руки: контроллер', () => {
  it('новая игра: фонарик в первой ячейке, включён, в руке — модель и свет', T, () => {
    store.delete('qa-world/hotbar');
    const { inv, frames, engine } = setup();
    frames(2);
    expect(inv.hotbar.slots[0]).toEqual({ item: 'it_flashlight', on: true });
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
    expect(loadHotbar(store.get('qa-world/hotbar') ?? null).slots[0]).toEqual({ item: 'it_flashlight', on: false });
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
    expect(inv.hotbar.slots[0]).toEqual({ item: 'it_flashlight', on: true });
    expect(drops()).toHaveLength(0);
    expect(saves()).toBe(2);
    expect(loadHotbar(store.get('qa-world/hotbar') ?? null).slots[0]).toEqual({ item: 'it_flashlight', on: true });
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
    store.delete('qa-world/hotbar');
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
    expect(inv.hotbar.slots[1]).toEqual({ item: KEROLAMP_ITEM });
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
    expect(a.inv.hotbar.slots[1]).toEqual({ item: KEROLAMP_ITEM });
    expect(a.inv.lampHeld).toBe(true);
    expect(store.has('qa-world/obsh-lamp')).toBe(false);
    expect(loadHotbar(store.get('qa-world/hotbar') ?? null).sel).toBe(1);
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
