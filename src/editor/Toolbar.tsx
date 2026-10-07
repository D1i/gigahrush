// Плавающая панель инструментов холста и строка контекстных полей активного инструмента.
import type { Project, Room, Tool } from '../model/types';
import { setUI, type UIState } from '../model/ui';
import { NumField } from '../ui/kit';

export const TOOLS: { id: Tool; label: string; title: string }[] = [
  { id: 'select', label: 'Выбор', title: 'Выбор и перемещение, габарит комнаты' },
  { id: 'rect', label: 'Прям.', title: 'Прямоугольник: протяжка добавляет/вычитает форму' },
  { id: 'ellipse', label: 'Эллипс', title: 'Эллипс: протяжка добавляет/вычитает форму' },
  { id: 'brush', label: 'Кисть', title: 'Кисть: мазок добавляет/вычитает клетки' },
  { id: 'door', label: 'Дверь', title: 'Дверь: клик у стены' },
  { id: 'connector', label: 'Метка', title: 'Метка стыковки: клик у стены' },
  { id: 'decor', label: 'Декор', title: 'Декор: клик ставит выбранный предмет' },
  { id: 'spot', label: 'Спот', title: 'Спот: клик ставит точку спавна' },
];

const SHAPE_TOOLS: Tool[] = ['rect', 'ellipse', 'brush'];

export function Toolbar(props: { ui: UIState; onFit: () => void }) {
  const { ui } = props;
  return (
    <>
      <div className="float toolbar rc-toolbar">
        {TOOLS.map((t, i) => (
          <button
            key={t.id}
            className={'btn sm ghost rc-tool' + (ui.tool === t.id ? ' on' : '')}
            title={`${t.title} — клавиша ${i + 1}${t.id === 'select' ? ' или V' : ''}`}
            onClick={() => setUI({ tool: t.id })}
          >
            {t.label}
            <span className="n">{i + 1}</span>
          </button>
        ))}
      </div>
      <div className="float rc-fit">
        <button className="btn sm ghost" onClick={props.onFit} title="Вписать комнату в окно — F">
          ⤢ вписать
        </button>
      </div>
    </>
  );
}

export function ToolContext(props: { ui: UIState; p: Project; room: Room | null }) {
  const { ui, p, room } = props;
  const cm = p.settings.cellM;
  const t = ui.tool;
  let body: React.ReactNode = null;

  const modeSwitch = (
    <span className="rc-seg" title="Режим формы — X; Shift инвертирует на время жеста">
      <button className={'add' + (ui.toolMode === 'add' ? ' on' : '')} onClick={() => setUI({ toolMode: 'add' })}>
        + добавить
      </button>
      <button className={'sub' + (ui.toolMode === 'sub' ? ' on' : '')} onClick={() => setUI({ toolMode: 'sub' })}>
        − вычесть
      </button>
    </span>
  );

  if (SHAPE_TOOLS.includes(t)) {
    body = (
      <>
        {modeSwitch}
        {t === 'brush' && (
          <>
            <span className="lbl">диаметр</span>
            <div className="num-w">
              <NumField value={ui.brushM} step={0.1} min={cm} max={10} suffix="м" onChange={(v) => setUI({ brushM: v })} title="Диаметр кисти, м" />
            </div>
          </>
        )}
        <span className="hint">Shift — {ui.toolMode === 'add' ? 'вычесть' : 'добавить'}</span>
      </>
    );
  } else if (t === 'door' || t === 'connector') {
    const key = t === 'door' ? 'doorLen' : 'connectorLen';
    body = (
      <>
        <span className="lbl">длина</span>
        <div className="num-w">
          <NumField
            value={ui[key] * cm}
            step={cm}
            min={cm}
            max={50}
            suffix="м"
            onChange={(v) => setUI({ [key]: Math.max(1, Math.round(v / cm)) } as Partial<UIState>)}
            title="Длина в метрах (кратно клетке)"
          />
        </div>
        {t === 'connector' && (
          <>
            <span className="lbl">tag</span>
            <input
              className="input num tag-w"
              value={ui.connectorTag}
              onChange={(e) => setUI({ connectorTag: e.target.value })}
              title="Метка стыковки для новых меток"
            />
          </>
        )}
        <span className="hint">клик у стены</span>
      </>
    );
  } else if (t === 'decor') {
    const prop = p.props.find((x) => x.id === ui.decorPropId) ?? null;
    body = (
      <>
        <span className="swatch" style={{ background: prop?.color ?? 'transparent', width: 16, height: 16 }} />
        <select
          className="select sel-w"
          value={prop?.id ?? ''}
          onChange={(e) => setUI({ decorPropId: e.target.value || null })}
          title="Какой декор ставить"
        >
          <option value="">— выберите декор —</option>
          {p.props.map((x) => (
            <option key={x.id} value={x.id}>
              {x.name} · {x.w}×{x.h} м
            </option>
          ))}
        </select>
        <span className="hint">Shift — без привязки</span>
      </>
    );
  } else if (t === 'spot') {
    const groups = room?.spotGroups ?? [];
    const g = groups.find((x) => x.id === ui.spotGroupId) ?? null;
    body = (
      <>
        <span className="swatch" style={{ background: g?.color ?? '#8a8d92', width: 16, height: 16 }} />
        <select
          className="select sel-w"
          value={g?.id ?? ''}
          onChange={(e) => setUI({ spotGroupId: e.target.value || null })}
          title="Группа для новых спотов"
        >
          <option value="">без группы</option>
          {groups.map((x) => (
            <option key={x.id} value={x.id}>
              {x.name}
            </option>
          ))}
        </select>
        <span className="hint">Shift — без привязки</span>
      </>
    );
  } else {
    body = (
      <span className="hint">
        <span className="kbd">Q</span>/<span className="kbd">E</span> поворот (Shift — 15°) · <span className="kbd">Del</span> удалить ·{' '}
        <span className="kbd">Esc</span> снять
      </span>
    );
  }

  return <div className="float rc-ctx">{body}</div>;
}
