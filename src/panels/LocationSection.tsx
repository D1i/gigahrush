// Секция инспектора «Спец-локация»: вид локации комнаты и параметры «Бесконечной лестницы», «Ржавого лифта»,
// «Логова босса» и финала «Болото на крыше» (механика — src/locations/, правила и формулы — docs/LOCATIONS.md).
import type { HangarSpec, LairSpec, LiftSpec, LocationSpec, Room, StairwellSpec, SwampSpec } from '../model/types';
import { grabTime, LOCATION_KINDS, newStairwell, STAIRWELL_LIMITS, stairwellRule } from '../locations/stairwell';
import { LIFT_FLOOR_M, LIFT_LIMITS, LIFT_PUMP_RATE, liftRule, newLift } from '../locations/lift';
import { lairSign, newLair } from '../locations/lair';
import { newSwamp, swampRule } from '../locations/swampEnd';
import { hangarBossSign, hangarRule, newHangar } from '../locations/hangar';
import { newHatch, newSnowDoor } from '../locations/storyDoors';
import { NumField, Section, Select, TextField } from '../ui/kit';
import { mutRoom } from './util';

type Kind = 'none' | LocationSpec['kind'];

const NEW: Record<LocationSpec['kind'], () => LocationSpec> = { stairwell: newStairwell, lift: newLift, lair: newLair, hangar: newHangar, swamp: newSwamp,
  // переходы сюжета (src/game/story.ts): параметров в инспекторе нет — по умолчанию
  hatch: newHatch, snowdoor: newSnowDoor };

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
      ) : loc?.kind === 'hangar' ? (
        <HangarFields room={room} spec={loc} />
      ) : loc?.kind === 'swamp' ? (
        <SwampFields room={room} spec={loc} />
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

type LiftRangeKey = 'floorsUp' | 'floorsDown' | 'boardPumpS';
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
  const avgDown = (spec.floorsDown[0] + spec.floorsDown[1]) / 2;
  // досок за подъём от самого низа до верха: первая (boardFirst) + по шансу на остальных пролётах
  const climb = avgFloors + avgDown;
  const boards = spec.boardFirst ? 1 + Math.max(0, climb - 1) * spec.boardChance : climb * spec.boardChance;
  return (
    <>
      <div className="grid2">
        {pct('Клетка (иначе каретка)', 'cageChance', 'Вероятность, что экземпляр — клетка: бьётся о стены и не сбрасывает; иначе открытая каретка — сбрасывает в шахту')}
        {pct('Логово за выходом', 'lairChance', 'Вероятность, что за одним из выходов лифта (на одном из этажей) — логово босса')}
      </div>
      <div className="grid2">
        <Range
          label="Этажей вверх"
          value={spec.floorsUp}
          lim={L.floorsUp}
          int
          title="Ход вверх: сколько этажей над входом; на каждом — выходы прямо и направо"
          onChange={setRange('floorsUp', true)}
        />
        <Range
          label="Этажей вниз"
          value={spec.floorsDown}
          lim={L.floorsDown}
          int
          title="Ход вниз: сколько этажей под входом (0 — вниз не ездит); на каждом — выходы прямо и направо"
          onChange={setRange('floorsDown', true)}
        />
      </div>
      <div className="hint">
        Высота шахты — от {spec.floorsDown[0]}–{spec.floorsDown[1]} эт. под входом до {spec.floorsUp[0]}–{spec.floorsUp[1]} над ним
        (этаж {LIFT_FLOOR_M} м). Вид, число этажей и где логово (этаж выше или ниже входа и выход) разыгрываются для каждого
        экземпляра лифта. Смерть — новая попытка: доски падают на других пролётах.
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
      <label className="check" title="Первая поездка вверх в каждой попытке не обходится без доски — на первом же пролёте; дальше — по шансу">
        <input type="checkbox" checked={spec.boardFirst} onChange={(e) => upd('boardFirst', (s) => (s.boardFirst = e.target.checked))} />
        Первый подъём — доска всегда
      </label>
      <div className="hint">
        Этаж ({LIFT_FLOOR_M} м) кабина проходит за <b className="mono">{(LIFT_FLOOR_M / spec.speed).toFixed(1)} с</b>; досок за подъём от
        низа до верха — в среднем <b className="mono">{boards.toFixed(1)}</b>. При спуске досок нет.
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

function HangarFields({ room, spec }: { room: Room; spec: HangarSpec }) {
  const upd = (key: string, fn: (s: HangarSpec) => void) =>
    mutRoom(room.id, (r) => {
      if (r.location?.kind === 'hangar') fn(r.location);
    }, { key: `room-loc-${key}:${room.id}` });
  const range = (key: 'hits' | 'floorsDown', i: 0 | 1, v: number, lo: number, hi: number) =>
    upd(key, (s) => {
      const a: [number, number] = [s[key][0], s[key][1]];
      a[i] = Math.min(hi, Math.max(lo, Math.round(v)));
      s[key] = a[0] <= a[1] ? a : [a[1], a[0]];
    });
  return (
    <>
      <Range label="Ударов по подтаявшему снегу" value={spec.hits} lim={[1, 30]} int title="Сколько раз ударить (E) по пятну, чтобы провалиться в ангар" onChange={(i, v) => range('hits', i, v, 1, 30)} />
      <Range label="Ворота ангара — этажей ниже" value={spec.floorsDown} lim={[1, 50]} int title="На сколько этажей ниже комната за воротами ангара (ангар — под снегом)" onChange={(i, v) => range('floorsDown', i, v, 1, 50)} />
      <TextField
        label="Мини-босс (id для движка)"
        value={spec.boss}
        placeholder="пусто — «здесь будет мини-босс»"
        onChange={(v) => upd('boss', (s) => (s.boss = v.slice(0, 64)))}
      />
      <NumField
        label="Темнота цеха"
        value={Math.round(spec.darkness * 100)}
        min={0}
        max={100}
        step={5}
        digits={0}
        suffix="%"
        title="0 — светло; 100% — только лампы и печь"
        onChange={(v) => upd('dark', (s) => (s.darkness = v / 100))}
      />
      <div className="hint">
        В снежных ходах — «Подтаявшая берлога» (хаб сети: через 60–150 м ползком). Сцена ангара открывается не при входе, а
        когда пятно в полу пробито: падение сквозь крышу в кучу мусора; ворота цеха — выход (этажом ниже; есть биом «Завод» —
        в его хаб).
      </div>
      <div className="pn-loc-rule">
        <b>Правило для игрока.</b> {hangarRule(spec)} <b>Табличка.</b> {hangarBossSign(spec)}
      </div>
    </>
  );
}

function SwampFields({ room, spec }: { room: Room; spec: SwampSpec }) {
  const upd = (key: string, fn: (s: SwampSpec) => void) =>
    mutRoom(room.id, (r) => {
      if (r.location?.kind === 'swamp') fn(r.location);
    }, { key: `room-loc-${key}:${room.id}` });
  return (
    <>
      <NumField
        label="Шестерня: зуб за"
        value={spec.toothS}
        min={0.5}
        max={30}
        step={0.1}
        digits={1}
        suffix="с"
        title="За сколько секунд огромная шестерня проворачивается на один зуб (рывком), пока игрок ходит по крыше"
        onChange={(v) => upd('tooth', (s) => (s.toothS = Math.min(30, Math.max(0.5, v))))}
      />
      <Range
        label="Номер части"
        value={spec.unit}
        lim={[1, 99999]}
        int
        title="Номер войсковой части на воротах — случайное целое в диапазоне (по сиду мира)"
        onChange={(i, v) => upd('unit', (s) => {
          s.unit[i] = Math.round(v);
          if (s.unit[0] > s.unit[1]) s.unit = [s.unit[1], s.unit[0]];
        })}
      />
      <NumField
        label="Темнота крыши"
        value={Math.round(spec.darkness * 100)}
        min={0}
        max={100}
        step={5}
        digits={0}
        suffix="%"
        title="0 — светлее (луна и туман), 100% — почти ночь"
        onChange={(v) => upd('dark', (s) => (s.darkness = v / 100))}
      />
      <div className="hint">
        Финал игры. Само не растёт по весу: в биоме «Завод» эту комнату ставит правило влажности — когда мокрый ход дошёл до
        болота. Вход — метка factory (проход цеха 2 м).
      </div>
      <div className="pn-loc-rule">
        <b>Правило для игрока.</b> {swampRule(spec)}
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
