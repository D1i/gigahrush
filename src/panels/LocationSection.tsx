// Секция инспектора «Спец-локация»: вид локации комнаты и параметры «Бесконечной лестницы», «Ржавого лифта»
// и «Логова босса» (механика — src/locations/, правила и формулы — docs/LOCATIONS.md).
import type { LairSpec, LiftSpec, LocationSpec, Room, StairwellSpec } from '../model/types';
import { grabTime, LOCATION_KINDS, newStairwell, STAIRWELL_LIMITS, stairwellRule } from '../locations/stairwell';
import { LIFT_FLOOR_M, LIFT_LIMITS, LIFT_PUMP_RATE, liftRule, newLift } from '../locations/lift';
import { lairSign, newLair } from '../locations/lair';
import { NumField, Section, Select, TextField } from '../ui/kit';
import { mutRoom } from './util';

type Kind = 'none' | LocationSpec['kind'];

const NEW: Record<LocationSpec['kind'], () => LocationSpec> = { stairwell: newStairwell, lift: newLift, lair: newLair };

export function LocationSection({ room }: { room: Room }) {
  const loc = room.location ?? null;
  const setKind = (k: Kind) =>
    mutRoom(room.id, (r) => {
      if (k === 'none') delete r.location;
      else if (r.location?.kind !== k) r.location = NEW[k]();
    });
  return (
    <Section title="Спец-локация">
      <Select<Kind>
        label="Вид"
        value={loc ? loc.kind : 'none'}
        options={[{ value: 'none', label: 'нет — обычная комната' }, ...LOCATION_KINDS.map((k) => ({ value: k.kind, label: k.name }))]}
        onChange={setKind}
      />
      {loc?.kind === 'stairwell' ? (
        <StairwellFields room={room} spec={loc} />
      ) : loc?.kind === 'lift' ? (
        <LiftFields room={room} spec={loc} />
      ) : loc?.kind === 'lair' ? (
        <LairFields room={room} spec={loc} />
      ) : (
        <div className="hint">
          Вход в такую комнату переводит игрока в особую сцену со своей механикой. В плане генератора это обычная комната
          (метки и стыковка — как у всех), сцену ведёт движок.
        </div>
      )}
    </Section>
  );
}

type RangeKey = 'sounds' | 'interval' | 'floorsDown';

function StairwellFields({ room, spec }: { room: Room; spec: StairwellSpec }) {
  const L = STAIRWELL_LIMITS;
  const upd = (key: string, fn: (s: StairwellSpec) => void) =>
    mutRoom(room.id, (r) => {
      if (r.location?.kind === 'stairwell') fn(r.location);
    }, { key: `room-loc-${key}:${room.id}` });
  // диапазон [мин, макс]: правка одного конца тянет другой, чтобы мин ≤ макс
  const setRange = (k: RangeKey, int: boolean) => (i: 0 | 1, v: number) =>
    upd(`${k}${i}`, (s) => {
      const x = int ? Math.round(v) : v;
      s[k][i] = x;
      if (s[k][0] > s[k][1]) s[k][1 - i] = x;
    });
  const tg = grabTime(spec);
  return (
    <>
      <Range
        label="Звуков подряд, чтобы выйти"
        value={spec.sounds}
        lim={L.sounds}
        int
        title="Сколько страшных звуков подряд надо пережить"
        onChange={setRange('sounds', true)}
      />
      <div className="hint">
        Число разыгрывается для каждого экземпляра из диапазона. Смерть — новая попытка: счёт с нуля, расписание звуков другое.
      </div>
      <Range
        label="Пауза между звуками"
        value={spec.interval}
        lim={L.interval}
        step={1}
        digits={1}
        suffix="с"
        title="Тишина до следующего звука, с"
        onChange={setRange('interval', false)}
      />
      <div className="hint">
        Отсчёт идёт, только пока игрок спускается: первый звук — не раньше, чем он сошёл на этаж ниже входа; следующий — когда
        после подъёма снова спустился до этажа, где застал прошлый звук.
      </div>
      <div className="grid2">
        <NumField
          label="Время до захвата (база)"
          value={spec.grabS}
          min={L.grabS[0]}
          max={L.grabS[1]}
          step={0.5}
          digits={1}
          suffix="с"
          title="За сколько секунд Хвататель дошёл бы до игрока без ускорения"
          onChange={(v) => upd('grab', (s) => (s.grabS = v))}
        />
        <NumField
          label="Ускорение"
          value={spec.accelS}
          min={L.accelS[0]}
          max={L.accelS[1]}
          step={0.5}
          digits={1}
          suffix="с"
          title="Темп подхода растёт как (1 + t / ускорение): меньше — быстрее разгоняется"
          onChange={(v) => upd('accel', (s) => (s.accelS = v))}
        />
      </div>
      <div className="hint">
        Стоять на месте после звука — схватит через <b className="mono">{tg.toFixed(1)} с</b> (t* = a·(√(1 + 2g/a) − 1), g — база,
        a — ускорение). Подняться на этаж (≈ 2.8 м по двум маршам) бегом — 3–4 с, шагом — 5–6 с.
      </div>
      <Range
        label="Выводит ниже, этажей"
        value={spec.floorsDown}
        lim={L.floorsDown}
        int
        title="На сколько этажей ниже выводит разомкнутая лестница"
        onChange={setRange('floorsDown', true)}
      />
      <NumField
        label="Темнота"
        value={Math.round(spec.darkness * 100)}
        min={0}
        max={100}
        step={5}
        digits={0}
        suffix="%"
        title="0 — светло; 100% — свет только от фонарика"
        onChange={(v) => upd('dark', (s) => (s.darkness = v / 100))}
      />
      <div className="pn-loc-rule">
        <b>Правило для игрока.</b> {stairwellRule(spec)}
      </div>
    </>
  );
}

