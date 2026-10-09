// Предметы на полу мира прогулки (StreamWorld.dropItem / pickItem): выброс, подбор (кто первый), повторный id,
// неизвестный экземпляр, сохранение туда-обратно, мусор в сохранении, предел DROPS_MAX; WorldOp 'drop' / 'pick' у двух
// копий мира (как в коопе) — одинаково.
import { describe, expect, it } from 'vitest';
import { ALL4, project, rectRoom } from '../gen/fixtures.test-util';
import type { Project } from '../model/types';
import { DEFAULT_WALK, WalkSession, type WorldOp } from '../view3d/walk';
import { createStreamWorld, DROPS_MAX, normDrop, streamSettings, type StreamSave, type WorldDrop } from './stream';

const proj = (): Project => project([rectRoom('box', 20, 16, { tags: ['start'], conns: ALL4(8) }), rectRoom('hall', 30, 10, { conns: ALL4(8) })]);
const p = proj();
const mk = (save?: StreamSave) => createStreamWorld(p, streamSettings('drops'), save);
const roundtrip = (s: StreamSave): StreamSave => JSON.parse(JSON.stringify(s));
/** без времени: момент сохранения и время генерации */
const noSavedAt = (s: StreamSave) => ({ ...s, savedAt: 0, run: { ...s.run, ms: 0 } });
const drop = (id: string, inst = 'i0', o: Partial<WorldDrop> = {}): WorldDrop => ({ id, item: 'it_flashlight', inst, x: 1.25, y: 0, z: -3.5, yaw: 0.7, ...o });

