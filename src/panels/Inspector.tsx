// Правая панель редактора: выделенный объект, комната, генерация, спец-локация, элитность, группы спотов, лут.
import { useEffect, useState } from 'react';
import type { Project, Room } from '../model/types';
import { useProject } from '../model/store';
import { notify, setUI, useUI } from '../model/ui';
import { bbox, rectCells, resizeCells } from '../model/cells';
import { reattachSegments } from '../model/segments';
import { deleteSpotGroup, roomArea, uid } from '../model/ops';
import { Btn, Check, ColorField, NumField, Section, Select, TagsField, TextField, pct } from '../ui/kit';
import { SelectionPanel } from './SelectionPanel';
import { FinishSection } from './FinishSection';
import { LocationSection } from './LocationSection';
import { GROUP_COLORS, mutRoom, toM } from './util';
import './panels.css';

export function Inspector() {
  const p = useProject();
  const ui = useUI();
  const room = p.rooms.find((r) => r.id === ui.roomId) ?? null;
  if (!room) {
    return (
      <div className="empty">
        Комната не выбрана.
        <div className="hint" style={{ marginTop: 6 }}>Создайте или выберите комнату в списке слева.</div>
      </div>
    );
  }
  return (
    <div className="pn-insp">
      <SelectionPanel room={room} />
      <RoomSection p={p} room={room} />
      <FinishSection p={p} room={room} />
      <GenSection room={room} />
      <LocationSection room={room} />
      <EliteSection p={p} room={room} />
      <SpotGroupsSection room={room} />
      <LootSection p={p} room={room} />
    </div>
  );
}

// ───────────── Комната ─────────────

function RoomSection({ p, room }: { p: Project; room: Room }) {
  const cellM = p.settings.cellM;
  const b = bbox(room.cells);
  return (
    <Section title="Комната">
      <TextField label="Название" value={room.name} onChange={(v) => mutRoom(room.id, (r) => (r.name = v), { key: `room-name:${room.id}` })} />
      <TagsField label="Теги" value={room.tags} onChange={(v) => mutRoom(room.id, (r) => (r.tags = v), { key: `room-tags:${room.id}` })} />
      <div className="row">
        <Check
          label="Уникальная"
          title="Не больше одной копии за прогон"
          value={room.unique}
          onChange={(v) =>
            mutRoom(room.id, (r) => {
              r.unique = v;
              if (v) {
                r.gen.max = 1;
                r.gen.min = Math.min(r.gen.min, 1);
              }
            })
          }
        />
        <span className="grow" />
        <span className="hint">Площадь</span>
        <span className="mono pn-big">{roomArea(p, room).toFixed(2)} м²</span>
      </div>
      <TextField label="Заметка" multiline value={room.note} placeholder="серия дома, тип квартиры…" onChange={(v) => mutRoom(room.id, (r) => (r.note = v), { key: `room-note:${room.id}` })} />
      <SizeEditor room={room} cellM={cellM} />
      <div className="pn-stats">
        <Stat k="клеток" v={room.cells.size} />
        <Stat k="дверей" v={room.doors.length} />
        <Stat k="меток" v={room.connectors.length} />
        <Stat k="декора" v={room.decor.length} />
        <Stat k="спотов" v={room.spots.length} />
      </div>
      {b && (
        <div className="hint">
          Габарит сейчас: <span className="mono">{toM(b.w, cellM)} × {toM(b.h, cellM)} м</span>
        </div>
      )}
    </Section>
  );
}

function Stat({ k, v }: { k: string; v: number }) {
  return (
    <div className="pn-stat">
      <span className="mono">{v}</span>
      <span>{k}</span>
    </div>
  );
}

