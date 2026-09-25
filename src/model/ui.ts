// Состояние интерфейса (не сериализуется в проект). Тот же паттерн, что store.ts.
import { useSyncExternalStore } from 'react';
import type { LayerKey, Page, Run, Selection, Tool } from './types';

export interface UIState {
  page: Page;
  /** выбранная комната в редакторе */
  roomId: string | null;
  tool: Tool;
  /** режим инструментов формы; Shift инвертирует на время жеста */
  toolMode: 'add' | 'sub';
  /** диаметр кисти, м */
  brushM: number;
  /** длина новой двери, клеток */
  doorLen: number;
  /** длина новой метки, клеток */
  connectorLen: number;
  /** метка для новых connector */
  connectorTag: string;
  /** какой декор ставит инструмент decor */
  decorPropId: string | null;
  /** в какую группу кладутся новые споты (null — без группы) */
  spotGroupId: string | null;
  layers: Record<LayerKey, boolean>;
  selection: Selection;
  /** открыт редактор вариантов для группы (модалка) */
  variantsGroupId: string | null;
  /** последний прогон генератора */
  run: Run | null;
  /** выделенный экземпляр в предпросмотре */
  runInst: string | null;
  /** выбранный элемент в библиотеке */
  libSel: { kind: 'prop' | 'item'; id: string } | null;
}

let state: UIState = {
  page: 'editor',
  roomId: null,
  tool: 'select',
  toolMode: 'add',
  brushM: 0.6,
  doorLen: 8,
  connectorLen: 8,
  connectorTag: 'door',
  decorPropId: null,
  spotGroupId: null,
  layers: { grid: true, doors: true, connectors: true, decor: true, spots: true },
  selection: null,
  variantsGroupId: null,
  run: null,
  runInst: null,
  libSel: null,
};

const listeners = new Set<() => void>();
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export function getUI(): UIState {
  return state;
}

export function setUI(patch: Partial<UIState> | ((s: UIState) => Partial<UIState>)) {
  const p = typeof patch === 'function' ? patch(state) : patch;
  state = { ...state, ...p };
  listeners.forEach((l) => l());
}

export function useUI(): UIState {
  return useSyncExternalStore(subscribe, getUI);
}

// ───────────── уведомления ─────────────

export interface Toast {
  id: number;
  text: string;
  kind: 'info' | 'warn' | 'error' | 'ok';
}

let toasts: Toast[] = [];
let toastSeq = 0;
const toastListeners = new Set<() => void>();

export function notify(text: string, kind: Toast['kind'] = 'info') {
  const t = { id: ++toastSeq, text, kind };
  toasts = [...toasts, t];
  toastListeners.forEach((l) => l());
  setTimeout(() => {
    toasts = toasts.filter((x) => x.id !== t.id);
    toastListeners.forEach((l) => l());
  }, kind === 'error' ? 6000 : 3500);
}

export function useToasts(): Toast[] {
  return useSyncExternalStore(
    (l) => {
      toastListeners.add(l);
      return () => toastListeners.delete(l);
    },
    () => toasts,
  );
}
