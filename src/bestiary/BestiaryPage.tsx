// Вкладка «Бестиарий» — полевой справочник по существам, явлениям и местам мира (tmp/smile-wip/CONTRACT.md §7): слева —
// указатель записей, справа — досье (как ведёт себя по стадиям, как выжить) и ручки его конфига. Правка ручки — через
// mutate() стора: отмена (Ctrl+Z), автосохранение, кооп получает проект целиком. Числа в тексте досье — живые.
import { useState, type ReactNode } from 'react';
import { mutate, useProject } from '../model/store';
import { setUI } from '../model/ui';
import type { Project } from '../model/types';
import {
  beasts, changedCount, fillText, fmtKnob, knobDefault, knobScale, lobbyBestiaryActive, withKnob, withoutBeast,
  type Beast, type BeastKnob,
} from '../game/bestiary';
import { Btn, NumField, Section } from '../ui/kit';
import { Scale } from './Scale';
import './bestiary.css';

// выбранная запись живёт между переходами по вкладкам
let lastSel: string | null = null;

const DANGER = ['безопасно', 'слабая', 'умеренная', 'высокая', 'очень высокая', 'смертельная'] as const;

/** Значение ручки по проекту: правка или дефолт (не живой конфиг: в коопе там числа лобби). */
const valueIn = (p: Project, id: string, key: string): number => p.bestiary?.[id]?.[key] ?? knobDefault(id, key);

function setKnobs(id: string, kv: [string, number][], undoKey: string) {
  mutate(
    (p) => {
      let o = p.bestiary;
      for (const [k, v] of kv) o = withKnob(o, id, k, v);
      if (o) p.bestiary = o;
      else delete p.bestiary;
    },
    { key: undoKey },
  );
}

function resetKeys(id: string, keys?: string[]) {
  mutate((p) => {
    const o = withoutBeast(p.bestiary, id, keys);
    if (o) p.bestiary = o;
    else delete p.bestiary;
  });
}

export function BestiaryPage() {
  const p = useProject();
  const list = beasts();
  const [sel, setSelState] = useState<string | null>(lastSel && list.some((b) => b.id === lastSel) ? lastSel : (list[0]?.id ?? null));
  const select = (id: string) => {
    lastSel = id;
    setSelState(id);
  };
  const b = list.find((x) => x.id === sel) ?? null;
  const total = list.reduce((s, x) => s + changedCount(p.bestiary, x.id), 0);
  return (
    <div className="bst">
      <aside className="bst-index">
        <header className="bst-index-h">
          <div className="bst-title">Бестиарий</div>
          <div className="bst-sub">
            полевой справочник · {list.length} {plural(list.length, 'запись', 'записи', 'записей')}
            {total > 0 && <span className="bst-sub-mod"> · изменено {total}</span>}
          </div>
        </header>
        <nav className="bst-list">
          {list.map((x) => (
            <IndexCard key={x.id} b={x} on={x.id === sel} mod={changedCount(p.bestiary, x.id)} onClick={() => select(x.id)} />
          ))}
        </nav>
        <footer className="bst-index-f">
          Числа досье — живые: правишь ручку — меняется и текст. Ctrl+Z отменяет правку.
        </footer>
      </aside>
      {b ? <Dossier key={b.id} b={b} p={p} /> : <div className="empty">Записей нет.</div>}
    </div>
  );
}

function IndexCard(props: { b: Beast; on: boolean; mod: number; onClick: () => void }) {
  const { b } = props;
  return (
    <button className={'bst-card' + (props.on ? ' on' : '')} onClick={props.onClick} aria-current={props.on || undefined}>
      <span className="bst-card-top">
        <span className="bst-card-biome">{b.biome}</span>
        <Pips n={b.danger} />
      </span>
      <span className="bst-card-name">{b.name}</span>
      <span className="bst-card-meta">
        <span>{b.kind}</span>
        <span className="bst-card-dot">·</span>
        <span>{b.knobs.length ? `${b.knobs.length} ${plural(b.knobs.length, 'ручка', 'ручки', 'ручек')}` : 'числа — у комнаты'}</span>
        {props.mod > 0 && <span className="bst-mod">изменено {props.mod}</span>}
      </span>
    </button>
  );
}

function Pips({ n, big }: { n: number; big?: boolean }) {
  return (
    <span className={'bst-pips' + (big ? ' big' : '')} title={`Опасность ${n} из 5 — ${DANGER[n]}`} aria-label={`Опасность ${n} из 5`}>
      {[0, 1, 2, 3, 4].map((i) => (
        <i key={i} className={i < n ? 'on' : undefined} />
      ))}
    </span>
  );
}

