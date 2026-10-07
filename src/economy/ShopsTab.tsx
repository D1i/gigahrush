// Магазины: список + редактор, справа — «ветки закупки» валюта → магазин → товары.
import type { Project, Shop } from '../model/types';
import { useProject } from '../model/store';
import { setUI } from '../model/ui';
import { uid } from '../model/ops';
import { Btn, NumField, Section, TextField } from '../ui/kit';
import { ItemSelect, editEco, isCurrency, itemColor, itemName, sortedTiers } from './shared';

function editShop(id: string, fn: (s: Shop) => void, key?: string) {
  editEco((e) => {
    const s = e.shops.find((x) => x.id === id);
    if (s) fn(s);
  }, key ? `shop-${key}-${id}` : undefined);
}

export function ShopsTab({ sel, setSel }: { sel: string | null; setSel: (id: string | null) => void }) {
  const p = useProject();
  const shops = p.economy.shops;
  const shop = shops.find((s) => s.id === sel) ?? shops[0] ?? null;
  const currencies = p.items.filter(isCurrency);

  const add = () => {
    let id = '';
    editEco((e, pr) => {
      const s: Shop = { id: uid('shop'), name: `Магазин ${e.shops.length + 1}`, currencyItemId: pr.items.find(isCurrency)?.id ?? '', offers: [], note: '' };
      e.shops.push(s);
      id = s.id;
    });
    setSel(id);
  };

  const del = () => {
    if (!shop) return;
    const rows = p.economy.tiers.reduce((n, t) => n + t.loot.filter((r) => r.source.kind === 'shop' && r.source.id === shop.id).length, 0);
    if (!confirm(`Удалить магазин «${shop.name}»?` + (rows ? `\n\nИсчезнут строки лута тиров «готовый предмет из магазина»: ${rows}` : '') + '\n\nОтменить можно через Ctrl+Z.')) return;
    editEco((e) => {
      e.shops = e.shops.filter((s) => s.id !== shop.id);
      e.tiers.forEach((t) => (t.loot = t.loot.filter((r) => !(r.source.kind === 'shop' && r.source.id === shop.id))));
    });
    setSel(null);
  };

  return (
    <div className="eco-2col">
      <aside className="side">
        <Section
          title={
            <>
              Магазины <span className="mono" style={{ fontWeight: 400 }}>{shops.length}</span>
            </>
          }
          actions={
            <Btn sm variant="primary" onClick={add}>
              + магазин
            </Btn>
          }
        />
        <div className="list">
          {shops.map((s) => (
            <div key={s.id} className={'li' + (s.id === shop?.id ? ' on' : '')} onClick={() => setSel(s.id)}>
              <span className="swatch" style={{ background: itemColor(p, s.currencyItemId) }} />
              <span className="name">{s.name}</span>
              <span className="meta">{s.offers.length} тов.</span>
            </div>
          ))}
          {shops.length === 0 && <div className="empty">Магазинов нет</div>}
        </div>
        {shop && (
          <>
            <Section title="Магазин" actions={<Btn sm variant="danger" onClick={del}>Удалить</Btn>}>
              <TextField label="Имя" value={shop.name} onChange={(v) => editShop(shop.id, (s) => (s.name = v), 'name')} />
              <div className="field">
                <label>Валюта</label>
                <ItemSelect p={p} only="currency" value={shop.currencyItemId} onChange={(v) => editShop(shop.id, (s) => (s.currencyItemId = v))} />
                {currencies.length === 0 && (
                  <div className="hint">
                    Валют нет — отметьте предмет тегом <b>currency</b> в{' '}
                    <a className="eco-link" onClick={() => setUI({ page: 'library' })}>
                      Библиотеках
                    </a>
                    .
                  </div>
                )}
              </div>
              <TextField label="Заметка" multiline value={shop.note} onChange={(v) => editShop(shop.id, (s) => (s.note = v), 'note')} placeholder="Кто продаёт, где стоит лавка…" />
            </Section>
            <Section
              title="Товары"
              actions={
                <Btn
                  sm
                  variant="primary"
                  onClick={() =>
                    editShop(shop.id, (s) => {
                      const it = p.items.find((i) => !isCurrency(i)) ?? p.items[0];
                      s.offers.push({ id: uid('offer'), itemId: it?.id ?? '', price: 1 });
                    })
                  }
                >
                  + товар
                </Btn>
              }
            >
              {shop.offers.length === 0 && <div className="hint">Товаров нет.</div>}
              {shop.offers.map((o) => (
                <div key={o.id} className="eco-offer">
                  <span className="swatch" style={{ background: itemColor(p, o.itemId) }} />
                  <ItemSelect p={p} value={o.itemId} onChange={(v) => editShop(shop.id, (s) => {
                    const x = s.offers.find((y) => y.id === o.id);
                    if (x) x.itemId = v;
                  })} />
                  <div style={{ width: 92, flex: 'none' }}>
                    <NumField value={o.price} min={0} max={99999} step={1} digits={1} onChange={(v) => editShop(shop.id, (s) => {
                      const x = s.offers.find((y) => y.id === o.id);
                      if (x) x.price = v;
                    })} />
                  </div>
                  <Btn sm icon variant="ghost" title="Убрать товар" onClick={() => editShop(shop.id, (s) => (s.offers = s.offers.filter((y) => y.id !== o.id)))}>
                    ×
                  </Btn>
                </div>
              ))}
              {shop.offers.length > 0 && <div className="hint">Цена — в валюте магазина ({itemName(p, shop.currencyItemId)}).</div>}
            </Section>
          </>
        )}
      </aside>
      <section className="eco-main">
        <Branches p={p} selShop={shop?.id ?? null} onShop={setSel} />
      </section>
    </div>
  );
}