/** Габарит: черновые ширина/глубина и две операции (ТЗ §5). */
function SizeEditor({ room, cellM }: { room: Room; cellM: number }) {
  const b = bbox(room.cells);
  const [w, setW] = useState(b ? toM(b.w, cellM) : 3);
  const [h, setH] = useState(b ? toM(b.h, cellM) : 3);
  // Сброс черновика при смене комнаты или внешнем изменении габарита
  useEffect(() => {
    if (b) {
      setW(toM(b.w, cellM));
      setH(toM(b.h, cellM));
    }
  }, [room.id, b?.w, b?.h, cellM]);

  const apply = (mode: 'rect' | 'fit') => {
    const wc = Math.max(1, Math.round(w / cellM));
    const hc = Math.max(1, Math.round(h / cellM));
    let res = { moved: 0, removed: 0 };
    mutRoom(room.id, (r) => {
      const cur = bbox(r.cells);
      const x0 = cur?.x0 ?? 0;
      const y0 = cur?.y0 ?? 0;
      r.cells = mode === 'rect' || !cur ? rectCells(x0, y0, wc, hc) : resizeCells(r.cells, { x0, y0, x1: x0 + wc, y1: y0 + hc });
      res = reattachSegments(r);
    });
    const parts: string[] = [];
    if (res.moved) parts.push(`перемещено проёмов: ${res.moved}`);
    if (res.removed) parts.push(`удалено (нет места): ${res.removed}`);
    notify(
      (mode === 'rect' ? `Форма — прямоугольник ${toM(wc, cellM)}×${toM(hc, cellM)} м` : `Форма подогнана под ${toM(wc, cellM)}×${toM(hc, cellM)} м`) +
        (parts.length ? `. ${parts.join(', ')}` : ''),
      res.removed ? 'warn' : 'ok',
    );
  };

  return (
    <div className="field">
      <label>Габарит (от левого верхнего угла)</label>
      <div className="row">
        <div className="grow">
          <NumField value={w} step={cellM} min={cellM} digits={2} suffix="м" title="Ширина (X)" onChange={setW} />
        </div>
        <span className="muted">×</span>
        <div className="grow">
          <NumField value={h} step={cellM} min={cellM} digits={2} suffix="м" title="Глубина (Y)" onChange={setH} />
        </div>
      </div>
      <div className="row">
        <Btn sm onClick={() => apply('rect')} title="Заменить форму прямоугольником заданного размера">
          Прямоугольник
        </Btn>
        <Btn sm onClick={() => apply('fit')} title="Растянуть/обрезать текущую форму: крайние ряды продолжаются, лишнее отсекается">
          Подогнать форму
        </Btn>
      </div>
    </div>
  );
}

// ───────────── Генерация ─────────────

function GenSection({ room }: { room: Room }) {
  const int = (v: number) => Math.max(0, Math.round(v));
  const set = (k: 'weight' | 'min' | 'max', v: number) =>
    mutRoom(room.id, (r) => {
      r.gen[k] = k === 'weight' ? Math.max(0, v) : int(v);
      if (r.unique) r.gen.max = 1;
      // min не может превышать max
      if (k === 'min' && r.gen.min > r.gen.max) r.gen.max = r.unique ? 1 : r.gen.min;
      if (r.gen.min > r.gen.max) r.gen.min = r.gen.max;
    }, { key: `room-gen-${k}:${room.id}` });
  return (
    <Section title="Генерация">
      <div className="grid3">
        <NumField label="Вес" value={room.gen.weight} min={0} step={1} digits={2} onChange={(v) => set('weight', v)} title="Относительная вероятность выбора комнаты" />
        <NumField label="Мин" value={room.gen.min} min={0} step={1} digits={0} onChange={(v) => set('min', v)} title="Минимум копий за прогон" />
        <NumField
          label="Макс"
          value={room.unique ? 1 : room.gen.max}
          min={0}
          step={1}
          digits={0}
          disabled={room.unique}
          onChange={(v) => set('max', v)}
          title={room.unique ? 'Уникальная комната — максимум 1' : 'Максимум копий за прогон'}
        />
      </div>
    </Section>
  );
}

// ───────────── Элитность ─────────────

