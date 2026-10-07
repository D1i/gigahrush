// Секция инспектора «Спец-локация»: вид локации комнаты и параметры «Бесконечной лестницы»
// (механика — src/locations/stairwell.ts, правила и формулы — docs/LOCATIONS.md).
import type { LocationSpec, Room, StairwellSpec } from '../model/types';
import { grabTime, LOCATION_KINDS, newStairwell, STAIRWELL_LIMITS, stairwellRule } from '../locations/stairwell';
import { newLift } from '../locations/lift';
import { newLair } from '../locations/lair';
import { NumField, Section, Select } from '../ui/kit';
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
      ) : loc ? (
        <div className="hint">TODO(логика лифта): поля «{loc.kind}»</div>
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
