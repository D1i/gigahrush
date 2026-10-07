// Колонки-списки библиотек: декор и предметы. Поиск по имени/тегу + фильтр по тегу.
import { useState, type ReactNode } from 'react';
import { mutate, useProject } from '../model/store';
import { setUI, useUI } from '../model/ui';
import { createItem, createProp, itemUsage, propUsage } from '../model/ops';
import { Btn } from '../ui/kit';
import { PropThumb } from './PropView';
import { allItemTags, allPropTags, isCurrency } from './usage';

function ListColumn(props: {
  title: string;
  count: number;
  addLabel: string;
  onAdd: () => void;
  tags: string[];
  q: string;
  setQ: (s: string) => void;
  tag: string;
  setTag: (s: string) => void;
  children: ReactNode;
  empty: boolean;
}) {
  return (
    <section className="lib-col">
      <div className="lib-col-h">
        <span className="cap">
          {props.title} <span className="mono lib-count">{props.count}</span>
        </span>
        <Btn sm variant="primary" onClick={props.onAdd}>
          {props.addLabel}
        </Btn>
      </div>
      <div className="lib-filters">
        <input className="input" placeholder="Поиск по имени или тегу" value={props.q} onChange={(e) => props.setQ(e.target.value)} />
        <select className="select lib-tagsel" value={props.tag} onChange={(e) => props.setTag(e.target.value)} title="Фильтр по тегу">
          <option value="">все теги</option>
          {props.tags.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </div>
      <div className="lib-scroll list">
        {props.children}
        {props.empty && <div className="empty">Ничего не найдено</div>}
      </div>
    </section>
  );
}

const match = (name: string, tags: string[], q: string, tag: string) => {
  if (tag && !tags.includes(tag)) return false;
  if (!q) return true;
  return name.toLowerCase().includes(q) || tags.some((t) => t.toLowerCase().includes(q));
};

export function PropList() {
  const p = useProject();
  const ui = useUI();
  const [q, setQ] = useState('');
  const [tag, setTag] = useState('');
  const s = q.trim().toLowerCase();
  const list = p.props.filter((x) => match(x.name, x.tags, s, tag));

  const add = () => {
    let id = '';
    mutate((pr) => {
      id = createProp(pr, { name: `Декор ${pr.props.length + 1}` }).id;
    });
    if (id) setUI({ libSel: { kind: 'prop', id } });
  };

  return (
    <ListColumn
      title="Декор"
      count={p.props.length}
      addLabel="+ декор"
      onAdd={add}
      tags={allPropTags(p)}
      q={q}
      setQ={setQ}
      tag={tag}
      setTag={setTag}
      empty={list.length === 0}
    >
      {list.map((x) => {
        const on = ui.libSel?.kind === 'prop' && ui.libSel.id === x.id;
        const used = propUsage(p, x.id);
        return (
          <div key={x.id} className={'li lib-li' + (on ? ' on' : '')} onClick={() => setUI({ libSel: { kind: 'prop', id: x.id } })}>
            <PropThumb prop={x} size={40} />
            <div className="lib-li-body">
              <div className="row">
                <span className="name">{x.name || <i className="muted">без имени</i>}</span>
                <span className="meta">
                  {x.w.toFixed(2)} × {x.h.toFixed(2)} м
                </span>
              </div>
              <div className="lib-tags">
                {x.tags.map((t) => (
                  <span key={t} className="lib-tag">
                    {t}
                  </span>
                ))}
                {x.tex && <span className="lib-tag tex">текстура</span>}
              </div>
            </div>
            <span className={'lib-use mono' + (used.total ? '' : ' zero')} title={`Экземпляров декора: ${used.decor}, назначений в вариантах: ${used.assigns}, комнат: ${used.rooms}`}>
              {used.total}
            </span>
          </div>
        );
      })}
    </ListColumn>
  );
}

export function ItemList() {
  const p = useProject();
  const ui = useUI();
  const [q, setQ] = useState('');
  const [tag, setTag] = useState('');
  const s = q.trim().toLowerCase();
  // валюты — сверху: это опорные предметы экономики
  const list = p.items
    .filter((x) => match(x.name, x.tags, s, tag))
    .sort((a, b) => Number(isCurrency(b)) - Number(isCurrency(a)));

  const add = () => {
    let id = '';
    mutate((pr) => {
      id = createItem(pr, { name: `Предмет ${pr.items.length + 1}` }).id;
    });
    if (id) setUI({ libSel: { kind: 'item', id } });
  };

  return (
    <ListColumn
      title="Предметы"
      count={p.items.length}
      addLabel="+ предмет"
      onAdd={add}
      tags={allItemTags(p)}
      q={q}
      setQ={setQ}
      tag={tag}
      setTag={setTag}
      empty={list.length === 0}
    >
      {list.map((x) => {
        const on = ui.libSel?.kind === 'item' && ui.libSel.id === x.id;
        const used = itemUsage(p, x.id);
        return (
          <div key={x.id} className={'li lib-li' + (on ? ' on' : '')} onClick={() => setUI({ libSel: { kind: 'item', id: x.id } })}>
            <span className="lib-marker" style={{ background: x.color }} />
            <div className="lib-li-body">
              <div className="row">
                <span className="name">{x.name || <i className="muted">без имени</i>}</span>
                {isCurrency(x) && <span className="chip accent">валюта</span>}
              </div>
              <div className="lib-tags">
                {x.tags
                  .filter((t) => t !== 'currency')
                  .map((t) => (
                    <span key={t} className="lib-tag">
                      {t}
                    </span>
                  ))}
              </div>
            </div>
            <span
              className={'lib-use mono' + (used.total ? '' : ' zero')}
              title={`В луте: ${used.loot}, в вариантах: ${used.assigns}, в экономике: ${used.economy}, комнат: ${used.rooms}`}
            >
              {used.total}
            </span>
          </div>
        );
      })}
    </ListColumn>
  );
}
