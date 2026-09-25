import { useEffect } from 'react';
import { redo, undo } from './model/store';
import { setUI, useToasts, useUI } from './model/ui';
import type { Page } from './model/types';
import { EditorPage } from './pages/EditorPage';
import { LibraryPage } from './pages/LibraryPage';
import { EconomyPage } from './pages/EconomyPage';
import { GeneratorPage } from './pages/GeneratorPage';
import { DataPage } from './pages/DataPage';
import { SaveIndicator } from './ui/SaveIndicator';

const TABS: { id: Page; label: string }[] = [
  { id: 'editor', label: 'Комнаты' },
  { id: 'library', label: 'Библиотеки' },
  { id: 'economy', label: 'Экономика' },
  { id: 'generator', label: 'Генератор' },
  { id: 'data', label: 'Данные / JSON' },
];

const isTyping = (t: EventTarget | null) =>
  t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement;

export function App() {
  const ui = useUI();

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
        {ui.page === 'generator' && <GeneratorPage />}
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
