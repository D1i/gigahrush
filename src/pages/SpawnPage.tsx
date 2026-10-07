// Спавн: редактор весов/min/max комнат по группам + симуляция N прогонов для сравнения
// «задумано» (доля веса в пуле) и «получилось» (среднее по прогонам).
import { useMemo, useState } from 'react';
import type { Project, Room } from '../model/types';
import { StopDiagnosis } from '../ui/StopDiagnosis';
import { getVersion, mutate, useProject } from '../model/store';
import { setUI } from '../model/ui';
import { roomArea } from '../model/ops';
import { Btn, NumField, pct } from '../ui/kit';
import { GROUP_COLORS, OTHER, groupOrder, inPool, roomGroup, roomRoles, type RoleInfo } from '../spawn/groups';
import { cancelSim, runSim, useSim, type SimResult } from '../spawn/sim';
import '../spawn/spawn.css';

// Память «выкл» групп: roomId → прежний вес (живёт между переходами по страницам)
const offMem = new Map<string, number>();
// Свёрнутые группы
const collapsedMem = new Set<string>();

const editRoom = (id: string, fn: (r: Room) => void, key?: string) =>
  mutate(
    (p) => {
      const r = p.rooms.find((x) => x.id === id);
      if (r) fn(r);
    },
    key ? { key: `spawn-${key}-${id}` } : undefined,
  );

const editRooms = (ids: string[], fn: (r: Room) => void) =>
  mutate((p) => {
    const s = new Set(ids);
    p.rooms.forEach((r) => s.has(r.id) && fn(r));
  });

const fmt = (v: number, d = 2) => String(+v.toFixed(d));

