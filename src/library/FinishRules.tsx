// Правила отделки: тег комнаты → варианты стен и пола с весами. Комнате достаётся правило
// первого её тега, для которого правило есть; явная отделка комнаты (инспектор) важнее.
import { Fragment, useState } from 'react';
import type { FinishRule, FinishSurface, Project, Room } from '../model/types';
import { mutate, useProject } from '../model/store';
import { setUI } from '../model/ui';
import { Btn, NumField, Select, pct } from '../ui/kit';
import { FinishSwatch } from './FinishSwatch';
import { allRoomTags, ruleIndexFor, ruleShares } from './finishUse';
import { plural } from './usage';

function updRule(i: number, fn: (r: FinishRule, p: Project) => void, key?: string) {
  mutate(
    (p) => {
      const r = p.finishRules[i];
      if (r) fn(r, p);
    },
    key ? { key: `fin-rule-${key}-${i}` } : undefined,
  );
}

const openRoom = (id: string) => setUI({ page: 'editor', roomId: id, selection: null });

/** Покрытие: какое правило досталось каждой комнате. */
function coverage(p: Project) {
  const byRule = new Map<number, Room[]>();
  const none: Room[] = [];
  for (const room of p.rooms) {
    const i = ruleIndexFor(p, room);
    if (i < 0) none.push(room);
    else {
      let l = byRule.get(i);
      if (!l) byRule.set(i, (l = []));
      l.push(room);
    }
  }
  return { byRule, none };
}

