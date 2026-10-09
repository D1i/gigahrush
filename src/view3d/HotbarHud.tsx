// HUD рук «Прогулки» (src/view3d/inventory.ts): хотбар — HOTBAR_SIZE квадратных ячеек внизу по центру, номер ячейки
// в углу, значок предмета (фонарик и керосиновая лампа — рисунки; горит — янтарная точка и луч), выбранная — янтарная рамка; над хотбаром —
// имя предмета в руке (гаснет). Стили — view3d.css (.v3-hotbar, .v3-held).
import type { InvSlotHud, InventoryHud } from './inventory';

/** Фонарик сбоку, линзой вверх-вправо: корпус, полоса наклейки, ползунок, раструб, ободок; горит — луч из линзы. */
function FlashGlyph({ on }: { on: boolean }) {
  return (
    <svg className="v3-glyph" viewBox="0 0 32 32" width="36" height="36" aria-hidden>
      <g transform="rotate(-38 16 16)">
        {on && <path d="M24.4 12.6 L33 7.5 L33 24.5 L24.4 19.4 Z" fill="#ffcf6e" opacity="0.38" />}
        <rect x="2.4" y="13.3" width="2.2" height="5.4" rx="0.7" fill="#9a9a92" />
        <rect x="4.2" y="13" width="13" height="6" rx="1" fill="#5b6650" stroke="#0d0f0a" strokeWidth="0.7" />
        <rect x="4.6" y="13.5" width="12.4" height="1.3" rx="0.6" fill="#8c987e" opacity="0.8" />
        <rect x="7" y="13" width="3.6" height="6" fill="#a53a26" />
        <path d="M17 13 L20.2 11.4 L20.2 20.6 L17 19 Z" fill="#5b6650" stroke="#0d0f0a" strokeWidth="0.7" strokeLinejoin="round" />
        <rect x="20.2" y="11.4" width="2.8" height="9.2" fill="#5b6650" stroke="#0d0f0a" strokeWidth="0.7" />
        <rect x="22.8" y="10.9" width="1.8" height="10.2" rx="0.5" fill="#cfcfc4" />
        <rect x={on ? 13.6 : 12} y="11.5" width="2.6" height="1.7" rx="0.4" fill="#c0392b" />
        {on && <rect x="24.2" y="12.3" width="0.9" height="7.4" fill="#fff2c4" />}
      </g>
    </svg>
  );
}

/** Керосиновая лампа «летучая мышь» (общага): дужка, колпак, стекло с огоньком, проволочная клетка, бачок. */
function LampGlyph() {
  return (
    <svg className="v3-glyph" viewBox="0 0 32 32" width="36" height="36" aria-hidden>
      <path d="M11.2 9 Q16 1.8 20.8 9" fill="none" stroke="#c9c2b0" strokeWidth="1.3" />
      <rect x="11.4" y="8" width="9.2" height="3" rx="1" fill="#9c3d22" stroke="#0d0f0a" strokeWidth="0.7" />
      <ellipse cx="16" cy="16.8" rx="4.8" ry="5.8" fill="#ffd98a" opacity="0.5" stroke="#0d0f0a" strokeWidth="0.6" />
      <path d="M16 13.2 Q18.2 16.8 16 19.8 Q13.8 16.8 16 13.2 Z" fill="#ffae3c" />
      <path d="M11.6 11 L11.6 22 M20.4 11 L20.4 22" stroke="#c9c2b0" strokeWidth="1" />
      <rect x="9.4" y="22" width="13.2" height="6.6" rx="2.2" fill="#9c3d22" stroke="#0d0f0a" strokeWidth="0.7" />
      <rect x="10.6" y="23.3" width="10.8" height="1.1" rx="0.5" fill="#c4643f" opacity="0.8" />
    </svg>
  );
}

/** Предмет без своего рисунка: посылка цвета предмета и первые буквы имени. */
function BoxGlyph({ s }: { s: InvSlotHud }) {
  return (
    <span className="v3-glyph-box" style={{ background: s.color }}>
      {s.name.slice(0, 3)}
    </span>
  );
}

export function HotbarHud({ hud }: { hud: InventoryHud }) {
  return (
    <>
      {hud.held && (
        <div key={hud.seq} className="v3-held">
          {hud.held}
        </div>
      )}
      <div className="float v3-hotbar">
        {hud.slots.map((s, i) => (
          <div key={i} className={'v3-slot' + (i === hud.sel ? ' sel' : '') + (s?.on ? ' lit' : '')} title={s ? s.name : 'пусто'}>
            <span className="v3-slot-n">{i + 1}</span>
            {s && (s.glyph === 'flash' ? <FlashGlyph on={s.on} /> : s.glyph === 'lamp' ? <LampGlyph /> : <BoxGlyph s={s} />)}
            {s?.on && <span className="v3-slot-on" />}
          </div>
        ))}
      </div>
    </>
  );
}
