// Проходки на элитные уровни: цена, буст тиров и предметов, пояснение простым языком.
import type { Pass, Project } from '../model/types';
import { mutate, useProject } from '../model/store';
import { uid } from '../model/ops';
import { Btn, NumField, Section, TextField, pct } from '../ui/kit';
import { ItemSelect, editEco, isCurrency, itemColor, itemName, mult, roomTierChances } from './shared';

function editPass(id: string, fn: (x: Pass) => void, key?: string) {
  editEco((e) => {
    const x = e.passes.find((y) => y.id === id);
    if (x) fn(x);
  }, key ? `pass-${key}-${id}` : undefined);
}

/** Пояснение для игрока одной-двумя фразами. */
export function passExplain(p: Project, x: Pass): string {
  const parts: string[] = [];
  if (x.tierBoost !== 1) parts.push(`элитные комнаты (тиры 2+) выпадают в ${mult(x.tierBoost)} ${x.tierBoost > 1 ? 'чаще' : 'реже'}`);
  for (const [id, m] of Object.entries(x.itemBoost)) if (m !== 1) parts.push(`шанс найти «${itemName(p, id)}» ${mult(m)}`);
  const price = x.priceItemId ? `${x.price} × ${itemName(p, x.priceItemId)}` : `${x.price}`;
  return `«${x.name}» стоит ${price}. ` + (parts.length ? `На уровне по проходке ${parts.join(', ')}.` : 'Пока ничего не меняет — задайте бусты.');
}

/** Средняя по комнатам с весами вероятность элитного тира (level ≥ 2) без/с проходкой. */
function eliteShare(p: Project, x: Pass | null): number | null {
  const rooms = p.rooms.filter((r) => r.elite.length);
  if (!rooms.length) return null;
  let s = 0;
  for (const r of rooms) {
    roomTierChances(p, r, x).forEach((pr, id) => {
      if ((p.economy.tiers.find((t) => t.id === id)?.level ?? 0) >= 2) s += pr;
    });
  }
  return s / rooms.length;
}

export function PassesTab({ sel, setSel }: { sel: string | null; setSel: (id: string | null) => void }) {
  const p = useProject();
  const passes = p.economy.passes;
  const pass = passes.find((x) => x.id === sel) ?? passes[0] ?? null;

  const add = () => {
    let id = '';
    editEco((e, pr) => {
      const x: Pass = {
        id: uid('pass'),
        name: `Проходка ${e.passes.length + 1}`,
        priceItemId: pr.items.find(isCurrency)?.id ?? '',
        price: 1,
        tierBoost: 2,
        itemBoost: {},
        note: '',
      };
      e.passes.push(x);
      id = x.id;
    });
    setSel(id);
  };

  const del = () => {
    if (!pass || !confirm(`Удалить проходку «${pass.name}»? Отменить можно через Ctrl+Z.`)) return;
    mutate((pr) => {
      pr.economy.passes = pr.economy.passes.filter((x) => x.id !== pass.id);
      if (pr.generator.passId === pass.id) pr.generator.passId = null;
    });
    setSel(null);
  };

  return (
    <div className="eco-2col">
      <aside className="side">
        <Section
          title={
            <>
              Проходки <span className="mono" style={{ fontWeight: 400 }}>{passes.length}</span>
            </>
          }
          actions={
            <Btn sm variant="primary" onClick={add}>
              + проходка
            </Btn>
          }
        />
        <div className="list">
          {passes.map((x) => (
            <div key={x.id} className={'li' + (x.id === pass?.id ? ' on' : '')} onClick={() => setSel(x.id)}>
              <span className="swatch" style={{ background: itemColor(p, x.priceItemId) }} />
              <span className="name">{x.name}</span>
              {p.generator.passId === x.id && <span className="chip accent">в генераторе</span>}
              <span className="meta">{mult(x.tierBoost)}</span>
            </div>
          ))}
          {passes.length === 0 && <div className="empty">Проходок нет</div>}
        </div>
        <div className="hint" style={{ padding: 12 }}>
          Проходка покупается (обычно за самогонку) и открывает элитный уровень: там чаще выпадают высокие тиры и больше
          конкретного компонента.
        </div>
      </aside>
      <section className="eco-main">{pass ? <PassEditor key={pass.id} p={p} pass={pass} onDel={del} /> : <div className="empty">Создайте проходку.</div>}</section>
    </div>
  );
}

