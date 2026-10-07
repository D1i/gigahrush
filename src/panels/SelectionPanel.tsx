// Инспектор: выделенный объект (дверь, метка стыковки, декор, спот).
import { useId } from 'react';
import type { Connector, Decor, Door, Project, Room, Segment, ShiftMode, Spot } from '../model/types';
import { useProject } from '../model/store';
import { notify, setUI, useUI } from '../model/ui';
import { isSegmentValid, tagsCompatible } from '../model/segments';
import { deleteSpot, setSpotGroup, variantChance } from '../model/ops';
import { Btn, NumField, Section, Select, TextField } from '../ui/kit';
import { SIDE_NAME, assignName, mutRoom, normDeg, segOverlap, toCells, toM } from './util';

export function SelectionPanel({ room }: { room: Room }) {
  const p = useProject();
  const ui = useUI();
  const sel = ui.selection;
  if (!sel) return null;

  const clear = () => setUI({ selection: null });

  switch (sel.kind) {
    case 'door': {
      const d = room.doors.find((x) => x.id === sel.id);
      if (!d) return null;
      return (
        <Section title="Дверь" actions={<DelBtn onClick={() => { mutRoom(room.id, (r) => (r.doors = r.doors.filter((x) => x.id !== d.id))); clear(); }} />}>
          <SegmentFields p={p} room={room} seg={d} kind="doors" />
        </Section>
      );
    }
    case 'connector': {
      const c = room.connectors.find((x) => x.id === sel.id);
      if (!c) return null;
      return (
        <Section title="Метка стыковки" actions={<DelBtn onClick={() => { mutRoom(room.id, (r) => (r.connectors = r.connectors.filter((x) => x.id !== c.id))); clear(); }} />}>
          <ConnectorFields p={p} room={room} c={c} />
        </Section>
      );
    }
    case 'decor': {
      const d = room.decor.find((x) => x.id === sel.id);
      if (!d) return null;
      const cellM = p.settings.cellM;
      const prop = p.props.find((x) => x.id === d.propId);
      const upd = (fn: (x: Decor) => void, key: string) =>
        mutRoom(room.id, (r) => {
          const t = r.decor.find((x) => x.id === d.id);
          if (t) fn(t);
        }, { key: `${key}:${d.id}` });
      return (
        <Section title="Декор" actions={<DelBtn onClick={() => { mutRoom(room.id, (r) => (r.decor = r.decor.filter((x) => x.id !== d.id))); clear(); }} />}>
          <Select
            label="Предмет обстановки"
            value={d.propId}
            options={[
              ...(prop ? [] : [{ value: d.propId, label: '(удалён из библиотеки)' }]),
              ...p.props.map((x) => ({ value: x.id, label: x.name })),
            ]}
            onChange={(v) => upd((t) => (t.propId = v), 'decor-prop')}
          />
          <div className="grid3">
            <NumField label="X, м" value={toM(d.x, cellM)} step={0.05} digits={3} onChange={(v) => upd((t) => (t.x = toCells(v, cellM)), 'decor-x')} />
            <NumField label="Y, м" value={toM(d.y, cellM)} step={0.05} digits={3} onChange={(v) => upd((t) => (t.y = toCells(v, cellM)), 'decor-y')} />
            <NumField label="Поворот" value={d.rot} step={90} digits={1} suffix="°" onChange={(v) => upd((t) => (t.rot = normDeg(v)), 'decor-rot')} />
          </div>
          <div className="row hint">
            <span>Габарит:</span>
            <span className="mono">{prop ? `${prop.w} × ${prop.h} м` : '—'}</span>
            {prop && prop.tags.length > 0 && <span className="grow" style={{ textAlign: 'right' }}>{prop.tags.join(', ')}</span>}
          </div>
        </Section>
      );
    }
    case 'spot': {
      const s = room.spots.find((x) => x.id === sel.id);
      if (!s) return null;
      const cellM = p.settings.cellM;
      const upd = (fn: (x: Spot) => void, key: string) =>
        mutRoom(room.id, (r) => {
          const t = r.spots.find((x) => x.id === s.id);
          if (t) fn(t);
        }, { key: `${key}:${s.id}` });
      const group = room.spotGroups.find((g) => g.id === s.groupId) ?? null;
      return (
        <Section title="Спот" actions={<DelBtn onClick={() => { mutRoom(room.id, (r) => deleteSpot(r, s.id)); clear(); }} />}>
          <TextField label="Имя" value={s.name} onChange={(v) => upd((t) => (t.name = v), 'spot-name')} />
          <div className="grid3">
            <NumField label="X, м" value={toM(s.x, cellM)} step={0.05} digits={3} onChange={(v) => upd((t) => (t.x = toCells(v, cellM)), 'spot-x')} />
            <NumField label="Y, м" value={toM(s.y, cellM)} step={0.05} digits={3} onChange={(v) => upd((t) => (t.y = toCells(v, cellM)), 'spot-y')} />
            <NumField label="Поворот" value={s.rot} step={90} digits={1} suffix="°" onChange={(v) => upd((t) => (t.rot = normDeg(v)), 'spot-rot')} />
          </div>
          <div className="row pn-end">
            <div className="grow">
              <Select
                label="Группа"
                value={s.groupId ?? ''}
                options={[{ value: '', label: 'без группы' }, ...room.spotGroups.map((g) => ({ value: g.id, label: g.name }))]}
                onChange={(v) => mutRoom(room.id, (r) => setSpotGroup(r, s.id, v || null))}
              />
            </div>
            {group && (
              <Btn sm onClick={() => setUI({ variantsGroupId: group.id })} title="Открыть редактор вариантов группы">
                варианты…
              </Btn>
            )}
          </div>
          <SpotOutcomes p={p} room={room} spotId={s.id} />
        </Section>
      );
    }
  }
}

