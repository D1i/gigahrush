// Сводка прогона (левая колонка генератора): счётчики, предупреждения, итоги по предметам,
// распределение по тирам, опасность.
import { useMemo } from 'react';
import type { Project, Run } from '../model/types';
import { Section } from '../ui/kit';
import { StopDiagnosis, aggStops } from '../ui/StopDiagnosis';
import { isCurrency, itemById, layerColor, wText } from './util';
import { normFold, validateFoldRun } from '../gen4d/fold';
import { isFoldRun } from './genMode';

export function RunSummary({ p, run }: { p: Project; run: Run }) {
  const totals = useMemo(() => {
    const rows = Object.entries(run.totals)
      .filter(([, n]) => n > 0)
      .map(([id, n]) => ({ id, n, item: itemById(p, id), cur: isCurrency(p, id) }));
    // валюты — первыми, дальше по убыванию количества
    rows.sort((a, b) => Number(b.cur) - Number(a.cur) || b.n - a.n);
    return rows;
  }, [run, p.items]);

  const tiers = useMemo(() => {
    const cnt = new Map<string | null, number>();
    for (const c of run.content) cnt.set(c.tierId, (cnt.get(c.tierId) ?? 0) + 1);
    const out: { id: string | null; name: string; color: string; level: number; n: number }[] = [
      { id: null, name: 'базовая', color: '#8d887c', level: 0, n: cnt.get(null) ?? 0 },
    ];
    for (const t of [...p.economy.tiers].sort((a, b) => a.level - b.level)) {
      out.push({ id: t.id, name: t.name, color: t.color, level: t.level, n: cnt.get(t.id) ?? 0 });
    }
    return out;
  }, [run, p.economy.tiers]);

  // складчатый прогон: независимая проверка гарантий
  const fold = isFoldRun(run);
  const foldErrs = useMemo(() => {
    if (!fold) return null;
    try {
      return validateFoldRun(p, run);
    } catch (e: any) {
      return ['Проверка не выполнилась: ' + String(e?.message ?? e)];
    }
  }, [run]);

  const limit = p.economy.dangerLimit;
  const sightLimit = run.settings.sightM ?? 0;
  const maxAcc = run.content.reduce((m, c) => Math.max(m, c.dangerAcc), 0);
  const over = limit > 0 ? run.content.filter((c) => c.dangerAcc > limit).length : 0;
  const totalRooms = Math.max(1, run.content.length);

  return (
    <>
      <Section title={`Прогон «${run.seed}»`}>
        <div className="pv-stats">
          <div className="stat">
            <span className="v">{run.instances.length}</span>
            <span className="k">экземпляров</span>
          </div>
          <div className="stat">
            <span className="v">{run.links.length}</span>
            <span className="k">связей</span>
          </div>
          <div className="stat">
            <span className="v" style={{ color: run.openConnectors.length ? 'var(--danger)' : undefined }}>{run.openConnectors.length}</span>
            <span className="k">тупиков</span>
          </div>
          <div className="stat">
            <span className="v">{Math.round(run.ms)}</span>
            <span className="k">мс</span>
          </div>
        </div>
        {run.instances.length < run.settings.count &&
          (run.stop ? (
            <StopDiagnosis p={p} agg={aggStops([run.stop], [run.instances.length], run.settings.count)} />
          ) : (
            <div className="pv-warn">
              Построено {run.instances.length} из {run.settings.count}
            </div>
          ))}
        {run.warnings.map((w, i) => (
          <div key={i} className="pv-warn">
            {w}
          </div>
        ))}
      </Section>

      {fold && <FoldSummary run={run} errs={foldErrs} />}

      <Section title="Обзор">
        {run.sight ? (
          <div className="pv-rowline" style={{ fontSize: 13 }}>
            <span className="grow">
              Макс. обзор{' '}
              <b className="mono" style={{ color: sightLimit > 0 && run.sight.maxM > sightLimit + 1e-6 ? 'var(--danger)' : 'var(--text)' }}>
                {+run.sight.maxM.toFixed(1)} м
              </b>
            </span>
            <span className="n">{sightLimit > 0 ? `предел ${+sightLimit.toFixed(1)} м` : 'без предела'}</span>
          </div>
        ) : (
          <div className="hint">Нет данных об обзоре (прогон старой версии) — перегенерируйте.</div>
        )}
      </Section>

      <Section title="Опасность">
        <div className="grid2">
          <div className="stat">
            <span className="v">{+maxAcc.toFixed(2)}</span>
            <span className="k">максимум по пути</span>
          </div>
          <div className="stat">
            <span className="v" style={{ color: over ? 'var(--danger)' : 'var(--ok)' }}>{over}</span>
            <span className="k">{limit > 0 ? `комнат за порогом ${limit}` : 'порог не задан'}</span>
          </div>
        </div>
      </Section>

      <Section title="Тиры комнат">
        <div className="pv-stack" title="Распределение экземпляров по тирам">
          {tiers
            .filter((t) => t.n > 0)
            .map((t) => (
              <div key={t.id ?? '-'} style={{ width: `${(t.n / totalRooms) * 100}%`, background: t.color }} title={`${t.name}: ${t.n}`} />
            ))}
        </div>
        {tiers.map((t) => (
          <div key={t.id ?? '-'} className="pv-rowline">
            <span className="swatch" style={{ background: t.color }} />
            <span className="grow">
              {t.name}
              {t.id && <span className="muted"> · ур. {t.level}</span>}
            </span>
            <span className="n">
              {t.n} · {Math.round((t.n / totalRooms) * 100)}%
            </span>
          </div>
        ))}
      </Section>

      <Section title="Итого предметов">
        {totals.length === 0 && <div className="hint">Ничего не выпало</div>}
        <div className="pv-totals">
          {totals.map((r) => (
            <div key={r.id} className={'pv-total' + (r.cur ? ' cur' : '')} title={r.item?.note || undefined}>
              <span className="swatch" style={{ background: r.item?.color ?? '#999' }} />
              <span className="name">{r.item?.name ?? r.id}</span>
              <span className="n">{r.n}</span>
            </div>
          ))}
        </div>
      </Section>
    </>
  );
}

