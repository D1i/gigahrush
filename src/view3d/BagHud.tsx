// Панель сумки «Прогулки» (Tab, src/view3d/inventory.ts): ячейки надетой сумки и хотбара. Клик — переложить (из сумки —
// в хотбар, из хотбара — в сумку), перетащить — в конкретную ячейку (обмен / долить стек), ПКМ — выбросить перед собой,
// «Снять сумку» — в хотбар (только пустую: «Сначала выложи вещи»). Наведение — подсказка: имя, редкость, заметка, цена
// у торговца («не продаётся» — керосинка). Мышь на время панели отпущена; Tab — закрыть (и захватить снова), Esc —
// закрыть. Стили — inventory.css (.inv-bag*).
import { useState, type DragEvent, type MouseEvent } from 'react';
import type { Loc } from '../game/hotbar';
import { itemTip, type InvSlotHud, type InventoryHud } from './inventory';
import { SlotView } from './HotbarHud';

/** Что панель умеет делать с руками (Inventory). */
export interface BagActions {
  autoMove(at: Loc): boolean;
  moveSlot(from: Loc, to: Loc): boolean;
  dropAt(at: Loc): Promise<boolean>;
  takeOffBag(): boolean;
  closeBag(relock?: boolean): void;
}

const locKey = (l: Loc) => `${l.bag ? 'b' : 'h'}${l.i}`;
const parseLoc = (t: string): Loc | null => {
  const m = /^([bh])(\d+)$/.exec(t);
  return m ? { bag: m[1] === 'b', i: Number(m[2]) } : null;
};

function Cell(props: { s: InvSlotHud | null; at: Loc; sel?: boolean; num?: number; act: BagActions; onTip: (item: string | null) => void }) {
  const { s, at, act } = props;
  const [over, setOver] = useState(false);
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    const from = parseLoc(e.dataTransfer.getData('text/plain'));
    if (from && locKey(from) !== locKey(at)) act.moveSlot(from, at);
  };
  const onContext = (e: MouseEvent) => {
    e.preventDefault();
    if (s) void act.dropAt(at);
  };
  return (
    <div
      className={'v3-slot inv-cell' + (props.sel ? ' sel' : '') + (s?.on ? ' lit' : '') + (s?.dead ? ' dead' : '') + (over ? ' over' : '') + (s ? '' : ' empty')}
      draggable={!!s}
      onDragStart={(e) => e.dataTransfer.setData('text/plain', locKey(at))}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={onDrop}
      onClick={() => s && act.autoMove(at)}
      onContextMenu={onContext}
      onMouseEnter={() => props.onTip(s?.item ?? null)}
      onMouseLeave={() => props.onTip(null)}
    >
      {props.num !== undefined && <span className="v3-slot-n">{props.num}</span>}
      {s && <SlotView s={s} />}
    </div>
  );
}

export function BagHud({ hud, act }: { hud: InventoryHud; act: BagActions }) {
  const [tipItem, setTip] = useState<string | null>(null);
  const tip = tipItem ? itemTip(tipItem) : null;
  const back = hud.back;
  const used = back ? back.slots.filter((x) => x).length : 0;
  return (
    <div className="inv-bag-wrap" onContextMenu={(e) => e.preventDefault()}>
      <div className="float inv-bag">
        <div className="inv-bag-head">
          <span className="inv-bag-t">{back ? `${back.name} · ${used}/${back.slots.length}` : 'Сумки нет'}</span>
          {back && (
            <button className="btn inv-bag-off" onClick={() => act.takeOffBag()} title="Только пустую: сначала выложи вещи">
              Снять сумку
            </button>
          )}
          <button className="btn inv-bag-x" onClick={() => act.closeBag(true)} title="Tab">
            ✕
          </button>
        </div>
        {back ? (
          <div className="inv-grid">
            {back.slots.map((s, i) => (
              <Cell key={'b' + i} s={s} at={{ bag: true, i }} act={act} onTip={setTip} />
            ))}
          </div>
        ) : (
          <div className="inv-bag-none">Надень сумку: возьми её в руку и ЛКМ — или подбери, пока спина пуста.</div>
        )}
        <div className="inv-bag-sep">Хотбар</div>
        <div className="inv-grid">
          {hud.slots.map((s, i) => (
            <Cell key={'h' + i} s={s} at={{ bag: false, i }} sel={i === hud.sel} num={i + 1} act={act} onTip={setTip} />
          ))}
        </div>
        <div className="inv-tip">
          {tip ? (
            <>
              <div className="inv-tip-h">
                <b style={tip.color ? { color: tip.color } : undefined}>{tip.name}</b>
                {tip.rarity && <span className="inv-tip-r" style={{ color: tip.color ?? undefined }}>{tip.rarity}</span>}
                {tip.price && <span className={'inv-tip-p' + (tip.price === 'не продаётся' ? ' no' : '')}>{tip.price}</span>}
              </div>
              {tip.note && <div className="inv-tip-n">{tip.note}</div>}
            </>
          ) : (
            <div className="inv-tip-n muted">клик — переложить · перетащить — в ячейку · ПКМ — выбросить · Tab — закрыть</div>
          )}
        </div>
      </div>
    </div>
  );
}
