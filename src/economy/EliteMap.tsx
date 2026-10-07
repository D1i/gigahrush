// Карта элитности: матрица комнаты × тиры с весами room.elite и итоговыми процентами.
import { useState } from 'react';
import type { Project, Room } from '../model/types';
import { mutate, useProject } from '../model/store';
import { setUI } from '../model/ui';
import { Btn, NumField, pct } from '../ui/kit';
import { roomExpectedDanger, roomTierChances, sortedTiers } from './shared';

function setWeight(roomId: string, tierId: string, w: number) {
  mutate((p) => {
    const r = p.rooms.find((x) => x.id === roomId);
    if (!r) return;
    const e = r.elite.find((x) => x.tierId === tierId);
    if (w <= 0) r.elite = r.elite.filter((x) => x.tierId !== tierId);
    else if (e) e.weight = w;
    else r.elite.push({ tierId, weight: w });
  });
}

/** Пресет «обычная»: вес линейно убывает с уровнем (1-й тир — n, последний — 1). */
function presetNormal(p: Project, room: Room) {
  const tiers = sortedTiers(p);
  room.elite = tiers.map((t, i) => ({ tierId: t.id, weight: tiers.length - i }));
}

export function EliteMap() {
  const p = useProject();
  const tiers = sortedTiers(p);
  const [passId, setPassId] = useState('');
  const [q, setQ] = useState('');
  const pass = p.economy.passes.find((x) => x.id === passId) ?? null;
  const s = q.trim().toLowerCase();
  const rooms = s ? p.rooms.filter((r) => r.name.toLowerCase().includes(s) || r.tags.some((t) => t.toLowerCase().includes(s))) : p.rooms;
  const noElite = p.rooms.filter((r) => r.elite.length === 0).length;

  return (
    <div className="eco-map">
      <div className="eco-bar">
        <input className="input" style={{ width: 220 }} placeholder="Поиск комнаты" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="row">
          <span className="muted">Показать с проходкой:</span>
          <select className="select" style={{ width: 200 }} value={passId} onChange={(e) => setPassId(e.target.value)}>
            <option value="">без проходки</option>
            {p.economy.passes.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </select>
        </div>
        <span className="grow" />
        <Btn
          sm
          disabled={noElite === 0}
          title="Применить пресет «обычная» ко всем комнатам, где веса не заданы"
          onClick={() => mutate((pr) => pr.rooms.forEach((r) => r.elite.length === 0 && presetNormal(pr, r)))}
        >
          «обычная» всем без весов ({noElite})
        </Btn>
      </div>
      <div className="hint eco-map-hint">
        При заходе в комнату разыгрывается один тир по весам строки. Процент = вес / сумма весов строки
        {pass ? ` (с проходкой «${pass.name}» веса тиров 2+ умножены на ×${pass.tierBoost})` : ''}. Пустая строка — комната
        всегда базовая, без тира. Вес 0 убирает тир из комнаты.
      </div>
      <div className="eco-map-scroll">
        <table className="table eco-matrix">
          <thead>
            <tr>
              <th>Комната</th>
              {tiers.map((t) => (
                <th key={t.id} className="eco-mcol" title={`${t.name}: +${t.danger} опасности`}>
                  <span className="eco-lvl" style={{ background: t.color }}>
                    {t.level}
                  </span>{' '}
                  <span className="eco-mname">{t.name}</span>
                </th>
              ))}
              <th className="num" title="Ожидаемый прирост опасности за проход">
                опасн.
              </th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rooms.map((r) => {
              const ch = roomTierChances(p, r, pass);
              return (
                <tr key={r.id}>
                  <td className="eco-mroom">
                    <a onClick={() => setUI({ page: 'editor', roomId: r.id, selection: null })} title="Открыть в редакторе">
                      {r.name}
                    </a>
                    {r.elite.length === 0 && <span className="muted"> · база</span>}
                  </td>
                  {tiers.map((t) => {
                    const w = r.elite.find((e) => e.tierId === t.id)?.weight ?? 0;
                    const pr = ch.get(t.id) ?? 0;
                    return (
                      <td key={t.id} className={'eco-cell' + (w > 0 ? ' on' : '')}>
                        <div className="eco-cell-in">
                          <NumField value={w} min={0} max={9999} step={1} digits={1} onChange={(v) => setWeight(r.id, t.id, v)} />
                          <span className="eco-pct mono" style={pr > 0 ? { color: t.color } : undefined}>
                            {pr > 0 ? pct(pr) : '—'}
                          </span>
                        </div>
                        {pr > 0 && <div className="eco-bar-fill" style={{ width: `${pr * 100}%`, background: t.color }} />}
                      </td>
                    );
                  })}
                  <td className="num">{r.elite.length ? '+' + +roomExpectedDanger(p, r, pass).toFixed(1) : '0'}</td>
                  <td className="eco-mact">
                    <Btn sm variant="ghost" title="Веса по убыванию уровня: 1-й тир чаще всего" onClick={() => mutate((pr) => {
                      const x = pr.rooms.find((y) => y.id === r.id);
                      if (x) presetNormal(pr, x);
                    })}>
                      обычная
                    </Btn>
                    <Btn sm variant="ghost" disabled={!r.elite.length} title="Убрать все веса — комната станет базовой" onClick={() => mutate((pr) => {
                      const x = pr.rooms.find((y) => y.id === r.id);
                      if (x) x.elite = [];
                    })}>
                      очистить
                    </Btn>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {rooms.length === 0 && <div className="empty">Комнат не найдено</div>}
      </div>
    </div>
  );
}