export function SpawnPage() {
  const p = useProject();
  const version = getVersion();
  const sim = useSim();
  const [n, setN] = useState(20);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set(collapsedMem));
  const [showHint, setShowHint] = useState(true);

  const roles = useMemo(() => roomRoles(p), [version]);
  const res = sim.result;
  const stale = !!res && res.version !== version;

  // пул и доли
  const poolW = p.rooms.reduce((s, r) => s + (inPool(r) ? Math.max(0, r.gen.weight) : 0), 0);
  const share = (r: Room) => (poolW > 0 && inPool(r) ? Math.max(0, r.gen.weight) / poolW : 0);
  const factShare = (r: Room) => (res && res.avgCount > 0 ? (res.perRoom[r.id] ?? 0) / res.avgCount : 0);

  // группы
  const groups = new Map<string, Room[]>();
  for (const r of p.rooms) {
    const g = roomGroup(r);
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g)!.push(r);
  }
  const order = [...groups.keys()].sort((a, b) => groupOrder(a) - groupOrder(b));
  const gShare = (g: string) => groups.get(g)!.reduce((s, r) => s + share(r), 0);
  const gFact = (g: string) => groups.get(g)!.reduce((s, r) => s + factShare(r), 0);
  const gAvg = (g: string) => (res ? groups.get(g)!.reduce((s, r) => s + (res.perRoom[r.id] ?? 0), 0) : 0);
  const maxShare = Math.max(0.0001, ...p.rooms.map((r) => Math.max(share(r), factShare(r))));

  const toggleCollapse = (g: string) => {
    const s = new Set(collapsed);
    s.has(g) ? s.delete(g) : s.add(g);
    collapsedMem.clear();
    s.forEach((x) => collapsedMem.add(x));
    setCollapsed(s);
  };
  const toggleSel = (ids: string[], on: boolean) => {
    const s = new Set(sel);
    ids.forEach((id) => (on ? s.add(id) : s.delete(id)));
    setSel(s);
  };

  const groupOff = (g: string) => groups.get(g)!.every((r) => r.gen.weight <= 0);
  const toggleGroup = (g: string) => {
    const rooms = groups.get(g)!;
    if (groupOff(g)) {
      editRooms(rooms.map((r) => r.id), (r) => {
        r.gen.weight = offMem.get(r.id) ?? 1;
        offMem.delete(r.id);
      });
    } else {
      rooms.forEach((r) => r.gen.weight > 0 && offMem.set(r.id, r.gen.weight));
      editRooms(rooms.map((r) => r.id), (r) => (r.gen.weight = 0));
    }
  };
  const scaleGroup = (g: string, k: number) =>
    editRooms(groups.get(g)!.map((r) => r.id), (r) => (r.gen.weight = +(r.gen.weight * k).toFixed(3)));

  const selIds = [...sel].filter((id) => p.rooms.some((r) => r.id === id));
  const allIds = p.rooms.map((r) => r.id);

  return (
    <div className="spawn">
      <div className="sp-top">
        <div className="sp-hint">
          <div className="sp-hint-h" onClick={() => setShowHint(!showHint)}>
            <span className="cap">Как работает спавн</span>
            <span className="muted">{showHint ? '▾' : '▸'}</span>
          </div>
          {showHint && (
            <ul>
              <li>
                Карта растёт от старта: к каждой свободной метке генератор подбирает комнату. Шанс комнаты{' '}
                <b>P = вес / сумма весов</b> всех комнат, <i>подходящих к этой метке</i>. Поэтому «доля в пуле» — это
                задумка, а «факт» (по симуляции) показывает, что получилось с учётом меток и места.
              </li>
              <li>
                <b>мин</b> — комната ставится обязательно (не меньше стольких штук за прогон); <b>макс</b> — потолок;{' '}
                <b>unique</b> — не больше одной на карту. Вес 0 — только по мин.
              </li>
              <li>
                <b>Хабы</b> (лестницы, коридоры — ≥ 2 ростовых меток) продолжают карту, <b>листья</b> (кухня, санузел)
                её закрывают. Мало хабов — карта глохнет раньше нужного числа комнат.
              </li>
            </ul>
          )}
        </div>
        <SimBox p={{ seed: p.generator.seed, count: p.generator.count }} project={p} n={n} setN={setN} sim={sim} stale={stale} />
      </div>

      <div className="sp-bars">
        <StackBar label="Доля групп в пуле (по весам)" parts={order.map((g) => ({ g, v: gShare(g) }))} />
        <StackBar
          label={res ? `Фактическая доля по симуляции (${res.runs} прогонов)${stale ? ' — устарело' : ''}` : 'Фактическая доля — запустите симуляцию'}
          parts={res ? order.map((g) => ({ g, v: gFact(g) })) : []}
          dim={stale}
        />
      </div>

      <div className={'sp-bulk' + (selIds.length ? ' on' : '')}>
        <label className="check">
          <input
            type="checkbox"
            checked={selIds.length > 0 && selIds.length === allIds.length}
            ref={(el) => {
              if (el) el.indeterminate = selIds.length > 0 && selIds.length < allIds.length;
            }}
            onChange={(e) => setSel(e.target.checked ? new Set(allIds) : new Set())}
          />
          {selIds.length ? `Выбрано: ${selIds.length}` : 'Выбрать все'}
        </label>
        {selIds.length > 0 && <BulkEditor ids={selIds} onClear={() => setSel(new Set())} />}
      </div>

      <div className="sp-scroll">
        <table className="table sp-table">
          <thead>
            <tr>
              <th style={{ width: 28 }} />
              <th>Комната</th>
              <th className="num">м²</th>
              <th className="num" title="Число меток стыковки">метки</th>
              <th title="Хаб продолжает рост карты, лист — закрывает ветку">роль</th>
              <th className="num">вес</th>
              <th className="num" title="w / Σw по пулу">доля</th>
              <th className="num">мин</th>
              <th className="num">макс</th>
              <th>unique</th>
              <th className="num" title="Среднее число экземпляров на прогон по симуляции">факт</th>
              <th style={{ width: 150 }}>
                <span className="sp-leg plan" /> пул <span className="sp-leg fact" /> факт
              </th>
            </tr>
          </thead>
          {order.map((g) => {
            const rooms = groups.get(g)!;
            const ids = rooms.map((r) => r.id);
            const allOn = ids.every((id) => sel.has(id));
            const someOn = ids.some((id) => sel.has(id));
            const off = groupOff(g);
            const isCol = collapsed.has(g);
            return (
              <tbody key={g}>
                <tr className="sp-gh">
                  <td>
                    <input
                      type="checkbox"
                      checked={allOn}
                      ref={(el) => {
                        if (el) el.indeterminate = someOn && !allOn;
                      }}
                      onChange={(e) => toggleSel(ids, e.target.checked)}
                    />
                  </td>
                  <td colSpan={11}>
                    <div className="sp-gh-in">
                      <span className="sp-caret" onClick={() => toggleCollapse(g)}>
                        {isCol ? '▸' : '▾'}
                      </span>
                      <span className="sp-gsw" style={{ background: GROUP_COLORS[g] ?? GROUP_COLORS[OTHER] }} />
                      <span className="sp-gname" onClick={() => toggleCollapse(g)}>
                        {g}
                      </span>
                      <span className="muted">{rooms.length} комн.</span>
                      <span className="sp-gstat">
                        пул <b className="mono">{pct(gShare(g))}</b>
                      </span>
                      {res && (
                        <span className="sp-gstat">
                          факт <b className="mono">{pct(gFact(g))}</b> · <span className="mono">{fmt(gAvg(g), 1)}</span> шт/прогон
                        </span>
                      )}
                      {off && <span className="chip danger">выключена</span>}
                      <span className="grow" />
                      <Btn sm variant="ghost" onClick={() => scaleGroup(g, 0.5)} disabled={off} title="Веса группы ×0.5">
                        ×0.5
                      </Btn>
                      <Btn sm variant="ghost" onClick={() => scaleGroup(g, 2)} disabled={off} title="Веса группы ×2">
                        ×2
                      </Btn>
                      <Btn sm on={off} onClick={() => toggleGroup(g)} title={off ? 'Вернуть прежние веса' : 'Веса группы = 0 (мин продолжает работать)'}>
                        {off ? 'вкл' : 'выкл'}
                      </Btn>
                    </div>
                  </td>
                </tr>
                {!isCol &&
                  rooms.map((r) => (
                    <RoomRow
                      key={r.id}
                      r={r}
                      area={safeArea(p, r)}
                      role={roles[r.id]}
                      share={share(r)}
                      fact={factShare(r)}
                      maxShare={maxShare}
                      res={res}
                      stale={stale}
                      checked={sel.has(r.id)}
                      onCheck={(v) => toggleSel([r.id], v)}
                    />
                  ))}
              </tbody>
            );
          })}
        </table>
        {p.rooms.length === 0 && <div className="empty">Комнат нет</div>}
      </div>
    </div>
  );
}

