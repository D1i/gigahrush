import { describe, expect, it } from 'vitest';
import { mergePresets, missingPresets, outdatedPresets, updatePresets } from './mergePresets';
import {
  createFinish, createRoom, deleteFinish, duplicateRoom, finishChances, finishRuleFor, finishUsage,
} from './ops';
import { emptyProject, parseProject, serializeProject } from './serialize';
import type { Project } from './types';

/** Проект с отделками: обои, кафель, двухцветная стена с dado, два пола, правила по тегам. */
function sample(): Project {
  const p = emptyProject();
  createFinish(p, 'wall', { id: 'wp', name: 'Обои', color: '#0a0', tex: 'data:image/jpeg;base64,AAAA', tileW: 0.53, tileH: 0.53, tags: ['обои'] });
  createFinish(p, 'wall', { id: 'tile', name: 'Кафель', tileW: 0.6, tileH: 0.6 });
  createFinish(p, 'wall', { id: 'two', name: 'Кафель + краска', dado: { finishId: 'tile', heightM: 1.5 } });
  createFinish(p, 'floor', { id: 'lino', name: 'Линолеум' });
  createFinish(p, 'floor', { id: 'parq', name: 'Паркет' });
  p.finishRules.push(
    { tag: 'жилая', wall: [{ finishId: 'wp', weight: 3 }, { finishId: 'tile', weight: 1 }], floor: [{ finishId: 'lino', weight: 1 }, { finishId: 'parq', weight: 1 }] },
    { tag: 'санузел', wall: [{ finishId: 'two', weight: 1 }], floor: [{ finishId: 'lino', weight: 1 }] },
  );
  const r = createRoom(p, 'Комната', 3, 3);
  r.id = 'room';
  r.tags = ['жилая'];
  const b = createRoom(p, 'Ванная', 2, 2);
  b.id = 'bath';
  b.tags = ['санузел', 'жилая'];
  b.finish = { wall: 'wp', floor: null };
  return p;
}

const roundtrip = (p: Project) => parseProject(JSON.parse(JSON.stringify(serializeProject(p))));

