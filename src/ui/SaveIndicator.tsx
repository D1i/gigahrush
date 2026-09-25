import { useEffect, useState } from 'react';
import { canRedo, canUndo, onSave, redo, undo, useProject } from '../model/store';
import { notify } from '../model/ui';
import { Btn } from './kit';

/** Индикатор автосохранения в localStorage + undo/redo. */
export function SaveIndicator() {
  useProject();
  const [st, setSt] = useState<{ ok: boolean; bytes: number } | null>(null);
  useEffect(
    () =>
      onSave((ok, bytes, err) => {
        setSt({ ok, bytes });
        if (!ok) notify('Не удалось сохранить в localStorage: ' + err, 'error');
      }),
    [],
  );
  return (
    <div className="row">
      <Btn variant="ghost" sm onClick={undo} disabled={!canUndo()} title="Отменить (Ctrl+Z)">
        ↶
      </Btn>
      <Btn variant="ghost" sm onClick={redo} disabled={!canRedo()} title="Повторить (Ctrl+Shift+Z)">
        ↷
      </Btn>
      <span className="hint mono" title="Размер проекта в localStorage">
        {st ? (st.ok ? `сохранено · ${(st.bytes / 1024).toFixed(0)} КБ` : 'ошибка сохранения') : 'автосохранение'}
      </span>
    </div>
  );
}
