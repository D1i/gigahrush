// Кооп (docs/COOP.md) во вкладке «3D»: раздел «Онлайн» слева (кнопка «Подключить онлайн») и модалка лобби. Главный путь —
// Steam: мост (tools/steam-bridge.mjs) на этом компьютере, хост — «Создать лобби через Steam», игрок — «Подключиться
// через Steam» (код лобби — из данных лобби Steam). Без Steam — свой сервер: создать (новый UUID) или подключиться по UUID.
import { useEffect, useState, type ReactNode } from 'react';
import { Btn, Modal, Section } from '../ui/kit';
import { notify } from '../model/ui';
import type { Project } from '../model/types';
import type { WalkOptions } from '../view3d/walk';
import { coopLeave, coopStart, newLobbyId, PLAYER_COLORS, readProfile, writeProfile, type CoopProfile } from './store';
import { bridgeWsUrl, defaultServerUrl, isLobbyId, normServerUrl, steamBridgeBases, type SteamBridgeStatus } from './protocol';
import type { CoopSession, CoopStatus } from './session';
import './coop.css';

export const COOP_STATUS: Record<CoopStatus, string> = {
  connecting: 'подключение…',
  syncing: 'загрузка мира лобби…',
  online: 'в игре',
  reconnecting: 'связь потеряна — переподключение…',
  closed: 'не в лобби',
  error: 'ошибка',
};

/** Лобби активно (подключено или подключается). */
export const coopActive = (co: CoopSession | null): co is CoopSession => !!co && co.status !== 'closed' && co.status !== 'error';

async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    notify('Код лобби скопирован — отправьте его друзьям', 'ok');
  } catch {
    notify('Не удалось скопировать — выделите код и скопируйте вручную', 'warn');
  }
}

function Players(props: { co: CoopSession }) {
  const { co } = props;
  const list = [{ ...co.me, you: true }, ...[...co.players.values()].map((p) => ({ ...p, you: false }))];
  return (
    <div className="coop-players">
      {list.map((p) => (
        <span key={p.id} className="coop-player" title={co.host === p.id ? 'хост: хранит мир лобби на сервере' : undefined}>
          <i style={{ background: p.color }} />
          {p.name}
          {p.you && <span className="muted"> (вы)</span>}
          {co.host === p.id && <span className="muted"> ★</span>}
        </span>
      ))}
    </div>
  );
}

/** HUD прогулки в лобби: игроки и «рядом — медленнее». */
export function CoopHud(props: { co: CoopSession; slow: boolean }) {
  const { co } = props;
  return (
    <div className="float hud coop-hud">
      <span className="muted">в лобби {co.players.size + 1}:</span>
      <Players co={co} />
      {props.slow && <span className="coop-slow">рядом игрок — шаг медленнее</span>}
    </div>
  );
}

/** Раздел «Онлайн» слева во вкладке «3D». */
export function CoopSection(props: { co: CoopSession | null; onOpen: () => void }) {
  const { co } = props;
  const err = co?.status === 'error' ? co.error : null;
  const on = coopActive(co);
  return (
    <Section title="Онлайн">
      {on ? (
        <div className="coop-side">
          <div>
            Лобби <span className="mono">{co.lobby.slice(0, 8)}…</span> · <span className={co.status === 'online' ? 'coop-ok' : 'coop-warn'}>{COOP_STATUS[co.status]}</span>
          </div>
          <Players co={co} />
          <div className="v3-seg">
            <Btn sm onClick={props.onOpen} title="Код лобби (скопировать для друзей), игроки, мир">
              Лобби…
            </Btn>
            <Btn sm variant="danger" onClick={coopLeave} title="Выйти из лобби — вернуться в свою одиночную прогулку">
              Выйти
            </Btn>
          </div>
        </div>
      ) : (
        <div className="coop-side">
          <Btn variant="primary" onClick={props.onOpen} title="Совместная прогулка: создать лобби или войти по его UUID">
            Подключить онлайн
          </Btn>
          {err && <div className="v3-err">{err}</div>}
          <div className="hint">Совместная «Прогулка»: один мир на всех, лобби — по UUID.</div>
        </div>
      )}
    </Section>
  );
}