describe('отделка: модель', () => {
  it('emptyProject и старые проекты без полей — пустые отделки, комнаты по правилам', () => {
    const p = emptyProject();
    expect(p.finishes).toEqual([]);
    expect(p.finishRules).toEqual([]);
    const old = parseProject({ format: 'room-forge', rooms: [{ name: 'Голая', cells: ['0:0-2'] }] });
    expect(old.finishes).toEqual([]);
    expect(old.finishRules).toEqual([]);
    expect(old.rooms[0].finish).toEqual({ wall: null, floor: null });
  });

  it('createRoom / duplicateRoom: finish есть, копия не делит объект', () => {
    const p = sample();
    expect(p.rooms[0].finish).toEqual({ wall: null, floor: null });
    const copy = duplicateRoom(p, 'bath');
    expect(copy.finish).toEqual({ wall: 'wp', floor: null });
    copy.finish.wall = null;
    expect(p.rooms.find((r) => r.id === 'bath')!.finish.wall).toBe('wp');
  });

  it('roundtrip без потерь', () => {
    const p = sample();
    const back = roundtrip(p);
    expect(back).toEqual(p);
    expect(JSON.stringify(serializeProject(back))).toBe(JSON.stringify(serializeProject(p)));
    // текстура — та же строка, без копирования
    expect(serializeProject(p).finishes[0].tex).toBe(p.finishes[0].tex);
  });

  it('createFinish: поверхность из аргумента, уникальный id, dado только на стеновую', () => {
    const p = sample();
    const f = createFinish(p, 'floor', { id: 'wp', surface: 'wall', dado: { finishId: 'tile', heightM: 1 } });
    expect(f.surface).toBe('floor');
    expect(f.id).not.toBe('wp');
    expect(f.dado).toBeNull(); // у пола нижней панели нет
    expect(createFinish(p, 'wall', { dado: { finishId: 'lino', heightM: 1 } }).dado).toBeNull(); // пол как панель
    expect(createFinish(p, 'wall', { dado: { finishId: 'nope', heightM: 1 } }).dado).toBeNull();
    const ok = createFinish(p, 'wall', { tileW: -1, dado: { finishId: 'tile', heightM: 1.2 } });
    expect(ok.dado).toEqual({ finishId: 'tile', heightM: 1.2 });
    expect(ok.tileW).toBe(0.5);
  });

  it('вычищает висячие ссылки и чинит значения', () => {
    const json = JSON.parse(JSON.stringify(serializeProject(sample())));
    json.finishes.push(
      { id: 'bad', name: 7, surface: 'потолок', tileW: 0, tileH: 'x', dado: { finishId: 'lino', heightM: 1 } }, // пол как dado
      { id: 'self', surface: 'wall', dado: { finishId: 'self', heightM: 1 } },
      { id: 'fl', surface: 'floor', dado: { finishId: 'tile', heightM: 1 } }, // dado у пола
      { id: 'gone', surface: 'wall', dado: { finishId: 'нет', heightM: 1 } },
      { id: 'h0', surface: 'wall', dado: { finishId: 'tile', heightM: -2 } },
    );
    json.finishRules[0].wall.push({ finishId: 'lino', weight: 1 }, { finishId: 'нет', weight: 1 }, { finishId: 'wp', weight: -3 });
    json.finishRules[0].floor.push({ finishId: 'wp', weight: 1 }, { weight: 1 });
    json.finishRules.push({ tag: 'жилая', wall: [], floor: [] }, { tag: '', wall: [] }, { wall: [] });
    json.rooms[0].finish = { wall: 'lino', floor: 'parq' }; // стене — пол: нельзя
    json.rooms[1].finish = { wall: 'нет', floor: 5 };
    const p = parseProject(json);
    const by = new Map(p.finishes.map((f) => [f.id, f]));
    expect(by.get('bad')).toMatchObject({ name: 'Отделка', surface: 'wall', tileW: 0.5, tileH: 0.5, dado: null, tex: null, tags: [] });
    expect(by.get('self')!.dado).toBeNull();
    expect(by.get('fl')!.dado).toBeNull();
    expect(by.get('gone')!.dado).toBeNull();
    expect(by.get('h0')!.dado).toEqual({ finishId: 'tile', heightM: 1.5 });
    expect(by.get('two')!.dado).toEqual({ finishId: 'tile', heightM: 1.5 });
    expect(p.finishRules.map((r) => r.tag)).toEqual(['жилая', 'санузел']); // повтор тега и пустые — прочь
    expect(p.finishRules[0].wall).toEqual([
      { finishId: 'wp', weight: 3 }, { finishId: 'tile', weight: 1 }, { finishId: 'wp', weight: 0 },
    ]);
    expect(p.finishRules[0].floor.map((x) => x.finishId)).toEqual(['lino', 'parq']);
    expect(p.rooms[0].finish).toEqual({ wall: null, floor: 'parq' });
    expect(p.rooms[1].finish).toEqual({ wall: null, floor: null });
  });

  it('deleteFinish: каскад по комнатам, правилам и dado; finishUsage считает то же', () => {
    const p = sample();
    expect(finishUsage(p, 'tile')).toEqual({ rooms: 0, rules: 1, dado: 1, total: 2 });
    expect(finishUsage(p, 'wp')).toEqual({ rooms: 1, rules: 1, dado: 0, total: 2 });
    expect(finishUsage(p, 'lino')).toEqual({ rooms: 0, rules: 2, dado: 0, total: 2 });
    expect(deleteFinish(p, 'tile')).toBe(2);
    expect(p.finishes.some((f) => f.id === 'tile')).toBe(false);
    expect(p.finishes.find((f) => f.id === 'two')!.dado).toBeNull();
    expect(p.finishRules[0].wall).toEqual([{ finishId: 'wp', weight: 3 }]);
    expect(deleteFinish(p, 'wp')).toBe(2);
    expect(p.rooms.find((r) => r.id === 'bath')!.finish.wall).toBeNull();
    expect(p.finishRules[0].wall).toEqual([]); // правило остаётся (пустое), его можно удалить вручную
  });

  it('finishRuleFor — по порядку тегов комнаты, не правил', () => {
    const p = sample();
    const bath = p.rooms.find((r) => r.id === 'bath')!;
    expect(finishRuleFor(p, bath)!.tag).toBe('санузел');
    bath.tags = ['жилая', 'санузел'];
    expect(finishRuleFor(p, bath)!.tag).toBe('жилая');
    bath.tags = ['кладовка', 'санузел'];
    expect(finishRuleFor(p, bath)!.tag).toBe('санузел');
    bath.tags = ['кладовка'];
    expect(finishRuleFor(p, bath)).toBeNull();
  });

  it('finishChances: явное назначение → 1, иначе w/Σw; повторы складываются, нули и висячие — нет', () => {
    const p = sample();
    const room = p.rooms.find((r) => r.id === 'room')!;
    const bath = p.rooms.find((r) => r.id === 'bath')!;
    expect(finishChances(p, room, 'wall')).toEqual([{ finishId: 'wp', p: 0.75 }, { finishId: 'tile', p: 0.25 }]);
    expect(finishChances(p, room, 'floor')).toEqual([{ finishId: 'lino', p: 0.5 }, { finishId: 'parq', p: 0.5 }]);
    expect(finishChances(p, bath, 'wall')).toEqual([{ finishId: 'wp', p: 1 }]);
    expect(finishChances(p, bath, 'floor')).toEqual([{ finishId: 'lino', p: 1 }]); // пол — по правилу санузла
    p.finishRules[0].wall.push({ finishId: 'wp', weight: 4 }, { finishId: 'нет', weight: 9 }, { finishId: 'lino', weight: 9 }, { finishId: 'tile', weight: 0 });
    const ch = finishChances(p, room, 'wall');
    expect(ch.map((x) => x.finishId)).toEqual(['wp', 'tile']);
    expect(ch[0].p).toBeCloseTo(7 / 8);
    // явное назначение на удалённую отделку — снова правило
    bath.finish.wall = 'нет';
    expect(finishChances(p, bath, 'wall')).toEqual([{ finishId: 'two', p: 1 }]);
    room.tags = [];
    expect(finishChances(p, room, 'wall')).toEqual([]);
  });
});

