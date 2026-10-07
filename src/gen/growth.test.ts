import { describe, expect, it } from 'vitest';
import { analyzeGrowth, generateRun } from './generate';
import { checkLinks, checkNoOverlap, hrushLike, project, rectRoom } from './fixtures.test-util';
import { runWorld } from './world';

describe('рост: ростовые метки и резерв', { timeout: 60000 }, () => {
  it('analyzeGrowth: лестницы ростовые, квартиры — листья; потенциал = размер поддерева', () => {
    const g = analyzeGrowth(hrushLike());
    expect(g.landing.grow).toEqual([true, true, false, false, false, false]);
    expect(g.flight.grow).toEqual([true, true]);
    expect(g.mid.grow).toEqual([true, true]);
    expect(g.foyer.grow).toEqual([true, false, false]); // apt>landing ведёт к площадке с лестницами
    // обратные метки листьев ведут назад в прихожую → к площадке, поэтому формально ростовые;
    // на практике лист ставится именно через неё, и открытой она не бывает
    expect(g.kitchen.grow).toEqual([true]);
    // landing>apt → прихожая (1) + комната (1) + кухня (1)
    expect(g.landing.pot.slice(2)).toEqual([3, 3, 3, 3]);
    expect(g.foyer.pot.slice(1)).toEqual([1, 1]); // комната, кухня — по одной комнате
    expect(g.landing.pot[0]).toBeGreaterThan(20);
  });

  it('в режиме len все метки ростовые (любая стыкуется с любой той же длины)', () => {
    const g = analyzeGrowth(project([rectRoom('a', 10, 10, { conns: [['N', 4], ['S', 4]] }), rectRoom('b', 10, 10, { conns: [['E', 4]] })]), { match: 'len' });
    expect(g.a.grow).toEqual([true, true]);
    expect(g.b.grow).toEqual([true]);
  });

  it('count достигается на модели «лестницы + квартиры-листья»; инварианты раскладки целы', () => {
    const p = hrushLike();
    let ok = 0;
    for (let i = 1; i <= 10; i++) {
      const run = generateRun(p, { seed: `h${i}`, count: 40 });
      if (run.instances.length >= 40) ok++;
      checkNoOverlap(runWorld(p, run), 1);
      checkLinks(p, run);
      const retry = run.warnings.find((w) => w.startsWith('Раскладка: взята попытка'));
      if (retry) expect(retry).toMatch(/попытка [2-6] из 6/);
    }
    expect(ok).toBeGreaterThanOrEqual(9);
  });

  it('перезапуски детерминированы', () => {
    const p = hrushLike();
    for (let i = 1; i <= 5; i++) {
      const a = generateRun(p, { seed: `r${i}`, count: 60 });
      const b = generateRun(p, { seed: `r${i}`, count: 60 });
      expect({ ...a, ms: 0 }).toEqual({ ...b, ms: 0 });
    }
  });
});

describe('дозаполнение листьями (fill)', { timeout: 60000 }, () => {
  it('analyzeGrowth: листья — комнаты без роста и не «входы» в хабы', () => {
    const g = analyzeGrowth(hrushLike());
    expect(Object.fromEntries(Object.entries(g).map(([k, v]) => [k, v.leaf]))).toEqual({
      landing: false, mid: false, flight: false, foyer: false, room: true, kitchen: true,
    });
  });

  it('закрывает тупики к листьям, не ставит хабов; инварианты целы', () => {
    const p = hrushLike();
    const leafTags = new Set(['hall>room', 'hall>kitchen']);
    let openLeafNo = 0, openLeafYes = 0;
    for (let i = 1; i <= 6; i++) {
      const no = generateRun(p, { seed: `f${i}`, count: 25 });
      const yes = generateRun(p, { seed: `f${i}`, count: 25, fill: true });
      // экземпляры дозаполнения дописываются в конец; число — в warnings
      const w = yes.warnings.find((x) => x.startsWith('Дозаполнение: +'))!;
      const n = Number(/\+(\d+)/.exec(w)![1]);
      expect(w).toBe(`Дозаполнение: +${n} комнат (итого ${yes.instances.length}).`);
      expect(yes.instances.length).toBeGreaterThanOrEqual(25);
      for (const inst of yes.instances.slice(yes.instances.length - n)) expect(['room', 'kitchen']).toContain(inst.roomId);
      expect(no.warnings.some((w) => w.startsWith('Дозаполнение'))).toBe(false);
      checkNoOverlap(runWorld(p, yes), 1);
      checkLinks(p, yes);
      expect(yes.content.length).toBe(yes.instances.length);
      const openLeaf = (run: typeof no) => {
        const byId = new Map(runWorld(p, run).map((w) => [w.inst.id, w]));
        return run.openConnectors.filter((o) => leafTags.has(byId.get(o.inst)!.connectors.find((c) => c.id === o.connector)!.tag)).length;
      };
      openLeafNo += openLeaf(no);
      openLeafYes += openLeaf(yes);
    }
    expect(openLeafYes).toBeLessThan(openLeafNo);
  });

  it('fill соблюдает предел обзора', () => {
    const p = hrushLike();
    for (let i = 1; i <= 4; i++) {
      const run = generateRun(p, { seed: `s${i}`, count: 25, fill: true, sightM: 5 });
      expect(run.sight.maxM).toBeLessThanOrEqual(5);
      checkLinks(p, run);
    }
  });
});

describe('диагностика остановки (Run.stop)', () => {
  it('нет совместимых комнат / упёрлись в max / предел обзора — с советами', () => {
    // нет совместимых
    const a = generateRun(project([
      rectRoom('solo', 20, 20, { tags: ['start'], weight: 0, conns: [['N', 8, 'x']] }),
      rectRoom('other', 20, 20, { conns: [['S', 8, 'y']] }),
    ]), { count: 5 });
    expect(a.stop).toMatchObject({ open: 1, noMatch: 1, atMax: 0, noSpace: 0, sight: 0, noMatchTags: ['x'] });
    expect(a.warnings.some((w) => w.includes('нет совместимых комнат — 1'))).toBe(true);
    expect(a.warnings.some((w) => w.startsWith('Совет: для меток «x»'))).toBe(true);
    // max
    const b = generateRun(project([
      rectRoom('hub', 20, 20, { tags: ['start'], weight: 0, conns: [['N', 8], ['S', 8]] }),
      rectRoom('b', 20, 20, { max: 1, conns: [['S', 8]] }),
    ]), { count: 5 });
    expect(b.instances.length).toBe(2);
    expect(b.stop).toMatchObject({ atMax: 1, maxRooms: ['b'] });
    expect(b.warnings).toContain('Совет: поднимите max у: «Комната b».');
    // предел обзора
    const r1 = rectRoom('r1', 10, 10, { tags: ['start'], weight: 0, conns: [['E', 4, 'd']] });
    const r2 = rectRoom('r2', 10, 10, { max: 1, conns: [['W', 4, 'd']] });
    const c = generateRun(project([r1, r2]), { count: 2, sightM: 2 });
    expect(c.stop).toMatchObject({ open: 1, sight: 1 });
    expect(c.warnings.some((w) => w.startsWith('Совет: увеличьте предел обзора (сейчас 2 м)'))).toBe(true);
    // count набран — диагностики нет
    expect(generateRun(hrushLike(), { count: 20 }).stop).toBeUndefined();
  });
});