type LiftRangeKey = 'floorsUp' | 'boardPumpS';
type LiftPctKey = 'cageChance' | 'lairChance' | 'boardChance' | 'darkness';

function LiftFields({ room, spec }: { room: Room; spec: LiftSpec }) {
  const L = LIFT_LIMITS;
  const upd = (key: string, fn: (s: LiftSpec) => void) =>
    mutRoom(room.id, (r) => {
      if (r.location?.kind === 'lift') fn(r.location);
    }, { key: `room-loc-${key}:${room.id}` });
  // диапазон [мин, макс]: правка одного конца тянет другой, чтобы мин ≤ макс
  const setRange = (k: LiftRangeKey, int: boolean) => (i: 0 | 1, v: number) =>
    upd(`${k}${i}`, (s) => {
      const x = int ? Math.round(v) : v;
      s[k][i] = x;
      if (s[k][0] > s[k][1]) s[k][1 - i] = x;
    });
  // доли 0..1 — в процентах
  const pct = (label: string, key: LiftPctKey, title: string) => (
    <NumField
      label={label}
      value={Math.round(spec[key] * 100)}
      min={0}
      max={100}
      step={5}
      digits={0}
      suffix="%"
      title={title}
      onChange={(v) => upd(key, (s) => (s[key] = v / 100))}
    />
  );
  // стоять на месте: от удара (boardKick) раскачка растёт на LIFT_PUMP_RATE долей предела в секунду, пока качает доска
  const toLimit = spec.boardKick >= 1 ? 0 : (1 - spec.boardKick) / LIFT_PUMP_RATE;
  const reaches = toLimit <= spec.boardPumpS[1];
  const avgFloors = (spec.floorsUp[0] + spec.floorsUp[1]) / 2;
  return (
    <>
      <div className="grid2">
        {pct('Клетка (иначе каретка)', 'cageChance', 'Вероятность, что экземпляр — клетка: бьётся о стены и не сбрасывает; иначе открытая каретка — сбрасывает в шахту')}
        {pct('Логово за выходом', 'lairChance', 'Вероятность, что за одним из выходов лифта (на одном из этажей) — логово босса')}
      </div>
      <Range
        label="Этажей с выходами над входом"
        value={spec.floorsUp}
        lim={L.floorsUp}
        int
        title="Сколько этажей над входом; на каждом — выходы прямо и направо"
        onChange={setRange('floorsUp', true)}
      />
      <div className="hint">
        Вид, число этажей и где логово (этаж и выход) разыгрываются для каждого экземпляра лифта. Смерть — новая попытка: доски
        падают на других пролётах.
      </div>
      <div className="grid2">
        <NumField
          label="Скорость кабины"
          value={spec.speed}
          min={L.speed[0]}
          max={L.speed[1]}
          step={0.1}
          digits={2}
          suffix="м/с"
          title="Скорость кабины в шахте"
          onChange={(v) => upd('speed', (s) => (s.speed = v))}
        />
        {pct('Доска на пролёте', 'boardChance', 'Вероятность, что на пролёте вверх между соседними этажами упадёт доска (не больше одной на пролёт за попытку)')}
      </div>
      <div className="hint">
        Этаж ({LIFT_FLOOR_M} м) кабина проходит за <b className="mono">{(LIFT_FLOOR_M / spec.speed).toFixed(1)} с</b>; досок за подъём до
        верха — в среднем <b className="mono">{(avgFloors * spec.boardChance).toFixed(1)}</b>. При спуске досок нет.
      </div>
      <div className="grid2">
        <NumField
          label="Удар доски"
          value={Math.round(spec.boardKick * 100)}
          min={L.boardKick[0] * 100}
          max={L.boardKick[1] * 100}
          step={5}
          digits={0}
          suffix="%"
          title="Начальная амплитуда крена от удара, % предела (100% — сразу предел)"
          onChange={(v) => upd('kick', (s) => (s.boardKick = v / 100))}
        />
        <NumField
          label="Период качания"
          value={spec.swingPeriod}
          min={L.swingPeriod[0]}
          max={L.swingPeriod[1]}
          step={0.5}
          digits={1}
          suffix="с"
          title="Период качания кабины: меньше — чаще перебегать"
          onChange={(v) => upd('period', (s) => (s.swingPeriod = v))}
        />
      </div>
      <Range
        label="Доска качает"
        value={spec.boardPumpS}
        lim={L.boardPumpS}
        step={0.5}
        digits={1}
        suffix="с"
        title="Сколько секунд застрявшая доска раскачивает лифт, прежде чем выпасть"
        onChange={setRange('boardPumpS', false)}
      />
      <div className="hint">
        Стоять на месте: крен дойдёт до предела через <b className="mono">≈ {toLimit.toFixed(1)} с</b> после удара
        {reaches ? ' — доска качает дольше, каретку сбросит' : ' — доска выпадет раньше'}. Гасит только бег на верхний край (вес на
        нижнем раскачивает): перебегать каждые полпериода, ≈ {(spec.swingPeriod / 2).toFixed(1)} с.
      </div>
      {pct('Темнота', 'darkness', '0 — светло; 100% — свет только от фонарика')}
      <div className="pn-loc-rule">
        <b>Правило для игрока.</b> {liftRule(spec)}
      </div>
    </>
  );
}

