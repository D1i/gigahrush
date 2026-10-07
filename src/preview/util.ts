// Мелкие утилиты предпросмотра и страницы данных: файлы, буфер обмена, сиды, цвета.
import { notify } from '../model/ui';
import type { Project } from '../model/types';

/** Скачать текст как файл. */
export function downloadText(name: string, text: string, mime = 'application/json') {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Копировать в буфер обмена с уведомлением. */
export async function copyText(text: string, what = 'JSON') {
  try {
    await navigator.clipboard.writeText(text);
    notify(`${what} скопирован (${fmtKB(byteLen(text))})`, 'ok');
  } catch (e: any) {
    notify('Не удалось скопировать: ' + String(e?.message ?? e), 'error');
  }
}

/** Длина строки в байтах UTF-8. */
export function byteLen(s: string): number {
  return new TextEncoder().encode(s).length;
}

export function fmtKB(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(2)} МБ`;
  return `${(bytes / 1024).toFixed(1)} КБ`;
}

/** Имя файла без запрещённых символов. */
export function safeName(s: string): string {
  return s.replace(/[^\p{L}\p{N}._-]+/gu, '_').slice(0, 60) || 'run';
}

/** Соседний сид: hrush-001 → hrush-002 (сохраняя ширину числа); без числа — дописывает -001. */
export function stepSeed(seed: string, d: number): string {
  const m = /^(.*?)(\d+)$/.exec(seed);
  if (!m) return `${seed || 'hrush'}-${String(Math.max(1, d)).padStart(3, '0')}`;
  const n = Math.max(0, parseInt(m[2], 10) + d);
  return m[1] + String(n).padStart(m[2].length, '0');
}

export function randomSeed(): string {
  return 'hrush-' + String(Math.floor(Math.random() * 1000)).padStart(3, '0') + Math.random().toString(36).slice(2, 5);
}

// ───────────── цвета ─────────────

function hexRgb(h: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(h.trim());
  if (!m) return [128, 128, 128];
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Линейная интерполяция по опорным цветам, t ∈ [0, 1]. */
export function ramp(stops: string[], t: number): string {
  const tt = Math.max(0, Math.min(1, Number.isFinite(t) ? t : 0));
  const f = tt * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(f));
  const k = f - i;
  const a = hexRgb(stops[i]);
  const b = hexRgb(stops[i + 1]);
  const c = a.map((v, j) => Math.round(v + (b[j] - v) * k));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

/** Смешать цвет с полом (для полупрозрачных заливок без альфы). */
export function mix(a: string, b: string, k: number): string {
  const x = hexRgb(a);
  const y = hexRgb(b);
  const c = x.map((v, j) => Math.round(v + (y[j] - v) * k));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

export const HEAT = ['#8fb86f', '#e8b04b', '#d8604a', '#8e2a2a'];
export const DEPTH = ['#d9e4ef', '#8fb0d8', '#4f6fa8', '#3b3570'];

/** Цвет подписи на цветном фоне. */
export function inkOn(bg: string): string {
  const [r, g, b] = hexRgb(bg);
  return r * 0.299 + g * 0.587 + b * 0.114 > 150 ? '#1a1408' : '#f2eee6';
}

// ───────────── поиск по проекту ─────────────

export const itemById = (p: Project, id: string) => p.items.find((i) => i.id === id);
export const propById = (p: Project, id: string) => p.props.find((i) => i.id === id);
export const tierById = (p: Project, id: string | null) => (id ? p.economy.tiers.find((t) => t.id === id) : undefined);
export const isCurrency = (p: Project, itemId: string) => !!itemById(p, itemId)?.tags.includes('currency');

/** Вызов функции-контракта, которая может быть ещё не реализована. */
export function safe<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

// ───────────── слои складчатого прогона ─────────────

/** Цвет слоя W: категориальный, соседние W заметно различаются (шаг по золотому углу). */
export function layerColor(w: number, l = 64): string {
  const h = (((200 + w * 137.508) % 360) + 360) % 360;
  return `hsl(${h.toFixed(0)} 62% ${l}%)`;
}

/** Подпись сдвига слоя: +1 / −2. */
export const dwText = (dw: number) => (dw > 0 ? `+${dw}` : `−${-dw}`);
/** Подпись слоя: W 0 / W +1 / W −2. */
export const wText = (w: number) => (w === 0 ? 'W 0' : `W ${dwText(w)}`);

/** Цвет порога со сдвигом слоя. */
export const SHIFT_COLOR = '#b67cff';
