import { describe, expect, it } from 'vitest';
import { createDefaultProject } from '../data/presets';
import { mergePresets, missingPresets, outdatedPresets, RETIRED_PRESETS, updatePresets } from './mergePresets';
import { parseProject, serializeProject } from './serialize';

describe('mergePresets', () => {
  const fresh = createDefaultProject();

  it('свежий проект после сохранения/загрузки не считается устаревшим', () => {
    const p = parseProject(JSON.parse(JSON.stringify(serializeProject(createDefaultProject()))));
    expect(outdatedPresets(p, fresh)).toBe(0);
    const m = missingPresets(p, fresh);
    expect(m.rooms + m.props + m.items + m.economy).toBe(0);
  });

  it('добавляет недостающее и не трогает правки', () => {
    const p = createDefaultProject();
    const removed = p.rooms.splice(3, 2);
    p.rooms[0].name = 'Моя площадка';
    const r = mergePresets(p, fresh);
    expect(r.rooms).toBe(2);
    expect(p.rooms.some((x) => x.id === removed[0].id)).toBe(true);
    expect(p.rooms[0].name).toBe('Моя площадка');
  });

  it('обновление заменяет изменённые пресеты и оставляет свои комнаты', () => {
    const p = createDefaultProject();
    p.rooms[0].name = 'Моя площадка';
    p.rooms.push({ ...p.rooms[1], id: 'my_room', name: 'Своя' });
    expect(outdatedPresets(p, fresh)).toBe(1);
    updatePresets(p, fresh);
    expect(p.rooms[0].name).toBe(fresh.rooms[0].name);
    expect(p.rooms.some((x) => x.id === 'my_room')).toBe(true);
    expect(outdatedPresets(p, fresh)).toBe(0);
  });

  it('убранные пресеты (сарай v1: сеновал, сено-«ковёр») — устаревшие; обновление их удаляет вместе со ссылками', () => {
    const p = createDefaultProject();
    const base = p.rooms.find((r) => r.id === 'barn_tun_2')!;
    p.props.push({ ...p.props[0], id: 'p_barn_hay', name: 'Сено на полу (дорожка)' });
    p.rooms.push({ ...base, id: 'barn_hub_hay', name: 'Сеновал' });
    // своя комната со старым сеном в декоре
    p.rooms.push({ ...base, id: 'my_barn', decor: [...base.decor, { id: 'my_hay', propId: 'p_barn_hay', x: 7, y: 7, rot: 0 }] });
    expect(RETIRED_PRESETS.rooms).toContain('barn_hub_hay');
    expect(outdatedPresets(p, fresh)).toBe(2);
    updatePresets(p, fresh);
    expect(p.rooms.some((x) => x.id === 'barn_hub_hay')).toBe(false);
    expect(p.props.some((x) => x.id === 'p_barn_hay')).toBe(false);
    expect(p.rooms.find((x) => x.id === 'my_barn')!.decor.some((d) => d.propId === 'p_barn_hay')).toBe(false);
    expect(outdatedPresets(p, fresh)).toBe(0);
  });
});
