// Редактор вариантов группы спотов (ТЗ §7): споты × варианты, веса, шансы, «все комбинации».
import { useEffect } from 'react';
import type { Assign, Project, Room, SpotGroup, Variant } from '../model/types';
import { useProject } from '../model/store';
import { notify, setUI, useUI } from '../model/ui';
import { allCombinations, uid, variantChance } from '../model/ops';
import { Btn, ColorField, Modal, NumField, pct } from '../ui/kit';
import { assignName, assignValue, inkFor, mutRoom, normDeg, parseAssignValue, shade } from './util';
import './panels.css';

const MAX_COMB = 6;

export function VariantEditor() {
  const p = useProject();
  const ui = useUI();
  const room = p.rooms.find((r) => r.id === ui.roomId) ?? null;
  const group = room?.spotGroups.find((g) => g.id === ui.variantsGroupId) ?? null;
  const close = () => setUI({ variantsGroupId: null });

  // Группа исчезла (удаление, undo, смена комнаты) — закрываемся
  useEffect(() => {
    if (!group) close();
  }, [!!group]);
  if (!room || !group) return null;

  return (
    <Modal
      width={1040}
      onClose={close}
      title={
        <span className="row" style={{ gap: 8 }}>
          <ColorField value={group.color} title="Цвет группы" onChange={(v) => updGroup(room.id, group.id, (g) => (g.color = v), `sg-color:${group.id}`)} />
          <input
            className="input pn-title-input"
            value={group.name}
            onChange={(e) => updGroup(room.id, group.id, (g) => (g.name = e.target.value), `sg-name:${group.id}`)}
          />
          <span className="muted" style={{ fontWeight: 400, fontSize: 12 }}>
            варианты группы · {room.name}
          </span>
        </span>
      }
      footer={<Btn onClick={close}>Готово</Btn>}
    >
      <Body p={p} room={room} group={group} />
    </Modal>
  );
}

function updGroup(roomId: string, groupId: string, fn: (g: SpotGroup) => void, key?: string) {
  mutRoom(roomId, (r) => {
    const g = r.spotGroups.find((x) => x.id === groupId);
    if (g) fn(g);
  }, key ? { key } : undefined);
}

function updVariant(roomId: string, groupId: string, variantId: string, fn: (v: Variant) => void, key?: string) {
  updGroup(roomId, groupId, (g) => {
    const v = g.variants.find((x) => x.id === variantId);
    if (v) fn(v);
  }, key);
}

