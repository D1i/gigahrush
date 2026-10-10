// Шкала-ползунок бестиария: линейка с делениями, засечка «по умолчанию», заливка от засечки до значения (видно, насколько
// ручку увели от заводской). Одна стрелка — число, две — пара [от, до] (стрелки не переходят друг через друга).
// Единицы — те, что показаны (проценты уже умножены); округление по шагу — здесь.

const pos = (v: number, min: number, max: number) => (max > min ? Math.min(100, Math.max(0, ((v - min) / (max - min)) * 100)) : 0);
const snap = (v: number, min: number, step: number) => +(min + Math.round((v - min) / step) * step).toFixed(6);

export function Scale(props: {
  min: number;
  max: number;
  step: number;
  /** одна стрелка — [v], пара — [от, до] */
  value: readonly number[];
  /** засечки «по умолчанию» (по числу стрелок) */
  def: readonly number[];
  onChange: (i: number, v: number) => void;
  label: string;
}) {
  const { min, max, step, value, def } = props;
  const pair = value.length === 2;
  const changed = value.some((v, i) => Math.abs(v - def[i]) > 1e-9);
  // заливка: одна стрелка — от засечки до стрелки; пара — сам диапазон [от, до]
  const a = pair ? value[0] : Math.min(value[0], def[0]);
  const b = pair ? value[1] : Math.max(value[0], def[0]);
  const f0 = pos(a, min, max), f1 = pos(b, min, max);
  return (
    <div className={'bst-scale' + (pair ? ' pair' : '') + (changed ? ' moved' : '')}>
      {/* рельс — с отступом в полстрелки: проценты рельса совпадают с ходом стрелки ползунка */}
      <div className="bst-scale-rail" aria-hidden>
        <div className="bst-scale-track">
          <div className="bst-scale-fill" style={{ left: `${f0}%`, width: `${Math.max(0, f1 - f0)}%` }} />
        </div>
        {def.map((d, i) => (
          <div key={i} className="bst-scale-def" style={{ left: `${pos(d, min, max)}%` }} />
        ))}
      </div>
      {value.map((v, i) => (
        <input
          key={i}
          type="range"
          className="bst-range"
          min={min}
          max={max}
          step={step}
          value={v}
          aria-label={pair ? `${props.label}, ${i ? 'до' : 'от'}` : props.label}
          onChange={(e) => {
            let x = Math.min(max, snap(Math.min(max, Math.max(min, parseFloat(e.target.value))), min, step));
            // пара: стрелки не переходят друг через друга
            if (pair) x = i === 0 ? Math.min(x, value[1]) : Math.max(x, value[0]);
            if (Number.isFinite(x) && x !== v) props.onChange(i, x);
          }}
        />
      ))}
    </div>
  );
}
