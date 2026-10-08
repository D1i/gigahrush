// Секция «Бесконечный мир» страницы «Генератор» (режим 4D): параметры генераторов «Прогулки» (Project.world) —
// квартиры, переходы, подвал (сеть ходов, частота кусков), 4D и обзор прогулки, биомы со своими параметрами.
// Механика — src/gen4d/stream.ts, правила — docs/GENERATOR-4D.md §16–18.
import { useMemo, useState, type ReactNode } from 'react';
import { mutate, useProject } from '../model/store';
import type { ApartmentSettings, Biome, Project, Room, TunnelSettings, WalkGenSettings, WorldSettings } from '../model/types';
import {
  aptOf, biomeMul, CLUSTER_MAX, defaultBiomes, DEFAULT_OUTER_TAGS, EXITS_LIM, isTunnels, tunnelKind, tunnelRule, tunOf, worldRule,
  type TunnelKind,
} from '../gen4d/biomes';
import { Btn, Check, ColorField, NumField, Section, Select, TagsField, TextField } from '../ui/kit';
import './panels.css';

const pct = (v: number) => Math.min(1, Math.max(0, v / 100));
/** Обновить пару [мин, макс] (целые, в пределах, упорядочены). */
const setPair = (x: [number, number], i: 0 | 1, v: number, lim: readonly [number, number]) => {
  const r = Math.min(lim[1], Math.max(lim[0], Math.round(v)));
  x[i] = r;
  if (x[0] > x[1]) x[1 - i] = r;
};