function Body({ p, room, group }: { p: Project; room: Room; group: SpotGroup }) {
  const spots = room.spots.filter((s) => s.groupId === group.id);
  const n = spots.length;
  const sum = group.variants.reduce((s, v) => s + Math.max(0, v.weight), 0);

  const addVariant = () => updGroup(room.id, group.id, (g) => g.variants.push({ id: uid('var'), weight: 1, assign: {} }));

  const dupVariant = (v: Variant) =>
    updGroup(room.id, group.id, (g) => {
      const i = g.variants.findIndex((x) => x.id === v.id);
      const assign: Record<string, Assign> = {};
      for (const [k, a] of Object.entries(v.assign)) assign[k] = { ...a };
      g.variants.splice(i + 1, 0, { id: uid('var'), weight: v.weight, assign });
    });

  const delVariant = (v: Variant) => updGroup(room.id, group.id, (g) => (g.variants = g.variants.filter((x) => x.id !== v.id)));

  const combos = () => {
    if (n > MAX_COMB || n === 0) return;
    if (group.variants.length && !confirm(`Заменить ${group.variants.length} вар. на ${2 ** n} комбинаций (вес 1)? Отменяется через Ctrl+Z.`)) return;
    // Шаблон для спотов без назначения: первое непустое назначение группы, иначе первый декор
    let fallback: Assign | null = null;
    for (const v of group.variants) {
      const a = Object.values(v.assign)[0];
      if (a) {
        fallback = { ...a };
        break;
      }
    }
    if (!fallback && p.props[0]) fallback = { kind: 'prop', id: p.props[0].id, rot: 0 };
    try {
      mutRoom(room.id, (r) => {
        const g = r.spotGroups.find((x) => x.id === group.id);
        if (g) g.variants = allCombinations(r, g.id, fallback);
      });
      notify(`Создано ${2 ** n} вариантов`, 'ok');
    } catch (e: any) {
      notify(String(e?.message ?? e), 'error');
    }
  };

  const normalize = () =>
    updGroup(room.id, group.id, (g) => {
      const s = g.variants.reduce((a, v) => a + Math.max(0, v.weight), 0);
      if (s <= 0) return;
      for (const v of g.variants) v.weight = Math.round((Math.max(0, v.weight) / s) * 10000) / 100;
    });

  const setCell = (v: Variant, spotId: string, value: string) =>
    updVariant(room.id, group.id, v.id, (t) => {
      const parsed = parseAssignValue(value);
      if (!parsed) delete t.assign[spotId];
      else t.assign[spotId] = { ...parsed, rot: t.assign[spotId]?.rot ?? 0 };
    });

  const combTitle = n === 0 ? 'в группе нет спотов' : n > MAX_COMB ? `больше ${MAX_COMB} спотов` : `2^${n} = ${2 ** n} вариантов, каждый спот занят или пуст`;

  return (
    <div className="ve">
      <div className="row ve-bar-row">
        <Btn sm onClick={addVariant}>+ вариант</Btn>
        <Btn sm onClick={combos} disabled={n === 0 || n > MAX_COMB} title={combTitle}>
          Все комбинации
        </Btn>
        <Btn sm variant="ghost" onClick={normalize} disabled={sum <= 0} title="Масштабировать веса так, чтобы сумма была 100 (шансы не меняются)">
          нормировать к 100
        </Btn>
        <span className="grow" />
        <span className="hint mono">
          {n} спот. · {group.variants.length} вар. · Σw = {+sum.toFixed(2)}
        </span>
      </div>

      <Distribution group={group} sum={sum} />

      {n === 0 && (
        <div className="hint pn-warn">
          В группе нет спотов. Поставьте споты инструментом «Спот», сделав группу активной, или переведите существующие споты в группу в инспекторе.
        </div>
      )}

      {group.variants.length === 0 ? (
        <div className="empty">Вариантов нет — группа всегда пуста. Добавьте вариант или сгенерируйте все комбинации.</div>
      ) : (
        <div className="ve-scroll">
          <table className="ve-table">
            <thead>
              <tr>
                <th className="ve-first">Спот</th>
                {group.variants.map((v, i) => {
                  const ch = variantChance(group, v.id);
                  return (
                    <th key={v.id} className="ve-col-h">
                      <div className="ve-vh" style={{ borderTopColor: shade(group.color, lightT(i, group.variants.length)) }}>
                        <div className="row" style={{ gap: 4 }}>
                          <span className="ve-vname">В{i + 1}</span>
                          <span className="grow" />
                          <Btn sm icon variant="ghost" title="Дублировать вариант" onClick={() => dupVariant(v)}>
                            ⧉
                          </Btn>
                          <Btn sm icon variant="danger" title="Удалить вариант" onClick={() => delVariant(v)}>
                            ✕
                          </Btn>
                        </div>
                        <div className="row" style={{ gap: 6 }}>
                          <div style={{ width: 64 }}>
                            <NumField
                              value={v.weight}
                              min={0}
                              step={1}
                              digits={2}
                              title="Вес варианта"
                              onChange={(w) => updVariant(room.id, group.id, v.id, (t) => (t.weight = Math.max(0, w)), `var-w:${v.id}`)}
                            />
                          </div>
                          <span className="mono ve-pct">{pct(ch)}</span>
                        </div>
                      </div>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {spots.map((s) => (
                <tr key={s.id}>
                  <td className="ve-first">
                    <div className="ve-spot" title={s.id}>
                      {s.name || s.id}
                    </div>
                  </td>
                  {group.variants.map((v) => {
                    const a = v.assign[s.id];
                    return (
                      <td key={v.id} className={a ? 've-full' : 've-empty'}>
                        <div className="ve-cell">
                          <ContentSelect p={p} value={a} onChange={(val) => setCell(v, s.id, val)} />
                          <div style={{ width: 58 }} title="Поворот содержимого относительно спота">
                            <NumField
                              value={a?.rot ?? 0}
                              step={90}
                              digits={0}
                              suffix="°"
                              disabled={!a}
                              onChange={(r) =>
                                updVariant(room.id, group.id, v.id, (t) => {
                                  const x = t.assign[s.id];
                                  if (x) x.rot = normDeg(r);
                                }, `var-rot:${v.id}:${s.id}`)
                              }
                            />
                          </div>
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td className="ve-first hint">Занято спотов</td>
                {group.variants.map((v) => {
                  const k = spots.filter((s) => v.assign[s.id]).length;
                  return (
                    <td key={v.id} className="ve-foot">
                      <span className="mono">
                        {k}/{n}
                      </span>
                      {k === 0 && <span className="chip" style={{ marginLeft: 6 }}>пустой вариант</span>}
                    </td>
                  );
                })}
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}

/** Светлота сегмента i из k: от темнее к светлее вокруг цвета группы. */
function lightT(i: number, k: number) {
  if (k <= 1) return 0;
  return -0.35 + (0.7 * i) / (k - 1);
}

/** Полоска распределения шансов вариантов. */
function Distribution({ group, sum }: { group: SpotGroup; sum: number }) {
  const vs = group.variants;
  return (
    <div className="ve-dist">
      <div className="ve-dist-bar">
        {sum <= 0 ? (
          <div className="ve-dist-none">{vs.length ? 'Σw = 0 — ни один вариант не выпадет' : 'нет вариантов'}</div>
        ) : (
          vs.map((v, i) => {
            const ch = variantChance(group, v.id);
            if (ch <= 0) return null;
            const bg = shade(group.color, lightT(i, vs.length));
            return (
              <div key={v.id} className="ve-dist-seg" style={{ flexGrow: ch, background: bg, color: inkFor(bg) }} title={`В${i + 1}: ${pct(ch)}`}>
                {ch >= 0.06 && (
                  <>
                    В{i + 1} <span className="mono">{pct(ch)}</span>
                  </>
                )}
              </div>
            );
          })
        )}
      </div>
      <div className="hint">
        <span className="mono">P(v) = w_v / Σ w_i</span> — при каждом появлении комнаты разыгрывается ровно один вариант группы.
      </div>
    </div>
  );
}

/** Выбор содержимого: пусто / декор / предмет. */
function ContentSelect({ p, value, onChange }: { p: Project; value: Assign | undefined; onChange: (v: string) => void }) {
  const cur = assignValue(value);
  const known = !value || (value.kind === 'prop' ? p.props.some((x) => x.id === value.id) : p.items.some((x) => x.id === value.id));
  return (
    <select className="select ve-select" value={cur} onChange={(e) => onChange(e.target.value)}>
      <option value="">— пусто —</option>
      {!known && <option value={cur}>{assignName(p, value)}</option>}
      <optgroup label="Декор">
        {p.props.map((x) => (
          <option key={x.id} value={`prop:${x.id}`}>
            {x.name}
          </option>
        ))}
      </optgroup>
      <optgroup label="Предметы">
        {p.items.map((x) => (
          <option key={x.id} value={`item:${x.id}`}>
            {x.name}
          </option>
        ))}
      </optgroup>
    </select>
  );
}
