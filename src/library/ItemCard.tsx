// Карточка предмета: имя, цвет маркера, теги, заметка, использование (лут / варианты / экономика).
import type { Item } from '../model/types';
import { mutate, useProject } from '../model/store';
import { notify, setUI } from '../model/ui';
import { createItem, deleteItem, itemUsage } from '../model/ops';
import { Btn, Check, ColorField, Section, TagsField, TextField } from '../ui/kit';
import { economyRefsItem, isCurrency, plural, roomsUsingItem } from './usage';

function editItem(id: string, fn: (x: Item) => void, key?: string) {
  mutate(
    (p) => {
      const x = p.items.find((q) => q.id === id);
      if (x) fn(x);
    },
    key ? { key: `lib-item-${key}-${id}` } : undefined,
  );
}

export function ItemCard({ item }: { item: Item }) {
  const p = useProject();
  const use = itemUsage(p, item.id);
  const rooms = roomsUsingItem(p, item.id);
  const eco = economyRefsItem(p, item.id);
  const cur = isCurrency(item);

  const dup = () => {
    let id = '';
    mutate((pr) => {
      id = createItem(pr, { name: `${item.name} (копия)`, color: item.color, tags: [...item.tags], note: item.note }).id;
    });
    if (id) setUI({ libSel: { kind: 'item', id } });
  };

  const del = () => {
    const lines: string[] = [];
    if (use.loot) lines.push(`• ${use.loot} ${plural(use.loot, 'строка', 'строки', 'строк')} лута в комнатах`);
    if (use.assigns) lines.push(`• ${use.assigns} ${plural(use.assigns, 'назначение', 'назначения', 'назначений')} в вариантах наборов`);
    eco.forEach((e) => lines.push(`• ${e}`));
    const where = rooms.length ? `\nв комнатах: ${rooms.map((r) => r.room.name).join(', ')}` : '';
    const msg = lines.length
      ? `Удалить предмет «${item.name}»?\n\nВместе с ним исчезнут:\n${lines.join('\n')}${where}\n\nОтменить можно через Ctrl+Z.`
      : `Удалить предмет «${item.name}»? Он нигде не используется.`;
    if (!confirm(msg)) return;
    let res = { loot: 0, assigns: 0, economy: 0 };
    mutate((pr) => {
      res = deleteItem(pr, item.id);
    });
    setUI({ libSel: null });
    notify(`Предмет «${item.name}» удалён: строк лута ${res.loot}, назначений ${res.assigns}, ссылок в экономике ${res.economy}`, 'ok');
  };

  const setCurrency = (v: boolean) =>
    editItem(item.id, (x) => {
      x.tags = v ? [...x.tags.filter((t) => t !== 'currency'), 'currency'] : x.tags.filter((t) => t !== 'currency');
    });

  return (
    <>
      <div className="lib-card-h">
        <span className="lib-card-kind cap">Предмет</span>
        {cur && <span className="chip accent">валюта</span>}
        <span className="grow" />
        <Btn sm onClick={dup}>
          Дублировать
        </Btn>
        <Btn sm variant="danger" onClick={del}>
          Удалить
        </Btn>
      </div>
      <Section title="Параметры">
        <div className="row" style={{ alignItems: 'flex-end' }}>
          <div className="grow">
            <TextField label="Имя" value={item.name} onChange={(v) => editItem(item.id, (x) => (x.name = v), 'name')} />
          </div>
          <div className="field">
            <label>Маркер</label>
            <ColorField value={item.color} onChange={(v) => editItem(item.id, (x) => (x.color = v), 'color')} title="Цвет маркера предмета на карте" />
          </div>
        </div>
        <TagsField label="Теги (через запятую)" value={item.tags} onChange={(v) => editItem(item.id, (x) => (x.tags = v), 'tags')} placeholder="электрика, свет" />
        <Check
          label="Валюта (тег currency)"
          value={cur}
          onChange={setCurrency}
          title="Валюты кормят свою ветку закупки: магазин принимает оплату только в своей валюте"
        />
        <TextField label="Заметка" multiline value={item.note} onChange={(v) => editItem(item.id, (x) => (x.note = v), 'note')} placeholder="Зачем нужен, где добывать, как тратится…" />
      </Section>

      <Section title="Использование">
        <div className="grid3">
          <div className="stat">
            <span className="v">{use.loot}</span>
            <span className="k">строк в луте комнат</span>
          </div>
          <div className="stat">
            <span className="v">{use.assigns}</span>
            <span className="k">назначений в вариантах</span>
          </div>
          <div className="stat">
            <span className="v">{use.economy}</span>
            <span className="k">ссылок в экономике</span>
          </div>
        </div>
        {eco.length > 0 && (
          <div className="lib-eco">
            <div className="cap">Экономика</div>
            {eco.map((e, i) => (
              <div key={i} className="lib-eco-li" onClick={() => setUI({ page: 'economy' })} title="Открыть экономику">
                {e}
              </div>
            ))}
          </div>
        )}
        {rooms.length > 0 ? (
          <div className="list lib-rooms">
            {rooms.map((r) => (
              <div key={r.room.id} className="li" onClick={() => setUI({ page: 'editor', roomId: r.room.id, selection: null })} title="Открыть в редакторе">
                <span className="name">{r.room.name}</span>
                <span className="meta">
                  {r.loot ? `лут ×${r.loot}` : ''}
                  {r.loot && r.assigns ? ' · ' : ''}
                  {r.assigns ? `в вариантах ×${r.assigns}` : ''}
                </span>
                <span className="muted">→</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="hint">Ни в одной комнате не используется.</div>
        )}
      </Section>
    </>
  );
}
