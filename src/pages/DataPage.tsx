// Данные / JSON — машинный сценарий (ТЗ §1): экспорт компонентов и готовой раскладки,
// импорт, сброс к пресетам, занятость хранилища, справка по формату.
import { useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { createDefaultProject } from '../data/presets';
import { mergePresets, missingPresets, outdatedPresets, updatePresets } from '../model/mergePresets';
import { parseProject, serializeProject } from '../model/serialize';
import { LS_KEY, getVersion, mutate, replaceProject, saveNow, subscribe, useProject } from '../model/store';
import type { Project } from '../model/types';
import { getUI, notify, setUI, useUI } from '../model/ui';
import { Btn, Check, Section, pct } from '../ui/kit';
import { FormatRef } from '../preview/formatRef';
import { copyRun, downloadRun, generateNow, runJSONText } from '../preview/runActions';
import { byteLen, copyText, downloadText, fmtKB } from '../preview/util';
import '../preview/preview.css';

const PREVIEW_LINES = 400;
const PREVIEW_COLS = 240;
/** ориентировочная квота localStorage, символов */
const LS_QUOTA = 5 * 1024 * 1024;

type Tab = 'project' | 'run' | 'format';

/** Проект → текст JSON (опционально без текстур). */
function projectText(p: Project, noTex: boolean): string {
  const j = serializeProject(p);
  const out = noTex ? { ...j, props: j.props.map((x) => ({ ...x, tex: null })) } : j;
  return JSON.stringify(out, null, 2);
}

/** Усечённый предпросмотр: не больше PREVIEW_LINES строк, длинные строки (текстуры) обрезаны. */
function clip(text: string): string {
  const lines = text.split('\n');
  const head = lines.slice(0, PREVIEW_LINES).map((l) => (l.length > PREVIEW_COLS ? `${l.slice(0, PREVIEW_COLS)}… (+${l.length - PREVIEW_COLS} симв.)` : l));
  if (lines.length > PREVIEW_LINES) head.push(`\n… ещё ${lines.length - PREVIEW_LINES} строк — полностью в скачанном файле`);
  return head.join('\n');
}

function summarize(p: Project): string {
  return `${p.rooms.length} комнат, ${p.props.length} декора, ${p.items.length} предметов, ${p.economy.tiers.length} тиров`;
}

export function DataPage() {
  const p = useProject();
  const ui = useUI();
  const version = useSyncExternalStore(subscribe, getVersion);
  const [noTex, setNoTex] = useState(false);
  const [tab, setTab] = useState<Tab>('project');
  const [paste, setPaste] = useState('');
  const [over, setOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // JSON проекта — пересчёт только при изменении проекта
  const proj = useMemo(() => {
    try {
      const text = projectText(p, noTex);
      return { text, bytes: byteLen(text), error: null as string | null };
    } catch (e: any) {
      return { text: '', bytes: 0, error: String(e?.message ?? e) };
    }
  }, [version, noTex]);

  const runOut = useMemo(() => {
    if (!ui.run) return null;
    try {
      const text = runJSONText(ui.run);
      const obj = JSON.parse(text);
      return { text, bytes: byteLen(text), keys: obj && typeof obj === 'object' ? Object.keys(obj) : [], error: null as string | null };
    } catch (e: any) {
      return { text: '', bytes: 0, keys: [], error: String(e?.message ?? e) };
    }
  }, [ui.run]);

  // хранилище
  const stored = useMemo(() => {
    let len = 0;
    try {
      len = localStorage.getItem(LS_KEY)?.length ?? 0;
    } catch {}
    const tex = p.props
      .filter((x) => x.tex)
      .map((x) => ({ id: x.id, name: x.name, len: x.tex!.length }))
      .sort((a, b) => b.len - a.len);
    const texTotal = tex.reduce((s, x) => s + x.len, 0);
    return { len, top: tex.slice(0, 5), texTotal, texCount: tex.length };
  }, [version]);

  const importText = (text: string, source: string) => {
    let np: Project;
    try {
      np = parseProject(JSON.parse(text));
    } catch (e: any) {
      notify(`Импорт (${source}) не удался: ${String(e?.message ?? e)}`, 'error');
      return;
    }
    replaceProject(np);
    const roomId = getUI().roomId;
    setUI({
      run: null,
      runInst: null,
      selection: null,
      roomId: roomId && np.rooms.some((r) => r.id === roomId) ? roomId : np.rooms[0]?.id ?? null,
    });
    notify(`Импортировано: ${summarize(np)}. Ctrl+Z — отменить`, 'ok');
  };

  const importFile = async (f: File | undefined) => {
    if (!f) return;
    try {
      importText(await f.text(), f.name);
    } catch (e: any) {
      notify('Не удалось прочитать файл: ' + String(e?.message ?? e), 'error');
    }
    if (fileRef.current) fileRef.current.value = '';
  };

  const missing = useMemo(() => missingPresets(p), [p, getVersion()]);
  const missingTotal = missing.rooms + missing.props + missing.items + missing.economy + missing.finishes;
  const merge = () => {
    let r = { rooms: 0, props: 0, items: 0, economy: 0, finishes: 0 };
    mutate((pp) => (r = mergePresets(pp)));
    notify(`Добавлено из пресетов: комнат ${r.rooms}, декора ${r.props}, предметов ${r.items}, экономики ${r.economy}, отделки ${r.finishes}`, 'ok');
  };

  const outdated = useMemo(() => outdatedPresets(p), [p, getVersion()]);
  const update = () => {
    if (!confirm(`Обновить пресеты до последней версии? ${outdated} пресетных комнат/предметов/тиров будут заменены свежими — ваши правки в НИХ потеряются (свои комнаты не тронутся). Старт, предел обзора и дозаполнение возьмутся из пресетов (сид, число комнат и зазор останутся). Ctrl+Z — отменить.`)) return;
    let r = { rooms: 0, props: 0, items: 0, economy: 0, finishes: 0 };
    mutate((pp) => (r = updatePresets(pp)));
    setUI({ run: null, runInst: null, selection: null });
    notify(`Пресеты обновлены: комнат ${r.rooms}, декора ${r.props}, предметов ${r.items}`, 'ok');
  };

  const reset = () => {
    if (!confirm('Сбросить проект к пресетам? Текущие комнаты, декор и экономика будут заменены (Ctrl+Z — отменить).')) return;
    try {
      const np = createDefaultProject();
      replaceProject(np);
      setUI({ run: null, runInst: null, selection: null, roomId: np.rooms[0]?.id ?? null });
      notify(`Сброшено к пресетам: ${summarize(np)}`, 'ok');
    } catch (e: any) {
      notify('Сброс не удался: ' + String(e?.message ?? e), 'error');
    }
  };

  const genAndExport = () => {
    const run = generateNow({ quiet: true });
    if (run) {
      downloadRun(run);
      setTab('run');
    }
  };

  const share = stored.len / LS_QUOTA;
  const preview =
    tab === 'project'
      ? proj.error
        ? `Ошибка сериализации: ${proj.error}`
        : clip(proj.text)
      : tab === 'run'
        ? runOut
          ? runOut.error
            ? `Ошибка экспорта: ${runOut.error}`
            : clip(runOut.text)
          : 'Прогона нет. Сгенерируйте его на вкладке «Генератор» или кнопкой «Сгенерировать и экспортировать».'
        : '';

  return (
    <div className="dp">
      <aside className="side">
        <Section title="Экспорт компонентов">
          <div className="hint">Проект целиком: комнаты, декор, предметы, экономика, настройки генератора. Движок собирает уровень сам.</div>
          <div className="row">
            <span className="mono">{proj.error ? '—' : fmtKB(proj.bytes)}</span>
            <span className="muted">{summarize(p)}</span>
          </div>
          <Check
            label="без текстур (tex → null, лёгкий экспорт)"
            value={noTex}
            onChange={setNoTex}
            title="Текстуры декора — основной вес файла"
          />
          <div className="row">
            <Btn
              variant="primary"
              disabled={!!proj.error}
              onClick={() => downloadText(noTex ? 'room-forge-project.notex.json' : 'room-forge-project.json', proj.text)}
            >
              ⬇ Скачать room-forge-project.json
            </Btn>
            <Btn disabled={!!proj.error} onClick={() => copyText(proj.text, 'JSON проекта')}>
              Копировать
            </Btn>
          </div>
        </Section>

        <Section title="Экспорт готовой раскладки">
          <div className="hint">Прогон генератора в мировых координатах — для движка, который берёт готовую карту.</div>
          {ui.run ? (
            <>
              <div className="row">
                <span className="mono">«{ui.run.seed}»</span>
                <span className="muted">
                  {ui.run.instances.length} комнат{runOut && !runOut.error ? ` · ${fmtKB(runOut.bytes)}` : ''}
                </span>
              </div>
              <div className="row">
                <Btn onClick={() => downloadRun(ui.run!)}>⬇ Скачать run-{ui.run.seed}.json</Btn>
                <Btn onClick={() => copyRun(ui.run!)}>Копировать</Btn>
              </div>
              <Btn sm variant="ghost" onClick={genAndExport} title="Перегенерировать по текущим настройкам и скачать">
                ↻ Перегенерировать и экспортировать
              </Btn>
            </>
          ) : (
            <Btn onClick={genAndExport}>⚙ Сгенерировать и экспортировать</Btn>
          )}
        </Section>

        <Section title="Импорт проекта">
          <div
            className={'dp-drop' + (over ? ' over' : '')}
            onDragOver={(e) => {
              e.preventDefault();
              setOver(true);
            }}
            onDragLeave={() => setOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setOver(false);
              importFile(e.dataTransfer.files[0]);
            }}
          >
            Перетащите .json сюда или{' '}
            <Btn sm onClick={() => fileRef.current?.click()}>
              выберите файл
            </Btn>
            <input ref={fileRef} type="file" accept=".json,application/json" hidden onChange={(e) => importFile(e.target.files?.[0])} />
          </div>
          <textarea
            className="textarea"
            style={{ fontFamily: 'var(--mono)', fontSize: 11, minHeight: 80 }}
            placeholder="…или вставьте JSON проекта"
            value={paste}
            onChange={(e) => setPaste(e.target.value)}
          />
          <div className="row">
            <Btn disabled={!paste.trim()} onClick={() => importText(paste, 'текст')}>
              Импортировать из текста
            </Btn>
            {paste && (
              <Btn variant="ghost" sm onClick={() => setPaste('')}>
                очистить
              </Btn>
            )}
          </div>
          <div className="hint">Импорт заменяет проект целиком. Битые ссылки вычищаются автоматически.</div>
        </Section>

        <Section title="Хранилище браузера">
          <div className="row">
            <span className="mono">{fmtKB(stored.len)}</span>
            <span className="muted grow">из ~5 МБ localStorage · {pct(share)}</span>
            <Btn sm variant="ghost" onClick={() => saveNow()} title="Сохранить сейчас">
              сохранить
            </Btn>
          </div>
          <div className={'dp-meter' + (share > 0.85 ? ' hot' : share > 0.6 ? ' warm' : '')}>
            <div style={{ width: `${Math.min(100, share * 100)}%` }} />
          </div>
          <div className="hint">
            Текстуры: {stored.texCount} шт., {fmtKB(stored.texTotal)}
            {stored.len > 0 && ` (${pct(Math.min(1, stored.texTotal / stored.len))} сохранения)`}
          </div>
          {stored.top.length > 0 && (
            <table className="table">
              <thead>
                <tr>
                  <th>крупнейшие текстуры</th>
                  <th className="num">размер</th>
                </tr>
              </thead>
              <tbody>
                {stored.top.map((t) => (
                  <tr key={t.id}>
                    <td>
                      <span className="pv-link" onClick={() => setUI({ page: 'library', libSel: { kind: 'prop', id: t.id } })} title="Открыть в библиотеке">
                        {t.name}
                      </span>
                    </td>
                    <td className="num">{fmtKB(t.len)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Section>

        <Section title="Пресеты">
          <div className="hint">
            {missingTotal
              ? `В пресетах есть то, чего нет в проекте: комнат ${missing.rooms}, декора ${missing.props}, предметов ${missing.items}, экономики ${missing.economy}, отделки ${missing.finishes}. Ваши правки не тронутся.`
              : 'Все пресеты уже в проекте.'}
          </div>
          <Btn variant="primary" onClick={merge} disabled={!missingTotal}>
            Добавить недостающие пресеты
          </Btn>
          <div className="hint">
            {outdated ? `Устарело пресетных сущностей: ${outdated} (пресеты обновились после сохранения проекта).` : 'Пресетные комнаты актуальны.'}
          </div>
          <Btn onClick={update} disabled={!outdated && !missingTotal}>
            Обновить пресеты до последней версии…
          </Btn>
          <Btn variant="danger" onClick={reset}>
            Сбросить к пресетам…
          </Btn>
        </Section>
      </aside>

      <section className="dp-main">
        <div className="dp-tabs">
          <button className={'tab' + (tab === 'project' ? ' on' : '')} onClick={() => setTab('project')}>
            JSON проекта
          </button>
          <button className={'tab' + (tab === 'run' ? ' on' : '')} onClick={() => setTab('run')}>
            JSON прогона
          </button>
          <button className={'tab' + (tab === 'format' ? ' on' : '')} onClick={() => setTab('format')}>
            Формат
          </button>
          <div className="spacer" />
          {tab !== 'format' && <span className="hint" style={{ paddingBottom: 8 }}>предпросмотр: до {PREVIEW_LINES} строк, длинные строки обрезаны</span>}
        </div>
        <div className="dp-body">
          {tab === 'format' ? <FormatRef exportKeys={runOut && !runOut.error ? runOut.keys : null} /> : <pre className="dp-pre">{preview}</pre>}
        </div>
      </section>
    </div>
  );
}
