// Кооп (docs/COOP.md) во вкладке «3D»: раздел «Онлайн» слева (кнопка «Подключить онлайн») и модалка лобби — создать
// (новый UUID, мир — текущие настройки прогулки и проект) или подключиться по UUID; в лобби — код, игроки, выход.
import { useState } from 'react';
import { Btn, Modal, Section } from '../ui/kit';
import { notify } from '../model/ui';
import type { Project } from '../model/types';
import type { WalkOptions } from '../view3d/walk';
import { coopLeave, coopStart, newLobbyId, PLAYER_COLORS, readProfile, writeProfile, type CoopProfile } from './store';
import { defaultServerUrl, isLobbyId, normServerUrl } from './protocol';
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

/** Модалка лобби: создать / подключиться по UUID; в лобби — код, игроки, мир. */
export function CoopModal(props: { co: CoopSession | null; walk: WalkOptions; project: Project; biomeName: string | null; onClose: () => void }) {
  const { co } = props;
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
  const create = () => coopStart({ url, lobby: newLobbyId(), profile, local: () => props.project, create: { walk: props.walk, project: props.project } });

  if (coopActive(co)) {
    return (
      <Modal title="Лобби" onClose={props.onClose} width={520} footer={<><Btn variant="danger" onClick={coopLeave}>Выйти из лобби</Btn><Btn variant="primary" onClick={props.onClose}>Играть</Btn></>}>
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
            <span className="mono">{co.url}</span>
            {co.meta && (
              <>
                <span>мир</span>
                <span>
                  сид <span className="mono">«{co.meta.seed}»</span>
                  {co.meta.walk.clusters ? ' · квартиры и биомы' : ' · прежний рост'} · создал {co.meta.by}
                </span>
              </>
            )}
          </div>
          <div className="cap">Игроки</div>
          <Players co={co} />
          <div className="hint">
            Друзья открывают игру с того же сервера (или указывают его адрес), вкладка «3D» → «Подключить онлайн» → вставляют код. Мир общий: двери, которые
            открывает кто-то один, открываются у всех. Сквозь друг друга можно пройти, но рядом с другим игроком оба идут на 75% медленнее.
          </div>
        </div>
      </Modal>
    );
  }

  return (
    <Modal title="Онлайн: лобби" onClose={props.onClose} width={560}>
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
              autoFocus
            />
            <Btn variant="primary" onClick={join} disabled={!isLobbyId(code)}>
              Подключиться
            </Btn>
          </div>
          {code.trim() && !isLobbyId(code) && <div className="v3-err">Код лобби — UUID вида xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx</div>}
        </div>

        <div className="coop-box">
          <div className="cap">Создать лобби</div>
          <div className="hint">
            Мир лобби — текущие настройки «Прогулки»: сид <span className="mono">«{props.walk.seed}»</span>
            {props.walk.clusters ? ` · квартиры и биомы${props.biomeName ? ` · старт: ${props.biomeName}` : ''}` : ' · прежний рост'}. Проект (комнаты, отделка) — ваш: у
            кого он другой, скачают ваш. Мир начинается заново с сида — ваша одиночная прогулка не меняется.
          </div>
          <Btn onClick={create}>Создать лобби</Btn>
        </div>

        {err && <div className="v3-err">{err}</div>}
      </div>
    </Modal>
  );
}
