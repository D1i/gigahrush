// Кооп (docs/COOP.md): место игрока в лобби (PlayerInfo.slot, tools/coop-server.mjs) — наименьшее свободное при входе;
// по нему у второго игрока шинель аватара другого цвета (src/coop/avatarModel.ts).
import { describe, expect, it } from 'vitest';
import { startCoopServer } from '../../tools/coop-server.mjs';
import { createDefaultProject } from '../data/presets';
import type { Project } from '../model/types';
import { DEFAULT_WALK } from '../view3d/walk';
import { CoopSession } from './session';

async function until(f: () => boolean, ms = 60000) {
  const t0 = Date.now();
  while (!f()) {
    if (Date.now() - t0 > ms) throw new Error('timeout');
    await new Promise((r) => setTimeout(r, 15));
  }
}

describe('coop: места в лобби', { timeout: 120000 }, () => {
  it('по порядку входа; ушедший освобождает место — следующий занимает его', async () => {
    const { url, close } = await startCoopServer({ port: 0, host: '127.0.0.1' });
    const p: Project = createDefaultProject();
    p.finishes ??= [];
    p.finishRules ??= [];
    const lobby = '7c2e9a41-3b5d-4f6e-9a8b-1c2d3e4f5a6b';
    const mk = (id: string, create = false) =>
      new CoopSession({ url, lobby, player: { id, name: id, color: '#e8b04b' }, local: () => p, ...(create ? { create: { walk: { ...DEFAULT_WALK, seed: 'кооп-места' }, project: p } } : {}) });
    const A = mk('A', true);
    await until(() => A.status === 'online');
    const B = mk('B');
    await until(() => B.status === 'online');
    const C = mk('C');
    await until(() => C.status === 'online' && A.players.size === 2);
    expect(B.players.get('A')?.slot).toBe(0);
    expect(A.players.get('B')?.slot).toBe(1);
    expect(A.players.get('C')?.slot).toBe(2);
    B.leave();
    await until(() => !A.players.has('B'));
    const D = mk('D');
    await until(() => D.status === 'online' && A.players.has('D'));
    expect(A.players.get('D')?.slot).toBe(1);
    expect(D.players.get('C')?.slot).toBe(2);
    for (const s of [A, C, D]) s.leave();
    await close();
  });
});
