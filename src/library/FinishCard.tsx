// Карточка отделки: параметры, текстура (бесшовная), размер повтора, нижняя панель, теги,
// использование, дублирование и каскадное удаление. Рядом — крупный предпросмотр (FinishStage).
import { useRef, useState } from 'react';
import type { Finish, FinishSurface, Project } from '../model/types';
import { mutate, useProject } from '../model/store';
import { notify, setUI } from '../model/ui';
import { createFinish, deleteFinish, finishUsage } from '../model/ops';
import { loadFinishTextureEx } from '../render/seamless';
import { Btn, Check, ColorField, NumField, Section, Select, TagsField, TextField, pct } from '../ui/kit';
import { FinishPreview } from './FinishPreview';
import { FinishSwatch } from './FinishSwatch';
import { analyzeTexture, texSize, tileLabel, useTexTick } from './finishTex';
import { dadoUsers, roomsWithFinish, ruleRoomsFor, ruleShares, rulesWithFinish } from './finishUse';
import { plural } from './usage';

/** Изменить отделку по id внутри mutate (после undo объект проекта заменяется). */
function editFinish(id: string, fn: (x: Finish, p: Project) => void, key?: string) {
  mutate(
    (p) => {
      const x = p.finishes.find((q) => q.id === id);
      if (x) fn(x, p);
    },
    key ? { key: `lib-fin-${key}-${id}` } : undefined,
  );
}

const SURF_OPTS: { value: FinishSurface; label: string }[] = [
  { value: 'wall', label: 'стены' },
  { value: 'floor', label: 'пол' },
];

// предпочтения переживают смену карточки
let seamlessPref = true;
let seamsPref = false;

function usageOf(p: Project, id: string) {
  try {
    return finishUsage(p, id);
  } catch {
    return { rooms: 0, rules: 0, dado: 0, total: 0 };
  }
}

