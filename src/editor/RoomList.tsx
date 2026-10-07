// Список комнат проекта (ТЗ §5): поиск, создание, дублирование, удаление.
import { useEffect, useState } from 'react';
import { mutate, useProject } from '../model/store';
import { setUI, useUI } from '../model/ui';
import { areaM2 } from '../model/cells';
import { createRoom, deleteRoom, duplicateRoom } from '../model/ops';
import { Btn, Section } from '../ui/kit';
import './editor.css';

export function RoomList() {
  const p = useProject();
  const ui = useUI();
  const [q, setQ] = useState('');

  // Автовыбор первой комнаты, если выбранной нет
  const exists = p.rooms.some((r) => r.id === ui.roomId);
  useEffect(() => {
    if (!exists) setUI({ roomId: p.rooms[0]?.id ?? null, selection: null });
  }, [exists, p.rooms.length]);

  // Проект мутируется на месте — без useMemo, фильтр дешёвый
  const s = q.trim().toLowerCase();
  const filtered = !s
    ? p.rooms
    : p.rooms.filter((r) => r.name.toLowerCase().includes(s) || r.tags.some((t) => t.toLowerCase().includes(s)));

  const cur = p.rooms.find((r) => r.id === ui.roomId) ?? null;

  const add = () => {
    let id = '';
    mutate((pr) => {
      const r = createRoom(pr, `Комната ${pr.rooms.length + 1}`);
      id = r.id;
    });
    if (id) setUI({ roomId: id, selection: null });
  };
  const dup = () => {
    if (!cur) return;
    let id = '';
    mutate((pr) => {
      id = duplicateRoom(pr, cur.id).id;
    });
    if (id) setUI({ roomId: id, selection: null });
  };
  const del = () => {
    if (!cur) return;
    if (!confirm(`Удалить комнату «${cur.name}»? Действие можно отменить (Ctrl+Z).`)) return;
    const idx = p.rooms.indexOf(cur);
    mutate((pr) => deleteRoom(pr, cur.id));
    const next = p.rooms[Math.min(idx, p.rooms.length - 1)];
    setUI({ roomId: next?.id ?? null, selection: null });
  };

  return (
    <Section
      title={
        <>
          Комнаты <span className="mono" style={{ fontWeight: 400 }}>{p.rooms.length}</span>
        </>
      }
      actions={
        <>
          <Btn sm variant="primary" onClick={add} title="Новая комната 3 × 3 м">
            + комната
          </Btn>
        </>
      }
    >
      <input
        className="input"
        placeholder="Поиск по имени или тегу"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      <div className="list rl-list">
        {filtered.map((r) => {
          const on = r.id === ui.roomId;
          return (
            <div
              key={r.id}
              className={'li rl-item' + (on ? ' on' : '')}
              onClick={() => setUI({ roomId: r.id, selection: null })}
              title={r.note || r.name}
            >
              <div className="rl-main">
                <div className="row" style={{ gap: 6 }}>
                  <span className="name">{r.name || 'без имени'}</span>
                  {r.unique && <span className="chip accent rl-chip" title="Уникальная">1×</span>}
                  <span className="meta">{areaM2(r.cells, p.settings.cellM).toFixed(1)} м²</span>
                </div>
                <div className="rl-sub">
                  {r.tags.length > 0 && <span className="rl-tags">{r.tags.join(' · ')}</span>}
                  <span className="rl-counts mono" title="двери / метки / споты">
                    д{r.doors.length} м{r.connectors.length} с{r.spots.length}
                  </span>
                </div>
              </div>
            </div>
          );
        })}
        {filtered.length === 0 && <div className="hint" style={{ padding: '8px 0' }}>Ничего не найдено</div>}
      </div>
      <div className="row">
        <Btn sm onClick={dup} disabled={!cur} title="Дублировать выбранную комнату">
          дублировать
        </Btn>
        <span className="grow" />
        <Btn sm variant="danger" onClick={del} disabled={!cur} title="Удалить выбранную комнату">
          удалить
        </Btn>
      </div>
    </Section>
  );
}
