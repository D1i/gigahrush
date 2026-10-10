// HUD рук «Прогулки» (src/view3d/inventory.ts): хотбар — HOTBAR_SIZE квадратных ячеек внизу по центру: номер ячейки,
// значок предмета (лут — картинка src/view3d/lootAssets.ts; нет — рисунок фонарика / лампы или «посылка» цвета предмета),
// уголок цвета редкости, бейдж ×N стека, полоска заряда / керосина, износ лампочки / фитиля, перегорел — крест, горит —
// янтарная точка; выбранная — янтарная рамка; справа — надетая сумка (заполнено / ячеек, Tab). Над хотбаром — предмет в
// руке: имя цветом редкости, редкость, клавиши, сколько света осталось (гаснет). Сверху — таймеры эффектов; пелена
// (лежит), реплика-субтитр. Стили — inventory.css (.inv-*) и view3d.css (.v3-hotbar, .v3-slot, .v3-held).
import type { InvSlotHud, InventoryHud } from './inventory';
import { lootIconUrl } from './lootAssets';
import './inventory.css';

/** Значок предмета: картинка лута или null (рисунок). */
export function iconOf(item: string): string | null {
  return lootIconUrl(item);
}

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

/** Цвет полоски заряда: полно — зелёная, середина — янтарь, на исходе — красная. */
const barColor = (v: number): string => (v > 0.5 ? '#7fc06a' : v > 0.15 ? '#e8b04b' : '#e0563f');

/** Содержимое ячейки (хотбар и панель сумки): значок, редкость, стек, заряд, износ, «горит», «перегорел». */
export function SlotView({ s }: { s: InvSlotHud }) {
  const icon = iconOf(s.item);
  return (
    <>
      {icon ? (
        <img className="inv-icon" src={icon} alt="" draggable={false} />
      ) : s.glyph === 'flash' ? (
        <FlashGlyph on={s.on} />
      ) : s.glyph === 'lamp' ? (
        <LampGlyph />
      ) : (
        <BoxGlyph s={s} />
      )}
      {s.rarity && <span className="inv-rar" style={{ borderTopColor: s.rarity }} />}
      {s.n > 1 && <span className="inv-n">×{s.n}</span>}
      {s.bar !== null && (
        <span className="inv-bar">
          <i style={{ width: `${Math.round(s.bar * 100)}%`, background: barColor(s.bar) }} />
        </span>
      )}
      {s.wear !== null && s.wear > 0 && !s.dead && (
        <span className="inv-wear" title="износ">
          <i style={{ height: `${Math.round(s.wear * 100)}%` }} />
        </span>
      )}
      {s.dead && <span className="inv-dead" title="перегорела" />}
      {s.on && <span className="v3-slot-on" />}
    </>
  );
}

export function HotbarHud({ hud }: { hud: InventoryHud }) {
  const t = hud.tip;
  const back = hud.back;
  return (
    <>
      {t && !hud.bagOpen && (
        <div key={hud.seq} className="v3-held inv-held">
          <b style={t.color ? { color: t.color } : undefined}>{t.name}</b>
          {t.rarity && <span className="inv-held-r">{t.rarity.toLowerCase()}</span>}
          <span className="inv-held-k">{t.keys}</span>
          {t.left && <span className="inv-held-l">{t.left}</span>}
        </div>
      )}
      <div className="float v3-hotbar">
        {hud.slots.map((s, i) => (
          <div key={i} className={'v3-slot' + (i === hud.sel ? ' sel' : '') + (s?.on ? ' lit' : '') + (s?.dead ? ' dead' : '')} title={s ? s.name : 'пусто'}>
            <span className="v3-slot-n">{i + 1}</span>
            {s && <SlotView s={s} />}
          </div>
        ))}
        {back && (
          <div className="inv-back" title={`${back.name}: Tab — открыть`}>
            {iconOf(back.item) ? <img className="inv-icon sm" src={iconOf(back.item)!} alt="" /> : <span className="inv-back-g">⛁</span>}
            <span className="inv-back-n">
              {back.slots.filter((x) => x).length}/{back.slots.length}
            </span>
            <span className="inv-back-k">Tab</span>
          </div>
        )}
      </div>
      {hud.fx.length > 0 && (
        <div className="inv-fx">
          {hud.fx.map((c) => (
            <span key={c.k} className={'inv-chip ' + c.tone}>
              {c.label} <b>{c.s >= 60 ? `${Math.floor(c.s / 60)}:${String(c.s % 60).padStart(2, '0')}` : c.s}</b>
            </span>
          ))}
        </div>
      )}
      {hud.veil && <div className="inv-veil" style={{ background: `rgba(0,0,0,${hud.veil.black})`, backdropFilter: hud.veil.blur > 0 ? `blur(${hud.veil.blur}px)` : undefined }} />}
      {hud.sub && <div className="inv-sub">{hud.sub}</div>}
    </>
  );
}
