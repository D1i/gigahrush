// Тиры элитности: список | редактор тира со строками лута | карточка для игрока.
import type { Project, Tier, TierLootRow } from '../model/types';
import { useProject } from '../model/store';
import { setUI } from '../model/ui';
import { uid } from '../model/ops';
import { Btn, ColorField, NumField, Section, TextField, pct } from '../ui/kit';
import { allPropTags } from '../library/usage';
import {
  TIER_COLORS,
  editEco,
  isCurrency,
  itemColor,
  itemName,
  roomTierChances,
  safeRuleLines,
  safeStepsStats,
  safeStepsText,
  sortedTiers,
} from './shared';

export function newTier(p: Project): Tier {
  const lvl = p.economy.tiers.reduce((m, t) => Math.max(m, t.level), 0) + 1;
  return {
    id: uid('tier'),
    name: `Элитность ${lvl}`,
    level: lvl,
    danger: lvl * 2,
    color: TIER_COLORS[(lvl - 1) % TIER_COLORS.length],
    note: '',
    loot: [],
  };
}

/** Редактировать тир по id (внутри mutate). */
function editTier(id: string, fn: (t: Tier, p: Project) => void, key?: string) {
  editEco((e, p) => {
    const t = e.tiers.find((x) => x.id === id);
    if (t) fn(t, p);
  }, key ? `tier-${key}-${id}` : undefined);
}

function editRow(tierId: string, rowId: string, fn: (r: TierLootRow) => void, key?: string) {
  editTier(tierId, (t) => {
    const r = t.loot.find((x) => x.id === rowId);
    if (r) fn(r);
  }, key ? `row-${key}-${rowId}` : undefined);
}

export function TiersTab({ sel, setSel }: { sel: string | null; setSel: (id: string | null) => void }) {
  const p = useProject();
  const tiers = sortedTiers(p);
  const tier = tiers.find((t) => t.id === sel) ?? tiers[0] ?? null;

  const add = () => {
    let id = '';
    editEco((e, pr) => {
      const t = newTier(pr);
      e.tiers.push(t);
      id = t.id;
    });
    setSel(id);
  };

  if (!tiers.length) return <EmptyTiers onAdd={add} />;

  const dup = () => {
    if (!tier) return;
    let id = '';
    editEco((e) => {
      const t: Tier = {
        ...structuredClone(tier),
        id: uid('tier'),
        name: `${tier.name} (копия)`,
        loot: tier.loot.map((r) => ({ ...structuredClone(r), id: uid('tl') })),
      };
      e.tiers.push(t);
      id = t.id;
    });
    setSel(id);
  };

  const del = () => {
    if (!tier) return;
    const rooms = p.rooms.filter((r) => r.elite.some((e) => e.tierId === tier.id));
    const msg =
      `Удалить тир «${tier.name}» (Э${tier.level})?` +
      (rooms.length ? `\n\nВеса этого тира пропадут в ${rooms.length} комн.: ${rooms.map((r) => r.name).join(', ')}` : '') +
      '\n\nОтменить можно через Ctrl+Z.';
    if (!confirm(msg)) return;
    editEco((e, pr) => {
      e.tiers = e.tiers.filter((t) => t.id !== tier.id);
      pr.rooms.forEach((r) => (r.elite = r.elite.filter((x) => x.tierId !== tier.id)));
    });
    setSel(null);
  };

  return (
    <div className="eco-tiers">
      <aside className="side">
        <Section
          title={
            <>
              Тиры <span className="mono" style={{ fontWeight: 400 }}>{tiers.length}</span>
            </>
          }
          actions={
            <Btn sm variant="primary" onClick={add}>
              + тир
            </Btn>
          }
        />
        <div className="list">
          {tiers.map((t) => (
            <div key={t.id} className={'li' + (t.id === tier?.id ? ' on' : '')} onClick={() => setSel(t.id)}>
              <span className="eco-lvl" style={{ background: t.color }}>
                {t.level}
              </span>
              <span className="name">{t.name}</span>
              <span className="meta" title="Прирост опасности за проход">
                +{t.danger}
              </span>
            </div>
          ))}
        </div>
        <div className="hint" style={{ padding: 12 }}>
          Сортировка — по уровню. Уровень 1 — обычная комната, чем выше, тем богаче лут и опаснее проход.
        </div>
      </aside>

      {tier && (
        <section className="eco-main">
          <TierEditor key={tier.id} p={p} tier={tier} onDup={dup} onDel={del} />
        </section>
      )}
      {tier && (
        <aside className="side right">
          <PlayerCard p={p} tier={tier} />
        </aside>
      )}
    </div>
  );
}

