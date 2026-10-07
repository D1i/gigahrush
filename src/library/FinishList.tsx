// Колонка-список отделок: фильтр «все / стены / пол», поиск, тег; образец в масштабе 1 м.
import { useState } from 'react';
import type { Finish, FinishSurface } from '../model/types';
import { mutate, useProject } from '../model/store';
import { setUI, useUI } from '../model/ui';
import { createFinish, finishUsage } from '../model/ops';
import { Btn } from '../ui/kit';
import { FinishSwatch } from './FinishSwatch';
import { allFinishTags } from './finishUse';
import { tileLabel } from './finishTex';

type SurfFilter = 'all' | FinishSurface;
let lastFilter: SurfFilter = 'all';

export function addFinish(surface: FinishSurface) {
  let id = '';
  mutate((pr) => {
    const n = pr.finishes.filter((f) => f.surface === surface).length + 1;
    id = createFinish(pr, surface, { name: surface === 'wall' ? `Стены ${n}` : `Пол ${n}` }).id;
  });
  if (id) setUI({ libSel: { kind: 'finish', id } });
}

function usage(p: ReturnType<typeof useProject>, id: string) {
  try {
    return finishUsage(p, id);
  } catch {
    return { rooms: 0, rules: 0, dado: 0, total: 0 };
  }
}

export function FinishList() {
  const p = useProject();
  const ui = useUI();
  const [surf, setSurfState] = useState<SurfFilter>(lastFilter);
  const setSurf = (s: SurfFilter) => {
    lastFilter = s;
    setSurfState(s);
  };
  const [q, setQ] = useState('');
  const [tag, setTag] = useState('');
  const s = q.trim().toLowerCase();
  const match = (f: Finish) => {
    if (surf !== 'all' && f.surface !== surf) return false;
    if (tag && !f.tags.includes(tag)) return false;
    return !s || f.name.toLowerCase().includes(s) || f.tags.some((t) => t.toLowerCase().includes(s));
  };
  // стены, затем пол — в порядке проекта
  const list = [...p.finishes.filter((f) => f.surface === 'wall'), ...p.finishes.filter((f) => f.surface === 'floor')].filter(match);
  const nWall = p.finishes.filter((f) => f.surface === 'wall').length;
  const tags = allFinishTags(p);
  const byId = new Map(p.finishes.map((f) => [f.id, f]));

  let lastSurf: FinishSurface | null = null;
  return (
    <section className="lib-col">
      <div className="lib-col-h">
        <span className="cap">
          Отделка <span className="mono lib-count">{p.finishes.length}</span>
        </span>
        <Btn sm variant="primary" onClick={() => addFinish('wall')} title="Обои, кафель, покраска стен">
          + отделка стен
        </Btn>
        <Btn sm variant="primary" onClick={() => addFinish('floor')} title="Линолеум, паркет, плитка">
          + отделка пола
        </Btn>
      </div>
      <div className="lib-filters fin-filters">
        <div className="lib-seg">
          {(
            [
              ['all', 'все', p.finishes.length],
              ['wall', 'стены', nWall],
              ['floor', 'пол', p.finishes.length - nWall],
            ] as const
          ).map(([k, label, n]) => (
            <button key={k} className={surf === k ? 'on' : ''} onClick={() => setSurf(k)}>
              {label} <span className="mono">{n}</span>
            </button>
          ))}
        </div>
        <input className="input" placeholder="Поиск" value={q} onChange={(e) => setQ(e.target.value)} />
        {tags.length > 0 && (
          <select className="select lib-tagsel fin-tagsel" value={tag} onChange={(e) => setTag(e.target.value)} title="Фильтр по тегу">
            <option value="">все теги</option>
            {tags.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        )}
      </div>
      <div className="lib-scroll list">
        {list.map((f) => {
          const on = ui.libSel?.kind === 'finish' && ui.libSel.id === f.id;
          const u = usage(p, f.id);
          const head =
            surf === 'all' && f.surface !== lastSurf ? (
              <div key={'h-' + f.surface} className="fin-group-h cap">
                {f.surface === 'wall' ? 'Стены' : 'Пол'}
              </div>
            ) : null;
          lastSurf = f.surface;
          const dado = f.dado ? byId.get(f.dado.finishId) : undefined;
          return [
            head,
            <div key={f.id} className={'li lib-li' + (on ? ' on' : '')} onClick={() => setUI({ libSel: { kind: 'finish', id: f.id } })}>
              <FinishSwatch
                finish={f}
                size={40}
                extentM={1}
                dado={f.dado ? { finish: dado, heightM: f.dado.heightM } : null}
                title={`${f.name}: образец 1 × 1 м${f.dado ? `; снизу — панель до ${f.dado.heightM} м` : ''}`}
              />
              <div className="lib-li-body">
                <div className="row">
                  <span className="name">{f.name || <i className="muted">без имени</i>}</span>
                  <span className="meta" title="Размер одного повтора текстуры">
                    {tileLabel(f)}
                  </span>
                </div>
                <div className="lib-tags">
                  {f.tex ? <span className="lib-tag tex">текстура</span> : <span className="lib-tag">цвет</span>}
                  {f.dado && (
                    <span className="lib-tag fin-dado-tag" title={`Нижняя панель «${dado?.name ?? '?'}» до ${f.dado.heightM} м`}>
                      панель {+f.dado.heightM.toFixed(2)} м
                    </span>
                  )}
                  {f.tags.map((t) => (
                    <span key={t} className="lib-tag">
                      {t}
                    </span>
                  ))}
                </div>
              </div>
              <span
                className={'lib-use mono' + (u.total ? '' : ' zero')}
                title={`Явно в комнатах: ${u.rooms}, в правилах: ${u.rules}, нижней панелью: ${u.dado}`}
              >
                {u.total}
              </span>
            </div>,
          ];
        })}
        {list.length === 0 && <div className="empty">{p.finishes.length ? 'Ничего не найдено' : 'Отделок пока нет'}</div>}
      </div>
    </section>
  );
}