export function WorldSection() {
  const p = useProject();
  const w = p.world;
  const [open, setOpen] = useState<string | null>(null);
  const upd = (key: string, fn: (x: WorldSettings) => void) => mutate((pp) => fn(pp.world), { key: `world-${key}` });
  // теги комнат проекта — подсказки для правил биомов; сколько комнат растёт в биоме
  const tags = useMemo(() => [...new Set(p.rooms.flatMap((r) => r.tags))].sort(), [p.rooms]);
  const grows = (b: Biome) => p.rooms.filter((r) => !r.location && r.gen.weight > 0 && biomeMul(b, r) > 0).length;
  const plain = w.biomes.filter((b) => !b.rich);
  const tun = w.biomes.some((b) => isTunnels(b));

  return (
    <Section title="Бесконечный мир («Прогулка»)">
      <div className="hint">
        Параметры генераторов мира «Прогулки». Мир растёт квартирами (открыл закрытый выход — за ним новая квартира), подвалы —
        сетью ходов; переходы по счётчику ведут в другой биом. Действуют на новые миры («Новый мир» / «Сбросить сохранение»).
      </div>

      <Block title="Квартиры" hint="Общие для всех квартирных биомов; у биома могут быть свои (галочка «свои параметры генератора»).">
        <AptFields v={w} set={(fn, k) => upd(`apt-${k}`, (x) => fn(x))} />
        <TagsField
          label="Наружные двери (теги меток)"
          value={w.outerTags}
          placeholder={DEFAULT_OUTER_TAGS.join(', ')}
          onChange={(v) => upd('outer', (x) => (x.outerTags = v))}
        />
        <div className="hint">
          Двери с этими метками — выходы квартиры в первую очередь (входная, коридор, марш, ход); остальные — внутренние: квартира
          достраивает их первыми.
        </div>
      </Block>

      <Block title="Переходы" hint="Лестница или лифт по счётчику пройденных комнат: ведут в другой биом или в богатую квартиру.">
        <div className="grid2">
          <NumField label="Переход после комнат" value={w.trAfter} min={0} max={10000} step={5} digits={0} title="Сколько комнат пройти (впервые), прежде чем появится шанс перехода" onChange={(v) => upd('trAfter', (x) => (x.trAfter = Math.max(0, Math.round(v))))} />
          <NumField label="Шанс перехода" value={w.trBase * 100} min={0} max={100} step={1} digits={1} suffix="%" title="Шанс для первой комнаты после порога" onChange={(v) => upd('trBase', (x) => (x.trBase = pct(v)))} />
          <NumField label="+ за комнату" value={w.trStep * 100} min={0} max={100} step={0.5} digits={1} suffix="%" title="Прибавка шанса за каждую следующую пройденную комнату" onChange={(v) => upd('trStep', (x) => (x.trStep = pct(v)))} />
          <NumField label="В другой биом" value={w.trToBiome * 100} min={0} max={100} step={5} digits={0} suffix="%" title="Доля переходов в другой биом; остальные — в богатую квартиру" onChange={(v) => upd('trToBiome', (x) => (x.trToBiome = pct(v)))} />
          <NumField label="Дверь под переход от" value={w.transitionMinLen} min={0.1} max={10} step={0.1} digits={2} suffix="м" title="Переход встаёт за дверью не уже этого (0.7 — межкомнатная и шире); выходами квартиры становятся только такие двери (уже — лишь чтобы набрать минимум выходов). Выпал переход — он за той дверью, которую откроешь, какой бы ширины она ни была" onChange={(v) => upd('trMin', (x) => (x.transitionMinLen = Math.min(10, Math.max(0.1, v))))} />
          <NumField label="Богатая: элитность ×" value={w.richBoost} min={1} max={1000} step={1} digits={0} title="Множитель весов тиров элитности ≥ 2 в богатой квартире (как у проходки)" onChange={(v) => upd('richBoost', (x) => (x.richBoost = Math.max(1, v)))} />
          <Select
            label="Стартовый биом"
            value={w.startBiome ?? ''}
            options={[{ value: '', label: 'первый обычный' }, ...plain.map((b) => ({ value: b.id, label: b.name }))]}
            onChange={(v) => upd('start', (x) => (x.startBiome = v || null))}
          />
        </div>
      </Block>

      {tun && (
        <Block title="Подвал: сеть ходов" hint="Общие для всех подвалов; у подвала могут быть свои. Ходы 1 м растут на ходу, вход и выход — марш хаба.">
          <TunFields v={w.tunnels} rooms={p.rooms} set={(fn, k) => upd(`tun-${k}`, (x) => fn(x.tunnels))} />
          <div className="pn-loc-rule">{tunnelRule(w.tunnels)}</div>
        </Block>
      )}

      <Block title="4D и обзор прогулки" hint="Складки слоёв W, пересечения, предел обзора и сколько мира строится заранее.">
        <WalkFields v={w.walk} set={(fn, k) => upd(`walk-${k}`, (x) => fn(x.walk))} />
      </Block>

      <div className="pn-loc-rule">
        <b>Правило.</b> {worldRule(w)}
      </div>

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
            title="Вернуть биомы по умолчанию (хрущёвки, малосемейки, общежитие, подвалы, богатая квартира)"
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
              {(b.apartments || b.tunnels) && <span className="muted" title="Свои параметры генератора"> ⚙</span>}
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
              onChange={(fn, k = '') => mutate((pp) => fn(pp.world.biomes[bi]), { key: `biome-${b.id}-${k}` })}
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

/** Сворачиваемый блок секции. */
function Block(props: { title: string; hint?: string; children: ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(props.defaultOpen ?? true);
  return (
    <div className="pn-block">
      <div className="pn-block-h" onClick={() => setOpen(!open)}>
        <span style={{ display: 'inline-block', width: 12 }}>{open ? '▾' : '▸'}</span>
        <b>{props.title}</b>
      </div>
      {open && (
        <div className="pn-block-b">
          {props.hint && <div className="hint">{props.hint}</div>}
          {props.children}
        </div>
      )}
    </div>
  );
}

type Setter<T> = (fn: (x: T) => void, key: string) => void;

/** Параметры квартир (общие или свои у биома). */
function AptFields(props: { v: ApartmentSettings; set: Setter<ApartmentSettings> }) {
  const { v, set } = props;
  return (
    <>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <Range label="Комнат в квартире" value={v.clusterRooms} lim={[1, CLUSTER_MAX]} title="Сколько комнат в квартире (кластере); не больше 15" onChange={(i, x) => set((a) => setPair(a.clusterRooms, i, x, [1, CLUSTER_MAX]), `rooms${i}`)} />
        <Range
          label="Выходов из квартиры"
          value={v.clusterExits}
          lim={EXITS_LIM}
          title="Закрытых дверей-выходов в другие квартиры: бросок в диапазоне; все оставшиеся двери квартиры — выходы, не больше максимума"
          onChange={(i, x) => set((a) => setPair(a.clusterExits, i, x, EXITS_LIM), `exits${i}`)}
        />
      </div>
      <div className="grid2">
        <NumField
          label="Проходимость"
          value={v.exitReserve * 100}
          min={0}
          max={100}
          step={10}
          digits={0}
          suffix="%"
          title="Запас дверей под выходы при росте: 100% — квартира держит открытыми столько дверей, сколько выходов ей выпало (за ними — только проходные комнаты, тупиковых комнат меньше); 0% — только минимум (обычные квартиры, больше кухонь и санузлов)"
          onChange={(x) => set((a) => (a.exitReserve = pct(x)), 'reserve')}
        />
        <NumField
          label="Вход: запас дверей"
          value={v.entrySpare}
          min={0}
          max={8}
          step={1}
          digits={0}
          title="Вход новой квартиры — сначала комната, у которой кроме двери входа не меньше «мин. выходов + запас» дверей"
          onChange={(x) => set((a) => (a.entrySpare = Math.min(8, Math.max(0, Math.round(x)))), 'spare')}
        />
      </div>
      <Check
        label="стыковка 4D-швом любой дверью"
        value={v.seamEntries}
        onChange={(x) => set((a) => (a.seamEntries = x), 'seam')}
        title="По меткам за выходом ничего с запасом дверей не встаёт (прихожая → комната) — вход новой квартиры стыкуется любой своей дверью (связь loose). Выключено — только по меткам; внутренние двери тогда выходами не бывают"
      />
    </>
  );
}

const KIND_RU: Record<TunnelKind, string> = { straight: 'ход', turn: 'поворот', branch: 'развилка', hub: 'хаб', storage: 'кладовая' };
const KIND_ORDER: TunnelKind[] = ['straight', 'turn', 'branch', 'hub', 'storage'];

/** Параметры ходов подвала (общие или свои у подвала) и частота кусков. */
function TunFields(props: { v: TunnelSettings; rooms: Room[]; set: Setter<TunnelSettings> }) {
  const { v, set } = props;
  const pf = (label: string, key: 'turn' | 'branch' | 'storage' | 'ring' | 'loop', title: string) => (
    <NumField label={label} value={v[key] * 100} min={0} max={100} step={1} digits={0} suffix="%" title={title} onChange={(x) => set((t) => (t[key] = pct(x)), key)} />
  );
  const pieces = useMemo(
    () =>
      props.rooms
        .filter((r) => !r.location)
        .map((r) => ({ r, kind: tunnelKind(r) }))
        .filter((x): x is { r: Room; kind: TunnelKind } => !!x.kind)
        .sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || a.r.name.localeCompare(b.r.name)),
    [props.rooms],
  );
  return (
    <>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <Range label="Хаб через, м хода" value={v.hubEvery} lim={[4, 1000]} title="Хаб не ближе минимума от прошлого, к максимуму — наверняка (шанс растёт линейно)" onChange={(i, x) => set((t) => setPair(t.hubEvery, i, x, [4, 1000]), `hub${i}`)} />
        <Range label="Кольцо, м" value={v.ringLen} lim={[8, 400]} title="Длина кольца из хаба в хаб" onChange={(i, x) => set((t) => setPair(t.ringLen, i, x, [8, 400]), `ring${i}`)} />
        <Range label="Бесконечный участок, м" value={v.loopLen} lim={[6, 120]} title="Длина повторяющегося прямого участка: дошёл до конца — снова в начале" onChange={(i, x) => set((t) => setPair(t.loopLen, i, x, [6, 120]), `loop${i}`)} />
      </div>
      <div className="grid2">
        {pf('Поворот', 'turn', 'Шанс поворота на кусок хода')}
        {pf('Развилка', 'branch', 'Шанс развилки на кусок хода')}
        {pf('Кладовая', 'storage', 'Шанс кладовой за боковой дверью хода (иначе стена)')}
        {pf('Кольцо из хаба', 'ring', 'Шанс, что ход из хаба замкнётся кольцом в другой проход того же хаба')}
        {pf('Бесконечный участок', 'loop', 'Шанс бесконечного прямого участка на кусок хода')}
        <NumField label="Бесконечный — от хаба" value={v.loopMinDist} min={0} max={1000} step={1} digits={0} suffix="м" title="Бесконечный участок — не ближе стольких метров хода к хабу" onChange={(x) => set((t) => (t.loopMinDist = Math.max(0, x)), 'loopMin')} />
      </div>
      <Block title="Частота кусков" hint="Множитель веса роста куска в подвале (0 — не ставится). Вид — по меткам: проходы на противоположных стенах — ход, на соседних — поворот, три и больше — развилка; тег «хаб»; дверь к ходу — кладовая." defaultOpen={false}>
        {pieces.map(({ r, kind }) => (
          <div key={r.id} className="row" style={{ gap: 4, alignItems: 'center' }}>
            <span className="grow" title={`${r.id} · вес роста ${r.gen.weight}`} style={{ minWidth: 0, fontSize: 11, lineHeight: 1.25 }}>
              <span className="muted" style={{ fontSize: 10 }}>
                {KIND_RU[kind]}
              </span>
              <br />
              {r.name}
            </span>
            <div style={{ width: 84, flex: 'none' }}>
              <NumField
                value={v.pieceWeights[r.id] ?? 1}
                min={0}
                max={100}
                step={0.25}
                digits={2}
                suffix="×"
                title={`Частота «${r.name}» в подвале: вес роста ${r.gen.weight} × множитель`}
                onChange={(x) =>
                  set((t) => {
                    t.pieceWeights = { ...t.pieceWeights };
                    if (Math.abs(x - 1) < 1e-9) delete t.pieceWeights[r.id];
                    else t.pieceWeights[r.id] = Math.max(0, x);
                  }, `pw-${r.id}`)
                }
              />
            </div>
          </div>
        ))}
      </Block>
    </>
  );
}

/** 4D и обзор прогулки. */
function WalkFields(props: { v: WalkGenSettings; set: Setter<WalkGenSettings> }) {
  const { v, set } = props;
  const int = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Math.round(x)));
  return (
    <div className="grid2">
      <NumField label="Сдвиг слоя на пороге" value={v.shiftChance * 100} min={0} max={100} step={5} digits={0} suffix="%" title="Шанс, что порог сдвигает слой W (комнаты разных слоёв занимают одно место в 3D)" onChange={(x) => set((w) => (w.shiftChance = pct(x)), 'shift')} />
      <NumField label="Сдвиг до, слоёв" value={v.maxShift} min={0} max={64} step={1} digits={0} title="Наибольший сдвиг W на одном пороге" onChange={(x) => set((w) => (w.maxShift = int(x, 0, 64)), 'maxShift')} />
      <NumField label="Без пересечений, дверей" value={v.localRadius} min={1} max={16} step={1} digits={0} title="Комнаты в пределах стольких дверей друг от друга не пересекаются в 3D (1 — только соседи по порогу: нужно физике на пороге)" onChange={(x) => set((w) => (w.localRadius = int(x, 1, 16)), 'radius')} />
      <NumField label="4D-складки не ближе" value={v.localM} min={0} max={100} step={1} digits={1} suffix="м" title="Комнаты, занимающие одно место в 3D (разные слои W), не ближе стольких метров пути друг от друга: в этом радиусе мир — обычный трёхмерный, складку не заметить. 0 — без проверки (складки хоть за соседней дверью); больше — реже «невозможные» места, но квартиры мельче и выходов меньше: не каждой комнате находится место (без проверки — 8.9 комнаты и 7.5 выхода в квартире, 3 м — 8.1 и 6.3, 6 м — 7.3 и 5.4). Если за выходом иначе ничего не встаёт, вход новой квартиры ставится ближе — мир не упирается в стену" onChange={(x) => set((w) => (w.localM = Math.min(100, Math.max(0, x))), 'localM')} />
      <NumField label="Слоёв W до" value={v.maxLayer} min={0} max={1000} step={10} digits={0} title="Наибольший |W|" onChange={(x) => set((w) => (w.maxLayer = int(x, 0, 1000)), 'layers')} />
      <NumField label="Предел обзора" value={v.sightM} min={0} max={200} step={0.5} digits={1} suffix="м" title="Линии обзора по порталам не длиннее (0 — без предела); «давящее» пространство квартир. Ходы и хабы подвала им не ограничены" onChange={(x) => set((w) => (w.sightM = Math.max(0, x)), 'sight')} />
      <NumField label="Вперёд дверей" value={v.aheadDoors} min={0} max={16} step={1} digits={0} title="На сколько дверей вперёд мир строится заранее (подвал; квартиры строятся целиком)" onChange={(x) => set((w) => (w.aheadDoors = int(x, 0, 16)), 'ahead')} />
    </div>
  );
}