export function EmptyTiers({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="eco-empty">
      <div className="eco-empty-box">
        <div className="cap">Тиров элитности пока нет</div>
        <p>
          Тир — это «насколько элитной оказалась комната» при заходе: от него зависят лут, шанс готовых предметов и то,
          насколько вырастет опасность уровня после прохода.
        </p>
        <Btn variant="primary" onClick={onAdd}>
          + тир
        </Btn>
      </div>
    </div>
  );
}

function TierEditor({ p, tier, onDup, onDel }: { p: Project; tier: Tier; onDup: () => void; onDel: () => void }) {
  const tags = allPropTags(p);
  const addRow = () =>
    editTier(tier.id, (t, pr) => {
      const def = pr.items.find(isCurrency) ?? pr.items[0];
      t.loot.push({
        id: uid('tl'),
        source: { kind: 'item', id: def?.id ?? '' },
        steps: [{ upTo: 1, chance: 0.5 }],
        where: '',
      });
    });
  return (
    <>
      <div className="eco-bar">
        <span className="eco-lvl big" style={{ background: tier.color }}>
          {tier.level}
        </span>
        <span className="eco-title">{tier.name || 'Без имени'}</span>
        <span className="grow" />
        <Btn sm onClick={onDup}>
          Дублировать
        </Btn>
        <Btn sm variant="danger" onClick={onDel}>
          Удалить
        </Btn>
      </div>
      <Section title="Тир">
        <div className="eco-tier-grid">
          <TextField label="Имя" value={tier.name} onChange={(v) => editTier(tier.id, (t) => (t.name = v), 'name')} />
          <NumField label="Уровень" value={tier.level} min={1} max={99} step={1} digits={0} onChange={(v) => editTier(tier.id, (t) => (t.level = Math.round(v)))} />
          <NumField
            label="Опасность за проход"
            value={tier.danger}
            min={0}
            max={9999}
            step={1}
            digits={1}
            onChange={(v) => editTier(tier.id, (t) => (t.danger = v))}
            title="На сколько вырастет опасность уровня после прохода через комнату этого тира"
          />
          <div className="field">
            <label>Цвет</label>
            <ColorField value={tier.color} onChange={(v) => editTier(tier.id, (t) => (t.color = v), 'color')} />
          </div>
        </div>
        <TextField
          label="Заметка (что это за квартира, для геймдизайна)"
          multiline
          value={tier.note}
          onChange={(v) => editTier(tier.id, (t) => (t.note = v), 'note')}
          placeholder="Напр.: спец. квартира радиолюбителя — схемы в ящиках, паяльник на столе"
        />
      </Section>
      <Section
        title={
          <>
            Лут тира <span className="mono" style={{ fontWeight: 400 }}>{tier.loot.length}</span>
          </>
        }
        actions={
          <Btn sm variant="primary" onClick={addRow}>
            + строка
          </Btn>
        }
      >
        <div className="hint">
          Каждая строка — отдельная находка. Ступени «до N — P%» проверяются от большего N к меньшему: первая сработавшая
          даёт от 1 до N штук. Не сработала ни одна — ничего.
        </div>
        {tier.loot.length === 0 && <div className="empty">Строк лута нет — в тире только прирост опасности.</div>}
        {tier.loot.map((r) => (
          <LootRowEditor key={r.id} p={p} tier={tier} row={r} tags={tags} />
        ))}
        <datalist id="eco-prop-tags">
          {tags.map((t) => (
            <option key={t} value={t} />
          ))}
        </datalist>
      </Section>
    </>
  );
}

