// Экономика (расширение ТЗ по переписке с заказчиком): тиры элитности, карта элитности,
// магазины (ветки закупки), проходки, опасность. Главное — правила понятны игроку.
import { useState } from 'react';
import { useProject } from '../model/store';
import { TiersTab, EmptyTiers, newTier } from '../economy/TiersTab';
import { EliteMap } from '../economy/EliteMap';
import { ShopsTab } from '../economy/ShopsTab';
import { PassesTab } from '../economy/PassesTab';
import { DangerTab } from '../economy/DangerTab';
import { editEco } from '../economy/shared';
import '../economy/economy.css';

type EcoTab = 'tiers' | 'map' | 'shops' | 'passes' | 'danger';

// Выбор вкладки/элементов живёт между переходами по страницам
let lastTab: EcoTab = 'tiers';

export function EconomyPage() {
  const p = useProject();
  const [tab, setTabState] = useState<EcoTab>(lastTab);
  const setTab = (t: EcoTab) => {
    lastTab = t;
    setTabState(t);
  };
  const [tierSel, setTierSel] = useState<string | null>(null);
  const [shopSel, setShopSel] = useState<string | null>(null);
  const [passSel, setPassSel] = useState<string | null>(null);
  const e = p.economy;
  const eliteRooms = p.rooms.filter((r) => r.elite.length).length;

  const tabs: { id: EcoTab; label: string; n?: string }[] = [
    { id: 'tiers', label: 'Тиры элитности', n: String(e.tiers.length) },
    { id: 'map', label: 'Карта элитности', n: `${eliteRooms}/${p.rooms.length}` },
    { id: 'shops', label: 'Магазины', n: String(e.shops.length) },
    { id: 'passes', label: 'Проходки', n: String(e.passes.length) },
    { id: 'danger', label: 'Опасность', n: e.dangerLimit > 0 ? String(e.dangerLimit) : '∞' },
  ];

  const addTier = () => {
    let id = '';
    editEco((eco, pr) => {
      const t = newTier(pr);
      eco.tiers.push(t);
      id = t.id;
    });
    setTierSel(id);
    setTab('tiers');
  };

  return (
    <div className="eco">
      <nav className="eco-tabs">
        {tabs.map((t) => (
          <button key={t.id} className={'eco-tab' + (tab === t.id ? ' on' : '')} onClick={() => setTab(t.id)}>
            {t.label}
            {t.n !== undefined && <span className="mono eco-tab-n">{t.n}</span>}
          </button>
        ))}
      </nav>
      <div className="eco-body">
        {tab === 'tiers' && <TiersTab sel={tierSel} setSel={setTierSel} />}
        {tab === 'map' && (e.tiers.length ? <EliteMap /> : <EmptyTiers onAdd={addTier} />)}
        {tab === 'shops' && <ShopsTab sel={shopSel} setSel={setShopSel} />}
        {tab === 'passes' && <PassesTab sel={passSel} setSel={setPassSel} />}
        {tab === 'danger' && <DangerTab />}
      </div>
    </div>
  );
}
