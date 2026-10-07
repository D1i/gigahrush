// Источники для 3D: последний прогон, одна комната из редактора, JSON прогона из файла.
import { exportRunJSON } from '../gen/world';
import { finishChances } from '../model/ops';
import type { FinishSurface, Project, Room, Run } from '../model/types';
import type { RunExport } from '../blockout/types';

/** Самая вероятная отделка комнаты (явное назначение или правило по тегу); null — нет или не готово. */
function likelyFinish(p: Project, room: Room, surface: FinishSurface): string | null {
  try {
    const ch = finishChances(p, room, surface);
    return ch.length ? ch.reduce((a, b) => (b.p > a.p ? b : a)).finishId : null;
  } catch {
    return null;
  }
}

/** Прогон из одного экземпляра комнаты: rot 0, без сдвига, без розыгрыша спотов; отделка — самая
 *  вероятная по назначению/правилу. */
export function singleRoomRun(p: Project, roomId: string): Run | null {
  const room = p.rooms.find((r) => r.id === roomId);
  if (!room) return null;
  const finish = { wall: likelyFinish(p, room, 'wall'), floor: likelyFinish(p, room, 'floor') };
  return {
    seed: 'room-' + room.id,
    settings: { ...p.generator, count: 1, startRoomId: room.id },
    instances: [{ id: 'i0', roomId: room.id, rot: 0, dx: 0, dy: 0, order: 0, parent: null, depth: 0 }],
    links: [],
    openConnectors: room.connectors.map((c) => ({ inst: 'i0', connector: c.id })),
    content: [{ inst: 'i0', tierId: null, danger: 0, dangerAcc: 0, groups: [], spots: [], loot: [], finish }],
    totals: {},
    warnings: [],
    sight: { maxM: 0, line: null },
    ms: 0,
  };
}

/** JSON прогона с текстурами (мебель и отделка — data:URI), как его получит движок. */
export function runExportOf(p: Project, run: Run): RunExport {
  return exportRunJSON(p, run, { withTex: true }) as RunExport;
}

/** Разобрать JSON прогона из файла; бросает понятную ошибку. */
export function parseRunJSON(text: string): RunExport {
  let data: any;
  try {
    data = JSON.parse(text);
  } catch (e: any) {
    throw new Error('Это не JSON: ' + String(e?.message ?? e));
  }
  if (!data || typeof data !== 'object') throw new Error('Пустой файл');
  if (data.format !== 'room-forge-run') {
    const hint = data.format === 'room-forge-blockout' ? ' (это уже blockout.json — нужен JSON прогона)' : data.rooms && data.props ? ' (это проект Room Forge — нужен JSON прогона из «Генератора»)' : '';
    throw new Error(`Не JSON прогона Room Forge: format = ${JSON.stringify(data.format ?? null)}${hint}`);
  }
  if (!Array.isArray(data.instances)) throw new Error('В JSON прогона нет instances');
  return data as RunExport;
}

/** Текстуры вида сверху: из самого JSON (если экспортирован с текстурами), иначе из проекта по id. */
export function propTexturesOf(p: Project, rx: RunExport | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (!rx) return out;
  for (const pr of rx.props ?? []) {
    const tex = pr.tex ?? p.props.find((x) => x.id === pr.id)?.tex ?? null;
    if (tex && tex.startsWith('data:')) out[pr.id] = tex;
  }
  return out;
}

/** Стартовый экземпляр прогона (без родителя / глубина 0). */
export function startInst(rx: RunExport | null): string | null {
  if (!rx?.instances?.length) return null;
  return (rx.instances.find((i) => i.parent == null) ?? rx.instances.find((i) => i.depth === 0) ?? rx.instances[0]).id;
}

/** Скачать Blob как файл. */
export function downloadBlob(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
