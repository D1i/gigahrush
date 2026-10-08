// Генератор: пробный прогон (ТЗ — «сразу видит результат»). Слева — настройки и сводка,
// в центре — предпросмотр раскладки, справа — подробности об экземпляре.
import { useEffect, useMemo, useRef, useState } from 'react';
import { getVersion, mutate, useProject } from '../model/store';
import type { FoldSettings, GeneratorMode, GeneratorSettings, MatchMode } from '../model/types';
import { normFold } from '../gen4d/fold';
import { setUI, useUI } from '../model/ui';
import { Btn, Check, NumField, Section, Select, TextField } from '../ui/kit';
import { WorldSection } from '../panels/WorldSection';
import { InstanceInfo } from '../preview/InstanceInfo';
import { PreviewCanvas } from '../preview/PreviewCanvas';
import { RunSummary } from '../preview/RunSummary';
import { buildRunGeo } from '../preview/runGeo';
import { copyRun, downloadRun, generateNow, getRunVersion } from '../preview/runActions';
import { randomSeed, stepSeed } from '../preview/util';
import '../preview/preview.css';

const MATCH: { value: MatchMode; label: string }[] = [
  { value: 'exact', label: 'Точно: метка + длина' },
  { value: 'tag', label: 'По метке (длина любая, по центру)' },
  { value: 'len', label: 'По длине (метка любая)' },
];

const GEN_MODES: { id: GeneratorMode; label: string; sub: string; title: string }[] = [
  {
    id: 'euclid',
    label: 'Евклидов',
    sub: 'обычный дом: одно пространство, комнаты не пересекаются',
    title: 'Классический генератор: все комнаты в одном плане, двери стыкуются лицом к лицу, пересечений нет',
  },
  {
    id: 'fold',
    label: 'Складчатый (4D)',
    sub: 'пороги сдвигают слой W — квартиры могут занимать одно место',
    title:
      'Каждая комната получает слой W; пороги могут его сдвигать. Комнаты разных слоёв занимают одно место в 3D, но игрок видит только свою комнату и соседей — и никогда не видит наложения',
  },
];

const AUTO_KEY = 'room-forge/gen-auto';
const readAuto = () => {
  try {
    return localStorage.getItem(AUTO_KEY) !== '0';
  } catch {
    return true;
  }
};

const isTyping = (t: EventTarget | null) =>
  t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement || t instanceof HTMLButtonElement;