function safeArea(p: ReturnType<typeof useProject>, r: Room): number {
  try {
    return roomArea(p, r);
  } catch {
    return r.cells.size * p.settings.cellM * p.settings.cellM;
  }
}

function RoomRow(props: {
  r: Room;
  area: number;
  role: RoleInfo | undefined;
  share: number;
  fact: number;
  maxShare: number;
  res: SimResult | null;
  stale: boolean;
  checked: boolean;
  onCheck: (v: boolean) => void;
}) {
  const { r, role, res } = props;
  const pool = inPool(r);
  const fails = res?.minFails[r.id] ?? 0;
  const avg = res ? res.perRoom[r.id] ?? 0 : null;
  return (
    <tr className={'sp-row' + (props.checked ? ' sel' : '') + (pool ? '' : ' out')}>
      <td>
        <input type="checkbox" checked={props.checked} onChange={(e) => props.onCheck(e.target.checked)} />
      </td>
      <td className="sp-name">
        <a onClick={() => setUI({ page: 'editor', roomId: r.id, selection: null })} title="Открыть в редакторе">
          {r.name}
        </a>
        {r.tags.includes('start') && <span className="chip green">старт</span>}
        {!pool && <span className="muted" title="Не участвует в генерации: вес 0 и мин 0, либо пустая, либо макс 0"> · вне пула</span>}
      </td>
      <td className="num">{fmt(props.area, 1)}</td>
      <td className="num">{r.connectors.length}</td>
      <td>
        {role && role.role !== 'none' ? (
          <span className={'sp-role ' + role.role} title={`Ростовых меток: ${role.grow} из ${role.total}`}>
            {role.role === 'hub' ? 'хаб' : 'лист'}
          </span>
        ) : (
          <span className="muted" title="Нет меток — может быть только стартом">—</span>
        )}
      </td>
      <td className="num sp-in">
        <NumField value={r.gen.weight} min={0} max={9999} step={1} digits={2} onChange={(v) => editRoom(r.id, (x) => (x.gen.weight = v), 'w')} />
      </td>
      <td className="num">{props.share > 0 ? pct(props.share) : '—'}</td>
      <td className="num sp-in sm">
        <NumField value={r.gen.min} min={0} max={999} step={1} digits={0} onChange={(v) => editRoom(r.id, (x) => (x.gen.min = Math.round(v)), 'min')} />
      </td>
      <td className="num sp-in sm">
        <NumField
          value={r.gen.max}
          min={0}
          max={999}
          step={1}
          digits={0}
          disabled={r.unique}
          title={r.unique ? 'unique — не больше одной' : undefined}
          onChange={(v) => editRoom(r.id, (x) => (x.gen.max = Math.round(v)), 'max')}
        />
      </td>
      <td>
        <input type="checkbox" checked={r.unique} onChange={(e) => editRoom(r.id, (x) => (x.unique = e.target.checked))} title="Не больше одной на карту" />
      </td>
      <td className={'num' + (props.stale ? ' sp-stale' : '')}>
        {avg === null ? '—' : fmt(avg)}
        {fails > 0 && res && (
          <span className="sp-fail" title={`min = ${r.gen.min} не выполнен в ${fails} из ${res.runs} прогонов`}>
            {' '}
            мин ✕{fails}
          </span>
        )}
      </td>
      <td>
        <div className="sp-mini">
          <div className="plan" style={{ width: `${(props.share / props.maxShare) * 100}%` }} />
          {res && <div className="fact" style={{ width: `${(props.fact / props.maxShare) * 100}%`, opacity: props.stale ? 0.4 : 1 }} />}
        </div>
      </td>
    </tr>
  );
}

