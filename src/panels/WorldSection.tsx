// Секция «Бесконечный мир» страницы «Генератор» (режим 4D): квартиры, переходы, биомы для «Прогулки»
// (Project.world; механика — src/gen4d/stream.ts, режим квартир; правила — docs/GENERATOR-4D.md §16).
import { useMemo, useState } from 'react';
import { mutate, useProject } from '../model/store';
import type { Biome, Project, TunnelSettings, WorldSettings } from '../model/types';
import { biomeMul, CLUSTER_MAX, defaultBiomes, EXITS_LIM, isTunnels, tunnelRule, worldRule } from '../gen4d/biomes';
import { Btn, Check, ColorField, NumField, Section, Select, TextField } from '../ui/kit';
import './panels.css';

type RangeKey = 'clusterRooms' | 'clusterExits';
type TunRangeKey = 'hubEvery' | 'ringLen' | 'loopLen';

export function WorldSection() {
  const p = useProject();
  const w = p.world;
  const [open, setOpen] = useState<string | null>(null);
  const upd = (key: string, fn: (x: WorldSettings) => void) => mutate((pp) => fn(pp.world), { key: `world-${key}` });
  const setRange = (k: RangeKey, lim: readonly [number, number]) => (i: 0 | 1, v: number) =>
    upd(`${k}${i}`, (x) => {
      const r = Math.min(lim[1], Math.max(lim[0], Math.round(v)));
      x[k][i] = r;
      if (x[k][0] > x[k][1]) x[k][1 - i] = r;
    });
  // теги комнат проекта — подсказки для правил биомов; сколько комнат растёт в биоме
  const tags = useMemo(() => [...new Set(p.rooms.flatMap((r) => r.tags))].sort(), [p.rooms]);
  const grows = (b: Biome) => p.rooms.filter((r) => !r.location && r.gen.weight > 0 && biomeMul(b, r) > 0).length;
  const plain = w.biomes.filter((b) => !b.rich);
  const tun = w.biomes.some((b) => isTunnels(b));
  const updT = (key: string, fn: (t: TunnelSettings) => void) => upd(`tun-${key}`, (x) => fn(x.tunnels));
  const tunRange = (k: TunRangeKey, lim: readonly [number, number]) => (i: 0 | 1, v: number) =>
    updT(`${k}${i}`, (t) => {
      const r = Math.min(lim[1], Math.max(lim[0], Math.round(v)));
      t[k][i] = r;
      if (t[k][0] > t[k][1]) t[k][1 - i] = r;
    });
  const pctField = (label: string, key: 'turn' | 'branch' | 'storage' | 'ring' | 'loop', title: string) => (
    <NumField label={label} value={w.tunnels[key] * 100} min={0} max={100} step={1} digits={0} suffix="%" title={title} onChange={(v) => updT(key, (t) => (t[key] = Math.min(1, Math.max(0, v / 100))))} />
  );

  return (
    <Section title="Бесконечный мир («Прогулка»)">
      <div className="hint">
        Мир растёт квартирами: открыл закрытый выход — за ним новая квартира, остальные выходы исчезают. Переходы (лестница,
        лифт) — по счётчику пройденных комнат, ведут в другой биом или в богатую квартиру.
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <Range label="Комнат в квартире" value={w.clusterRooms} lim={[1, CLUSTER_MAX]} title="Сколько комнат в квартире (кластере); не больше 15" onChange={setRange('clusterRooms', [1, CLUSTER_MAX])} />
        <Range label="Выходов из квартиры" value={w.clusterExits} lim={EXITS_LIM} title="Закрытых дверей-выходов в другие квартиры (входные двери, коридоры, марши, подвальные ходы)" onChange={setRange('clusterExits', EXITS_LIM)} />
      </div>
      <div className="grid2">
        <NumField label="Переход после комнат" value={w.trAfter} min={0} max={10000} step={5} digits={0} title="Сколько комнат пройти (впервые), прежде чем появится шанс перехода" onChange={(v) => upd('trAfter', (x) => (x.trAfter = Math.max(0, Math.round(v))))} />
        <NumField label="Шанс перехода" value={w.trBase * 100} min={0} max={100} step={1} digits={1} suffix="%" title="Шанс для первой комнаты после порога" onChange={(v) => upd('trBase', (x) => (x.trBase = Math.min(1, Math.max(0, v / 100))))} />
        <NumField label="+ за комнату" value={w.trStep * 100} min={0} max={100} step={0.5} digits={1} suffix="%" title="Прибавка шанса за каждую следующую пройденную комнату" onChange={(v) => upd('trStep', (x) => (x.trStep = Math.min(1, Math.max(0, v / 100))))} />
        <NumField label="В другой биом" value={w.trToBiome * 100} min={0} max={100} step={5} digits={0} suffix="%" title="Доля переходов в другой биом; остальные — в богатую квартиру" onChange={(v) => upd('trToBiome', (x) => (x.trToBiome = Math.min(1, Math.max(0, v / 100))))} />
        <NumField label="Богатая: элитность ×" value={w.richBoost} min={1} max={1000} step={1} digits={0} title="Множитель весов тиров элитности ≥ 2 в богатой квартире (как у проходки)" onChange={(v) => upd('richBoost', (x) => (x.richBoost = Math.max(1, v)))} />
        <Select
          label="Стартовый биом"
          value={w.startBiome ?? ''}
          options={[{ value: '', label: 'первый обычный' }, ...plain.map((b) => ({ value: b.id, label: b.name }))]}
          onChange={(v) => upd('start', (x) => (x.startBiome = v || null))}
        />
      </div>
      <div className="pn-loc-rule">
        <b>Правило.</b> {worldRule(w)}
      </div>
      {tun && (
        <>
          <div className="row" style={{ marginTop: 6 }}>
            <b>Подвал: сеть ходов</b>
          </div>
          <div className="hint">
            Биомы с галочкой «подвал» растут не квартирами, а ходами на ходу: длинные ходы 1 м, редкие хабы (вход и выход —
            марш хаба), кладовые, кольца через слои W и бесконечные прямые участки.
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <Range label="Хаб через, м хода" value={w.tunnels.hubEvery} lim={[4, 1000]} title="Хаб не ближе минимума от прошлого, к максимуму — наверняка (шанс растёт линейно)" onChange={tunRange('hubEvery', [4, 1000])} />
            <Range label="Кольцо, м" value={w.tunnels.ringLen} lim={[8, 400]} title="Длина кольца из хаба в хаб" onChange={tunRange('ringLen', [8, 400])} />
            <Range label="Бесконечный участок, м" value={w.tunnels.loopLen} lim={[6, 120]} title="Длина повторяющегося прямого участка: дошёл до конца — снова в начале" onChange={tunRange('loopLen', [6, 120])} />
          </div>
          <div className="grid2">
            {pctField('Поворот', 'turn', 'Шанс поворота на кусок хода')}
            {pctField('Развилка', 'branch', 'Шанс развилки на кусок хода')}
            {pctField('Кладовая', 'storage', 'Шанс кладовой за боковой дверью хода (иначе стена)')}
            {pctField('Кольцо из хаба', 'ring', 'Шанс, что ход из хаба замкнётся кольцом в другой проход того же хаба')}
            {pctField('Бесконечный участок', 'loop', 'Шанс бесконечного прямого участка на кусок хода (не ближе 12 м к хабу)')}
          </div>
          <div className="pn-loc-rule">{tunnelRule(w.tunnels)}</div>
        </>
      )}

      <div className="row" style={{ justifyContent: 'space-between', marginTop: 6 }}>
        <b>Биомы</b>
        <div className="row" style={{ gap: 4 }}>
          <Btn
            sm
            title="Новый биом: пустой список тегов"
            onClick={() =>
              mutate((pp) => {
                let k = pp.world.biomes.length + 1;
                while (pp.world.biomes.some((b) => b.id === `biome${k}`)) k++;
                pp.world.biomes.push({ id: `biome${k}`, name: `Биом ${k}`, color: '#9a9a9a', tags: [], note: '' });
                setOpen(`biome${k}`);
              })
            }
          >
            + биом
          </Btn>
          <Btn
            sm
            title="Вернуть биомы по умолчанию (хрущёвки, малосемейки, общежитие, подвал, богатая квартира)"
            onClick={() => confirm('Заменить биомы пресетами? Ваши биомы удалятся (Ctrl+Z — отменить).') && mutate((pp) => (pp.world.biomes = defaultBiomes()))}
          >
            пресеты
          </Btn>
        </div>
      </div>
      {w.biomes.map((b, bi) => (
        <div key={b.id} className="pn-biome">
          <div className="row" style={{ gap: 6, cursor: 'pointer' }} onClick={() => setOpen(open === b.id ? null : b.id)}>
            <span className="pn-biome-dot" style={{ background: b.color }} />
            <span className="grow">
              {b.name}
              {b.rich ? ' ★' : ''}
            </span>
            <span className="muted" title="Сколько комнат проекта растёт в этом биоме">
              {grows(b)} комн.
            </span>
          </div>
          {open === b.id && (
            <BiomeFields
              b={b}
              p={p}
              tags={tags}
              onChange={(fn) => mutate((pp) => fn(pp.world.biomes[bi]), { key: `biome-${b.id}` })}
              onRemove={() =>
                mutate((pp) => {
                  pp.world.biomes.splice(bi, 1);
                  if (pp.world.startBiome === b.id) pp.world.startBiome = null;
                })
              }
            />
          )}
        </div>
      ))}
    </Section>
  );
}

