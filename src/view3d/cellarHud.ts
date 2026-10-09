// HUD погреба (src/view3d/cellarWalk.ts) — свой DOM поверх холста, без React: страница только создаёт CellarWalk
// (элемент сцены — BlockoutViewer.host). Засыпало — почти чёрный экран (светлеет с откопкой); треск крепей —
// виньетка; пыль после обвала — бурая пелена; подсказка действия (E — откапываться / разгребать) и подсказка
// «повернись боком» / «тесно». Обновляется только когда изменилось.
import './cellar.css';

export interface CellarHud {
  /** игрок в погребе (от первого лица) */
  on: boolean;
  /** засыпан: прогресс откопки 0…1 */
  buried: number | null;
  /** треск: сыплется земля (0…1 — скоро рухнет) */
  crack: number | null;
  /** пыль после обвала 0…1 */
  dust: number;
  /** подсказка действия (E) */
  prompt: string | null;
  /** подсказка: повернись боком / тесно */
  hint: string | null;
  /** протискивается боком */
  side: boolean;
}

export const HUD_OFF: CellarHud = { on: false, buried: null, crack: null, dust: 0, prompt: null, hint: null, side: false };

/** Ключ для «изменилось ли» (доли — округлены). */
export function hudKey(h: CellarHud): string {
  const r = (v: number | null) => (v === null ? '' : String(Math.round(v * 20)));
  return `${h.on ? 1 : 0}|${r(h.buried)}|${r(h.crack)}|${r(h.dust)}|${h.prompt ?? ''}|${h.hint ?? ''}|${h.side ? 1 : 0}`;
}

export class CellarHudView {
  private root: HTMLDivElement | null = null;
  private buried: HTMLDivElement | null = null;
  private crack: HTMLDivElement | null = null;
  private dust: HTMLDivElement | null = null;
  private prompt: HTMLDivElement | null = null;
  private hint: HTMLDivElement | null = null;
  private hintText = '';

  constructor(host: HTMLElement | null | undefined) {
    if (!host || typeof document === 'undefined') return;
    const div = (cls: string) => {
      const d = document.createElement('div');
      d.className = cls;
      d.style.display = 'none';
      return d;
    };
    const root = (this.root = div('v3-cel'));
    this.dust = div('v3-cel-dust');
    this.crack = div('v3-cel-crack');
    this.buried = div('v3-cel-buried');
    this.prompt = div('float hud v3-cel-prompt');
    this.hint = div('float hud v3-cel-hint');
    root.append(this.dust, this.crack, this.buried, this.prompt, this.hint);
    host.appendChild(root);
  }

  /** Показать состояние; promptOk — подсказку действия можно (у игрока нет своей: подобрать, дверь, откопать). */
  show(h: CellarHud, promptOk = true) {
    if (!this.root) return;
    this.root.style.display = h.on ? '' : 'none';
    if (!h.on) return;
    const vis = (el: HTMLDivElement | null, on: boolean, opacity?: number) => {
      if (!el) return;
      el.style.display = on ? '' : 'none';
      if (on && opacity !== undefined) el.style.opacity = opacity.toFixed(3);
    };
    vis(this.buried, h.buried !== null, h.buried !== null ? 0.97 - 0.45 * h.buried : 0);
    vis(this.crack, h.crack !== null, h.crack !== null ? 0.2 + 0.55 * h.crack : 0);
    vis(this.dust, h.dust > 0.01, 0.75 * h.dust);
    const p = promptOk || h.buried !== null ? h.prompt : null;
    if (this.prompt) {
      this.prompt.style.display = p ? '' : 'none';
      if (p && this.prompt.textContent !== p) this.prompt.textContent = p;
    }
    if (this.hint) {
      const t = h.hint && h.buried === null ? h.hint : '';
      this.hint.style.display = t ? '' : 'none';
      if (t !== this.hintText) {
        this.hintText = t;
        this.hint.textContent = t;
        // заново — с проявлением
        if (t) {
          this.hint.style.animation = 'none';
          void this.hint.offsetWidth;
          this.hint.style.animation = '';
        }
      }
    }
  }

  dispose() {
    this.root?.remove();
    this.root = null;
  }
}