function StackBar({ label, parts, dim }: { label: string; parts: { g: string; v: number }[]; dim?: boolean }) {
  const total = parts.reduce((s, x) => s + x.v, 0);
  return (
    <div className={'sp-stack' + (dim ? ' dim' : '')}>
      <div className="sp-stack-l">{label}</div>
      <div className="sp-stack-bar">
        {total > 0 ? (
          parts
            .filter((x) => x.v > 0)
            .map((x) => (
              <div
                key={x.g}
                className="sp-seg"
                style={{ flexGrow: x.v, background: GROUP_COLORS[x.g] ?? GROUP_COLORS[OTHER] }}
                title={`${x.g}: ${pct(x.v / total)}`}
              >
                {x.v / total >= 0.06 && (
                  <span>
                    {x.g} {pct(x.v / total)}
                  </span>
                )}
              </div>
            ))
        ) : (
          <div className="sp-seg empty" />
        )}
      </div>
    </div>
  );
}

function SimBox({ p, project, n, setN, sim, stale }: { p: { seed: string; count: number }; project: Project; n: number; setN: (n: number) => void; sim: ReturnType<typeof useSim>; stale: boolean }) {
  const res = sim.result;
  return (
    <div className="sp-sim">
      <div className="row">
        <span className="cap">Симуляция</span>
        <span className="grow" />
        {[10, 20, 50].map((k) => (
          <Btn key={k} sm on={n === k} onClick={() => setN(k)} disabled={sim.running}>
            {k}
          </Btn>
        ))}
        {sim.running ? (
          <Btn sm variant="danger" onClick={cancelSim}>
            Стоп
          </Btn>
        ) : (
          <Btn sm variant="primary" onClick={() => runSim(n)}>
            Прогнать {n} прогонов
          </Btn>
        )}
      </div>
      <div className="hint">
        Сиды «{p.seed}#0…#{n - 1}», остальные настройки — из генератора (цель {p.count} комнат).
      </div>
      {sim.running && (
        <div className="sp-prog">
          <div style={{ width: `${(sim.done / Math.max(1, sim.total)) * 100}%` }} />
          <span className="mono">
            {sim.done} / {sim.total}
          </span>
        </div>
      )}
      {sim.error && <div className="sp-err">Ошибка генератора: {sim.error}</div>}
      {res && !sim.running && (
        <>
          {stale && (
            <div className="sp-stale-b">
              Проект изменился — результат устарел.{' '}
              <a onClick={() => runSim(n)}>Перепрогнать</a>
            </div>
          )}
          <div className={'sp-stats' + (stale ? ' dim' : '')}>
            <div className="stat">
              <span className="v">
                {fmt(res.avgCount, 1)}
                <span className="muted" style={{ fontSize: 12 }}>
                  {' '}
                  / {res.target}
                </span>
              </span>
              <span className="k">комнат в среднем</span>
            </div>
            <div className="stat">
              <span className="v">{fmt(res.avgDeadEnds, 1)}</span>
              <span className="k">тупиков (своб. меток)</span>
            </div>
            <div className="stat">
              <span className="v">{res.avgSight === null ? '—' : `${fmt(res.avgSight, 1)} м`}</span>
              <span className="k">обзор ср.{res.maxSight !== null ? ` · макс ${fmt(res.maxSight, 1)} м` : ''}</span>
            </div>
            <div className="stat">
              <span className="v" style={res.runsWithMinFail ? { color: 'var(--danger)' } : undefined}>
                {res.runsWithMinFail}
                <span className="muted" style={{ fontSize: 12 }}>
                  {' '}
                  / {res.runs}
                </span>
              </span>
              <span className="k">прогонов с невыполненным мин</span>
            </div>
          </div>
          <div className="hint mono">
            {res.runs} прогонов за {fmt(res.ms / 1000, 1)} с
          </div>
          {res.stops && !stale && <StopDiagnosis p={project} agg={res.stops} />}
        </>
      )}
    </div>
  );
}