// ───────────────────────── досье ─────────────────────────

function Dossier({ b, p }: { b: Beast; p: Project }) {
  const mod = changedCount(p.bestiary, b.id);
  const lobby = lobbyBestiaryActive();
  return (
    <article className="bst-file">
      <header className="bst-head">
        <div className="bst-head-main">
          <div className="bst-eyebrow">
            <span>{b.biome}</span>
            <span className="bst-card-dot">·</span>
            <span>{b.kind}</span>
          </div>
          <h1 className="bst-name">{b.name}</h1>
          {b.aka && <div className="bst-aka">{b.aka}</div>}
        </div>
        <div className="bst-threat">
          <span className="bst-threat-k">опасность</span>
          <Pips n={b.danger} big />
          <span className={'bst-threat-v d' + b.danger}>{DANGER[b.danger]}</span>
        </div>
      </header>
      {lobby && (
        <div className="bst-lobby">
          Идёт кооп: в игре действуют числа проекта лобби. Правки сохранятся в проекте и заработают после выхода из лобби.
        </div>
      )}
      <div className="bst-body">
        <div className="bst-text">
          <p className="bst-summary">{b.summary}</p>
          <h2 className="bst-h2">Поведение</h2>
          <ol className="bst-stages">
            {b.behaviour.map((s) => (
              <li key={s.title} className="bst-stage">
                <h3>{s.title}</h3>
                <p>
                  <Live b={b} p={p} text={s.text} />
                </p>
              </li>
            ))}
          </ol>
          {b.counters?.length ? (
            <>
              <h2 className="bst-h2 green">{b.kind === 'место' ? 'Как пользоваться' : 'Как выжить'}</h2>
              <ul className="bst-counters">
                {b.counters.map((c) => (
                  <li key={c}>
                    <Live b={b} p={p} text={c} />
                  </li>
                ))}
              </ul>
            </>
          ) : null}
          {b.note && b.knobs.length > 0 && <p className="bst-note">{b.note}</p>}
        </div>
        <div className="bst-knobs">
          <div className="bst-knobs-h">
            <span className="cap">Настройки</span>
            {b.knobs.length > 0 && (
              <Btn sm variant="danger" disabled={!mod} onClick={() => resetKeys(b.id)} title="Вернуть все ручки этой записи к значениям по умолчанию">
                Сбросить всё{mod ? ` (${mod})` : ''}
              </Btn>
            )}
          </div>
          {b.knobs.length ? <KnobGroups b={b} p={p} /> : <RoomNote b={b} p={p} />}
        </div>
      </div>
    </article>
  );
}

/** Текст досье: {ключ} — живое число (изменённое — янтарём). */
function Live({ b, p, text }: { b: Beast; p: Project; text: string }) {
  const parts: ReactNode[] = [];
  let at = 0;
  for (const m of text.matchAll(/\{([\w.]+)\}/g)) {
    if (m.index! > at) parts.push(text.slice(at, m.index));
    const key = m[1];
    const moved = p.bestiary?.[b.id]?.[key] !== undefined;
    parts.push(
      <span key={m.index} className={'bst-v' + (moved ? ' moved' : '')}>
        {fillText(b, m[0])}
      </span>,
    );
    at = m.index! + m[0].length;
  }
  if (at < text.length) parts.push(text.slice(at));
  return <>{parts}</>;
}

/** Без ручек: где настраивается и какие комнаты проекта — эта локация. */
function RoomNote({ b, p }: { b: Beast; p: Project }) {
  const rooms = b.roomKind ? p.rooms.filter((r) => r.location?.kind === b.roomKind) : [];
  return (
    <div className="bst-roomnote">
      <p>{b.note ?? 'Своих ручек у записи нет.'}</p>
      {rooms.length > 0 && (
        <div className="bst-roomnote-list">
          <span className="cap">Комнаты проекта</span>
          {rooms.map((r) => (
            <Btn key={r.id} sm onClick={() => setUI({ page: 'editor', roomId: r.id, selection: null })} title="Открыть комнату в редакторе — параметры в инспекторе, секция «Спец-локация»">
              {r.name} →
            </Btn>
          ))}
        </div>
      )}
    </div>
  );
}

// ───────────────────────── ручки ─────────────────────────

