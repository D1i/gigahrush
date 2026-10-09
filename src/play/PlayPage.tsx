// «Запустить без отладки» (docs/GAMEPLAY.md, «Запуск без отладки»): игра по сюжету (src/game/story.ts) на весь экран.
// Экраны: главное меню → одиночная (продолжить / новая игра) или мультиплеер (Steam, лобби по UUID) → игра — вкладка
// «3D» в режиме play (src/view3d/View3DPage.tsx: без отладочных панелей, пауза по Esc, конец — «Новая игра» / «Главное
// меню»). Babylon грузится только с началом игры (View3DPage — лениво).
import { Suspense, lazy, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useProject } from '../model/store';
import type { Project } from '../model/types';
import { hasWalkSave, resetWalkSave, storyWalk, type WalkOptions } from '../view3d/walk';
import { coopLeave, coopResume, getCoop, useCoop } from '../coop/store';
import { CoopLobbyForm, coopActive } from '../coop/CoopPanel';
import './play.css';

const View3DPage = lazy(() => import('../view3d/View3DPage'));

// ── сохранение сюжета: сид текущей одиночной игры (мир и игрок — в сохранении прогулки этого сида) ──
const STORY_KEY = 'room-forge/story';
interface StorySave {
  /** сид текущей одиночной игры ('' — игры ещё не было) */
  seed: string;
  /** сиды брошенных игр («Новая игра»): их миры стираются (resetWalkSave), когда сессия игры закрыта (иначе dispose сохранит снова) */
  old: string[];
}

function readStory(): StorySave {
  try {
    const o = JSON.parse(localStorage.getItem(STORY_KEY) || '{}');
    return {
      seed: typeof o.seed === 'string' ? o.seed : '',
      old: Array.isArray(o.old) ? o.old.filter((s: unknown): s is string => typeof s === 'string' && !!s) : [],
    };
  } catch {
    return { seed: '', old: [] };
  }
}

function writeStory(s: StorySave) {
  try {
    localStorage.setItem(STORY_KEY, JSON.stringify(s));
  } catch {}
}

/** Сид нового мира: «хрущ-482113» (виден в лобби). */
const newSeed = () => `хрущ-${100000 + Math.floor(Math.random() * 900000)}`;

/** Стереть миры брошенных игр — только когда игра не идёт (сессия прогулки закрыта). */
function purgeOld(p: Project) {
  const s = readStory();
  if (!s.old.length) return;
  for (const seed of s.old) if (seed !== s.seed) resetWalkSave(p, storyWalk(seed));
  writeStory({ ...s, old: [] });
}

/** Новая одиночная игра: новый сид (прежний — в брошенные). */
function startStory(p: Project): WalkOptions {
  const s = readStory();
  const seed = newSeed();
  writeStory({ seed, old: s.seed ? [...s.old, s.seed] : s.old });
  const w = storyWalk(seed);
  resetWalkSave(p, w);
  return w;
}

type Screen = 'main' | 'solo' | 'confirm' | 'mp' | 'game';

