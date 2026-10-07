// Секция инспектора «Отделка»: стены и пол — по правилу тега или конкретная отделка;
// под выбором — что может выпасть комнате (образец + имя + шанс).
import type { FinishRule, FinishSurface, Project, Room } from '../model/types';
import { finishRuleFor } from '../model/ops';
import { Btn, Section, Select, pct } from '../ui/kit';
import { FinishMix, FinishSwatch } from '../library/FinishSwatch';
import { safeChances } from '../library/finishUse';
import { tileLabel } from '../library/finishTex';
import { openFinish, openLibrary } from '../library/nav';
import { mutRoom } from './util';

function ruleOf(p: Project, room: Room): FinishRule | null {
  try {
    return finishRuleFor(p, room);
  } catch {
    return null;
  }
}

export function FinishSection({ p, room }: { p: Project; room: Room }) {
  const rule = ruleOf(p, room);
  return (
    <Section
      title="Отделка"
      actions={
        <>
          <Btn sm variant="ghost" onClick={() => openLibrary('rules')} title="Правила отделки по тегам комнат">
            правила…
          </Btn>
          <Btn sm variant="ghost" onClick={() => openLibrary('finishes')} title="Библиотека отделки">
            библиотека…
          </Btn>
        </>
      }
    >
      <FinishPick p={p} room={room} surface="wall" rule={rule} />
      <FinishPick p={p} room={room} surface="floor" rule={rule} />
      {!rule && (
        <div className="hint">
          {room.tags.length ? `Ни для одного тега комнаты (${room.tags.join(', ')}) нет правила` : 'У комнаты нет тегов — правило не найдётся'}. Без явной
          отделки стены и пол останутся по умолчанию.
        </div>
      )}
    </Section>
  );
}

function FinishPick({ p, room, surface, rule }: { p: Project; room: Room; surface: FinishSurface; rule: FinishRule | null }) {
  const cur = room.finish?.[surface] ?? null;
  const byId = new Map(p.finishes.map((f) => [f.id, f]));
  const curFin = cur ? byId.get(cur) : undefined;
  const fins = p.finishes.filter((f) => f.surface === surface);
  const chances = safeChances(p, room, surface);
  const ruleVars = rule ? (surface === 'wall' ? rule.wall : rule.floor).length : 0;
  const ruleLabel = rule ? `по правилу (тег «${rule.tag}»${ruleVars ? '' : ' — пусто'})` : 'по правилу — правила нет';
  const opts = [
    { value: '', label: ruleLabel },
    ...(cur && !curFin ? [{ value: cur, label: '(удалённая отделка)' }] : []),
    ...fins.map((f) => ({ value: f.id, label: f.name })),
  ];
  const set = (v: string) =>
    mutRoom(room.id, (r) => {
      if (!r.finish) r.finish = { wall: null, floor: null };
      r.finish[surface] = v || null;
    });
  const what = surface === 'wall' ? 'Стены' : 'Пол';

  return (
    <div className="field pn-fin-pick">
      <label>
        {what}
        {cur && <span className="pn-fin-mode"> · явно</span>}
      </label>
      <div className="row">
        {cur ? (
          <span className="pn-fin-sw" onClick={() => curFin && openFinish(curFin.id)} title={curFin ? `${curFin.name} — открыть в библиотеке` : 'Отделка удалена'}>
            <FinishSwatch finish={curFin} size={26} />
          </span>
        ) : (
          <FinishMix items={chances.map((c) => ({ finish: byId.get(c.finishId), p: c.p }))} size={26} title="Варианты по правилу (ширина полосы — шанс)" />
        )}
        <div className="grow">
          <Select value={cur ?? ''} options={opts} onChange={set} />
        </div>
      </div>
      {chances.length > 0 ? (
        <div className="pn-chips">
          {chances.map((c) => {
            const f = byId.get(c.finishId);
            return (
              <button
                key={c.finishId}
                className="chip pn-link pn-fin-chip"
                onClick={() => f && openFinish(f.id)}
                title={f ? `${f.name}: повтор ${tileLabel(f)}${f.dado ? `, панель до ${f.dado.heightM} м` : ''} — открыть в библиотеке` : 'Отделка удалена'}
              >
                <FinishSwatch finish={f} size={12} extentM={0.6} />
                <span className="pn-ell">{f?.name ?? '(удалена)'}</span>
                <span className="mono pn-fin-p">{pct(c.p)}</span>
              </button>
            );
          })}
        </div>
      ) : (
        <div className="hint">{what} без отделки — по умолчанию.</div>
      )}
    </div>
  );
}