/** Сводка складчатого (4D) прогона: слои, наложения, сдвигающие пороги, проверка гарантий. */
function FoldSummary({ run, errs }: { run: Run; errs: string[] | null }) {
  const f = run.fold;
  const fs = normFold(run.settings.fold);
  const links = run.links.length;
  return (
    <Section title="Складки (4D)">
      {f ? (
        <>
          <div className="pv-stats">
            <div className="stat">
              <span className="v">{f.layers}</span>
              <span className="k">слоёв</span>
            </div>
            <div className="stat">
              <span className="v" style={{ fontSize: 14 }}>
                {f.minW}…{f.maxW > 0 ? `+${f.maxW}` : f.maxW}
              </span>
              <span className="k">диапазон W</span>
            </div>
            <div className="stat">
              <span className="v">{f.overlaps}</span>
              <span className="k">пар в одном месте</span>
            </div>
            <div className="stat">
              <span className="v">{f.shifted}</span>
              <span className="k">сдвигов из {links}</span>
            </div>
          </div>
          <div className="pv-stack" title="Слои по возрастанию W">
            {Array.from({ length: f.maxW - f.minW + 1 }, (_, i) => f.minW + i).map((w) => {
              const n = run.instances.filter((x) => (x.w ?? 0) === w).length;
              return n ? <div key={w} style={{ width: `${(n / Math.max(1, run.instances.length)) * 100}%`, background: layerColor(w) }} title={`${wText(w)}: ${n} комн.`} /> : null;
            })}
          </div>
          <div className="hint">
            Пары в одном месте — комнаты разных слоёв, занимающие одно место в 3D (дальше {fs.localRadius} двер. друг от друга). Игрок их одновременно не видит.
          </div>
        </>
      ) : (
        <div className="hint">Нет сводки складчатого генератора — перегенерируйте.</div>
      )}
      {errs &&
        (errs.length === 0 ? (
          <div className="pv-ok" title="validateFoldRun: в одном слое нет пересечений; в радиусе по графу нет пересечений; dw связей сходятся; пороги «никогда»/«всегда» соблюдены">
            ✓ Проверка пройдена: слои не пересекаются, соседи в радиусе {fs.localRadius} — тоже
          </div>
        ) : (
          <>
            <div className="pv-warn" style={{ color: 'var(--danger)', borderLeftColor: 'var(--danger)' }}>
              Проверка: нарушений — {errs.length}
              {errs.length >= 100 ? '+' : ''}
            </div>
            <ul className="pv-errs">
              {errs.slice(0, 20).map((e, i) => (
                <li key={i}>{e}</li>
              ))}
            </ul>
          </>
        ))}
    </Section>
  );
}