export function GeneratorPage() {
  const p = useProject();
  const ui = useUI();
  const g = p.generator;
  const run = ui.run;
  const [auto, setAutoState] = useState(readAuto);
  const setAuto = (v: boolean) => {
    setAutoState(v);
    try {
      localStorage.setItem(AUTO_KEY, v ? '1' : '0');
    } catch {}
  };

  const set = <K extends keyof GeneratorSettings>(k: K, v: GeneratorSettings[K]) =>
    mutate((pp) => {
      pp.generator[k] = v;
    }, { key: 'gen.' + k });
  const setFold = <K extends keyof FoldSettings>(k: K, v: FoldSettings[K]) =>
    mutate((pp) => {
      pp.generator.fold = { ...normFold(pp.generator.fold), [k]: v };
    }, { key: 'gen.fold.' + k });
  const isFold = g.mode === 'fold';
  const fold = normFold(g.fold);

  // геометрия предпросмотра — один раз на прогон
  const geo = useMemo(() => (run ? buildRunGeo(p, run) : null), [run]);

  // автогенерация при первом входе
  useEffect(() => {
    if (!ui.run) generateNow({ quiet: true });
  }, []);

  // перегенерация при изменении настроек
  const settingsKey = JSON.stringify(g);
  const firstKey = useRef(settingsKey);
  useEffect(() => {
    if (settingsKey === firstKey.current) return;
    firstKey.current = settingsKey;
    if (auto) generateNow({ quiet: true });
  }, [settingsKey, auto]);

  // Enter — сгенерировать, Esc — снять выделение
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (isTyping(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === 'Enter') {
        e.preventDefault();
        // поле ввода успеет закоммитить значение по blur/Enter — читаем свежий проект
        setTimeout(() => generateNow(), 0);
      } else if (e.key === 'Escape') {
        setUI({ runInst: null });
      }
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, []);

  const stale = !!run && getRunVersion() !== getVersion();
  const cellM = p.settings.cellM;
  const roomOpts = [{ value: '', label: 'авто (тег start / по весу)' }, ...p.rooms.map((r) => ({ value: r.id, label: r.name }))];
  const passOpts = [
    { value: '', label: 'нет' },
    ...p.economy.passes.map((x) => {
      const price = p.items.find((i) => i.id === x.priceItemId);
      return { value: x.id, label: `${x.name}${price ? ` — ${x.price} ${price.name}` : ''}` };
    }),
  ];
  const pass = g.passId ? p.economy.passes.find((x) => x.id === g.passId) : undefined;

  return (
    <div className="cols3">
      <aside className="side">
        <Section title="Генератор">
          <div className="pv-modes">
            {GEN_MODES.map((m) => (
              <Btn key={m.id} on={(g.mode ?? 'euclid') === m.id} onClick={() => set('mode', m.id)} title={m.title}>
                {m.label}
                <small>{m.sub}</small>
              </Btn>
            ))}
          </div>
          {isFold && (
            <>
              <div className="grid2">
                <NumField
                  label="Шанс сдвига"
                  value={Math.round(fold.shiftChance * 1000) / 10}
                  min={0}
                  max={100}
                  step={5}
                  digits={1}
                  suffix="%"
                  title="Вероятность, что обычный порог (метка «авто») сдвинет слой, даже когда место в текущем слое есть. 0 — складки только «по нужде», где иначе был бы тупик"
                  onChange={(v) => setFold('shiftChance', Math.min(1, Math.max(0, v / 100)))}
                />
                <NumField
                  label="Макс. сдвиг |ΔW|"
                  value={fold.maxShift}
                  min={0}
                  max={64}
                  step={1}
                  digits={0}
                  title="На сколько слоёв максимум может сдвинуть один порог. 0 — плоский план (как евклидов)"
                  onChange={(v) => setFold('maxShift', Math.round(v))}
                />
                <NumField
                  label="Радиус евклидовости"
                  value={fold.localRadius}
                  min={1}
                  max={16}
                  step={1}
                  digits={0}
                  suffix="дв."
                  title="Комнаты ближе этого числа дверей друг к другу никогда не пересекаются в 3D. 1 — максимум складок: портальный рендер всё равно показывает каждую комнату только в её проёме"
                  onChange={(v) => setFold('localRadius', Math.round(v))}
                />
                <NumField
                  label="Предел слоёв |W| ≤"
                  value={fold.maxLayer}
                  min={0}
                  max={1000}
                  step={1}
                  digits={0}
                  title="Допустимые слои: от −N до +N"
                  onChange={(v) => setFold('maxLayer', Math.round(v))}
                />
              </div>
              <Check
                label="бесшовность без порталов (меньше складок)"
                value={!!fold.seamless}
                onChange={(v) => setFold('seamless', v)}
                title="Запретить пересечения внутри видимого набора комнаты — нужно, только если движок рисует набор целиком, без портального рендера. С порталами (вкладка 3D) пересечения в поле зрения допустимы и бесшовны"
              />
              <div className="hint">
                Комнаты разных слоёв W занимают одно место; портальный рендер (3D) показывает каждую только сквозь её проём — поэтому наложения
                в поле зрения не видны и переходы бесшовны. Радиус 1 даёт больше всего складок. Пороги «всегда / никогда не сдвигает» задаются у
                метки в редакторе комнаты.
              </div>
            </>
          )}
        </Section>
        <Section title="Настройки прогона">
          <div className="pv-seed">
            <TextField label="Сид" value={g.seed} mono onChange={(v) => set('seed', v)} />
            <Btn icon onClick={() => set('seed', stepSeed(g.seed, -1))} title="Предыдущий сид">
              ←
            </Btn>
            <Btn icon onClick={() => set('seed', stepSeed(g.seed, 1))} title="Следующий сид">
              →
            </Btn>
            <Btn icon onClick={() => set('seed', randomSeed())} title="Случайный сид">
              🎲
            </Btn>
          </div>
          <div className="grid2">
            <NumField label="Комнат" value={g.count} min={1} max={400} step={1} digits={0} onChange={(v) => set('count', Math.round(v))} />
            <NumField
              label={`Зазор = ${+(g.gap * cellM).toFixed(2)} м`}
              value={g.gap}
              min={0}
              max={20}
              step={1}
              digits={0}
              suffix="кл"
              title="Толщина стены между комнатами, клеток"
              onChange={(v) => set('gap', Math.round(v))}
            />
          </div>
          <NumField
            label="Дальность обзора, м (0 — без ограничения)"
            value={g.sightM ?? 0}
            min={0}
            max={200}
            step={0.5}
            digits={1}
            suffix="м"
            title="Самая длинная прямая линия видимости сквозь двери; меньше — извилистее карта, больше поворотов"
            onChange={(v) => set('sightM', v)}
          />
          <div className="row" style={{ gap: 4 }}>
            {(isFold ? [0, 9, 7, 5] : [0, 12, 9, 6]).map((v) => (
              <Btn key={v} sm on={(g.sightM ?? 0) === v} onClick={() => set('sightM', v)}>
                {v === 0 ? 'нет' : v}
              </Btn>
            ))}
          </div>
          <div className="hint">
            {isFold
              ? 'Взгляд идёт сквозь двери в соседние комнаты любых слоёв W; комнаты других слоёв на том же месте его не задерживают. 5–7 м — давяще: структуры не дают смотреть вдаль; 9 м — умеренно.'
              : 'Самая длинная прямая линия видимости сквозь двери; меньше — извилистее карта, больше поворотов.'}
          </div>
          <Check
            label="достраивать квартиры"
            value={!!g.fill}
            onChange={(v) => set('fill', v)}
            title="После набора числа комнат закрыть открытые проёмы кухнями, санузлами, комнатами и балконами (без новых лестниц и коридоров) — квартиры не обрываются на прихожей"
          />
          <Select label="Стыковка меток" value={g.match} options={MATCH} onChange={(v) => set('match', v)} />
          <Select label="Стартовая комната" value={g.startRoomId ?? ''} options={roomOpts} onChange={(v) => set('startRoomId', v || null)} />
          <Select label="Проходка" value={g.passId ?? ''} options={passOpts} onChange={(v) => set('passId', v || null)} />
          {pass && (
            <div className="hint">
              элитные тиры ×{pass.tierBoost}
              {Object.keys(pass.itemBoost).length > 0 &&
                ' · ' +
                  Object.entries(pass.itemBoost)
                    .map(([id, k]) => `${p.items.find((i) => i.id === id)?.name ?? id} ×${k}`)
                    .join(', ')}
            </div>
          )}
          <div className="row">
            <Btn variant="primary" onClick={() => generateNow()} title="Сгенерировать (Enter)">
              ⚙ Сгенерировать <span className="kbd" style={{ color: '#1a1408', borderColor: '#1a140855' }}>Enter</span>
            </Btn>
          </div>
          <Check label="перегенерировать при изменении настроек" value={auto} onChange={setAuto} />
        </Section>
        {isFold && <WorldSection />}
        <Section title="Экспорт раскладки">
          <div className="row">
            <Btn sm disabled={!run} onClick={() => run && downloadRun(run)} title="Скачать JSON готовой раскладки для движка (run-<сид>.json)">
              ⬇ Скачать run.json
            </Btn>
            <Btn sm disabled={!run} onClick={() => run && copyRun(run)}>
              Копировать
            </Btn>
          </div>
        </Section>
        {run && <RunSummary p={p} run={run} />}
      </aside>
      <section className="stage">
        <PreviewCanvas p={p} run={run} geo={geo} selected={ui.runInst} stale={stale} />
      </section>
      <aside className="side right">
        {run && geo ? <InstanceInfo p={p} run={run} geo={geo} instId={ui.runInst} /> : <div className="empty">Нет прогона</div>}
      </aside>
    </div>
  );
}
