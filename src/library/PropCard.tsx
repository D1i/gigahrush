// Карточка декора: параметры, текстура, предпросмотр в масштабе, использование, удаление.
import { useRef, useState } from 'react';
import type { Project, Prop } from '../model/types';
import { mutate, useProject } from '../model/store';
import { notify, setUI } from '../model/ui';
import { createProp, deleteProp, propUsage } from '../model/ops';
import { loadTextureFile } from '../render/props';
import { Btn, ColorField, NumField, Section, TagsField, TextField } from '../ui/kit';
import { PropFloorView } from './PropView';
import { plural, roomsUsingProp } from './usage';

/** Изменить декор по id внутри mutate (после undo объект проекта заменяется). */
function editProp(id: string, fn: (x: Prop) => void, key?: string) {
  mutate(
    (p) => {
      const x = p.props.find((q) => q.id === id);
      if (x) fn(x);
    },
    key ? { key: `lib-prop-${key}-${id}` } : undefined,
  );
}

const ROTS = [0, 90, 180, 270];

export function PropCard({ prop }: { prop: Prop }) {
  const p = useProject();
  const [rot, setRot] = useState(0);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const use = propUsage(p, prop.id);
  const rooms = roomsUsingProp(p, prop.id);
  const texKB = prop.tex ? Math.round(prop.tex.length / 1024) : 0;

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    setBusy(true);
    try {
      const tex = await loadTextureFile(f, 512);
      editProp(prop.id, (x) => (x.tex = tex));
      notify(`Текстура загружена: ${Math.round(tex.length / 1024)} КБ`, 'ok');
    } catch (e: any) {
      notify(String(e?.message ?? e), 'error');
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const dup = () => {
    let id = '';
    mutate((pr) => {
      id = createProp(pr, {
        name: `${prop.name} (копия)`,
        w: prop.w,
        h: prop.h,
        color: prop.color,
        tex: prop.tex,
        tags: [...prop.tags],
      }).id;
    });
    if (id) setUI({ libSel: { kind: 'prop', id } });
  };

  const del = () => {
    const lines: string[] = [];
    if (use.decor) lines.push(`• ${use.decor} ${plural(use.decor, 'экземпляр', 'экземпляра', 'экземпляров')} декора`);
    if (use.assigns) lines.push(`• ${use.assigns} ${plural(use.assigns, 'назначение', 'назначения', 'назначений')} в вариантах наборов`);
    const where = rooms.length ? `\nв комнатах: ${rooms.map((r) => r.room.name).join(', ')}` : '';
    const msg = lines.length
      ? `Удалить декор «${prop.name}»?\n\nВместе с ним исчезнут:\n${lines.join('\n')}${where}\n\nОтменить можно через Ctrl+Z.`
      : `Удалить декор «${prop.name}»? Он нигде не используется.`;
    if (!confirm(msg)) return;
    let res = { decor: 0, assigns: 0 };
    mutate((pr) => {
      res = deleteProp(pr, prop.id);
    });
    setUI({ libSel: null });
    notify(`Декор «${prop.name}» удалён: экземпляров ${res.decor}, назначений ${res.assigns}`, 'ok');
  };

  return (
    <>
      <div className="lib-card-h">
        <span className="lib-card-kind cap">Декор</span>
        <span className="grow" />
        <Btn sm onClick={dup} title="Копия с новым id">
          Дублировать
        </Btn>
        <Btn sm variant="danger" onClick={del}>
          Удалить
        </Btn>
      </div>
      <Section title="Параметры">
        <TextField label="Имя" value={prop.name} onChange={(v) => editProp(prop.id, (x) => (x.name = v), 'name')} />
        <div className="grid3">
          <NumField label="Ширина (X)" suffix="м" value={prop.w} min={0.05} max={20} step={0.05} onChange={(v) => editProp(prop.id, (x) => (x.w = v), 'w')} />
          <NumField label="Глубина (Y)" suffix="м" value={prop.h} min={0.05} max={20} step={0.05} onChange={(v) => editProp(prop.id, (x) => (x.h = v), 'h')} />
          <div className="field">
            <label>Цвет-замена</label>
            <div className="row">
              <ColorField value={prop.color} onChange={(v) => editProp(prop.id, (x) => (x.color = v), 'color')} title="Цвет, если нет текстуры" />
              <span className="mono muted" style={{ fontSize: 11 }}>
                {prop.color}
              </span>
            </div>
          </div>
        </div>
        <TagsField label="Теги (через запятую)" value={prop.tags} onChange={(v) => editProp(prop.id, (x) => (x.tags = v), 'tags')} placeholder="кухня, шкаф, сервант" />
        <div className="hint">Теги декора используются в экономике: строка лута тира с «где = сервант» кладёт находку в декор с тегом «сервант».</div>
      </Section>

      <Section title="Текстура (вид сверху)">
        <div className="row">
          <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={(e) => onFile(e.target.files?.[0])} />
          <Btn sm onClick={() => fileRef.current?.click()} disabled={busy}>
            {busy ? 'Загрузка…' : prop.tex ? 'Заменить…' : 'Загрузить с диска…'}
          </Btn>
          {prop.tex && (
            <Btn sm variant="ghost" onClick={() => editProp(prop.id, (x) => (x.tex = null))}>
              Убрать текстуру
            </Btn>
          )}
          <span className="grow" />
          {prop.tex ? (
            <span className={'mono lib-kb' + (texKB > 200 ? ' big' : '')} title="Размер data:URI в проекте">
              {texKB} КБ
            </span>
          ) : (
            <span className="muted" style={{ fontSize: 12 }}>
              нет — рисуется цветом
            </span>
          )}
        </div>
        <div className="hint">
          Картинка сжимается до 512 px по длинной стороне (PNG, прозрачность сохраняется) и растягивается на габарит. Оригинал не хранится — держите исходник у себя. Передняя грань — нижний край картинки.
        </div>
      </Section>

      <Section title="Предпросмотр в масштабе">
        <PropFloorView prop={prop} rot={rot} width={416} height={250} />
        <div className="lib-rots">
          {ROTS.map((r) => (
            <button key={r} className={'lib-rot' + (r === rot ? ' on' : '')} onClick={() => setRot(r)} title={`Поворот ${r}°`}>
              <PropFloorView prop={prop} rot={r} width={90} height={68} labels={false} />
              <span className="mono">{r}°</span>
            </button>
          ))}
        </div>
        <div className="hint">Сетка — 0.1 м, яркие линии — каждый метр. Тёмная полоса — передняя грань.</div>
      </Section>

      <UsageSection p={p} rooms={rooms} use={use} />
    </>
  );
}

function UsageSection({ rooms, use }: { p: Project; rooms: ReturnType<typeof roomsUsingProp>; use: ReturnType<typeof propUsage> }) {
  return (
    <Section title="Использование">
      <div className="grid3">
        <div className="stat">
          <span className="v">{use.rooms}</span>
          <span className="k">{plural(use.rooms, 'комната', 'комнаты', 'комнат')}</span>
        </div>
        <div className="stat">
          <span className="v">{use.decor}</span>
          <span className="k">экземпляров декора</span>
        </div>
        <div className="stat">
          <span className="v">{use.assigns}</span>
          <span className="k">назначений в вариантах</span>
        </div>
      </div>
      {rooms.length > 0 ? (
        <div className="list lib-rooms">
          {rooms.map((r) => (
            <div key={r.room.id} className="li" onClick={() => setUI({ page: 'editor', roomId: r.room.id, selection: null })} title="Открыть в редакторе">
              <span className="name">{r.room.name}</span>
              <span className="meta">
                {r.decor ? `декор ×${r.decor}` : ''}
                {r.decor && r.assigns ? ' · ' : ''}
                {r.assigns ? `в вариантах ×${r.assigns}` : ''}
              </span>
              <span className="muted">→</span>
            </div>
          ))}
        </div>
      ) : (
        <div className="hint">Нигде не используется.</div>
      )}
    </Section>
  );
}
