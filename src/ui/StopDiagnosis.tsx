// «Почему карта не набрала нужное число комнат» — понятные причины остановки роста и кнопки
// исправления. Используется в сводке прогона (генератор) и в симуляции (спавн).
import { useMemo } from 'react';
import type { Project, RunStop } from '../model/types';
import { mutate } from '../model/store';
import { notify, setUI } from '../model/ui';
import { missingPresets, outdatedPresets, updatePresets } from '../model/mergePresets';
import { Btn } from './kit';

/** Сводка причин по одному или нескольким прогонам. maxRooms: roomId → сколько раз упирались. */
export interface StopAgg {
  runs: number;
  failed: number;
  reached: number;
  target: number;
  noSpace: number;
  atMax: number;
  sight: number;
  noMatch: number;
  maxRooms: Record<string, number>;
  noMatchTags: string[];
}

export function aggStops(stops: (RunStop | undefined)[], reached: number[], target: number): StopAgg {
  const a: StopAgg = { runs: stops.length, failed: 0, reached: 0, target, noSpace: 0, atMax: 0, sight: 0, noMatch: 0, maxRooms: {}, noMatchTags: [] };
  const tags = new Set<string>();
  stops.forEach((s, i) => {
    a.reached += reached[i] ?? 0;
    if (!s) return;
    a.failed++;
    a.noSpace += s.noSpace;
    a.atMax += s.atMax;
    a.sight += s.sight;
    a.noMatch += s.noMatch;
    for (const id of s.maxRooms) a.maxRooms[id] = (a.maxRooms[id] ?? 0) + 1;
    for (const t of s.noMatchTags) tags.add(t);
  });
  a.reached /= Math.max(1, stops.length);
  a.noMatchTags = [...tags];
  return a;
}

export function StopDiagnosis({ p, agg }: { p: Project; agg: StopAgg }) {
  const presetState = useMemo(() => {
    const m = missingPresets(p);
    return { missing: m.rooms + m.props + m.finishes, outdated: outdatedPresets(p) };
  }, [p, agg]);
  if (!agg.failed) return null;

  const total = agg.noSpace + agg.atMax + agg.sight + agg.noMatch || 1;
  const reasons = [
    { k: 'atMax', n: agg.atMax, color: 'var(--accent)', label: 'подходящие комнаты упёрлись в «макс»' },
    { k: 'noSpace', n: agg.noSpace, color: 'var(--danger)', label: 'за проёмом нет места' },
    { k: 'sight', n: agg.sight, color: 'var(--blue)', label: 'мешает предел обзора' },
    { k: 'noMatch', n: agg.noMatch, color: 'var(--muted)', label: 'нет совместимых комнат' },
  ].filter((r) => r.n > 0);

  const capped = Object.entries(agg.maxRooms)
    .sort((a, b) => b[1] - a[1])
    .map(([id, n]) => ({ room: p.rooms.find((r) => r.id === id), n }))
    .filter((x) => x.room);

  const raiseMax = () => {
    const ids = new Set(capped.map((x) => x.room!.id));
    mutate((pp) => {
      for (const r of pp.rooms)
        if (ids.has(r.id)) {
          r.unique = false;
          r.gen.max = Math.max(r.gen.max, 99);
        }
    });
    notify(`«Макс» поднят до 99 у ${ids.size} комнат`, 'ok');
  };
  const setSight = (v: number) => mutate((pp) => (pp.generator.sightM = v));
  const update = () => {
    if (!confirm('Обновить пресеты до последней версии? Пресетные комнаты заменятся свежими (ваши правки в них потеряются), свои комнаты останутся. Ctrl+Z — отменить.')) return;
    mutate((pp) => updatePresets(pp));
    setUI({ run: null, runInst: null, selection: null });
    notify('Пресеты обновлены', 'ok');
  };

  return (
    <div className="stopdx">
      <div className="stopdx-h">
        Почему {agg.runs > 1 ? `в ${agg.failed} из ${agg.runs} прогонов ` : ''}не набрано {agg.target}
        {agg.runs === 1 ? ` (есть ${Math.round(agg.reached)})` : ` (в среднем ${agg.reached.toFixed(1)})`}
      </div>
      <div className="hint">Карта растёт только через свободные проёмы. Когда ни в один не встаёт комната, рост останавливается. Причины по тупикам:</div>
      <div className="stopdx-bar">
        {reasons.map((r) => (
          <span key={r.k} style={{ flex: r.n, background: r.color }} title={`${r.label}: ${r.n}`} />
        ))}
      </div>
      {reasons.map((r) => (
        <div key={r.k} className="stopdx-row">
          <span className="swatch" style={{ background: r.color }} />
          <span className="grow">{r.label}</span>
          <span className="mono">{Math.round((100 * r.n) / total)}%</span>
        </div>
      ))}

      {capped.length > 0 && (
        <div className="stopdx-fix">
          <div>
            Упёрлись в «макс»:{' '}
            {capped.slice(0, 8).map((x, i) => (
              <span key={x.room!.id}>
                {i > 0 && ', '}
                <a onClick={() => setUI({ page: 'editor', roomId: x.room!.id })}>{x.room!.name}</a>
                <span className="muted"> (макс {x.room!.unique ? 1 : x.room!.gen.max})</span>
              </span>
            ))}
            {capped.length > 8 && ` и ещё ${capped.length - 8}`}
          </div>
          <Btn sm variant="primary" onClick={raiseMax}>
            Поднять им «макс» до 99
          </Btn>
          <div className="hint">Чтобы комнат было меньше, снижайте вес, а не «макс»: «макс» у проходных комнат обрывает рост карты.</div>
        </div>
      )}
      {agg.sight > 0 && (
        <div className="stopdx-fix">
          <div>Предел обзора {p.generator.sightM} м отсекает кандидатов.</div>
          <div className="row">
            <Btn sm onClick={() => setSight(12)}>12 м</Btn>
            <Btn sm onClick={() => setSight(0)}>без предела</Btn>
          </div>
        </div>
      )}
      {agg.noSpace > 0 && (
        <div className="hint">
          «Нет места» — за проёмом стоят соседние комнаты. Помогают комнаты-развилки (коридоры, тамбуры, холлы) с выходами в разные стороны.
        </div>
      )}
      {agg.noMatchTags.length > 0 && (
        <div className="hint">Для меток {agg.noMatchTags.map((t) => `«${t}»`).join(', ')} в пуле нет совместимых комнат.</div>
      )}
      {(presetState.missing > 0 || presetState.outdated > 0) && (
        <div className="stopdx-fix">
          <div>
            Проект собран на старых пресетах (новых комнат: {presetState.missing}, изменённых: {presetState.outdated}). В новых
            пресетах площадки выходят в поэтажные коридоры, а коридоров, тамбуров и холлов для роста больше.
          </div>
          <Btn sm variant="primary" onClick={update}>
            Обновить пресеты…
          </Btn>
        </div>
      )}
    </div>
  );
}