export default function PlayPage(props: { onExit: () => void }) {
  const p = useProject();
  const co = useCoop();
  const coOn = coopActive(co);
  const [screen, setScreen] = useState<Screen>('main');
  /** игра: одиночная — мир сюжета сида; в лобби — мир лобби (walk — запасной, View3DPage берёт копию лобби) */
  const [kind, setKind] = useState<'solo' | 'coop'>('solo');
  const [walk, setWalk] = useState<WalkOptions | null>(null);
  /** мир нового лобби («Создать лобби»): своя новая игра по сюжету */
  const [mpWalk, setMpWalk] = useState<WalkOptions>(() => storyWalk(newSeed()));

  // вкладка была в лобби до перезагрузки (или лобби уже идёт) — сразу в игру
  useEffect(() => {
    if (!coopResume(() => p)) return;
    setKind('coop');
    setScreen('game');
  }, []);
  // не в игре — сессии прогулки нет: миры брошенных игр можно стереть
  useEffect(() => {
    if (screen !== 'game') purgeOld(p);
  }, [screen]);
  // лобби пропало (сервер, ошибка) — назад к лобби: там видно, что случилось
  useEffect(() => {
    if (screen === 'game' && kind === 'coop' && !coOn) setScreen('mp');
  }, [screen, kind, coOn]);
  // Esc в подменю — назад
  useEffect(() => {
    if (screen === 'main' || screen === 'game') return;
    const k = (e: KeyboardEvent) => {
      if (e.code !== 'Escape' || (e.target as HTMLElement | null)?.tagName === 'INPUT') return;
      if (screen === 'mp') leaveMp();
      else setScreen(screen === 'confirm' ? 'solo' : 'main');
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [screen]);

  /** Сохранённая одиночная игра (сид и есть ли мир) — для «Продолжить». */
  const save = useMemo(() => {
    const s = readStory();
    return s.seed && hasWalkSave(p, storyWalk(s.seed)) ? s.seed : null;
  }, [screen, p]);

  const play = (w: WalkOptions) => {
    setWalk(w);
    setKind('solo');
    setScreen('game');
  };
  const newGame = () => play(startStory(p));
  const openMp = () => {
    // каждое новое лобби — новый мир сюжета
    if (!coopActive(getCoop())) setMpWalk(storyWalk(newSeed()));
    setScreen('mp');
  };
  const leaveMp = () => {
    if (coopActive(getCoop())) coopLeave();
    setScreen('main');
  };
  /** Из игры в главное меню; из лобби — с выходом (мир лобби остаётся у остальных, вернуться — по коду). */
  const toMenu = () => {
    if (coopActive(getCoop())) coopLeave();
    setScreen('main');
  };

  if (screen === 'game' && (walk || kind === 'coop')) {
    return (
      <div className="play">
        <Suspense fallback={<div className="play-loading">Загрузка…</div>}>
          <View3DPage
            play={{
              walk: kind === 'coop' ? mpWalk : walk!,
              onMenu: toMenu,
              // после «КОНЕЦ»: новая игра — новый мир (сюда не попадает в лобби: там мир общий)
              onNewGame: () => setWalk(startStory(p)),
            }}
          />
        </Suspense>
      </div>
    );
  }

  return (
    <div className="play">
      <div className="play-wall">
        <div className="play-lamp" aria-hidden />
        <div className="play-paint" aria-hidden />
        <h1 className="play-title">Гигахрущ</h1>

        {screen === 'main' && (
          <Board>
            <Row onClick={() => setScreen('solo')}>Одиночная игра</Row>
            <Row onClick={openMp}>Мультиплеер</Row>
            <Row onClick={props.onExit} dim>
              Выйти в редактор
            </Row>
          </Board>
        )}

        {screen === 'solo' && (
          <Board head="Одиночная игра">
            <Row onClick={() => save && play(storyWalk(save))} disabled={!save} note={save ? `мир ${save}` : 'сохранённой игры нет'}>
              Продолжить
            </Row>
            <Row onClick={() => (save ? setScreen('confirm') : newGame())}>Новая игра</Row>
            <Row onClick={() => setScreen('main')} dim>
              Назад
            </Row>
          </Board>
        )}

        {screen === 'confirm' && (
          <Board head="Начать заново?" note="Сохранённая игра будет стёрта: снова хрущёвка, с самого начала.">
            <Row onClick={newGame}>Да, новая игра</Row>
            <Row onClick={() => setScreen('solo')} dim>
              Нет
            </Row>
          </Board>
        )}

        {screen === 'mp' && (
          <div className="play-sheet">
            <CoopLobbyForm
              co={co}
              walk={mpWalk}
              project={p}
              biomeName={null}
              onPlay={() => {
                setKind('coop');
                setScreen('game');
              }}
            />
            <button className="play-back" onClick={leaveMp} title={coOn ? 'Выйти из лобби и вернуться в меню' : 'В главное меню'}>
              ‹ {coOn ? 'Выйти из лобби' : 'Назад'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/** Наборная доска (чёрная, в бороздках, с белыми пластмассовыми буквами) — меню. */
function Board(props: { head?: string; note?: string; children: ReactNode }) {
  return (
    <div className="play-board" role="menu">
      {props.head && (
        <div className="play-board-head">
          <Letters text={props.head} />
        </div>
      )}
      {props.note && <div className="play-board-note">{props.note}</div>}
      {props.children}
    </div>
  );
}

function Row(props: { onClick: () => void; children: string; disabled?: boolean; dim?: boolean; note?: string }) {
  return (
    <button className={'play-row' + (props.dim ? ' dim' : '')} role="menuitem" onClick={props.onClick} disabled={props.disabled} aria-label={props.children}>
      <Letters text={props.children} />
      {props.note && <span className="play-row-note">{props.note}</span>}
    </button>
  );
}

/** Буквы доски вставлены руками — каждая чуть сдвинута и наклонена (по коду буквы и месту: всегда одинаково). */
function Letters(props: { text: string }) {
  return (
    <span className="play-letters" aria-hidden>
      {[...props.text.toUpperCase()].map((ch, i) => {
        const h = (ch.charCodeAt(0) * 31 + i * 17) % 97;
        const dy = ((h % 7) - 3) * 0.3;
        const rot = (((h >> 2) % 9) - 4) * 0.35;
        return (
          <span key={i} style={ch === ' ' ? undefined : { transform: `translateY(${dy.toFixed(1)}px) rotate(${rot.toFixed(2)}deg)` }}>
            {ch === ' ' ? ' ' : ch}
          </span>
        );
      })}
    </span>
  );
}