function BiomeFields(props: { b: Biome; p: Project; tags: string[]; onChange: (fn: (b: Biome) => void, key?: string) => void; onRemove: () => void }) {
  const { b, p, tags, onChange } = props;
  const w = p.world;
  const fname = (id: string) => p.finishes?.find((f) => f.id === id)?.name ?? `${id} (нет в проекте)`;
  const free = tags.filter((t) => !b.tags.some((x) => x.tag === t));
  const tunnels = isTunnels(b);
  const own = tunnels ? !!b.tunnels : !!b.apartments;
  return (
    <div className="pn-biome-body">
      <div className="row" style={{ gap: 6 }}>
        <div className="grow">
          <TextField label="Название" value={b.name} onChange={(v) => onChange((x) => (x.name = v), 'name')} />
        </div>
        <ColorField value={b.color} onChange={(v) => onChange((x) => (x.color = v), 'color')} title="Цвет на плане и в HUD" />
      </div>
      <Check
        label="богатая квартира"
        value={!!b.rich}
        onChange={(v) => onChange((x) => (v ? (x.rich = true) : delete x.rich))}
        title="Сюда ведёт часть переходов; элитность с усилением; стартом и «другим биомом» не бывает"
      />
      <Check
        label="подвал: сеть ходов"
        value={tunnels}
        onChange={(v) => onChange((x) => (v ? (x.layout = 'tunnels') : delete x.layout))}
        title="Растёт не квартирами, а ходами на ходу (параметры — «Подвал: сеть ходов» выше): нужны куски ходов с тегами «ход», «поворот», «развилка», «хаб»"
      />
      <Check
        label="свои параметры генератора"
        value={own}
        onChange={(v) =>
          onChange((x) => {
            // включить — копия действующих (общих), дальше правятся у биома
            if (tunnels) {
              if (!v) delete x.tunnels;
              else fullTun(w, x);
            } else if (!v) delete x.apartments;
            else fullApt(w, x);
          })
        }
        title={tunnels ? 'Свои параметры ходов этого подвала поверх общих («Подвал: сеть ходов»)' : 'Свои параметры квартир этого биома поверх общих («Квартиры»)'}
      />
      {own && tunnels && <TunFields v={tunOf(w, b.id)} rooms={p.rooms} set={(fn, k) => onChange((x) => fn(fullTun(w, x)), `tun-${k}`)} />}
      {own && !tunnels && <AptFields v={aptOf(w, b.id)} set={(fn, k) => onChange((x) => fn(fullApt(w, x)), `apt-${k}`)} />}
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
            <NumField value={t.mul} min={0} max={100} step={0.1} digits={2} suffix="×" title={`Множитель веса комнат с тегом «${t.tag}»`} onChange={(v) => onChange((x) => (x.tags[ti].mul = Math.max(0, v)), `tag-${t.tag}`)} />
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
      <TextField label="Заметка" value={b.note} onChange={(v) => onChange((x) => (x.note = v), 'note')} />
      <Btn sm variant="danger" onClick={props.onRemove} title="Удалить биом">
        удалить биом
      </Btn>
    </div>
  );
}

/** Свои параметры биома — полной копией действующих (в сохранении могут быть не все поля). */
function fullTun(w: WorldSettings, b: Biome): TunnelSettings {
  const t = tunOf(w, b.id);
  b.tunnels = { ...t, hubEvery: [...t.hubEvery], ringLen: [...t.ringLen], loopLen: [...t.loopLen], pieceWeights: { ...t.pieceWeights } };
  return b.tunnels as TunnelSettings;
}
function fullApt(w: WorldSettings, b: Biome): ApartmentSettings {
  const a = aptOf(w, b.id);
  b.apartments = { ...a, clusterRooms: [...a.clusterRooms], clusterExits: [...a.clusterExits] };
  return b.apartments as ApartmentSettings;
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