describe('отделка: слияние пресетов', () => {
  /** «Пресеты» — sample(), «старый проект» — без отделок. */
  const fresh = () => sample();

  it('старый проект без отделок: недостающие считаются и добавляются, свои правила не трогаются', () => {
    const p = emptyProject();
    p.finishRules.push({ tag: 'жилая', wall: [], floor: [] });
    const m = missingPresets(p, fresh());
    expect(m.finishes).toBe(5 + 1); // 5 отделок + правило «санузел»
    const r = mergePresets(p, fresh());
    expect(r.finishes).toBe(6);
    expect(p.finishes.map((f) => f.id)).toEqual(['wp', 'tile', 'two', 'lino', 'parq']);
    expect(p.finishRules.map((x) => x.tag)).toEqual(['жилая', 'санузел']);
    expect(p.finishRules[0].wall).toEqual([]); // своё правило «жилая» осталось
    expect(missingPresets(p, fresh()).finishes).toBe(0);
  });

  it('устаревшие отделки и правила считаются; обновление заменяет пресетные теги, свои оставляет', () => {
    const f = fresh();
    const p = roundtrip(f);
    expect(outdatedPresets(p, f)).toBe(0);
    p.finishes[0].name = 'Мои обои';
    p.finishes[0].tex = 'data:image/jpeg;base64,BBBB'; // текстура в сравнении не участвует
    p.finishRules[0].wall[0].weight = 10;
    p.finishRules.push({ tag: 'кладовка', wall: [{ finishId: 'wp', weight: 1 }], floor: [] });
    expect(outdatedPresets(p, f)).toBe(2);
    updatePresets(p, f);
    expect(p.finishes[0].name).toBe('Обои');
    expect(p.finishRules[0].wall[0].weight).toBe(3);
    expect(p.finishRules.find((x) => x.tag === 'кладовка')).toBeDefined();
    expect(outdatedPresets(p, f)).toBe(0);
    // правила проекта — копии, не общие объекты с пресетами
    p.finishRules[0].wall[0].weight = 7;
    expect(f.finishRules[0].wall[0].weight).toBe(3);
  });
});
