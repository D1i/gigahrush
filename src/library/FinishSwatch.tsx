// Квадрат-образец отделки: CSS-тайлинг текстуры в масштабе (extentM метров на сторону квадрата).
import type { CSSProperties } from 'react';
import type { Finish } from '../model/types';
import { texUrl } from './finishTex';
import './library.css';

function bg(f: Finish, sizePx: number, extentM: number): CSSProperties {
  const st: CSSProperties = { backgroundColor: f.color };
  if (f.tex) {
    const k = sizePx / Math.max(0.01, extentM);
    st.backgroundImage = `url(${texUrl(f.tex)})`;
    st.backgroundSize = `${Math.max(1, f.tileW * k)}px ${Math.max(1, f.tileH * k)}px`;
    // стены считаются от пола, полы — от угла комнаты
    st.backgroundPosition = f.surface === 'wall' ? 'left bottom' : 'left top';
  }
  return st;
}

/** dado — нижняя панель: полоса снизу, её высота — доля от стены 2.5 м (схематично, не в масштабе образца). */
export function FinishSwatch(props: {
  finish: Finish | undefined | null;
  size?: number;
  extentM?: number;
  title?: string;
  className?: string;
  dado?: { finish: Finish | undefined; heightM: number } | null;
}) {
  const { finish: f, size = 40, extentM = 1, dado } = props;
  const cls = 'fin-sw' + (props.className ? ' ' + props.className : '');
  if (!f) return <span className={cls + ' none'} style={{ width: size, height: size }} title={props.title ?? 'нет отделки'} />;
  return (
    <span className={cls} style={{ width: size, height: size, ...bg(f, size, extentM) }} title={props.title ?? f.name}>
      {dado?.finish && (
        <span className="fin-sw-dado" style={{ height: `${Math.min(100, (dado.heightM / 2.5) * 100)}%`, ...bg(dado.finish, size, extentM) }} />
      )}
    </span>
  );
}

/** Образец «по правилу»: вертикальные полосы вариантов шириной по вероятности. */
export function FinishMix(props: { items: { finish: Finish | undefined; p: number }[]; size?: number; title?: string }) {
  const { items, size = 22 } = props;
  if (!items.length) return <span className="fin-sw none" style={{ width: size, height: size }} title={props.title ?? 'нет отделки'} />;
  return (
    <span className="fin-sw fin-mix" style={{ width: size, height: size }} title={props.title}>
      {items.map((x, i) => (
        <span key={i} style={{ flexGrow: Math.max(0.001, x.p), ...(x.finish ? bg(x.finish, size, 1) : { background: '#555' }) }} />
      ))}
    </span>
  );
}