function BulkEditor({ ids, onClear }: { ids: string[]; onClear: () => void }) {
  const [w, setW] = useState(1);
  const [k, setK] = useState(2);
  const [mn, setMn] = useState(0);
  const [mx, setMx] = useState(99);
  return (
    <div className="sp-bulk-f">
      <span className="muted">вес</span>
      <div className="sp-bn">
        <NumField value={w} min={0} max={9999} step={1} onChange={setW} />
      </div>
      <Btn sm onClick={() => editRooms(ids, (r) => (r.gen.weight = w))}>
        задать
      </Btn>
      <span className="sp-sep" />
      <span className="muted">вес ×</span>
      <div className="sp-bn">
        <NumField value={k} min={0} max={100} step={0.5} onChange={setK} />
      </div>
      <Btn sm onClick={() => editRooms(ids, (r) => (r.gen.weight = +(r.gen.weight * k).toFixed(3)))}>
        умножить
      </Btn>
      <span className="sp-sep" />
      <span className="muted">мин</span>
      <div className="sp-bn">
        <NumField value={mn} min={0} max={999} step={1} digits={0} onChange={setMn} />
      </div>
      <Btn sm onClick={() => editRooms(ids, (r) => (r.gen.min = Math.round(mn)))}>
        задать
      </Btn>
      <span className="sp-sep" />
      <span className="muted">макс</span>
      <div className="sp-bn">
        <NumField value={mx} min={0} max={999} step={1} digits={0} onChange={setMx} />
      </div>
      <Btn sm onClick={() => editRooms(ids, (r) => (r.gen.max = Math.round(mx)))}>
        задать
      </Btn>
      <span className="grow" />
      <Btn sm variant="ghost" onClick={onClear}>
        снять выделение
      </Btn>
    </div>
  );
}
