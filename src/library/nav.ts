// Раздел библиотеки (декор/предметы, отделка, правила отделки) переживает переход по страницам.
// Переход снаружи (инспектор, «Данные») задаёт libSel — страница сама переключается на раздел
// выбранного элемента; на правила можно попасть явно через openLibrary('rules').
import { getUI, setUI, type UIState } from '../model/ui';

export type LibSection = 'objects' | 'finishes' | 'rules';

let section: LibSection = 'objects';
/** libSel, который страница видела последним: если он сменился, пока страницы не было, — переключаемся */
let seenSel: UIState['libSel'] = null;

export const sectionFor = (sel: UIState['libSel']): LibSection => (sel?.kind === 'finish' ? 'finishes' : 'objects');

/** Раздел при открытии страницы. */
export function initialSection(): LibSection {
  const sel = getUI().libSel;
  if (sel && sel !== seenSel) section = sectionFor(sel);
  seenSel = sel;
  return section;
}

export function rememberSection(s: LibSection, sel: UIState['libSel']) {
  section = s;
  seenSel = sel;
}

/** Открыть библиотеку на разделе (и, если задан, выбрать элемент). */
export function openLibrary(s: LibSection, sel?: UIState['libSel']) {
  section = s;
  const patch: Partial<UIState> = { page: 'library' };
  if (sel !== undefined) patch.libSel = sel;
  setUI(patch);
  seenSel = getUI().libSel;
}

/** Открыть карточку отделки. */
export const openFinish = (id: string) => openLibrary('finishes', { kind: 'finish', id });