/** Ручки по группам; пара [от, до] (ключи x.0 / x.1 с общим range) — одной строкой. */
function KnobGroups({ b, p }: { b: Beast; p: Project }) {
  const groups: { name: string; rows: BeastKnob[][] }[] = [];
  const ks = b.knobs;
  for (let i = 0; i < ks.length; i++) {
    const k = ks[i];
    const name = k.group ?? 'Прочее';
    let g = groups.find((x) => x.name === name);
    if (!g) groups.push((g = { name, rows: [] }));
    const nx = ks[i + 1];
    if (k.range && k.key.endsWith('.0') && nx && nx.range === k.range && nx.key === k.key.slice(0, -1) + '1') {
      g.rows.push([k, nx]);
      i++;
    } else g.rows.push([k]);
  }
  return (
    <>
      {groups.map((g) => {
        const keys = g.rows.flat().map((k) => k.key);
        const mod = keys.filter((k) => p.bestiary?.[b.id]?.[k] !== undefined).length;
        return (
          <Section
            key={g.name}
            title={
              <>
                {g.name}
                {mod > 0 && <span className="bst-mod">изменено {mod}</span>}
              </>
            }
            actions={
              mod > 0 ? (
                <Btn sm variant="ghost" onClick={() => resetKeys(b.id, keys)} title="Вернуть ручки группы к значениям по умолчанию">
                  сбросить
                </Btn>
              ) : undefined
            }
          >
            {g.rows.map((row) => (
              <KnobRow key={row[0].key} b={b} p={p} row={row} />
            ))}
          </Section>
        );
      })}
    </>
  );
}

function KnobRow({ b, p, row }: { b: Beast; p: Project; row: BeastKnob[] }) {
  const k = row[0];
  const pair = row.length === 2;
  const { mul, step, digits } = knobScale(k);
  const unit = k.pct ? '%' : (k.unit ?? '');
  const shown = (v: number) => +(v * mul).toFixed(digits);
  const vals = row.map((x) => valueIn(p, b.id, x.key));
  const defs = row.map((x) => knobDefault(b.id, x.key));
  const moved = row.some((x) => p.bestiary?.[b.id]?.[x.key] !== undefined);
  const undoKey = `bst:${b.id}:${k.range ?? k.key}`;
  // правка в показанных единицах; пара — от ≤ до (правка одного конца тянет другой)
  const set = (i: number, shownV: number) => {
    const v = shownV / mul;
    const kv: [string, number][] = [[row[i].key, v]];
    if (pair && i === 0 && v > vals[1]) kv.push([row[1].key, v]);
    if (pair && i === 1 && v < vals[0]) kv.push([row[0].key, v]);
    setKnobs(b.id, kv, undoKey);
  };
  const label = pair ? (k.range ?? k.label) : k.label;
  const defText = defs.map((d) => fmtKnob(k, d)).join('–') + (unit ? ` ${unit}` : '');
  const field = (i: number) => (
    <div className="bst-num">
      <NumField value={shown(vals[i])} step={step} min={shown(k.min)} max={shown(k.max)} digits={digits} onChange={(v) => set(i, v)} title={`${shown(k.min)}…${shown(k.max)}${unit ? ' ' + unit : ''}`} />
    </div>
  );
  return (
    <div className={'bst-knob' + (moved ? ' moved' : '')}>
      <div className="bst-knob-h">
        <span className="bst-knob-label">{label}</span>
        <span className="bst-knob-in">
          {field(0)}
          {pair && <span className="bst-dash">–</span>}
          {pair && field(1)}
          <span className="bst-unit">{unit}</span>
          <Btn sm icon variant="ghost" disabled={!moved} onClick={() => resetKeys(b.id, row.map((x) => x.key))} title={moved ? `Вернуть по умолчанию: ${defText}` : 'Значение по умолчанию'}>
            ↺
          </Btn>
        </span>
      </div>
      <Scale min={shown(k.min)} max={shown(k.max)} step={step} value={vals.map(shown)} def={defs.map(shown)} onChange={set} label={label} />
      {(k.hint || moved) && (
        <div className="bst-knob-hint">
          {k.hint && <span>{k.hint}</span>}
          {moved && <span className="bst-knob-def">по умолчанию {defText}</span>}
        </div>
      )}
    </div>
  );
}

function plural(n: number, one: string, few: string, many: string): string {
  const a = Math.abs(n) % 100, b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b === 1) return one;
  if (b >= 2 && b <= 4) return few;
  return many;
}