function DelBtn({ onClick }: { onClick: () => void }) {
  return (
    <Btn sm variant="danger" onClick={onClick} title="Удалить (Delete)">
      удалить
    </Btn>
  );
}

/** Что может появиться на споте: суммарные шансы содержимого по вариантам группы. */
function SpotOutcomes({ p, room, spotId }: { p: Project; room: Room; spotId: string }) {
  const s = room.spots.find((x) => x.id === spotId)!;
  const g = room.spotGroups.find((x) => x.id === s.groupId);
  if (!g) return <div className="hint">Без группы — заготовка, в генерации не участвует.</div>;
  if (!g.variants.length) return <div className="hint">В группе «{g.name}» нет вариантов — спот всегда пуст.</div>;
  const acc = new Map<string, number>();
  for (const v of g.variants) {
    const name = assignName(p, v.assign[s.id]);
    acc.set(name, (acc.get(name) ?? 0) + variantChance(g, v.id));
  }
  const rows = [...acc].sort((a, b) => b[1] - a[1]);
  return (
    <div className="field">
      <label>Может появиться</label>
      <div className="pn-chips">
        {rows.map(([name, ch]) => (
          <span key={name} className={'chip' + (name === 'пусто' ? '' : ' accent')}>
            {name} <span className="mono">{+(ch * 100).toFixed(1)}%</span>
          </span>
        ))}
      </div>
    </div>
  );
}

/** Сторона + длина отрезка. Длина меняется с сохранением центра, если стена позволяет. */
function SegmentFields({ p, room, seg, kind }: { p: Project; room: Room; seg: Door | Connector; kind: 'doors' | 'connectors' }) {
  const cellM = p.settings.cellM;
  const setLen = (meters: number) => {
    const len = Math.max(1, Math.round(meters / cellM));
    if (len === seg.len) return;
    const others: Segment[] = (room[kind] as Segment[]).filter((x) => x.id !== seg.id);
    const pos = fitSegment(room, seg, len, others);
    if (!pos) {
      notify(`Отрезок ${toM(len, cellM)} м не помещается на этой стене`, 'warn');
      return;
    }
    mutRoom(room.id, (r) => {
      const t = (r[kind] as Segment[]).find((x) => x.id === seg.id);
      if (t) Object.assign(t, pos, { len });
    }, { key: `seg-len:${seg.id}` });
  };
  const horiz = seg.side === 'N' || seg.side === 'S';
  return (
    <div className="grid2">
      <div className="field">
        <label>Сторона</label>
        <div className="pn-ro">
          {SIDE_NAME[seg.side]} <span className="muted mono">({seg.side})</span>
        </div>
      </div>
      <NumField label="Длина" value={toM(seg.len, cellM)} step={cellM} digits={2} min={cellM} suffix="м" onChange={setLen} />
      <div className="hint" style={{ gridColumn: '1 / -1' }}>
        {horiz ? 'X' : 'Y'} от <span className="mono">{toM(horiz ? seg.cx : seg.cy, cellM)}</span> до{' '}
        <span className="mono">{toM((horiz ? seg.cx : seg.cy) + seg.len, cellM)}</span> м
      </div>
    </div>
  );
}

