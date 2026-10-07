// Переключатели слоёв холста редактора (ТЗ §5). Скрытый слой не рисуется и не ловит курсор.
import type { LayerKey } from '../model/types';
import { setUI, useUI } from '../model/ui';
import { CANVAS } from '../render/palette';
import { Section } from '../ui/kit';
import './editor.css';

const LAYERS: { key: LayerKey; label: string; color: string }[] = [
  { key: 'grid', label: 'Сетка', color: '#5a5f66' },
  { key: 'doors', label: 'Двери', color: CANVAS.door },
  { key: 'connectors', label: 'Метки стыковки', color: CANVAS.connector },
  { key: 'decor', label: 'Декор', color: '#a88a64' },
  { key: 'spots', label: 'Споты', color: CANVAS.spot },
  // проходимость для игрока (капсула 0.3 м): красное — центр не встанет, оранжевое — отрезано от дверей
  { key: 'walk', label: 'Проходимость', color: CANVAS.walkOk },
];

export function LayerToggles() {
  const ui = useUI();
  const toggle = (k: LayerKey) => setUI((s) => ({ layers: { ...s.layers, [k]: !s.layers[k] } }));
  return (
    <Section title="Слои">
      <div className="list lt-list">
        {LAYERS.map((l) => {
          const on = ui.layers[l.key];
          return (
            <div
              key={l.key}
              className={'li lt-item' + (on ? '' : ' off')}
              onClick={() => toggle(l.key)}
              title={on ? 'Скрыть слой' : 'Показать слой'}
            >
              <span className="swatch" style={{ background: on ? l.color : 'transparent', borderColor: l.color }} />
              <span className="name">{l.label}</span>
              <span className="meta">{on ? 'вкл' : 'скрыт'}</span>
            </div>
          );
        })}
      </div>
    </Section>
  );
}
