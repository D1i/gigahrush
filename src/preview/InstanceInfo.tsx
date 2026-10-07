// Правая колонка генератора: подробности о выделенном экземпляре или список экземпляров прогона.
import type { Project, Run } from '../model/types';
import { setUI } from '../model/ui';
import { tierRuleLines } from '../gen/rules';
import type { ContentGroup } from '../gen/walk';
import { Btn, Section, pct } from '../ui/kit';
import { pathTo, type RunGeo } from './runGeo';
import { dwText, itemById, layerColor, propById, safe, tierById, wText } from './util';
import { normFold } from '../gen4d/fold';

const sel = (id: string) => setUI({ runInst: id });

export function InstanceInfo({ p, run, geo, instId }: { p: Project; run: Run; geo: RunGeo; instId: string | null }) {
  const g = instId ? geo.byId.get(instId) : undefined;
  if (!g) return <RunOverview p={p} run={run} geo={geo} />;

  const { inst, room, content: c } = g;
  const tier = tierById(p, c?.tierId ?? null);
  const path = pathTo(geo, inst.id);
  const nameOf = (id: string) => {
    const x = geo.byId.get(id);
    return x?.room?.name ?? x?.inst.roomId ?? id;
  };
  const rules = tier ? safe(() => tierRuleLines(p, tier), [] as string[]) : [];
  const connName = (instId: string, cid: string) => geo.byId.get(instId)?.w.connectors.find((x) => x.id === cid);

  return (
    <>
      <Section
        title={`Экземпляр ${inst.id}`}
        actions={
          <Btn sm variant="ghost" onClick={() => setUI({ runInst: null })} title="Снять выделение (Esc)">
            ✕
          </Btn>
        }
      >
        <div className="pv-title">
          {inst.order === 0 && <span className="chip green">старт</span>}
          {room?.name ?? <span className="muted">комната удалена</span>}
        </div>
        <div className="pv-kv">
          <span>комната</span>
          <span>{inst.roomId}</span>
          <span>поворот</span>
          <span>{inst.rot}°</span>
          <span>смещение</span>
          <span>
            {inst.dx}, {inst.dy} кл. ({+(inst.dx * p.settings.cellM).toFixed(1)}, {+(inst.dy * p.settings.cellM).toFixed(1)} м)
          </span>
          {geo.fold && (
            <>
              <span>слой</span>
              <span>
                <span className="pv-wchip" style={{ background: layerColor(g.layer), cursor: 'default' }}>
                  {wText(g.layer)}
                </span>
              </span>
            </>
          )}
          <span>глубина</span>
          <span>{inst.depth}</span>
          <span>шаг роста</span>
          <span>{inst.order}</span>
          <span>родитель</span>
          <span>{inst.parent ? <span className="pv-link" onClick={() => sel(inst.parent!)}>{inst.parent} · {nameOf(inst.parent)}</span> : '—'}</span>
        </div>
        {room && (
          <Btn sm onClick={() => setUI({ page: 'editor', roomId: room.id, selection: null })}>
            ✎ Открыть в редакторе
          </Btn>
        )}
      </Section>

      <Section title="Тир и опасность">
        {tier ? (
          <>
            <div className="row">
              <span className="chip" style={{ background: tier.color, color: '#111', borderColor: tier.color }}>
                {tier.name}
              </span>
              <span className="muted">уровень {tier.level}</span>
            </div>
            {rules.length > 0 && (
              <ul className="pv-rules">
                {rules.map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ul>
            )}
          </>
        ) : (
          <div className="hint">Базовая комната (без тира)</div>
        )}
        <div className="pv-kv">
          <span>за проход</span>
          <span style={{ color: c?.danger ? 'var(--danger)' : undefined }}>+{+(c?.danger ?? 0).toFixed(2)}</span>
          <span>накоплено</span>
          <span style={{ color: p.economy.dangerLimit > 0 && (c?.dangerAcc ?? 0) > p.economy.dangerLimit ? 'var(--danger)' : undefined }}>
            {+(c?.dangerAcc ?? 0).toFixed(2)}
            {p.economy.dangerLimit > 0 && <span className="muted"> / порог {p.economy.dangerLimit}</span>}
          </span>
        </div>
        {path.length > 1 && (
          <div className="pv-path">
            <span className="muted">путь:</span>
            {path.map((x, i) => {
              const xc = x.content;
              const t = tierById(p, xc?.tierId ?? null);
              return (
                <span key={x.inst.id} className="row" style={{ gap: 3 }}>
                  {i > 0 && <span className="muted">→</span>}
                  <span className="pv-link" onClick={() => sel(x.inst.id)} title={`${x.inst.id}, накоплено ${+(xc?.dangerAcc ?? 0).toFixed(2)}`}>
                    {t && <span className="pv-dot" style={{ background: t.color, marginRight: 3 }} />}
                    {x.room?.name ?? x.inst.roomId}
                    {xc?.danger ? <span style={{ color: 'var(--danger)' }}> +{+xc.danger.toFixed(2)}</span> : null}
                  </span>
                </span>
              );
            })}
          </div>
        )}
      </Section>

      <Section title="Споты">
        {!c?.groups.length && <div className="hint">Групп спотов нет</div>}
        {c?.groups.map((gr) => {
          const group = room?.spotGroups.find((x) => x.id === gr.groupId);
          const vi = group ? group.variants.findIndex((v) => v.id === gr.variantId) : -1;
          const variant = group?.variants[vi];
          const wsum = group ? group.variants.reduce((s, v) => s + Math.max(0, v.weight), 0) : 0;
          const spots = c.spots.filter((s) => s.groupId === gr.groupId);
          return (
            <div key={gr.groupId} className="pv-group" style={{ borderLeftColor: group?.color }}>
              <div className="h">
                <b>{group?.name ?? gr.groupId}</b>
                <span className="muted">
                  → вариант {vi + 1}
                  {group && `/${group.variants.length}`}
                  {variant && wsum > 0 && ` (${pct(Math.max(0, variant.weight) / wsum)})`}
                  {(gr as ContentGroup).fallback && ' · подмена: выпавший перегораживал проход'}
                </span>
              </div>
              {spots.map((s) => {
                const sp = room?.spots.find((x) => x.id === s.spotId);
                const ct = s.content;
                const label = !ct
                  ? null
                  : ct.kind === 'prop'
                    ? propById(p, ct.id)?.name ?? ct.id
                    : itemById(p, ct.id)?.name ?? ct.id;
                const color = ct ? (ct.kind === 'prop' ? propById(p, ct.id)?.color : itemById(p, ct.id)?.color) : undefined;
                return (
                  <div key={s.spotId} className="row" style={{ gap: 6 }}>
                    <span className="muted">{sp?.name ?? s.spotId}:</span>
                    {ct ? (
                      <>
                        <span className={ct.kind === 'item' ? 'pv-dot' : 'swatch'} style={{ background: color ?? '#999' }} />
                        <span>{label}</span>
                        <span className="muted">{ct.kind === 'prop' ? 'декор' : 'предмет'}</span>
                      </>
                    ) : (
                      <span className="muted">пусто</span>
                    )}
                  </div>
                );
              })}
            </div>
          );
        })}
      </Section>

      <Section title="Лут">
        {!c?.loot.length && <div className="hint">Ничего не выпало</div>}
        {c && c.loot.length > 0 && (
          <table className="table">
            <thead>
              <tr>
                <th>предмет</th>
                <th className="num">×</th>
                <th>откуда</th>
              </tr>
            </thead>
            <tbody>
              {c.loot.map((l, i) => {
                const it = itemById(p, l.itemId);
                const dec = l.decorId ? g.w.decor.find((d) => d.id === l.decorId) : undefined;
                const decName = dec ? propById(p, dec.propId)?.name : undefined;
                const shop = l.shopId ? p.economy.shops.find((s) => s.id === l.shopId) : undefined;
                return (
                  <tr key={i}>
                    <td>
                      <span className="row" style={{ gap: 6 }}>
                        <span className="swatch" style={{ background: it?.color ?? '#999' }} />
                        {it?.name ?? l.itemId}
                      </span>
                    </td>
                    <td className="num">{l.count}</td>
                    <td>
                      <span className={'chip' + (l.from === 'tier' ? ' accent' : '')}>{l.from === 'tier' ? 'тир' : 'комната'}</span>
                      {shop && <span className="muted"> · {shop.name}</span>}
                      {decName && <span className="muted"> · в «{decName}»</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Section>

      <Section title={`Связи (${g.peers.length})`}>
        {g.peers.length === 0 && <div className="hint">Нет связей</div>}
        {g.peers.map((pl, i) => {
          const own = connName(inst.id, pl.connector);
          const other = connName(pl.inst, pl.peerConnector);
          return (
            <div key={i} className="pv-rowline">
              <span className="muted">{own?.name || own?.tag || pl.connector}</span>
              <span className="muted">↔</span>
              <span className="pv-link grow" onClick={() => sel(pl.inst)}>
                {pl.inst} · {nameOf(pl.inst)}
              </span>
              {pl.dw !== 0 && (
                <span className="pv-dw" title={`Порог со сдвигом: проходя отсюда, игрок попадает в слой ${wText(g.layer + pl.dw)}`}>
                  ⚡{dwText(pl.dw)}
                </span>
              )}
              <span className="n">{other?.name || other?.tag || ''}</span>
            </div>
          );
        })}
        {g.open.size > 0 && (
          <div className="hint" style={{ color: 'var(--danger)' }}>
            Тупики:{' '}
            {[...g.open]
              .map((cid) => {
                const cc = g.w.connectors.find((x) => x.id === cid);
                return cc?.name || cc?.tag || cid;
              })
              .join(', ')}
          </div>
        )}
      </Section>

      {geo.fold && (
        <Section title={`Делит место (${g.overlaps.length})`}>
          {g.overlaps.length === 0 ? (
            <div className="hint">В 3D на этом месте больше никого нет.</div>
          ) : (
            <>
              <div className="hint">
                Эти комнаты стоят на том же месте в 3D, но в других измерениях (слоях W). Все они дальше {normFold(run.settings.fold).localRadius} двер. по
                графу — игрок не видит их одновременно с этой.
              </div>
              {g.overlaps.map((id) => {
                const o = geo.byId.get(id);
                if (!o) return null;
                return (
                  <div key={id} className="pv-rowline">
                    <span className="pv-wchip" style={{ background: layerColor(o.layer), cursor: 'default' }}>
                      {wText(o.layer)}
                    </span>
                    <span className="pv-link grow" onClick={() => sel(id)}>
                      {id} · {o.room?.name ?? o.inst.roomId}
                    </span>
                    <span className="n">г{o.inst.depth}</span>
                  </div>
                );
              })}
            </>
          )}
        </Section>
      )}
    </>
  );
}

/** Без выделения — список экземпляров прогона. */
function RunOverview({ p, run, geo }: { p: Project; run: Run; geo: RunGeo }) {
  const s = run.settings;
  const pass = s.passId ? p.economy.passes.find((x) => x.id === s.passId) : undefined;
  const start = s.startRoomId ? p.rooms.find((r) => r.id === s.startRoomId) : undefined;
  return (
    <>
      <Section title="Прогон">
        <div className="pv-kv">
          <span>сид</span>
          <span>{run.seed}</span>
          <span>комнат</span>
          <span>
            {run.instances.length} / {s.count}
          </span>
          <span>зазор</span>
          <span>
            {s.gap} кл. ({+(s.gap * p.settings.cellM).toFixed(2)} м)
          </span>
          <span>стыковка</span>
          <span>{s.match}</span>
          <span>старт</span>
          <span>{start?.name ?? 'авто'}</span>
          <span>проходка</span>
          <span>{pass?.name ?? 'нет'}</span>
          <span>генератор</span>
          <span>{geo.fold ? 'складчатый (4D)' : 'евклидов'}</span>
          {geo.fold && (
            <>
              <span>складки</span>
              <span>
                сдвиг {Math.round(normFold(s.fold).shiftChance * 100)}% · |ΔW| ≤ {normFold(s.fold).maxShift} · радиус {normFold(s.fold).localRadius} · |W| ≤{' '}
                {normFold(s.fold).maxLayer}
              </span>
            </>
          )}
        </div>
        <div className="hint">Кликните комнату на холсте, чтобы увидеть, что в ней выпало.</div>
      </Section>
      <Section title={`Экземпляры (${geo.list.length})`}>
        <div className="list pv-insts" style={{ margin: '0 -12px' }}>
          {[...geo.list]
            .sort((a, b) => a.inst.order - b.inst.order)
            .map((g) => {
              const t = tierById(p, g.content?.tierId ?? null);
              const over = p.economy.dangerLimit > 0 && (g.content?.dangerAcc ?? 0) > p.economy.dangerLimit;
              return (
                <div key={g.inst.id} className="li" onClick={() => sel(g.inst.id)}>
                  <span className="pv-dot" style={{ background: t?.color ?? 'transparent', borderColor: t ? undefined : 'var(--line-2)' }} />
                  <span className="name">
                    {g.room?.name ?? g.inst.roomId}
                    {g.inst.order === 0 && <span className="muted"> · старт</span>}
                  </span>
                  <span className="meta" style={{ color: over ? 'var(--danger)' : undefined }} title="накопленная опасность">
                    ☢{+(g.content?.dangerAcc ?? 0).toFixed(1)}
                  </span>
                  {geo.fold && (
                    <span className="meta" style={{ color: layerColor(g.layer) }} title="слой W">
                      {g.layer > 0 ? `+${g.layer}` : g.layer < 0 ? `−${-g.layer}` : '0'}
                    </span>
                  )}
                  <span className="meta">г{g.inst.depth}</span>
                </div>
              );
            })}
        </div>
      </Section>
    </>
  );
}
