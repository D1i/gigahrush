// Вход во «Фрактальную станцию» (tmp/metro-wip/FRACTAL.md §6) — чистое, без движка.
//
//  • Бездонный эскалатор metro_esc_abyss (src/data/roomsMetro.ts) — обычная комната метро без Room.location (кладовая
//    за дверью служебного хода): с площадки у двери три дорожки уходят вниз, во тьму. Узнаётся по тегу ABYSS_TAG.
//  • Дорожки — все вниз, средняя стоит (ABYSS_DIRS, src/locations/metroEscalator.ts escLanes); срыва нет
//    (src/view3d/metroWalk.ts пропускает бездну).
//  • Спуск: с доли подъёма ABYSS.veilFrom над низом комнаты экран темнеет (CSS-вуаль, src/view3d/fractalAbyss.ts), к
//    ABYSS.veilTo — чёрное; на ABYSS.enterAt — вход в слой «Фрактальной станции». Вверх по эскалатору — вуаль спадает.
//  • Выход из станции — StreamWorld.descend(id бездны) (src/gen4d/stream.ts): вестибюль новой квартиры метро этажом ниже.

export const ABYSS_TAG = 'бездна';
/** Направления дорожек бездны (номер дорожки = индекс марша): все вниз, средняя стоит. */
export const ABYSS_DIRS: readonly (1 | 0 | -1)[] = [-1, 0, -1];
/** Доли подъёма над низом комнаты: с 60 % темнеет, к 30 % — чёрное и вход. */
export const ABYSS = { veilFrom: 0.6, veilTo: 0.3, enterAt: 0.3 } as const;

/** Комната — бездонный эскалатор (тег «бездна»). */
export function isAbyss(tags: readonly string[] | undefined): boolean {
  return !!tags && tags.includes(ABYSS_TAG);
}

/** Доля подъёма ступней над низом комнаты (rise ≤ 0 — 1: не бездна, не темнеть). */
function heightShare(feetZ: number, roomZ: number, rise: number): number {
  if (!(rise > 0) || !Number.isFinite(feetZ) || !Number.isFinite(roomZ)) return 1;
  return (feetZ - roomZ) / rise;
}

/** Затемнение 0…1 по высоте ступней над низом комнаты (feetZ, roomZ, rise — м). */
export function abyssVeil(feetZ: number, roomZ: number, rise: number): number {
  const h = heightShare(feetZ, roomZ, rise);
  const v = (ABYSS.veilFrom - h) / (ABYSS.veilFrom - ABYSS.veilTo);
  return Math.min(1, Math.max(0, v));
}

/** Пора входить: ступни на доле подъёма enterAt над низом или ниже (затемнение уже 1). Движение вниз сверяет клей в
 *  прогулке (src/view3d/fractalAbyss.ts). */
export function abyssEnter(feetZ: number, roomZ: number, rise: number): boolean {
  if (!(rise > 0)) return false;
  return heightShare(feetZ, roomZ, rise) <= ABYSS.enterAt + 1e-9;
}