function EliteSection({ p, room }: { p: Project; room: Room }) {
  const tiers = [...p.economy.tiers].sort((a, b) => a.level - b.level);
  const wOf = (tierId: string) => room.elite.find((e) => e.tierId === tierId)?.weight ?? 0;
  const sum = tiers.reduce((s, t) => s + wOf(t.id), 0);
  const setW = (tierId: string, w: number) =>
    mutRoom(room.id, (r) => {
      const e = r.elite.find((x) => x.tierId === tierId);
      if (w <= 0) r.elite = r.elite.filter((x) => x.tierId !== tierId);
      else if (e) e.weight = w;
      else r.elite.push({ tierId, weight: w });
    }, { key: `room-elite:${room.id}:${tierId}` });

  return (
    <Section
      title="Элитность при заходе"
      actions={
        <>
          <Btn sm variant="ghost" disabled={!tiers.length} onClick={() => mutRoom(room.id, (r) => (r.elite = tiers.map((t) => ({ tierId: t.id, weight: 1 }))))} title="Все тиры с весом 1">
            ровно
          </Btn>
          <Btn sm variant="ghost" disabled={!room.elite.length} onClick={() => mutRoom(room.id, (r) => (r.elite = []))} title="Убрать все тиры — комната всегда базовая">
            очистить
          </Btn>
        </>
      }
    >
      {!tiers.length ? (
        <div className="hint">В экономике нет тиров — настройте их на вкладке «Экономика».</div>
      ) : (
        <>
          <table className="table pn-table">
            <thead>
              <tr>
                <th>Тир</th>
                <th className="num">Опасн.</th>
                <th className="num">Вес</th>
                <th className="num">Шанс</th>
              </tr>
            </thead>
            <tbody>
              {tiers.map((t) => {
                const w = wOf(t.id);
                return (
                  <tr key={t.id} className={w > 0 ? '' : 'pn-off'}>
                    <td>
                      <div className="row" style={{ gap: 6 }}>
                        <span className="swatch" style={{ background: t.color }} />
                        <span className="pn-ell" title={t.note || t.name}>{t.name}</span>
                        <span className="mono muted">ур.{t.level}</span>
                      </div>
                    </td>
                    <td className="num">+{t.danger}</td>
                    <td className="num" style={{ width: 70 }}>
                      <NumField value={w} min={0} step={1} digits={2} onChange={(v) => setW(t.id, v)} />
                    </td>
                    <td className="num" style={{ width: 52 }}>{w > 0 && sum > 0 ? pct(w / sum) : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="hint">
            {sum > 0
              ? 'При заходе разыгрывается один тир: P = w / Σw. Вес 0 — тир не выпадает.'
              : 'Список пуст — комната всегда базовая (без тира и прироста опасности).'}
          </div>
        </>
      )}
    </Section>
  );
}

// ───────────── Группы спотов ─────────────

function SpotGroupsSection({ room }: { room: Room }) {
  const ui = useUI();
  const loose = room.spots.filter((s) => !s.groupId || !room.spotGroups.some((g) => g.id === s.groupId));

  const add = () => {
    const id = uid('sg');
    mutRoom(room.id, (r) => {
      const used = new Set(r.spotGroups.map((g) => g.color));
      const color = GROUP_COLORS.find((c) => !used.has(c)) ?? GROUP_COLORS[r.spotGroups.length % GROUP_COLORS.length];
      r.spotGroups.push({ id, name: `Группа ${r.spotGroups.length + 1}`, color, variants: [] });
    });
    setUI({ spotGroupId: id });
  };
  const del = (id: string) => {
    mutRoom(room.id, (r) => deleteSpotGroup(r, id));
    setUI((s) => ({
      spotGroupId: s.spotGroupId === id ? null : s.spotGroupId,
      variantsGroupId: s.variantsGroupId === id ? null : s.variantsGroupId,
    }));
  };

  return (
    <Section
      title="Группы спотов"
      actions={
        <Btn sm onClick={add} title="Новая группа (станет активной для новых спотов)">
          + группа
        </Btn>
      }
    >
      {room.spotGroups.length === 0 && <div className="hint">Групп нет. Группа — набор спотов, заполняемых одним вариантом.</div>}
      {room.spotGroups.map((g) => {
        const n = room.spots.filter((s) => s.groupId === g.id).length;
        const active = ui.spotGroupId === g.id;
        return (
          <div key={g.id} className={'pn-group' + (active ? ' on' : '')}>
            <div className="row">
              <ColorField value={g.color} title="Цвет группы" onChange={(v) => mutRoom(room.id, (r) => { const t = r.spotGroups.find((x) => x.id === g.id); if (t) t.color = v; }, { key: `sg-color:${g.id}` })} />
              <div className="grow">
                <TextField value={g.name} onChange={(v) => mutRoom(room.id, (r) => { const t = r.spotGroups.find((x) => x.id === g.id); if (t) t.name = v; }, { key: `sg-name:${g.id}` })} />
              </div>
              <Btn sm icon variant="danger" onClick={() => del(g.id)} title="Удалить группу (споты останутся без группы)">
                ✕
              </Btn>
            </div>
            <div className="row">
              <span className="hint mono pn-nowrap">
                {n} спот. · {g.variants.length} вар.
              </span>
              <span className="grow" />
              <Btn sm on={active} onClick={() => setUI({ spotGroupId: active ? null : g.id })} title="Новые споты инструментом «Спот» попадут в эту группу">
                {active ? '● активна' : 'сделать активной'}
              </Btn>
              <Btn sm onClick={() => setUI({ variantsGroupId: g.id })}>варианты…</Btn>
            </div>
            {n > 0 && g.variants.length === 0 && <div className="hint pn-warn">Нет вариантов — споты группы всегда пусты.</div>}
          </div>
        );
      })}
      {room.spotGroups.length > 0 && (
        <div className="hint">
          Новые споты → <b>{room.spotGroups.find((g) => g.id === ui.spotGroupId)?.name ?? 'без группы'}</b>
        </div>
      )}
      {loose.length > 0 && (
        <div className="field">
          <label>
            Без группы <span className="muted">— заготовка, в генерации не участвует</span>
          </label>
          <div className="pn-chips">
            {loose.map((s) => (
              <button
                key={s.id}
                className={'chip pn-link' + (ui.selection?.kind === 'spot' && ui.selection.id === s.id ? ' accent' : '')}
                onClick={() => setUI({ selection: { kind: 'spot', id: s.id } })}
              >
                {s.name || s.id}
              </button>
            ))}
          </div>
        </div>
      )}
    </Section>
  );
}

// ───────────── Лут комнаты ─────────────

function LootSection({ p, room }: { p: Project; room: Room }) {
  const upd = (rowId: string, fn: (x: Room['loot'][number]) => void, key: string) =>
    mutRoom(room.id, (r) => {
      const t = r.loot.find((x) => x.id === rowId);
      if (t) fn(t);
    }, { key: `${key}:${rowId}` });
  const add = () =>
    mutRoom(room.id, (r) => {
      r.loot.push({ id: uid('loot'), itemId: p.items[0]?.id ?? '', chance: 0.5, min: 1, max: 1 });
    });
  const itemOpts = p.items.map((x) => ({ value: x.id, label: x.name }));

  return (
    <Section
      title="Лут комнаты"
      actions={
        <Btn sm onClick={add} disabled={!p.items.length} title={p.items.length ? 'Добавить строку' : 'В библиотеке нет предметов'}>
          + строка
        </Btn>
      }
    >
      {room.loot.length === 0 ? (
        <div className="hint">Лута нет.</div>
      ) : (
        <table className="table pn-table">
          <thead>
            <tr>
              <th>Предмет</th>
              <th className="num">%</th>
              <th className="num">Мин</th>
              <th className="num">Макс</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {room.loot.map((row) => (
              <tr key={row.id}>
                <td>
                  <Select
                    value={row.itemId}
                    options={p.items.some((x) => x.id === row.itemId) ? itemOpts : [{ value: row.itemId, label: '(удалён)' }, ...itemOpts]}
                    onChange={(v) => upd(row.id, (t) => (t.itemId = v), 'loot-item')}
                  />
                </td>
                <td style={{ width: 58 }}>
                  <NumField value={+(row.chance * 100).toFixed(2)} min={0} max={100} step={5} digits={1} onChange={(v) => upd(row.id, (t) => (t.chance = v / 100), 'loot-ch')} />
                </td>
                <td style={{ width: 46 }}>
                  <NumField
                    value={row.min}
                    min={0}
                    step={1}
                    digits={0}
                    onChange={(v) =>
                      upd(row.id, (t) => {
                        t.min = Math.max(0, Math.round(v));
                        if (t.max < t.min) t.max = t.min;
                      }, 'loot-min')
                    }
                  />
                </td>
                <td style={{ width: 46 }}>
                  <NumField
                    value={row.max}
                    min={0}
                    step={1}
                    digits={0}
                    onChange={(v) =>
                      upd(row.id, (t) => {
                        t.max = Math.max(0, Math.round(v));
                        if (t.min > t.max) t.min = t.max;
                      }, 'loot-max')
                    }
                  />
                </td>
                <td style={{ width: 24 }}>
                  <Btn sm icon variant="danger" title="Удалить строку" onClick={() => mutRoom(room.id, (r) => (r.loot = r.loot.filter((x) => x.id !== row.id)))}>
                    ✕
                  </Btn>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="hint">Строки бросаются независимо, позицию определяет движок.</div>
    </Section>
  );
}