function BiomeFields(props: { b: Biome; p: Project; tags: string[]; onChange: (fn: (b: Biome) => void) => void; onRemove: () => void }) {
  const { b, p, tags, onChange } = props;
  const fname = (id: string) => p.finishes?.find((f) => f.id === id)?.name ?? `${id} (нет в проекте)`;
  const free = tags.filter((t) => !b.tags.some((x) => x.tag === t));
  return (
    <div className="pn-biome-body">
      <div className="row" style={{ gap: 6 }}>
        <div className="grow">
          <TextField label="Название" value={b.name} onChange={(v) => onChange((x) => (x.name = v))} />
        </div>
        <ColorField value={b.color} onChange={(v) => onChange((x) => (x.color = v))} title="Цвет на плане и в HUD" />
      </div>
      <Check
        label="богатая квартира"
        value={!!b.rich}
        onChange={(v) => onChange((x) => (v ? (x.rich = true) : delete x.rich))}
        title="Сюда ведёт часть переходов; элитность с усилением; стартом и «другим биомом» не бывает"
      />
      <Check
        label="подвал: сеть ходов"
        value={isTunnels(b)}
        onChange={(v) => onChange((x) => (v ? (x.layout = 'tunnels') : delete x.layout))}
        title="Растёт не квартирами, а ходами на ходу (настройки — «Подвал: сеть ходов» выше): нужны куски ходов с тегами «ход», «поворот», «развилка», «хаб»"
      />
      {!!b.finishRules?.length && (
        <div className="hint" title="Правила отделки биома — поверх правил проекта (по тегу комнаты); меняются пресетами биомов">
          <b>Отделка биома:</b>{' '}
          {b.finishRules.map((r) => `${r.tag} — стены: ${r.wall.map((x) => fname(x.finishId)).join(', ')}; пол: ${r.floor.map((x) => fname(x.finishId)).join(', ')}`).join(' · ')}
        </div>
      )}
      <div className="hint">Вес комнаты в биоме = вес роста × наибольший множитель среди её тегов; тега нет в списке — комната не растёт.</div>
      {b.tags.map((t, ti) => (
        <div key={t.tag} className="row" style={{ gap: 4 }}>
          <span className="grow mono">{t.tag}</span>
          <div style={{ width: 90 }}>
            <NumField value={t.mul} min={0} max={100} step={0.1} digits={2} suffix="×" title={`Множитель веса комнат с тегом «${t.tag}»`} onChange={(v) => onChange((x) => (x.tags[ti].mul = Math.max(0, v)))} />
          </div>
          <Btn sm icon title="Убрать тег" onClick={() => onChange((x) => x.tags.splice(ti, 1))}>
            ✕
          </Btn>
        </div>
      ))}
      {free.length > 0 && (
        <Select
          value=""
          options={[{ value: '', label: '+ тег комнат…' }, ...free.map((t) => ({ value: t, label: t }))]}
          onChange={(v) => v && onChange((x) => x.tags.push({ tag: v, mul: 1 }))}
        />
      )}
      <TextField label="Заметка" value={b.note} onChange={(v) => onChange((x) => (x.note = v))} />
      <Btn sm variant="danger" onClick={props.onRemove} title="Удалить биом">
        удалить биом
      </Btn>
    </div>
  );
}

function Range(props: { label: string; value: [number, number]; lim: readonly [number, number]; title: string; onChange: (i: 0 | 1, v: number) => void }) {
  const f = (i: 0 | 1) => (
    <div className="grow">
      <NumField
        value={props.value[i]}
        min={props.lim[0]}
        max={props.lim[1]}
        step={1}
        digits={0}
        title={`${props.title} — ${i ? 'максимум' : 'минимум'}`}
        onChange={(v) => props.onChange(i, v)}
      />
    </div>
  );
  return (
    <div className="field">
      <label title={props.title}>{props.label}</label>
      <div className="row">
        {f(0)}
        <span className="muted">–</span>
        {f(1)}
      </div>
    </div>
  );
}