function LairFields({ room, spec }: { room: Room; spec: LairSpec }) {
  const upd = (key: string, fn: (s: LairSpec) => void) =>
    mutRoom(room.id, (r) => {
      if (r.location?.kind === 'lair') fn(r.location);
    }, { key: `room-loc-${key}:${room.id}` });
  return (
    <>
      <TextField
        label="Босс (id для движка)"
        value={spec.boss}
        placeholder="пусто — «здесь будет босс»"
        onChange={(v) => upd('boss', (s) => (s.boss = v.slice(0, 64)))}
      />
      <NumField
        label="Темнота"
        value={Math.round(spec.darkness * 100)}
        min={0}
        max={100}
        step={5}
        digits={0}
        suffix="%"
        title="0 — светло; 100% — свет только от фонарика"
        onChange={(v) => upd('dark', (s) => (s.darkness = v / 100))}
      />
      <div className="hint">
        Заглушка: боссов пока нет. Само не растёт — ставится только за выходом лифта, где по розыгрышу логово (вес роста — 0).
        Нужна метка corridor 1.3 м: через неё приходят из кабины.
      </div>
      <div className="pn-loc-rule">
        <b>Табличка.</b> {lairSign(spec)}
      </div>
    </>
  );
}

function Range(props: {
  label: string;
  value: [number, number];
  lim: readonly [number, number];
  int?: boolean;
  step?: number;
  digits?: number;
  suffix?: string;
  title: string;
  onChange: (i: 0 | 1, v: number) => void;
}) {
  const f = (i: 0 | 1) => (
    <div className="grow">
      <NumField
        value={props.value[i]}
        min={props.lim[0]}
        max={props.lim[1]}
        step={props.step ?? 1}
        digits={props.int ? 0 : props.digits ?? 1}
        suffix={props.suffix}
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