export function FinishCard({ finish: f, onOpenRules }: { finish: Finish; onOpenRules: () => void }) {
  const p = useProject();
  useTexTick();
  const [busy, setBusy] = useState(false);
  const [seamless, setSeamlessState] = useState(seamlessPref);
  const setSeamless = (v: boolean) => {
    seamlessPref = v;
    setSeamlessState(v);
  };
  const fileRef = useRef<HTMLInputElement>(null);
  /** сколько раппортов узора попало в плитку при последней загрузке (подсказка для размера повтора) */
  const [reps, setReps] = useState<{ x: number; y: number } | null>(null);
  const [rapport, setRapport] = useState(0.53);
  const use = usageOf(p, f.id);
  const rooms = roomsWithFinish(p, f.id);
  const rules = rulesWithFinish(p, f.id);
  const dadoOf = dadoUsers(p, f.id);
  const byRule = ruleRoomsFor(p, f);
  const texKB = f.tex ? Math.round(f.tex.length / 1024) : 0;
  const px = texSize(f.tex);
  const isWall = f.surface === 'wall';
  const otherWalls = p.finishes.filter((x) => x.surface === 'wall' && x.id !== f.id);
  const dadoFin = f.dado ? p.finishes.find((x) => x.id === f.dado!.finishId) : undefined;

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    setReps(null);
    try {
      // бесшовная: сначала с поиском периода узора (обои, кафель) — плитка режется по целым раппортам
      let r: Awaited<ReturnType<typeof loadFinishTextureEx>>;
      if (seamless) r = await loadFinishTextureEx(file, { maxSide: 1024, seamless: { period: 'auto' } }).catch(() => loadFinishTextureEx(file, { maxSide: 1024, seamless: true }));
      else r = await loadFinishTextureEx(file, { maxSide: 1024, seamless: false });
      const rp = r.info?.repeats;
      const multi = !!rp && (rp.x > 1 || rp.y > 1);
      editFinish(f.id, (x) => {
        x.tex = r.url;
        x.color = r.color;
        // в плитке несколько раппортов узора — повтор = раппорт × их число (раппорт можно поправить ниже)
        if (multi) x.tileW = +(rp!.x * rapport).toFixed(3);
        // повтор сохраняет пропорции картинки: ширина задана, высота подстраивается
        if (r.w > 0) x.tileH = +((x.tileW * r.h) / r.w).toFixed(3);
      });
      if (multi) setReps(rp!);
      notify(
        `Текстура загружена${seamless ? ' (бесшовная)' : ''}: ${r.w}×${r.h} px, ${Math.round(r.url.length / 1024)} КБ; цвет — средний по текстуре` +
          (rp ? `. Узор: в плитке ${rp.x} × ${rp.y} раппорта` : ''),
        'ok',
      );
    } catch (e: any) {
      notify(String(e?.message ?? e), 'error');
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const colorFromTex = async () => {
    if (!f.tex) return;
    try {
      const info = await analyzeTexture(f.tex);
      editFinish(f.id, (x) => (x.color = info.color));
    } catch (e: any) {
      notify(String(e?.message ?? e), 'error');
    }
  };

  const tileByImage = () => {
    if (!px) return;
    editFinish(f.id, (x) => (x.tileH = +((x.tileW * px.h) / px.w).toFixed(3)));
  };

  const dup = () => {
    let id = '';
    mutate((pr) => {
      id = createFinish(pr, f.surface, {
        name: `${f.name} (копия)`,
        color: f.color,
        tex: f.tex,
        tileW: f.tileW,
        tileH: f.tileH,
        dado: f.dado ? { ...f.dado } : null,
        tags: [...f.tags],
      }).id;
    });
    if (id) setUI({ libSel: { kind: 'finish', id } });
  };

  const del = () => {
    const lines: string[] = [];
    if (rooms.length)
      lines.push(
        `• явное назначение в ${rooms.length} ${plural(rooms.length, 'комнате', 'комнатах', 'комнатах')} (станет «по правилу»): ${rooms.map((r) => r.room.name).join(', ')}`,
      );
    if (rules.length) {
      const n = rules.reduce((s, r) => s + r.wall + r.floor, 0);
      lines.push(`• ${n} ${plural(n, 'вариант', 'варианта', 'вариантов')} в правилах: ${rules.map((r) => `«${r.rule.tag}»`).join(', ')}`);
    }
    if (dadoOf.length) lines.push(`• нижняя панель у: ${dadoOf.map((x) => `«${x.name}»`).join(', ')}`);
    const msg = lines.length
      ? `Удалить отделку «${f.name}»?\n\nСсылки на неё будут сняты:\n${lines.join('\n')}\n\nОтменить можно через Ctrl+Z.`
      : `Удалить отделку «${f.name}»? Она нигде не используется.`;
    if (!confirm(msg)) return;
    let n = 0;
    mutate((pr) => {
      n = deleteFinish(pr, f.id);
    });
    setUI({ libSel: null });
    notify(`Отделка «${f.name}» удалена${n ? `, снято ссылок: ${n}` : ''}`, 'ok');
  };

  return (
    <>
      <div className="lib-card-h">
        <span className="lib-card-kind cap">{isWall ? 'Отделка стен' : 'Отделка пола'}</span>
        <span className="grow" />
        <Btn sm onClick={dup} title="Копия с новым id">
          Дублировать
        </Btn>
        <Btn sm variant="danger" onClick={del}>
          Удалить
        </Btn>
      </div>

      <Section title="Параметры">
        <TextField label="Имя" value={f.name} onChange={(v) => editFinish(f.id, (x) => (x.name = v), 'name')} />
        <div className="grid2">
          <div className="field" title={use.total ? 'Отделка используется — сначала снимите ссылки (комнаты, правила, панели)' : undefined}>
            <label>Поверхность</label>
            {use.total ? (
              <div className="fin-ro">{isWall ? 'стены' : 'пол'} · используется</div>
            ) : (
              <Select
                value={f.surface}
                options={SURF_OPTS}
                onChange={(v) =>
                  editFinish(f.id, (x) => {
                    x.surface = v;
                    if (v === 'floor') x.dado = null;
                  })
                }
              />
            )}
          </div>
          <div className="field">
            <label>Цвет {f.tex ? '(средний по текстуре)' : ''}</label>
            <div className="row">
              <ColorField value={f.color} onChange={(v) => editFinish(f.id, (x) => (x.color = v), 'color')} title="Цвет без текстуры; для простых движков и плана генератора" />
              <span className="mono muted" style={{ fontSize: 11 }}>
                {f.color}
              </span>
              <span className="grow" />
              {f.tex && (
                <Btn sm variant="ghost" onClick={colorFromTex} title="Пересчитать средний цвет текстуры">
                  из текстуры
                </Btn>
              )}
            </div>
          </div>
        </div>
        <TagsField
          label="Теги (через запятую)"
          value={f.tags}
          onChange={(v) => editFinish(f.id, (x) => (x.tags = v), 'tags')}
          placeholder={isWall ? 'обои, жилое, хрущёвка' : 'линолеум, кухня'}
        />
      </Section>

      <Section title="Текстура">
        <div className="row">
          <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={(e) => onFile(e.target.files?.[0])} />
          <Btn sm onClick={() => fileRef.current?.click()} disabled={busy}>
            {busy ? 'Обработка…' : f.tex ? 'Заменить…' : 'Загрузить с диска…'}
          </Btn>
          <Check
            label="сделать бесшовной"
            value={seamless}
            onChange={setSeamless}
            title="Края картинки сводятся так, чтобы стык между повторами не был виден. Снимите, если текстура уже бесшовная (готовый раппорт)."
          />
          <span className="grow" />
          {f.tex ? (
            <>
              <span className={'mono lib-kb' + (texKB > 300 ? ' big' : '')} title={`Размер data:URI в проекте${px ? `; картинка ${px.w}×${px.h} px` : ''}`}>
                {px ? `${px.w}×${px.h} · ` : ''}
                {texKB} КБ
              </span>
              <Btn sm variant="ghost" onClick={() => editFinish(f.id, (x) => (x.tex = null))} title="Убрать текстуру — останется цвет">
                убрать
              </Btn>
            </>
          ) : (
            <span className="muted" style={{ fontSize: 12 }}>
              нет — заливка цветом
            </span>
          )}
        </div>
        <div className="hint">
          Картинка ужимается до 1024 px по длинной стороне (JPEG) и повторяется по поверхности с шагом «размер повтора». Средний цвет и
          пропорции повтора берутся из картинки.
        </div>
      </Section>

      <Section title="Размер повтора">
        <div className="row fin-end">
          <div className="grow">
            <NumField label="Ширина" suffix="м" value={f.tileW} min={0.02} max={20} step={0.01} digits={3} onChange={(v) => editFinish(f.id, (x) => (x.tileW = v), 'tw')} />
          </div>
          <span className="muted fin-x">×</span>
          <div className="grow">
            <NumField label="Высота" suffix="м" value={f.tileH} min={0.02} max={20} step={0.01} digits={3} onChange={(v) => editFinish(f.id, (x) => (x.tileH = v), 'th')} />
          </div>
          <Btn sm disabled={!px} onClick={tileByImage} title={px ? `Высота = ширина × ${px.h}/${px.w} (пропорции картинки)` : 'Нет текстуры'}>
            по картинке
          </Btn>
        </div>
        {reps && (
          <div className="fin-reps" title="Повтор = раппорт × число раппортов в плитке; пропорции картинки сохраняются">
            <span>
              В плитке <b className="mono">{reps.x} × {reps.y}</b> раппорта узора. Раппорт по ширине
            </span>
            <div style={{ width: 84 }}>
              <NumField
                value={rapport}
                min={0.02}
                max={5}
                step={0.01}
                digits={3}
                suffix="м"
                onChange={(v) => {
                  setRapport(v);
                  editFinish(
                    f.id,
                    (x) => {
                      const k = x.tileW > 0 ? x.tileH / x.tileW : 1;
                      x.tileW = +(reps.x * v).toFixed(3);
                      x.tileH = +(x.tileW * k).toFixed(3);
                    },
                    'rapport',
                  );
                }}
              />
            </div>
            <span className="muted">→ повтор {tileLabel(f)}</span>
          </div>
        )}
        <div className="hint">
          {isWall
            ? 'Один повтор текстуры на стене: рулон обоев — 0.53 м (раппорт 0.53–0.64), кафель 0.15 × 0.15 м, краска — любой.'
            : 'Один повтор на полу: плитка 0.3 × 0.3 м, паркет-ёлочка ~0.6 м, линолеум — по рисунку.'}
        </div>
      </Section>

      {isWall && (
        <Section title="Нижняя панель">
          <Check
            label="Есть нижняя панель"
            value={!!f.dado}
            onChange={(v) =>
              editFinish(f.id, (x) => {
                x.dado = v ? { finishId: otherWalls[0]?.id ?? '', heightM: 1.5 } : null;
              })
            }
            title={otherWalls.length ? 'До заданной высоты стена отделана другой отделкой' : 'Нужна ещё одна отделка стен'}
          />
          {f.dado && (
            <div className="row fin-end">
              <FinishSwatch finish={dadoFin} size={28} extentM={1} />
              <div className="grow">
                <div className="field">
                  <label>Отделка панели</label>
                  <Select
                    value={f.dado.finishId}
                    options={[
                      ...(dadoFin ? [] : [{ value: f.dado.finishId, label: f.dado.finishId ? '(удалена)' : '— выберите —' }]),
                      ...otherWalls.map((x) => ({ value: x.id, label: x.name })),
                    ]}
                    onChange={(v) => editFinish(f.id, (x) => x.dado && (x.dado.finishId = v))}
                  />
                </div>
              </div>
              <div style={{ width: 96 }}>
                <NumField
                  label="Высота"
                  suffix="м"
                  value={f.dado.heightM}
                  min={0.05}
                  max={3}
                  step={0.05}
                  digits={2}
                  onChange={(v) => editFinish(f.id, (x) => x.dado && (x.dado.heightM = v), 'dado-h')}
                />
              </div>
            </div>
          )}
          {f.dado && dadoFin?.dado && <div className="hint fin-warn">У «{dadoFin.name}» своя панель — внутри панели она не применяется.</div>}
          <div className="hint">Подъезд — краска до 1.5 м, санузел — кафель до 1.5 м. Повтор панели тоже считается от пола.</div>
        </Section>
      )}

      <Section title="Использование">
        <div className="grid3">
          <div className="stat">
            <span className="v">{use.rooms}</span>
            <span className="k">явно в комнатах</span>
          </div>
          <div className="stat">
            <span className="v">{use.rules}</span>
            <span className="k">в правилах</span>
          </div>
          <div className="stat">
            <span className="v">{use.dado}</span>
            <span className="k">нижней панелью</span>
          </div>
        </div>
        {rules.length > 0 && (
          <div className="list lib-rooms">
            {rules.map((r) => {
              const list = isWall ? r.rule.wall : r.rule.floor;
              const sh = ruleShares(p, r.rule, f.surface);
              const share = list.reduce((s, v, i) => s + (v.finishId === f.id ? sh[i] : 0), 0);
              return (
                <div key={r.index} className="li" onClick={onOpenRules} title="Открыть правила отделки">
                  <span className="name">
                    правило «{r.rule.tag || '—'}» · {r.wall ? 'стены' : ''}
                    {r.wall && r.floor ? ' + ' : ''}
                    {r.floor ? 'пол' : ''}
                  </span>
                  <span className="meta">{pct(share)}</span>
                  <span className="muted">→</span>
                </div>
              );
            })}
          </div>
        )}
        {rooms.length > 0 && (
          <div className="list lib-rooms">
            {rooms.map((r) => (
              <div key={r.room.id} className="li" onClick={() => setUI({ page: 'editor', roomId: r.room.id, selection: null })} title="Открыть в редакторе">
                <span className="name">{r.room.name}</span>
                <span className="meta">явно: {[r.wall && 'стены', r.floor && 'пол'].filter(Boolean).join(' + ')}</span>
                <span className="muted">→</span>
              </div>
            ))}
          </div>
        )}
        {dadoOf.length > 0 && (
          <div className="list lib-rooms">
            {dadoOf.map((x) => (
              <div key={x.id} className="li" onClick={() => setUI({ libSel: { kind: 'finish', id: x.id } })} title="Открыть отделку">
                <FinishSwatch finish={x} size={16} />
                <span className="name">панель у «{x.name}»</span>
                <span className="meta">до {+(x.dado?.heightM ?? 0).toFixed(2)} м</span>
              </div>
            ))}
          </div>
        )}
        {byRule.length > 0 ? (
          <div className="field">
            <label>
              По правилам может выпасть в {byRule.length} {plural(byRule.length, 'комнате', 'комнатах', 'комнатах')}
            </label>
            <div className="list lib-rooms fin-rule-rooms">
              {byRule.map((r) => (
                <div key={r.room.id} className="li" onClick={() => setUI({ page: 'editor', roomId: r.room.id, selection: null })} title="Открыть в редакторе">
                  <span className="name">{r.room.name}</span>
                  <span className="meta">{pct(r.p)}</span>
                </div>
              ))}
            </div>
          </div>
        ) : (
          !use.total && <div className="hint">Нигде не используется: добавьте отделку в правило или назначьте комнате в инспекторе.</div>
        )}
      </Section>
    </>
  );
}

/** Центральная колонка: крупный предпросмотр в масштабе. */
export function FinishStage({ finish: f }: { finish: Finish }) {
  const p = useProject();
  const [showSeams, setSeamsState] = useState(seamsPref);
  const setSeams = (v: boolean) => {
    seamsPref = v;
    setSeamsState(v);
  };
  const dado = f.surface === 'wall' && f.dado ? p.finishes.find((x) => x.id === f.dado!.finishId) : undefined;
  return (
    <section className="fin-stage">
      <div className="fin-stage-bar">
        <FinishSwatch finish={f} size={22} />
        <span className="fin-stage-name">{f.name || 'без имени'}</span>
        <span className="chip">{f.surface === 'wall' ? 'стены' : 'пол'}</span>
        <span className="mono muted" style={{ fontSize: 11 }}>
          повтор {tileLabel(f)}
        </span>
        <span className="grow" />
        <Check label="границы повтора" value={showSeams} onChange={setSeams} title="Пунктиром — где один повтор текстуры стыкуется со следующим" />
      </div>
      <FinishPreview finish={f} dado={dado} showSeams={showSeams} />
    </section>
  );
}