/** Мост Steam на этом компьютере: опрос GET /steam раз в 3 с, пока модалка открыта (null — не найден); server — поле
 *  «Сервер». Моста нет — браузер пишет в консоль «ERR_CONNECTION_REFUSED» на каждый опрос: это ожидаемо. */
function useSteamBridge(on: boolean, server: string): { base: string; st: SteamBridgeStatus } | null {
  const [found, setFound] = useState<{ base: string; st: SteamBridgeStatus } | null>(null);
  useEffect(() => {
    if (!on) return;
    let alive = true;
    const probe = async () => {
      for (const base of steamBridgeBases(server)) {
        try {
          const ctl = new AbortController();
          const t = setTimeout(() => ctl.abort(), 1200);
          const r = await fetch(base + '/steam', { signal: ctl.signal, cache: 'no-store' });
          clearTimeout(t);
          const st = (await r.json()) as SteamBridgeStatus;
          if (st?.app === 'room-forge-steam') {
            if (alive) setFound({ base, st });
            return;
          }
        } catch {}
      }
      if (alive) setFound(null);
    };
    void probe();
    const timer = setInterval(probe, 3000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [on, server]);
  return found;
}

/** Блок «Steam»: мост найден — кнопка хоста / игрока; нет — как запустить. */
function SteamBox(props: { bridge: { base: string; st: SteamBridgeStatus } | null; onCreate: (url: string) => void; onJoin: (url: string, lobby: string) => void }) {
  const b = props.bridge;
  if (!b) {
    return (
      <div className="coop-box coop-steam">
        <div className="cap">Steam (Spacewar) — до 4 игроков</div>
        <div className="hint">
          Мост Steam на этом компьютере не найден. Запустите Steam (вход в аккаунт) и мост рядом с игрой:
          <br />
          сервер — <span className="mono">npm run steam -- host</span> (покажет id лобби Steam для друзей);
          <br />
          игрок — <span className="mono">npm run steam -- join &lt;id лобби Steam&gt;</span> или <span className="mono">npm run steam -- join</span> и «Присоединиться к игре» у
          хоста в списке друзей Steam.
          <br />
          Связь — прямым туннелем через сеть Steam: порты открывать не нужно. Мост не на 8787 (<span className="mono">--port N</span>) — впишите{' '}
          <span className="mono">localhost:N</span> в поле «Сервер» ниже.
        </div>
      </div>
    );
  }
  const { st } = b;
  const url = bridgeWsUrl(b.base);
  const members = `${st.steam.members}/${st.steam.max}`;
  return (
    <div className="coop-box coop-steam">
      <div className="cap">Steam (Spacewar) — до {st.steam.max} игроков</div>
      {st.error && <div className="v3-err">{st.error}</div>}
      {st.role === 'host' ? (
        <>
          <div>
            Вы — сервер. Лобби Steam <span className="mono">{st.steam.lobby ?? '…'}</span> · в нём {members}
          </div>
          <div className="hint">
            Друзьям: <span className="mono">npm run steam -- join {st.steam.lobby ?? '<id>'}</span> или «Присоединиться к игре» у вас в списке друзей Steam. Создайте
            игровое лобби — его код уйдёт им через Steam сам.
          </div>
          <Btn variant="primary" onClick={() => props.onCreate(url)} disabled={!st.ready}>
            Создать лобби через Steam
          </Btn>
        </>
      ) : !st.ready ? (
        <div className="hint">Мост ждёт лобби Steam: в Steam — список друзей → хост → «Присоединиться к игре» (или перезапустите мост с id лобби).</div>
      ) : st.game.lobby ? (
        <>
          <div>
            Хост — <b>{st.steam.host ?? '?'}</b> · лобби Steam {members}
          </div>
          <Btn variant="primary" onClick={() => props.onJoin(url, st.game.lobby!)}>
            Подключиться через Steam
          </Btn>
        </>
      ) : (
        <div className="hint">
          Вы в лобби Steam хоста <b>{st.steam.host ?? '?'}</b> ({members}). Ждём, когда он создаст игровое лобби…
        </div>
      )}
    </div>
  );
}

/** Рамка формы лобби: заголовок, тело и кнопки (в лобби — «Выйти из лобби» / «Играть»; вне лобби — null). */
type LobbyFrame = (title: string, body: ReactNode, footer: ReactNode | null) => ReactNode;

/** Без рамки: заголовок над формой, кнопки под ней (меню «Запустить без отладки» — src/play/PlayPage.tsx). */
const plainFrame: LobbyFrame = (title, body, footer) => (
  <div className="coop-form">
    <div className="coop-form-h">{title}</div>
    {body}
    {footer && <div className="coop-form-f">{footer}</div>}
  </div>
);

/** Модалка лобби (вкладка «3D»): форма лобби в Modal, «Играть» — закрыть модалку. */
export function CoopModal(props: { co: CoopSession | null; walk: WalkOptions; project: Project; biomeName: string | null; onClose: () => void }) {
  return (
    <CoopLobbyForm
      {...props}
      onPlay={props.onClose}
      frame={(title, body, footer) => (
        <Modal title={title} onClose={props.onClose} width={footer ? 520 : 560} footer={footer ?? undefined}>
          {body}
        </Modal>
      )}
    />
  );
}

/**
 * Форма лобби: Steam / создать / подключиться по UUID; в лобби — код, игроки, мир. walk — мир нового лобби («Создать
 * лобби»; сюжет — WalkOptions.story: «Запустить без отладки»). onPlay — «Играть»; frame — рамка (по умолчанию без неё).
 */
export function CoopLobbyForm(props: { co: CoopSession | null; walk: WalkOptions; project: Project; biomeName: string | null; onPlay: () => void; frame?: LobbyFrame }) {
  const { co } = props;
  const frame = props.frame ?? plainFrame;
  const story = !!props.walk.story;
  const err = co?.status === 'error' ? co.error : null;
  const [prof, setProfS] = useState<CoopProfile>(readProfile);
  const [code, setCode] = useState(prof.lastLobby);
  const setProf = (patch: Partial<CoopProfile>) => {
    const next = { ...prof, ...patch };
    setProfS(next);
    writeProfile(next);
  };
  const url = normServerUrl(prof.server);
  const profile = { ...prof, name: prof.name.trim() || 'Жилец' };
  const join = () => {
    const id = code.trim().toLowerCase();
    if (!isLobbyId(id)) return;
    coopStart({ url, lobby: id, profile, local: () => props.project });
  };
  const create = (u = url) => coopStart({ url: u, lobby: newLobbyId(), profile, local: () => props.project, create: { walk: props.walk, project: props.project } });
  const bridge = useSteamBridge(true, prof.server);
  const viaSteam = !!bridge && !!co && co.url === bridgeWsUrl(bridge.base);

  if (coopActive(co)) {
    return frame(
      'Лобби',
      <div className="coop-modal">
          <div className="field">
            <label>Код лобби (UUID) — отправьте друзьям</label>
            <div className="coop-row">
              <input className="input num coop-code" readOnly value={co.lobby} onFocus={(e) => e.currentTarget.select()} />
              <Btn onClick={() => void copy(co.lobby)}>Копировать</Btn>
            </div>
          </div>
          <div className="v3-kv">
            <span>статус</span>
            <span className={co.status === 'online' ? 'coop-ok' : 'coop-warn'}>
              {COOP_STATUS[co.status]}
              {co.status === 'online' && <span className="muted"> · операций мира {co.lastSeq}</span>}
            </span>
            <span>сервер</span>
            {viaSteam ? (
              <span>
                Steam · лобби <span className="mono">{bridge!.st.steam.lobby}</span> · {bridge!.st.role === 'host' ? 'вы — сервер' : `хост — ${bridge!.st.steam.host ?? '?'}`} ·{' '}
                {bridge!.st.steam.members}/{bridge!.st.steam.max}
              </span>
            ) : (
              <span className="mono">{co.url}</span>
            )}
            {co.meta && (
              <>
                <span>мир</span>
                <span>
                  сид <span className="mono">«{co.meta.seed}»</span>
                  {co.meta.walk.story ? ' · сюжет' : co.meta.walk.clusters ? ' · квартиры и биомы' : ' · прежний рост'} · создал {co.meta.by}
                </span>
              </>
            )}
          </div>
          <div className="cap">Игроки</div>
          <Players co={co} />
          <div className="hint">
            {viaSteam
              ? 'Друзья запускают мост Steam (npm run steam -- join <id лобби Steam> или «Присоединиться к игре» в Steam) и в игре нажимают «Подключиться через Steam» — код придёт сам.'
              : story
              ? 'Друзья открывают игру с того же сервера (или указывают его адрес), «Запустить без отладки» → «Мультиплеер» → вставляют код.'
              : 'Друзья открывают игру с того же сервера (или указывают его адрес), вкладка «3D» → «Подключить онлайн» → вставляют код.'}{' '}
            Мир общий: двери, которые открывает кто-то один, открываются у всех. Сквозь друг друга можно пройти, но рядом с другим игроком оба идут на 75%
            медленнее. До 4 игроков.
          </div>
        </div>,
      <>
        <Btn variant="danger" onClick={coopLeave}>
          Выйти из лобби
        </Btn>
        <Btn variant="primary" onClick={props.onPlay}>
          Играть
        </Btn>
      </>,
    );
  }

  return frame(
    'Онлайн: лобби',
      <div className="coop-modal">
        <div className="grid2">
          <div className="field">
            <label>Имя</label>
            <input className="input" value={prof.name} maxLength={40} onChange={(e) => setProf({ name: e.target.value })} />
          </div>
          <div className="field">
            <label>Цвет</label>
            <div className="coop-colors">
              {PLAYER_COLORS.map((c) => (
                <button key={c} className={'coop-color' + (prof.color === c ? ' on' : '')} style={{ background: c }} onClick={() => setProf({ color: c })} title={c} />
              ))}
            </div>
          </div>
        </div>
        <SteamBox bridge={bridge} onCreate={(u) => create(u)} onJoin={(u, lobby) => coopStart({ url: u, lobby, profile, local: () => props.project })} />

        <div className="cap">Без Steam — свой сервер</div>
        <div className="field">
          <label>Сервер</label>
          <input className="input num" value={prof.server} placeholder={defaultServerUrl()} onChange={(e) => setProf({ server: e.target.value })} />
          <div className="hint">
            Пусто — тот сервер, с которого открыта игра (<span className="mono">npm run dev</span> или <span className="mono">npm run coop-server</span>). Игра из файла — укажите
            адрес, например <span className="mono">192.168.0.5:8787</span>.
          </div>
        </div>

        <div className="coop-box">
          <div className="cap">Подключиться по UUID</div>
          <div className="coop-row">
            <input
              className="input num coop-code"
              value={code}
              placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
              onChange={(e) => setCode(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && join()}
            />
            <Btn variant="primary" onClick={join} disabled={!isLobbyId(code)}>
              Подключиться
            </Btn>
          </div>
          {code.trim() && !isLobbyId(code) && <div className="v3-err">Код лобби — UUID вида xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx</div>}
        </div>

        <div className="coop-box">
          <div className="cap">Создать лобби</div>
          {story ? (
            <div className="hint">
              Новая игра по сюжету — с хрущёвки, сид <span className="mono">«{props.walk.seed}»</span>. Проект (комнаты, отделка) — ваш: у кого он другой, скачают
              ваш. Ваша одиночная игра не меняется.
            </div>
          ) : (
            <div className="hint">
              Мир лобби — текущие настройки «Прогулки»: сид <span className="mono">«{props.walk.seed}»</span>
              {props.walk.clusters ? ` · квартиры и биомы${props.biomeName ? ` · старт: ${props.biomeName}` : ''}` : ' · прежний рост'}. Проект (комнаты, отделка) — ваш: у
              кого он другой, скачают ваш. Мир начинается заново с сида — ваша одиночная прогулка не меняется.
            </div>
          )}
          <Btn onClick={() => create()}>Создать лобби</Btn>
        </div>

        {err && <div className="v3-err">{err}</div>}
      </div>,
    null,
  );
}
