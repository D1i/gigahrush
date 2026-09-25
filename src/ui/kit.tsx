// Общие UI-примитивы. Все панели используют их, чтобы интерфейс был единообразным.
import { useEffect, useRef, useState, type ReactNode } from 'react';

/** Числовое поле: коммит по Enter/blur, ↑/↓ — шаг (Shift ×10). */
export function NumField(props: {
  label?: string;
  value: number;
  onChange: (v: number) => void;
  step?: number;
  min?: number;
  max?: number;
  suffix?: string;
  /** знаков после запятой при показе */
  digits?: number;
  title?: string;
  disabled?: boolean;
}) {
  const { value, onChange, step = 1, min = -Infinity, max = Infinity, digits = 2 } = props;
  const fmt = (v: number) => (Number.isFinite(v) ? String(+v.toFixed(digits)) : '');
  const [text, setText] = useState(fmt(value));
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setText(fmt(value));
  }, [value]);
  const commit = (t: string) => {
    const v = parseFloat(t.replace(',', '.'));
    if (!Number.isFinite(v)) {
      setText(fmt(value));
      return;
    }
    const c = Math.min(max, Math.max(min, v));
    if (c !== value) onChange(c);
    setText(fmt(c));
  };
  const input = (
    <div className="input-wrap">
      <input
        className="input num"
        value={text}
        title={props.title}
        disabled={props.disabled}
        onFocus={() => (focused.current = true)}
        onBlur={(e) => {
          focused.current = false;
          commit(e.target.value);
        }}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault();
            const d = (e.key === 'ArrowUp' ? 1 : -1) * step * (e.shiftKey ? 10 : 1);
            const v = Math.min(max, Math.max(min, +(value + d).toFixed(6)));
            onChange(v);
            setText(fmt(v));
          }
        }}
      />
      {props.suffix && <span className="suffix">{props.suffix}</span>}
    </div>
  );
  if (!props.label) return input;
  return (
    <div className="field">
      <label>{props.label}</label>
      {input}
    </div>
  );
}

export function TextField(props: {
  label?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  multiline?: boolean;
  mono?: boolean;
}) {
  const el = props.multiline ? (
    <textarea className="textarea" value={props.value} placeholder={props.placeholder} onChange={(e) => props.onChange(e.target.value)} />
  ) : (
    <input
      className={'input' + (props.mono ? ' num' : '')}
      value={props.value}
      placeholder={props.placeholder}
      onChange={(e) => props.onChange(e.target.value)}
    />
  );
  if (!props.label) return el;
  return (
    <div className="field">
      <label>{props.label}</label>
      {el}
    </div>
  );
}

/** Теги через запятую. */
export function TagsField(props: { label?: string; value: string[]; onChange: (v: string[]) => void; placeholder?: string }) {
  const [text, setText] = useState(props.value.join(', '));
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setText(props.value.join(', '));
  }, [props.value.join('|')]);
  const el = (
    <input
      className="input"
      value={text}
      placeholder={props.placeholder ?? 'тег, тег'}
      onFocus={() => (focused.current = true)}
      onChange={(e) => {
        setText(e.target.value);
        props.onChange(
          e.target.value
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean),
        );
      }}
      onBlur={() => {
        focused.current = false;
        setText(props.value.join(', '));
      }}
    />
  );
  if (!props.label) return el;
  return (
    <div className="field">
      <label>{props.label}</label>
      {el}
    </div>
  );
}

export function ColorField(props: { value: string; onChange: (v: string) => void; title?: string }) {
  return (
    <input
      type="color"
      className="color"
      title={props.title}
      value={/^#[0-9a-f]{6}$/i.test(props.value) ? props.value : '#888888'}
      onChange={(e) => props.onChange(e.target.value)}
    />
  );
}

export function Select<T extends string>(props: {
  label?: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  const el = (
    <select className="select" value={props.value} onChange={(e) => props.onChange(e.target.value as T)}>
      {props.options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
  if (!props.label) return el;
  return (
    <div className="field">
      <label>{props.label}</label>
      {el}
    </div>
  );
}

export function Check(props: { label: ReactNode; value: boolean; onChange: (v: boolean) => void; title?: string }) {
  return (
    <label className="check" title={props.title}>
      <input type="checkbox" checked={props.value} onChange={(e) => props.onChange(e.target.checked)} />
      {props.label}
    </label>
  );
}

export function Btn(props: {
  children?: ReactNode;
  onClick?: (e: React.MouseEvent) => void;
  variant?: 'primary' | 'ghost' | 'danger';
  sm?: boolean;
  icon?: boolean;
  on?: boolean;
  title?: string;
  disabled?: boolean;
}) {
  const cls = ['btn', props.variant, props.sm && 'sm', props.icon && 'icon', props.on && 'on'].filter(Boolean).join(' ');
  return (
    <button className={cls} onClick={props.onClick} title={props.title} disabled={props.disabled}>
      {props.children}
    </button>
  );
}

export function Section(props: { title: ReactNode; actions?: ReactNode; children?: ReactNode; collapsible?: boolean; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(props.defaultOpen ?? true);
  return (
    <div className="section">
      <div className="section-h" onClick={props.collapsible ? () => setOpen(!open) : undefined} style={props.collapsible ? { cursor: 'pointer' } : undefined}>
        <span className="cap">
          {props.collapsible && <span style={{ display: 'inline-block', width: 12 }}>{open ? '▾' : '▸'}</span>}
          {props.title}
        </span>
        <span onClick={(e) => e.stopPropagation()} className="row">
          {props.actions}
        </span>
      </div>
      {open && props.children && <div className="section-b">{props.children}</div>}
    </div>
  );
}

export function Modal(props: { title: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode; width?: number }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && props.onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [props.onClose]);
  return (
    <div className="modal-bg" onMouseDown={(e) => e.target === e.currentTarget && props.onClose()}>
      <div className="modal" style={props.width ? { width: props.width } : undefined}>
        <div className="modal-h">
          <span className="title">{props.title}</span>
          <Btn variant="ghost" icon onClick={props.onClose} title="Закрыть (Esc)">
            ✕
          </Btn>
        </div>
        <div className="modal-b">{props.children}</div>
        {props.footer && <div className="modal-f">{props.footer}</div>}
      </div>
    </div>
  );
}

/** Процент: 0.1234 → "12.3%" */
export const pct = (v: number) => `${+(v * 100).toFixed(1)}%`;
/** Метры из клеток */
export const m = (cells: number, cellM: number) => +(cells * cellM).toFixed(2);
