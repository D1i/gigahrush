// ТЗ §6: библиотеки проекта. Разделы: «Декор и предметы» (две колонки-списка + карточка),
// «Отделка» (список + крупный предпросмотр + карточка), «Правила отделки» (тег → варианты).
import { useEffect, useRef, useState } from 'react';
import { useProject } from '../model/store';
import { setUI, useUI } from '../model/ui';
import { PropList, ItemList } from '../library/LibLists';
import { PropCard } from '../library/PropCard';
import { ItemCard } from '../library/ItemCard';
import { FinishList, addFinish } from '../library/FinishList';
import { FinishCard, FinishStage } from '../library/FinishCard';
import { FinishRules } from '../library/FinishRules';
import { initialSection, rememberSection, sectionFor, type LibSection } from '../library/nav';
import { Btn } from '../ui/kit';
import '../library/library.css';

export function LibraryPage() {
  const p = useProject();
  const ui = useUI();
  const sel = ui.libSel;
  const [section, setSectionState] = useState<LibSection>(initialSection);
  const setSection = (s: LibSection) => {
    rememberSection(s, sel);
    setSectionState(s);
  };
  // выбор элемента другого раздела (переход по ссылке) — переключаемся на его раздел
  const prevSel = useRef(sel);
  useEffect(() => {
    if (sel === prevSel.current) return;
    prevSel.current = sel;
    if (!sel) return;
    const next = sectionFor(sel);
    rememberSection(next, sel);
    if (next !== section) setSectionState(next);
  }, [sel]);

  const openFinish = (id: string) => {
    rememberSection('finishes', sel);
    setSectionState('finishes');
    setUI({ libSel: { kind: 'finish', id } });
  };

  const tabs: { id: LibSection; label: string; n: string }[] = [
    { id: 'objects', label: 'Декор и предметы', n: `${p.props.length} · ${p.items.length}` },
    { id: 'finishes', label: 'Отделка', n: String(p.finishes.length) },
    { id: 'rules', label: 'Правила отделки', n: String(p.finishRules.length) },
  ];

  return (
    <div className="lib-page">
      <nav className="lib-tabs">
        {tabs.map((t) => (
          <button key={t.id} className={'lib-tab' + (section === t.id ? ' on' : '')} onClick={() => setSection(t.id)}>
            {t.label}
            <span className="mono lib-tab-n">{t.n}</span>
          </button>
        ))}
      </nav>
      <div className="lib-body">
        {section === 'objects' && <ObjectsSection />}
        {section === 'finishes' && <FinishesSection onOpenRules={() => setSection('rules')} />}
        {section === 'rules' && <FinishRules onOpenFinish={openFinish} />}
      </div>
    </div>
  );
}

function ObjectsSection() {
  const p = useProject();
  const sel = useUI().libSel;
  const prop = sel?.kind === 'prop' ? p.props.find((x) => x.id === sel.id) : undefined;
  const item = sel?.kind === 'item' ? p.items.find((x) => x.id === sel.id) : undefined;
  return (
    <div className="lib">
      <PropList />
      <ItemList />
      <aside className="side right lib-card">
        {prop ? (
          <PropCard key={prop.id} prop={prop} />
        ) : item ? (
          <ItemCard key={item.id} item={item} />
        ) : (
          <div className="empty">
            Выберите декор или предмет слева.
            <div className="hint" style={{ marginTop: 8 }}>
              Библиотеки общие для всего проекта: изменение габарита или текстуры сразу видно во всех комнатах.
            </div>
          </div>
        )}
      </aside>
    </div>
  );
}

function FinishesSection({ onOpenRules }: { onOpenRules: () => void }) {
  const p = useProject();
  const sel = useUI().libSel;
  const fin = sel?.kind === 'finish' ? p.finishes.find((x) => x.id === sel.id) : undefined;
  return (
    <div className="lib lib-fin">
      <FinishList />
      {fin ? (
        <FinishStage key={'s' + fin.id} finish={fin} />
      ) : (
        <section className="fin-stage fin-stage-empty">
          <div className="empty">
            Выберите отделку слева — здесь будет стена 3 × 2.5 м (или пол 3 × 3 м) в масштабе.
            <div className="row" style={{ justifyContent: 'center', marginTop: 10 }}>
              <Btn sm variant="primary" onClick={() => addFinish('wall')}>
                + отделка стен
              </Btn>
              <Btn sm variant="primary" onClick={() => addFinish('floor')}>
                + отделка пола
              </Btn>
            </div>
          </div>
        </section>
      )}
      <aside className="side right lib-card">
        {fin ? (
          <FinishCard key={fin.id} finish={fin} onOpenRules={onOpenRules} />
        ) : (
          <div className="empty">
            Отделка — обои, кафель и краска на стенах, линолеум, паркет и плитка на полу.
            <div className="hint" style={{ marginTop: 8 }}>
              Комната получает отделку по правилу своего тега (вкладка «Правила отделки») или явно — в инспекторе комнаты.
            </div>
          </div>
        )}
      </aside>
    </div>
  );
}