export function FinishRules({ onOpenFinish }: { onOpenFinish: (id: string) => void }) {
  const p = useProject();
  const [open, setOpen] = useState<Set<number>>(new Set());
  const tags = allRoomTags(p);
  const { byRule, none } = coverage(p);
  const ruleTags = new Set(p.finishRules.map((r) => r.tag));

  // теги комнат без правила — по числу комнат
  const freeTags = new Map<string, number>();
  for (const r of none) for (const t of r.tags) if (!ruleTags.has(t)) freeTags.set(t, (freeTags.get(t) ?? 0) + 1);
  const freeSorted = [...freeTags].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ru'));

  const addRule = (tag?: string) => {
    const t = tag ?? freeSorted[0]?.[0] ?? '';
    mutate((pr) => {
      pr.finishRules.push({ tag: t, wall: [], floor: [] });
    });
  };
  const toggle = (i: number) =>
    setOpen((s) => {
      const n = new Set(s);
      n.has(i) ? n.delete(i) : n.add(i);
      return n;
    });

  const explicit = p.rooms.filter((r) => r.finish?.wall || r.finish?.floor).length;
  const bare = none.filter((r) => !r.finish?.wall && !r.finish?.floor);

  return (
    <div className="fin-rules">
      <div className="fin-rules-main">
        <div className="fin-bar">
          <span className="fin-title">Правила отделки</span>
          <span className="mono muted">{p.finishRules.length}</span>
          <span className="hint fin-bar-hint">
            Комнате достаётся правило <b>первого её тега</b>, для которого правило есть; варианты разыгрываются по весам: P = w / Σw. Явная отделка в
            инспекторе комнаты важнее правила.
          </span>
          <span className="grow" />
          <Btn sm variant="primary" onClick={() => addRule()} title={freeSorted[0] ? `Новое правило — для тега «${freeSorted[0][0]}»` : 'Новое правило'}>
            + правило
          </Btn>
        </div>
        <datalist id="fin-room-tags">
          {tags.map((t) => (
            <option key={t} value={t} />
          ))}
        </datalist>
        <div className="fin-rules-scroll">
          {p.finishRules.length === 0 ? (
            <div className="empty">
              Правил нет — отделка будет только у комнат с явным назначением.
              <div style={{ marginTop: 8 }}>
                <Btn sm variant="primary" onClick={() => addRule()}>
                  + правило
                </Btn>
              </div>
            </div>
          ) : (
            <table className="table fin-rt">
              <thead>
                <tr>
                  <th style={{ width: 190 }}>Тег комнаты</th>
                  <th style={{ width: 86 }}>Комнат</th>
                  <th>Стены: отделка · вес · шанс</th>
                  <th>Пол: отделка · вес · шанс</th>
                  <th style={{ width: 30 }} />
                </tr>
              </thead>
              <tbody>
                {p.finishRules.map((rule, i) => {
                  const rooms = byRule.get(i) ?? [];
                  const withTag = p.rooms.filter((r) => r.tags.includes(rule.tag));
                  // у комнаты есть тег, но раньше в её тегах стоит другой тег с правилом
                  const taken = withTag.filter((r) => !rooms.includes(r));
                  const dupOf = p.finishRules.findIndex((r) => r.tag === rule.tag);
                  const isOpen = open.has(i);
                  return (
                    <Fragment key={i}>
                      <tr className={'fin-rt-row' + (isOpen ? ' open' : '')}>
                        <td>
                          <input
                            className="input"
                            list="fin-room-tags"
                            value={rule.tag}
                            placeholder="тег комнаты"
                            onChange={(e) => updRule(i, (r) => (r.tag = e.target.value), 'tag')}
                            onBlur={(e) => e.target.value !== e.target.value.trim() && updRule(i, (r) => (r.tag = r.tag.trim()), 'tag')}
                          />
                          {!rule.tag ? (
                            <div className="hint fin-warn">пустой тег — правило не сработает</div>
                          ) : dupOf !== i ? (
                            <div className="hint fin-warn">тег уже есть выше — это правило не применяется</div>
                          ) : withTag.length === 0 ? (
                            <div className="hint fin-warn">нет комнат с таким тегом</div>
                          ) : null}
                        </td>
                        <td>
                          <button className={'fin-rooms-btn' + (rooms.length ? '' : ' zero')} onClick={() => toggle(i)} title="Показать комнаты под этим правилом">
                            <span className="mono">{rooms.length}</span> {isOpen ? '▾' : '▸'}
                          </button>
                          {taken.length > 0 && (
                            <div className="hint" title="У этих комнат раньше в списке тегов стоит другой тег с правилом">
                              +{taken.length} перехв.
                            </div>
                          )}
                        </td>
                        <td>
                          <VariantList p={p} i={i} surface="wall" rule={rule} onOpenFinish={onOpenFinish} />
                        </td>
                        <td>
                          <VariantList p={p} i={i} surface="floor" rule={rule} onOpenFinish={onOpenFinish} />
                        </td>
                        <td>
                          <Btn
                            sm
                            icon
                            variant="danger"
                            title="Удалить правило"
                            onClick={() => {
                              mutate((pr) => {
                                pr.finishRules.splice(i, 1);
                              });
                              setOpen(new Set());
                            }}
                          >
                            ✕
                          </Btn>
                        </td>
                      </tr>
                      {isOpen && (
                        <tr className="fin-rt-rooms">
                          <td colSpan={5}>
                            {rooms.length ? (
                              <div className="fin-chips">
                                {rooms.map((r) => (
                                  <button key={r.id} className="chip fin-chip" onClick={() => openRoom(r.id)} title={`Теги: ${r.tags.join(', ')}`}>
                                    {r.name}
                                    {(r.finish?.wall || r.finish?.floor) && <span className="fin-explicit">явно</span>}
                                  </button>
                                ))}
                              </div>
                            ) : (
                              <span className="hint">Под правило не попадает ни одна комната.</span>
                            )}
                            {taken.length > 0 && (
                              <div className="fin-chips" style={{ marginTop: 6 }}>
                                <span className="hint">Тег есть, но правило берётся по более раннему тегу:</span>
                                {taken.map((r) => {
                                  const j = ruleIndexFor(p, r);
                                  return (
                                    <button key={r.id} className="chip fin-chip muted" onClick={() => openRoom(r.id)} title={`Теги: ${r.tags.join(', ')}`}>
                                      {r.name} <span className="muted">→ «{p.finishRules[j]?.tag}»</span>
                                    </button>
                                  );
                                })}
                              </div>
                            )}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <aside className="side right fin-cover">
        <div className="section">
          <div className="section-h">
            <span className="cap">Покрытие комнат</span>
          </div>
          <div className="section-b">
            <div className="grid3">
              <div className="stat">
                <span className="v">{p.rooms.length - none.length}</span>
                <span className="k">по правилам</span>
              </div>
              <div className="stat">
                <span className="v">{explicit}</span>
                <span className="k">с явной отделкой</span>
              </div>
              <div className="stat">
                <span className="v" style={bare.length ? { color: 'var(--accent)' } : undefined}>
                  {bare.length}
                </span>
                <span className="k">без отделки</span>
              </div>
            </div>
          </div>
        </div>
        {freeSorted.length > 0 && (
          <div className="section">
            <div className="section-h">
              <span className="cap">Теги без правила</span>
            </div>
            <div className="section-b">
              <div className="fin-chips">
                {freeSorted.map(([t, n]) => (
                  <button key={t} className="chip fin-chip" onClick={() => addRule(t)} title={`Создать правило для тега «${t}»`}>
                    + {t} <span className="mono muted">{n}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
        <div className="section">
          <div className="section-h">
            <span className="cap">
              Комнаты без правила <span className="mono">{none.length}</span>
            </span>
          </div>
          {none.length === 0 ? (
            <div className="section-b">
              <div className="hint">Каждая комната попадает под какое-то правило.</div>
            </div>
          ) : (
            <div className="list fin-none">
              {none.map((r) => (
                <div key={r.id} className="li" onClick={() => openRoom(r.id)} title="Открыть в редакторе">
                  <div className="lib-li-body">
                    <span className="name">{r.name}</span>
                    <div className="lib-tags">
                      {r.tags.length ? r.tags.map((t) => <span key={t} className="lib-tag">{t}</span>) : <span className="lib-tag">без тегов</span>}
                    </div>
                  </div>
                  {r.finish?.wall || r.finish?.floor ? <span className="chip green">явно</span> : <span className="chip">нет</span>}
                </div>
              ))}
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}

function VariantList(props: {
  p: Project;
  i: number;
  surface: FinishSurface;
  rule: FinishRule;
  onOpenFinish: (id: string) => void;
}) {
  const { p, i, surface } = props;
  const list = props.rule[surface];
  const fins = p.finishes.filter((f) => f.surface === surface);
  const byId = new Map(p.finishes.map((f) => [f.id, f]));
  const shares = ruleShares(p, props.rule, surface);
  const opts = fins.map((f) => ({ value: f.id, label: f.name }));
  const key = surface === 'wall' ? 'wall' : 'floor';

  const add = () =>
    updRule(i, (r) => {
      const used = new Set(r[key].map((v) => v.finishId));
      const f = fins.find((x) => !used.has(x.id)) ?? fins[0];
      if (f) r[key].push({ finishId: f.id, weight: 1 });
    });

  return (
    <div className="fin-vars">
      {list.map((v, j) => {
        const f = byId.get(v.finishId);
        const bad = !f || f.surface !== surface;
        return (
          <div key={j} className={'fin-var' + (v.weight > 0 ? '' : ' off')}>
            <span className="fin-sw-btn" onClick={() => f && props.onOpenFinish(f.id)} title={f ? `Открыть «${f.name}»` : undefined}>
              <FinishSwatch finish={f} size={20} />
            </span>
            <div className="grow">
              <Select
                value={v.finishId}
                options={bad ? [{ value: v.finishId, label: f ? `${f.name} (не ${surface === 'wall' ? 'стены' : 'пол'})` : '(удалена)' }, ...opts] : opts}
                onChange={(id) => updRule(i, (r) => r[key][j] && (r[key][j].finishId = id))}
              />
            </div>
            <div className="fin-w">
              <NumField value={v.weight} min={0} step={1} digits={2} title="Вес варианта" onChange={(w) => updRule(i, (r) => r[key][j] && (r[key][j].weight = w), `${key}-w-${j}`)} />
            </div>
            <span className="mono fin-pct">{v.weight > 0 ? pct(shares[j]) : '—'}</span>
            <Btn sm icon variant="ghost" title="Убрать вариант" onClick={() => updRule(i, (r) => r[key].splice(j, 1))}>
              ✕
            </Btn>
          </div>
        );
      })}
      <div className="row">
        <Btn sm variant="ghost" disabled={!fins.length} onClick={add} title={fins.length ? 'Добавить вариант' : `Нет отделок ${surface === 'wall' ? 'стен' : 'пола'}`}>
          + вариант
        </Btn>
        {list.length === 0 && <span className="hint">{surface === 'wall' ? 'стены' : 'пол'} — без отделки</span>}
        {list.length > 0 && <span className="hint">{list.length} {plural(list.length, 'вариант', 'варианта', 'вариантов')}</span>}
      </div>
    </div>
  );
}