function LootRowEditor({ p, tier, row, tags }: { p: Project; tier: Tier; row: TierLootRow; tags: string[] }) {
  const cur = p.items.filter(isCurrency);
  const rest = p.items.filter((i) => !isCurrency(i));
  const srcVal = `${row.source.kind}:${row.source.id}`;
  const srcOk =
    row.source.kind === 'item' ? p.items.some((i) => i.id === row.source.id) : p.economy.shops.some((s) => s.id === row.source.id);
  const stats = safeStepsStats(row.steps);
  const ups = row.steps.map((s) => s.upTo);
  const dupUp = ups.some((u, i) => ups.indexOf(u) !== i);
  const whereMissing = row.where.trim() !== '' && !tags.includes(row.where.trim());
  const color = row.source.kind === 'item' ? itemColor(p, row.source.id) : '#e8b04b';

  const setSteps = (fn: (s: TierLootRow['steps']) => void, key?: string) =>
    editRow(tier.id, row.id, (r) => {
      fn(r.steps);
      // храним по возрастанию N — так читается «до 4 — 70%, до 6 — 50%»
      r.steps.sort((a, b) => a.upTo - b.upTo);
    }, key);

  return (
    <div className="eco-row" style={{ borderLeftColor: color }}>
      <div className="eco-row-top">
        <div className="field grow">
          <label>Что</label>
          <select
            className="select"
            value={srcOk ? srcVal : ''}
            onChange={(e) => {
              const [kind, id] = e.target.value.split(':');
              editRow(tier.id, row.id, (r) => (r.source = kind === 'shop' ? { kind: 'shop', id } : { kind: 'item', id }));
            }}
          >
            {!srcOk && <option value="">— выберите —</option>}
            {cur.length > 0 && (
              <optgroup label="Валюты">
                {cur.map((i) => (
                  <option key={i.id} value={`item:${i.id}`}>
                    {i.name}
                  </option>
                ))}
              </optgroup>
            )}
            {rest.length > 0 && (
              <optgroup label="Предметы">
                {rest.map((i) => (
                  <option key={i.id} value={`item:${i.id}`}>
                    {i.name}
                  </option>
                ))}
              </optgroup>
            )}
            {p.economy.shops.length > 0 && (
              <optgroup label="Готовый предмет из магазина">
                {p.economy.shops.map((s) => (
                  <option key={s.id} value={`shop:${s.id}`}>
                    случайный товар: {s.name}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
        </div>
        <div className="field eco-where">
          <label>Где (тег декора)</label>
          <input
            className="input"
            list="eco-prop-tags"
            value={row.where}
            placeholder="пусто — без привязки"
            onChange={(e) => editRow(tier.id, row.id, (r) => (r.where = e.target.value), 'where')}
          />
        </div>
        <Btn
          icon
          variant="ghost"
          title="Удалить строку"
          onClick={() => editTier(tier.id, (t) => (t.loot = t.loot.filter((x) => x.id !== row.id)))}
        >
          ✕
        </Btn>
      </div>
      <div className="eco-steps">
        {row.steps.map((s, i) => (
          <div key={i} className="eco-step">
            <span className="muted">до</span>
            <div className="eco-step-n">
              <NumField value={s.upTo} min={1} max={999} step={1} digits={0} onChange={(v) => setSteps((st) => (st[i].upTo = Math.round(v)))} />
            </div>
            <span className="muted">—</span>
            <div className="eco-step-p">
              <NumField value={s.chance * 100} min={0} max={100} step={5} digits={1} suffix="%" onChange={(v) => setSteps((st) => (st[i].chance = v / 100))} />
            </div>
            <Btn sm icon variant="ghost" title="Удалить ступень" onClick={() => setSteps((st) => st.splice(i, 1))}>
              ×
            </Btn>
          </div>
        ))}
        <Btn
          sm
          onClick={() =>
            setSteps((st) => {
              const maxUp = st.reduce((m, x) => Math.max(m, x.upTo), 0);
              const minCh = st.reduce((m, x) => Math.min(m, x.chance), 1);
              st.push({ upTo: maxUp + 2, chance: st.length ? Math.max(0.01, +(minCh / 2).toFixed(2)) : 0.5 });
            })
          }
        >
          + ступень
        </Btn>
      </div>
      <div className="eco-row-foot">
        <span className="eco-rule">{row.steps.length ? safeStepsText(row.steps) : 'нет ступеней — строка ничего не даёт'}</span>
        {stats && row.steps.length > 0 && (
          <span className="mono muted">
            хоть что-то {pct(stats.pAny)} · в среднем {+stats.mean.toFixed(2)} шт
          </span>
        )}
      </div>
      {(dupUp || whereMissing || !srcOk) && (
        <div className="eco-warn">
          {!srcOk && <div>Источник не выбран или удалён.</div>}
          {dupUp && <div>Две ступени с одинаковым «до N» — оставьте одну.</div>}
          {whereMissing && <div>Нет декора с тегом «{row.where}» — в комнатах без него строка не разыгрывается.</div>}
        </div>
      )}
    </div>
  );
}

function PlayerCard({ p, tier }: { p: Project; tier: Tier }) {
  const lines = safeRuleLines(p, tier);
  const where = p.rooms
    .map((r) => ({ r, pr: roomTierChances(p, r).get(tier.id) ?? 0 }))
    .filter((x) => x.pr > 0)
    .sort((a, b) => b.pr - a.pr);
  return (
    <>
      <Section title="Карточка для игрока">
        <div className="eco-player" style={{ borderTopColor: tier.color }}>
          <div className="eco-player-h">
            <span className="eco-lvl big" style={{ background: tier.color }}>
              {tier.level}
            </span>
            <div>
              <div className="eco-player-t">Элитность {tier.level}</div>
              <div className="muted">{tier.name}</div>
            </div>
          </div>
          <ul className="eco-player-lines">
            {lines.map((l, i) => (
              <li key={i}>{l}</li>
            ))}
          </ul>
        </div>
        <div className="hint">Так правило видит игрок: только «до N — P%», без размытых «может 10, может 25».</div>
      </Section>
      {tier.loot.length > 0 && (
        <Section title="Точные шансы по строкам">
          <table className="table">
            <thead>
              <tr>
                <th>Что</th>
                <th className="num">хоть что-то</th>
                <th className="num">в среднем</th>
              </tr>
            </thead>
            <tbody>
              {tier.loot.map((r) => {
                const st = safeStepsStats(r.steps);
                const name =
                  r.source.kind === 'item' ? itemName(p, r.source.id) : `товар: ${p.economy.shops.find((s) => s.id === r.source.id)?.name ?? '—'}`;
                return (
                  <tr key={r.id}>
                    <td>
                      {name}
                      {r.where && <span className="muted"> · {r.where}</span>}
                    </td>
                    <td className="num">{st ? pct(st.pAny) : '—'}</td>
                    <td className="num">{st ? `${+st.mean.toFixed(2)} шт` : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Section>
      )}
      <Section title="Где выпадает этот тир">
        {where.length === 0 ? (
          <div className="hint">Ни одна комната не может стать этим тиром — задайте веса на вкладке «Карта элитности».</div>
        ) : (
          <div className="list eco-where-list">
            {where.map(({ r, pr }) => (
              <div key={r.id} className="li" onClick={() => setUI({ page: 'editor', roomId: r.id, selection: null })} title="Открыть комнату">
                <span className="name">{r.name}</span>
                <span className="meta">{pct(pr)}</span>
              </div>
            ))}
          </div>
        )}
      </Section>
    </>
  );
}
