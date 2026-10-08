import { Suspense, lazy, useEffect } from 'react';
import { getProject, redo, undo } from './model/store';
import { missingPresets, outdatedPresets } from './model/mergePresets';
import { notify, setUI, useToasts, useUI } from './model/ui';
import type { Page } from './model/types';
import { EditorPage } from './pages/EditorPage';
import { LibraryPage } from './pages/LibraryPage';
import { EconomyPage } from './pages/EconomyPage';
import { GeneratorPage } from './pages/GeneratorPage';
import { SpawnPage } from './pages/SpawnPage';
import { DataPage } from './pages/DataPage';

// Babylon тяжёлый — грузится только при открытии вкладки «3D»
const View3DPage = lazy(() => import('./view3d/View3DPage'));
import { SaveIndicator } from './ui/SaveIndicator';

const TABS: { id: Page; label: string }[] = [
  { id: 'editor', label: 'Комнаты' },
  { id: 'library', label: 'Библиотеки' },
  { id: 'economy', label: 'Экономика' },
  { id: 'spawn', label: 'Спавн' },
  { id: 'generator', label: 'Генератор' },
  { id: 'view3d', label: '3D' },
  { id: 'data', label: 'Данные / JSON' },
];

const isTyping = (t: EventTarget | null) =>
  t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement;

export function App() {
  const ui = useUI();

  // сохранённый проект старше пресетов — подсказать, что есть новые комнаты
  useEffect(() => {
    const m = missingPresets(getProject());
    const old = outdatedPresets(getProject());
    if (m.rooms + m.props + m.finishes + m.biomes > 0 || old > 0)
      notify(`Пресеты обновились (новых комнат ${m.rooms}, отделок ${m.finishes}, биомов ${m.biomes}, изменённых ${old}) — «Данные / JSON» → «Пресеты»`, 'info');
  }, []);

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (isTyping(e.target)) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.code === 'KeyZ') {
        e.preventDefault();
        e.shiftKey ? redo() : undo();
      } else if (mod && e.code === 'KeyY') {
        e.preventDefault();
        redo();
      }
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, []);

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <b>Room Forge</b>
          <span>гигахрущ · редактор комнат</span>
        </div>
        <nav className="tabs">
          {TABS.map((t) => (
            <button key={t.id} className={'tab' + (ui.page === t.id ? ' on' : '')} onClick={() => setUI({ page: t.id })}>
              {t.label}
            </button>
          ))}
        </nav>
        <div className="spacer" />
        <SaveIndicator />
      </header>
      <main className="page">
        {ui.page === 'editor' && <EditorPage />}
        {ui.page === 'library' && <LibraryPage />}
        {ui.page === 'economy' && <EconomyPage />}
        {ui.page === 'spawn' && <SpawnPage />}
        {ui.page === 'generator' && <GeneratorPage />}
        {ui.page === 'view3d' && (
          <Suspense fallback={<div className="empty">Загрузка 3D…</div>}>
            <View3DPage />
          </Suspense>
        )}
        {ui.page === 'data' && <DataPage />}
      </main>
      <Toasts />
    </div>
  );
}

function Toasts() {
  const toasts = useToasts();
  return (
    <div className="toasts">
      {toasts.map((t) => (
        <div key={t.id} className={'toast ' + t.kind}>
          {t.text}
        </div>
      ))}
    </div>
  );
}
