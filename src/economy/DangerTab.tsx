// Опасность уровня: лимит «горения» + правило простым языком + сколько комнат до лимита.
import { useState } from 'react';
import { useProject } from '../model/store';
import { setUI } from '../model/ui';
import { NumField, Section } from '../ui/kit';
import { editEco, roomExpectedDanger, sortedTiers } from './shared';
import { plural } from '../library/usage';

export function DangerTab() {
  const p = useProject();
  const tiers = sortedTiers(p);
  const limit = p.economy.dangerLimit;
  const [passId, setPassId] = useState('');
  const pass = p.economy.passes.find((x) => x.id === passId) ?? null;
  const rooms = p.rooms
    .filter((r) => r.elite.length)
    .map((r) => ({ r, d: roomExpectedDanger(p, r, pass) }))
    .sort((a, b) => b.d - a.d);
  const avg = rooms.length ? rooms.reduce((s, x) => s + x.d, 0) / rooms.length : 0;
  // пример пути: по тиру на комнату, начиная с младшего
  const example = tiers.filter((t) => t.danger > 0).slice(0, 3);

  return (
    <div className="eco-danger">
      <div className="eco-danger-l">
        <Section title="Лимит опасности">
          <div className="row" style={{ alignItems: 'flex-end' }}>
            <div style={{ width: 280 }}>
              <NumField
                label="Уровень «горит», когда опасность больше"
                value={limit}
                min={0}
                max={99999}
                step={5}
                digits={0}
                onChange={(v) => editEco((e) => (e.dangerLimit = Math.round(v)), 'danger-limit')}
              />
            </div>
            <span className="hint">0 — лимита нет</span>
          </div>
        </Section>
        <div className="eco-explain">
          <div className="cap">Правило для игрока</div>
          <ol className="eco-rule-list">
            <li>При входе в комнату разыгрывается её элитность (тир). У каждого тира — своя цена прохода: «+N опасности».</li>
            <li>Каждая пройденная комната добавляет опасность своего тира. Опасность копится по пути от старта: чем глубже зашёл через элитные квартиры, тем она выше.</li>
            <li>
              {limit > 0 ? (
                <>
                  Как только сумма превысит <b className="mono">{limit}</b>, уровень «горит».
                </>
              ) : (
                <>Лимит не задан — уровень никогда не «горит».</>
              )}
            </li>
          </ol>
          {limit > 0 && example.length > 0 && (
            <div className="eco-example">
              Пример:{' '}
              {example.map((t, i) => (
                <span key={t.id}>
                  {i > 0 && ' → '}
                  <span style={{ color: t.color }}>Э{t.level}</span> +{t.danger}
                </span>
              ))}{' '}
              = <b className="mono">{example.reduce((s, t) => s + t.danger, 0)}</b> из {limit}
            </div>
          )}
        </div>
        <Section title="Тиры: сколько комнат подряд до лимита">
          {tiers.length === 0 ? (
            <div className="hint">Тиров нет.</div>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Тир</th>
                  <th className="num">за проход</th>
                  <th className="num">комнат до «горит»</th>
                </tr>
              </thead>
              <tbody>
                {tiers.map((t) => (
                  <tr key={t.id}>
                    <td>
                      <span className="eco-lvl" style={{ background: t.color }}>
                        {t.level}
                      </span>{' '}
                      {t.name}
                    </td>
                    <td className="num">+{t.danger}</td>
                    <td className="num">{limit > 0 && t.danger > 0 ? Math.floor(limit / t.danger) + 1 : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <div className="hint">Сколько комнат одного тира подряд нужно пройти, чтобы опасность превысила лимит.</div>
        </Section>
      </div>
      <div className="eco-danger-r side right">
        <Section
          title="Ожидаемая опасность за комнату"
          actions={
            <select className="select" style={{ width: 170, height: 22, fontSize: 12 }} value={passId} onChange={(e) => setPassId(e.target.value)}>
              <option value="">без проходки</option>
              {p.economy.passes.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </select>
          }
        >
          {rooms.length === 0 ? (
            <div className="hint">Ни у одной комнаты нет весов элитности — опасность не растёт.</div>
          ) : (
            <>
              <div className="row">
                <div className="stat">
                  <span className="v">+{+avg.toFixed(1)}</span>
                  <span className="k">в среднем за комнату</span>
                </div>
                {limit > 0 && avg > 0 && (
                  <div className="stat">
                    <span className="v">≈{Math.floor(limit / avg) + 1}</span>
                    <span className="k">{plural(Math.floor(limit / avg) + 1, 'комната', 'комнаты', 'комнат')} вглубь до «горит»</span>
                  </div>
                )}
              </div>
              <table className="table">
                <thead>
                  <tr>
                    <th>Комната</th>
                    <th className="num">ожид. +</th>
                  </tr>
                </thead>
                <tbody>
                  {rooms.map(({ r, d }) => (
                    <tr key={r.id}>
                      <td>
                        <a className="eco-link" onClick={() => setUI({ page: 'editor', roomId: r.id, selection: null })}>
                          {r.name}
                        </a>
                      </td>
                      <td className="num">+{+d.toFixed(1)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="hint">Среднее по весам элитности комнаты. Комнаты без весов (база) опасность не добавляют.</div>
            </>
          )}
        </Section>
      </div>
    </div>
  );
}
