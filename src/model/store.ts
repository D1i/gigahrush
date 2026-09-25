// Единый объект проекта в памяти + подписка React + автосохранение + undo/redo.
// Проект мутируется на месте внутри mutate(); после каждого mutate растёт version и все
// подписчики перерисовываются.
import { useSyncExternalStore } from 'react';
import type { Project } from './types';
import { parseProject, serializeProject, type ProjectJSON } from './serialize';
import { createDefaultProject } from '../data/presets';

export const LS_KEY = 'room-forge/project/v1';

let project: Project;
let version = 0;
const listeners = new Set<() => void>();

function load(): Project {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(LS_KEY) : null;
    if (raw) return parseProject(JSON.parse(raw));
  } catch (e) {
    console.warn('Room Forge: сохранение не читается, загружаю пресеты', e);
  }
  return createDefaultProject();
}

project = load();

function emit() {
  version++;
  listeners.forEach((l) => l());
}

export function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

export function getProject(): Project {
  return project;
}

export function getVersion(): number {
  return version;
}

/** Подписка на проект: компонент перерисовывается после каждого mutate. */
export function useProject(): Project {
  useSyncExternalStore(subscribe, getVersion);
  return project;
}

// ───────────── undo / redo ─────────────

const undoStack: ProjectJSON[] = [];
const redoStack: ProjectJSON[] = [];
let lastKey: string | undefined;
let lastAt = 0;
const UNDO_LIMIT = 80;

/** Снимок перед изменением. Вызывать вручную в начале протяжки (mousedown). */
export function checkpoint(key?: string) {
  const now = Date.now();
  if (key && key === lastKey && now - lastAt < 1000) {
    lastAt = now;
    return;
  }
  lastKey = key;
  lastAt = now;
  undoStack.push(serializeProject(project));
  if (undoStack.length > UNDO_LIMIT) undoStack.shift();
  redoStack.length = 0;
}

export function canUndo() {
  return undoStack.length > 0;
}
export function canRedo() {
  return redoStack.length > 0;
}

export function undo() {
  const snap = undoStack.pop();
  if (!snap) return;
  redoStack.push(serializeProject(project));
  project = parseProject(snap);
  lastKey = undefined;
  scheduleSave();
  emit();
}

export function redo() {
  const snap = redoStack.pop();
  if (!snap) return;
  undoStack.push(serializeProject(project));
  project = parseProject(snap);
  lastKey = undefined;
  scheduleSave();
  emit();
}

export interface MutateOpts {
  /** false — не делать снимок (протяжка, где снимок сделан на mousedown). По умолчанию true. */
  undo?: boolean;
  /** Ключ слияния: подряд идущие изменения с одним ключом (ввод в поле) — один шаг undo. */
  key?: string;
}

/** Единственный способ менять проект. */
export function mutate(fn: (p: Project) => void, opts: MutateOpts = {}) {
  if (opts.undo !== false) checkpoint(opts.key);
  fn(project);
  scheduleSave();
  emit();
}

/** Полная замена (импорт / сброс к пресетам). */
export function replaceProject(p: Project) {
  checkpoint();
  project = p;
  scheduleSave();
  emit();
}

// ───────────── автосохранение ─────────────

let saveTimer: ReturnType<typeof setTimeout> | null = null;
let saveListeners = new Set<(ok: boolean, bytes: number, err?: string) => void>();

export function onSave(l: (ok: boolean, bytes: number, err?: string) => void) {
  saveListeners.add(l);
  return () => {
    saveListeners.delete(l);
  };
}

function scheduleSave() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 500);
}

export function saveNow() {
  saveTimer = null;
  try {
    const s = JSON.stringify(serializeProject(project));
    localStorage.setItem(LS_KEY, s);
    saveListeners.forEach((l) => l(true, s.length));
  } catch (e: any) {
    saveListeners.forEach((l) => l(false, 0, String(e?.message ?? e)));
  }
}