/** Новое начало отрезка длины len: при сжатии — центр сохраняется; при росте — ищем сдвиг вдоль стены. */
function fitSegment(room: Room, seg: Segment, len: number, others: Segment[]): { cx: number; cy: number } | null {
  const horiz = seg.side === 'N' || seg.side === 'S';
  const s0 = horiz ? seg.cx : seg.cy;
  const mk = (start: number) => (horiz ? { cx: start, cy: seg.cy } : { cx: seg.cx, cy: start });
  if (len < seg.len) return mk(s0 + Math.floor((seg.len - len) / 2));
  const delta = len - seg.len;
  const offs: number[] = [];
  for (let o = 0; o <= delta; o++) offs.push(o);
  offs.sort((a, b) => Math.abs(a - delta / 2) - Math.abs(b - delta / 2));
  for (const o of offs) {
    const cand = { ...mk(s0 - o), side: seg.side, len };
    if (isSegmentValid(room.cells, cand) && !others.some((x) => segOverlap(x, cand))) return mk(s0 - o);
  }
  return null;
}

const MATCH_LABEL = { exact: 'тег + длина', tag: 'только тег', len: 'только длина' } as const;

const SHIFT_OPTS: { value: ShiftMode; label: string }[] = [
  { value: 'auto', label: 'авто (по настройкам генератора)' },
  { value: 'always', label: 'всегда сдвигает слой W' },
  { value: 'never', label: 'никогда не сдвигает' },
];

const SHIFT_HINT: Record<ShiftMode, string> = {
  auto: 'Сдвиг слоя — с шансом из настроек, или «по нужде», когда в текущем слое нет места.',
  always: 'За этим проёмом всегда другое измерение (например, входная дверь квартиры).',
  never: 'Обычный порог: слой не меняется (например, лестничный марш — подъезд остаётся цельным).',
};

function ConnectorFields({ p, room, c }: { p: Project; room: Room; c: Connector }) {
  const listId = useId();
  const upd = (fn: (x: Connector) => void, key: string) =>
    mutRoom(room.id, (r) => {
      const t = r.connectors.find((x) => x.id === c.id);
      if (t) fn(t);
    }, { key: `${key}:${c.id}` });

  // Все теги меток в проекте — подсказки
  const tags = new Set<string>();
  for (const r of p.rooms) for (const x of r.connectors) if (x.tag) tags.add(x.tag);

  // С чем стыкуется — по текущему режиму генератора
  const mode = p.generator.match;
  const fits = (x: Connector) =>
    x.id !== c.id &&
    (mode === 'exact' ? tagsCompatible(c.tag, x.tag) && x.len === c.len : mode === 'tag' ? tagsCompatible(c.tag, x.tag) : x.len === c.len);
  const matches = p.rooms
    .map((r) => ({ r, list: r.connectors.filter(fits) }))
    .filter((m) => m.list.length > 0);

  return (
    <>
      <div className="grid2">
        <TextField label="Имя" value={c.name} onChange={(v) => upd((t) => (t.name = v), 'con-name')} />
        <div className="field">
          <label>Тег стыковки</label>
          <input className="input" list={listId} value={c.tag} placeholder="door" onChange={(e) => upd((t) => (t.tag = e.target.value), 'con-tag')} />
          <datalist id={listId}>
            {[...tags].sort().map((t) => (
              <option key={t} value={t} />
            ))}
          </datalist>
        </div>
      </div>
      <SegmentFields p={p} room={room} seg={c} kind="connectors" />
      <Select<ShiftMode>
        label="Порог (4D)"
        value={c.shift ?? 'auto'}
        options={SHIFT_OPTS}
        onChange={(v) =>
          upd((t) => {
            // 'auto' — значение по умолчанию: поле не храним
            if (v === 'auto') delete t.shift;
            else t.shift = v;
          }, 'con-shift')
        }
      />
      <div className="hint">
        {SHIFT_HINT[c.shift ?? 'auto']}
        {p.generator.mode !== 'fold' && ' Действует только в складчатом генераторе.'}
      </div>
      <div className="field">
        <label>
          Стыкуется с <span className="muted">(режим: {MATCH_LABEL[mode]})</span>
        </label>
        {matches.length === 0 ? (
          <div className="hint pn-warn">Нет ни одной подходящей метки — в генерации это будет тупик.</div>
        ) : (
          <div className="pn-chips">
            {matches.map(({ r, list }) => (
              <button
                key={r.id}
                className={'chip pn-link' + (r.id === room.id ? ' accent' : ' green')}
                title="Перейти к метке"
                onClick={() => setUI({ roomId: r.id, selection: { kind: 'connector', id: list[0].id } })}
              >
                {r.name}
                {list.length > 1 && <span className="mono">×{list.length}</span>}
              </button>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