/** Ветки закупки: по строке на валюту — откуда берётся → магазины → товары; плюс проходки за эту валюту. */
function Branches({ p, selShop, onShop }: { p: Project; selShop: string | null; onShop: (id: string) => void }) {
  const cur = p.items.filter(isCurrency);
  // валюты, которые где-то используются, но без тега, тоже показываем
  const used = new Set([...p.economy.shops.map((s) => s.currencyItemId), ...p.economy.passes.map((x) => x.priceItemId)]);
  const extra = p.items.filter((i) => !isCurrency(i) && used.has(i.id));
  const all = [...cur, ...extra];
  const orphan = p.economy.shops.filter((s) => !p.items.some((i) => i.id === s.currencyItemId));
  const tiers = sortedTiers(p);

  return (
    <div className="eco-branches">
      <div className="eco-bar">
        <span className="cap">Ветки закупки</span>
        <span className="hint">валюта → где добыть → магазин → товары</span>
      </div>
      {all.length === 0 && <div className="empty">Нет валют. Предмет становится валютой, если у него есть тег «currency».</div>}
      {all.map((c) => {
        const shops = p.economy.shops.filter((s) => s.currencyItemId === c.id);
        const passes = p.economy.passes.filter((x) => x.priceItemId === c.id);
        const sources = tiers.filter((t) => t.loot.some((r) => r.source.kind === 'item' && r.source.id === c.id));
        return (
          <div key={c.id} className="eco-branch">
            <div className="eco-cur" style={{ borderColor: c.color }}>
              <span className="lib-marker-sm" style={{ background: c.color }} />
              <div className="eco-cur-name">{c.name}</div>
              {!isCurrency(c) && <div className="eco-warn-inline">нет тега currency</div>}
              <div className="eco-cur-src">
                {sources.length ? (
                  <>
                    добывается:{' '}
                    {sources.map((t) => (
                      <span key={t.id} className="eco-tier-chip" style={{ borderColor: t.color, color: t.color }} title={t.name}>
                        Э{t.level}
                      </span>
                    ))}
                  </>
                ) : (
                  <span className="muted">нет в луте тиров</span>
                )}
              </div>
            </div>
            <div className="eco-arrow">→</div>
            <div className="eco-branch-shops">
              {shops.length === 0 && passes.length === 0 && <div className="hint">Тратить некуда — нет магазинов и проходок.</div>}
              {shops.map((s) => (
                <div key={s.id} className={'eco-shop' + (s.id === selShop ? ' on' : '')} onClick={() => onShop(s.id)}>
                  <div className="eco-shop-h">{s.name}</div>
                  <div className="eco-goods">
                    {s.offers.length === 0 && <span className="muted">пусто</span>}
                    {s.offers.map((o) => (
                      <div key={o.id} className="eco-good" style={{ borderTopColor: itemColor(p, o.itemId) }}>
                        <div className="eco-good-n">{itemName(p, o.itemId)}</div>
                        <div className="eco-good-p mono">
                          {o.price} {c.name}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
              {passes.map((x) => (
                <div key={x.id} className="eco-shop pass">
                  <div className="eco-shop-h">Проходка: {x.name}</div>
                  <div className="eco-goods">
                    <div className="eco-good" style={{ borderTopColor: '#e8b04b' }}>
                      <div className="eco-good-n">элитный уровень</div>
                      <div className="eco-good-p mono">
                        {x.price} {c.name}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })}
      {orphan.length > 0 && (
        <div className="eco-warn" style={{ margin: 12 }}>
          Без валюты: {orphan.map((s) => s.name).join(', ')} — выберите валюту в редакторе магазина.
        </div>
      )}
    </div>
  );
}