describe('stream: предметы на полу', () => {
  it('выброс и подбор: порядок, номер версии, кто первый — того и предмет; мир (куски) не трогается', () => {
    const w = mk();
    w.expand(w.startId!);
    const other = w.run().instances[1].id;
    let calls = 0;
    w.onChange(() => calls++);
    const run0 = w.run();
    expect(w.drops()).toEqual([]);
    expect(w.dropsRev()).toBe(0);
    expect(w.dropItem(drop('a', 'i0', { on: true }))).toBe(true);
    expect(w.dropItem(drop('b', other))).toBe(true);
    expect(w.dropsRev()).toBe(2);
    expect(w.drops().map((d) => d.id)).toEqual(['a', 'b']);
    expect(w.drops()[0]).toEqual(drop('a', 'i0', { on: true }));
    // массив стабилен, пока нет изменений; заморожен
    expect(w.drops()).toBe(w.drops());
    expect(Object.isFrozen(w.drops())).toBe(true);
    expect(Object.isFrozen(w.drops()[0])).toBe(true);
    const got = w.pickItem('a');
    expect(got).toEqual(drop('a', 'i0', { on: true }));
    expect(w.pickItem('a')).toBeNull();
    expect(w.pickItem('нет такого')).toBeNull();
    expect(w.dropsRev()).toBe(3);
    expect(w.drops().map((d) => d.id)).toEqual(['b']);
    // подобранный id можно выбросить снова
    expect(w.dropItem(drop('a'))).toBe(true);
    expect(w.drops().map((d) => d.id)).toEqual(['b', 'a']);
    // отдельный канал: onChange не звался, прогон тот же объект (кэш по версии мира)
    expect(calls).toBe(0);
    expect(w.run()).toBe(run0);
  });

  it('повторный id, неизвестный экземпляр, негодный предмет — false, ничего не меняется', () => {
    const w = mk();
    expect(w.dropItem(drop('a'))).toBe(true);
    const rev = w.dropsRev();
    expect(w.dropItem(drop('a', 'i0', { item: 'it_batteries' }))).toBe(false);
    expect(w.dropItem(drop('b', 'i9999'))).toBe(false);
    const bad: unknown[] = [
      null, 5, 'x', {}, drop('', 'i0'), drop('c', ''), drop('c', 'i0', { item: '' }), drop('x'.repeat(65)),
      drop('c', 'i0', { x: NaN }), drop('c', 'i0', { y: Infinity }), drop('c', 'i0', { yaw: '1' as unknown as number }),
      drop('c', 'i0', { on: 1 as unknown as boolean }), { id: 'c', item: 'it', inst: 'i0', x: 0, y: 0, z: 0 },
    ];
    for (const d of bad) expect(w.dropItem(d as WorldDrop), JSON.stringify(d)).toBe(false);
    expect(w.dropsRev()).toBe(rev);
    expect(w.drops().map((d) => d.id)).toEqual(['a']);
    // лишние поля не хранятся
    expect(w.dropItem({ ...drop('j'), junk: [1, 2, 3] } as WorldDrop)).toBe(true);
    expect(w.drops()[1]).toEqual(drop('j'));
    expect(normDrop({ ...drop('j'), on: false })).toEqual({ ...drop('j'), on: false });
  });

  it('сохранение: только если есть; туда и обратно — те же предметы и то же сохранение', () => {
    const A = mk();
    A.expand(A.startId!);
    expect('drops' in A.save()).toBe(false);
    const other = A.run().instances[2].id;
    A.dropItem(drop('a', 'i0', { on: false }));
    A.dropItem(drop('b', other, { x: -0.1, y: 1e-7, z: 123.456, yaw: -3.14 }));
    A.dropItem(drop('c'));
    A.pickItem('c');
    const sv = roundtrip(A.save());
    expect(sv.drops).toEqual([drop('a', 'i0', { on: false }), drop('b', other, { x: -0.1, y: 1e-7, z: 123.456, yaw: -3.14 })]);
    const B = mk(sv);
    expect(B.stale).toBe(false);
    expect(B.drops()).toEqual(A.drops());
    expect(noSavedAt(B.save())).toEqual(noSavedAt(A.save()));
    // после загрузки — как обычно
    expect(B.pickItem('a')).toEqual(drop('a', 'i0', { on: false }));
    expect(B.dropItem(drop('b'))).toBe(false);
    // всё подобрали — поля в сохранении нет
    B.pickItem('b');
    expect('drops' in B.save()).toBe(false);
  });

  it('мусор в сохранении: негодные, повторные id и у неизвестных экземпляров — отброшены, мир не устарел', () => {
    const A = mk();
    A.expand(A.startId!);
    const sv = roundtrip(A.save());
    for (const junk of ['x', 5, { a: 1 }, null]) {
      const w = mk({ ...sv, drops: junk as unknown as WorldDrop[] });
      expect(w.stale).toBe(false);
      expect(w.drops()).toEqual([]);
    }
    const list = [
      drop('a'), null, 7, 'строка', drop('b', 'i9999'), drop('c', 'i0', { x: null as unknown as number }), drop('a', 'i0', { item: 'it_batteries' }),
      { ...drop('d', 'i1'), junk: true }, drop('e', 'i0', { on: 'да' as unknown as boolean }), drop('f', 'i0', { item: 'x'.repeat(100) }),
    ];
    const w = mk({ ...sv, drops: list as WorldDrop[] });
    expect(w.stale).toBe(false);
    expect(w.drops()).toEqual([drop('a'), drop('d', 'i1')]);
  });

  it('устаревшее сохранение (комната изменена): мир заново — предметы пропали вместе с ним', () => {
    const A = mk();
    A.dropItem(drop('a'));
    const sv = roundtrip(A.save());
    const p2 = proj();
    p2.rooms[0] = rectRoom('box', 22, 16, { tags: ['start'], conns: ALL4(8) });
    const B = createStreamWorld(p2, streamSettings('drops'), sv);
    expect(B.stale).toBe(true);
    expect(B.drops()).toEqual([]);
  });

  it(`предел ${DROPS_MAX}: сверх него пропадают самые старые; из сохранения — последние ${DROPS_MAX}`, () => {
    const w = mk();
    for (let i = 0; i < DROPS_MAX + 5; i++) expect(w.dropItem(drop(`d${i}`))).toBe(true);
    expect(w.drops()).toHaveLength(DROPS_MAX);
    expect(w.drops()[0].id).toBe('d5');
    expect(w.drops()[DROPS_MAX - 1].id).toBe(`d${DROPS_MAX + 4}`);
    expect(w.pickItem('d0')).toBeNull();
    const sv = roundtrip(w.save());
    expect(sv.drops).toHaveLength(DROPS_MAX);
    const big = { ...sv, drops: Array.from({ length: DROPS_MAX + 50 }, (_, i) => drop(`s${i}`)) };
    const B = mk(big);
    expect(B.drops()).toHaveLength(DROPS_MAX);
    expect(B.drops()[0].id).toBe('s50');
  });

  it("WorldOp 'drop' / 'pick': у двух копий мира (кооп) — одинаково; второй подбор того же — null", () => {
    const opts = { ...DEFAULT_WALK, seed: 'drops-coop', clusters: false };
    const A = new WalkSession(p, opts, { save: null, opened: [], key: 'test/A' });
    const B = new WalkSession(p, opts, { save: null, opened: [], key: 'test/B' });
    const start = A.world.startId!;
    const ops: WorldOp[] = [
      { k: 'enter', id: start },
      { k: 'drop', d: drop('a', start, { on: true }) },
      { k: 'drop', d: drop('b', start) },
      { k: 'drop', d: drop('a', start) },
      { k: 'drop', d: drop('z', 'i9999') },
      { k: 'pick', id: 'a' },
      { k: 'pick', id: 'a' },
      { k: 'drop', d: { id: 'bad' } as unknown as WorldDrop },
    ];
    const ra = ops.map((op) => A.apply(op));
    const rb = ops.map((op) => B.apply(op));
    expect(ra).toEqual([null, 'a', 'b', null, null, 'a', null, null]);
    expect(rb).toEqual(ra);
    expect(A.drops().map((d) => d.id)).toEqual(['b']);
    expect(B.drops()).toEqual(A.drops());
    expect(A.dropsRev()).toBe(3);
    expect(B.fingerprint()).toBe(A.fingerprint());
    expect(A.fingerprint()).toMatch(/\/d1:b$/);
    expect(noSavedAt(B.world.save())).toEqual(noSavedAt(A.world.save()));
    // опоздавший — из сохранения (чекпойнт): те же предметы и отпечаток
    const C = new WalkSession(p, opts, { save: roundtrip(A.world.save()), opened: [], key: 'test/C' });
    expect(C.drops()).toEqual(A.drops());
    expect(C.fingerprint()).toBe(A.fingerprint());
    for (const s of [A, B, C]) s.dispose();
  });
});