function PassEditor({ p, pass, onDel }: { p: Project; pass: Pass; onDel: () => void }) {
  const boosts = Object.entries(pass.itemBoost);
  const before = eliteShare(p, null);
  const after = eliteShare(p, pass);
  const active = p.generator.passId === pass.id;

  const setBoostKey = (oldId: string, newId: string) =>
    editPass(pass.id, (x) => {
      if (newId in x.itemBoost && newId !== oldId) return;
      const next: Record<string, number> = {};
      for (const [k, v] of Object.entries(x.itemBoost)) next[k === oldId ? newId : k] = v;
      x.itemBoost = next;
    });

  return (
    <div className="eco-pass">
      <div className="eco-bar">
        <span className="eco-title">{pass.name || 'Без имени'}</span>
        <span className="grow" />
        <Btn sm on={active} onClick={() => mutate((pr) => (pr.generator.passId = active ? null : pass.id))} title="Генератор будет строить уровень с этой проходкой">
          {active ? 'Активна в генераторе' : 'Использовать в генераторе'}
        </Btn>
        <Btn sm variant="danger" onClick={onDel}>
          Удалить
        </Btn>
      </div>

      <div className="eco-explain">
        <div className="cap">Что делает проходка — для игрока</div>
        <div className="eco-explain-t">{passExplain(p, pass)}</div>
        {before !== null && after !== null && pass.tierBoost !== 1 && (
          <div className="muted">
            В среднем по комнатам элитный тир (2+): <b className="mono">{pct(before)}</b> → <b className="mono">{pct(after)}</b>
          </div>
        )}
      </div>

      <div className="eco-pass-grid">
        <Section title="Проходка">
          <TextField label="Имя" value={pass.name} onChange={(v) => editPass(pass.id, (x) => (x.name = v), 'name')} />
          <div className="grid2">
            <div className="field">
              <label>Чем платим</label>
              <ItemSelect p={p} value={pass.priceItemId} onChange={(v) => editPass(pass.id, (x) => (x.priceItemId = v))} />
            </div>
            <NumField label="Цена" value={pass.price} min={0} max={99999} step={1} digits={1} onChange={(v) => editPass(pass.id, (x) => (x.price = v))} />
          </div>
          <NumField
            label="Буст тиров 2+ (множитель веса)"
            value={pass.tierBoost}
            min={0}
            max={100}
            step={0.5}
            digits={2}
            suffix="×"
            onChange={(v) => editPass(pass.id, (x) => (x.tierBoost = v))}
            title="Веса тиров с уровнем ≥ 2 в каждой комнате умножаются на это число"
          />
          <TextField label="Заметка" multiline value={pass.note} onChange={(v) => editPass(pass.id, (x) => (x.note = v), 'note')} placeholder="Где продаётся, что за уровень…" />
        </Section>

        <Section
          title="Буст предметов"
          actions={
            <Btn
              sm
              variant="primary"
              disabled={boosts.length >= p.items.length}
              onClick={() =>
                editPass(pass.id, (x) => {
                  const it = p.items.find((i) => !(i.id in x.itemBoost));
                  if (it) x.itemBoost[it.id] = 1.5;
                })
              }
            >
              + предмет
            </Btn>
          }
        >
          <div className="hint">Шанс каждой ступени лута для этого предмета умножается на множитель (не выше 100%).</div>
          {boosts.length === 0 && <div className="hint">Бустов нет.</div>}
          {boosts.map(([id, m]) => (
            <div key={id} className="eco-offer">
              <span className="swatch" style={{ background: itemColor(p, id) }} />
              <ItemSelect p={p} value={id} onChange={(v) => v && setBoostKey(id, v)} />
              <div style={{ width: 92, flex: 'none' }}>
                <NumField value={m} min={0} max={100} step={0.1} digits={2} suffix="×" onChange={(v) => editPass(pass.id, (x) => (x.itemBoost[id] = v))} />
              </div>
              <Btn
                sm
                icon
                variant="ghost"
                title="Убрать"
                onClick={() =>
                  editPass(pass.id, (x) => {
                    delete x.itemBoost[id];
                  })
                }
              >
                ×
              </Btn>
            </div>
          ))}
        </Section>
      </div>
    </div>
  );
}
