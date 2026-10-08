// Кооп (docs/COOP.md): текущее лобби страницы и профиль игрока. Лобби живёт вне React — копия мира применяет операции,
// даже когда вкладка «3D» закрыта; страница подписывается на изменения (useCoop).
import { useSyncExternalStore } from 'react';
import { CoopSession, type CoopStartOptions } from './session';
import { defaultServerUrl, newLobbyId } from './protocol';

let session: CoopSession | null = null;
let ver = 0;
const listeners = new Set<() => void>();
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
const bump = () => {
  ver++;
  listeners.forEach((l) => l());
};

export function getCoop(): CoopSession | null {
  return session;
}

/** Лобби (перерисовка на каждое изменение статуса, игроков, копии мира). */
export function useCoop(): CoopSession | null {
  useSyncExternalStore(subscribe, () => ver);
  return session;
}

/** Войти в лобби / создать его (прежнее лобби — выйти). */
export function coopStart(o: Omit<CoopStartOptions, 'player'> & { profile: CoopProfile }): CoopSession {
  session?.leave();
  const { profile, ...rest } = o;
  // (колбэк может прийти ещё из конструктора — неверный адрес сервера)
  let s: CoopSession | null = null;
  s = new CoopSession({ ...rest, player: { id: playerId(), name: profile.name, color: profile.color } }, () => {
    // лобби пропало / не пустили — после перезагрузки не входить снова
    if (s && s.status === 'error' && session === s) forget();
    bump();
  });
  session = s;
  writeProfile({ ...profile, lastLobby: s.lobby });
  try {
    if (s.status !== 'error') sessionStorage.setItem(ACTIVE_KEY, JSON.stringify({ lobby: s.lobby, url: s.url }));
  } catch {}
  bump();
  return s;
}

export function coopLeave() {
  const s = session;
  session = null;
  s?.leave();
  forget();
  bump();
}

function forget() {
  try {
    sessionStorage.removeItem(ACTIVE_KEY);
  } catch {}
}

/** Вкладка была в лобби до перезагрузки — войти снова (тот же игрок: id вкладки, место в лобби — своё). */
export function coopResume(local: () => import('../model/types').Project): CoopSession | null {
  if (session) return session;
  try {
    const a = JSON.parse(sessionStorage.getItem(ACTIVE_KEY) || 'null') as { lobby?: string; url?: string } | null;
    if (!a?.lobby || !a.url) return null;
    return coopStart({ url: a.url, lobby: a.lobby, profile: readProfile(), local });
  } catch {
    return null;
  }
}

// ───────────────────────── профиль ─────────────────────────

export interface CoopProfile {
  name: string;
  color: string;
  /** адрес relay (пусто — по умолчанию: тот сервер, с которого открыта игра) */
  server: string;
  lastLobby: string;
}

/** Цвета игроков на выбор. */
export const PLAYER_COLORS = ['#e8b04b', '#4fb3e8', '#e0563f', '#6fd36a', '#c77de8', '#f2f2f2'];
const PROFILE_KEY = 'room-forge/coop/profile';
const ID_KEY = 'room-forge/coop/player';
/** лобби этой вкладки (переподключиться после перезагрузки) */
const ACTIVE_KEY = 'room-forge/coop/active';

export function readProfile(): CoopProfile {
  try {
    const o = JSON.parse(localStorage.getItem(PROFILE_KEY) || '{}');
    return {
      name: typeof o.name === 'string' && o.name.trim() ? o.name.slice(0, 40) : 'Жилец-' + Math.floor(100 + Math.random() * 900),
      color: typeof o.color === 'string' && /^#[0-9a-f]{6}$/i.test(o.color) ? o.color : PLAYER_COLORS[Math.floor(Math.random() * PLAYER_COLORS.length)],
      server: typeof o.server === 'string' ? o.server : '',
      lastLobby: typeof o.lastLobby === 'string' ? o.lastLobby : '',
    };
  } catch {
    return { name: 'Жилец', color: PLAYER_COLORS[0], server: '', lastLobby: '' };
  }
}

export function writeProfile(p: CoopProfile) {
  try {
    localStorage.setItem(PROFILE_KEY, JSON.stringify(p));
  } catch {}
}

/** id игрока — на вкладку (две вкладки одного браузера — два игрока), переживает перезагрузку. */
function playerId(): string {
  try {
    const id = sessionStorage.getItem(ID_KEY);
    if (id) return id;
    const n = newLobbyId();
    sessionStorage.setItem(ID_KEY, n);
    return n;
  } catch {
    return newLobbyId();
  }
}

export { defaultServerUrl, newLobbyId };
