// Подбор констант раскачки (npm run test:perf): боты на каретке — кто выживает. LIFT_SPEC='{...}' — свои параметры.
import { it } from 'vitest';
const env = ((globalThis as any).process?.env ?? {}) as Record<string, string | undefined>;
import { DEFAULT_LIFT, LIFT_RUN, LIFT_SLIP, LIFT_HALF_X, LIFT_HALF_Z, createLift, stepLift, type LiftRoll, liftBoard } from './zz_liftx';
import { EXP } from './zz_liftx';
import type { LiftSpec } from '../model/types';

type Bot = (phi: number, vel: number, p: number) => number; // целевое положение, доли
const bots: Record<string, Bot> = {
  idle: () => 0,
  counter: (phi, vel) => -Math.sign(vel) * 0.9,
  downhill: (phi) => Math.sign(phi) * 0.9,
  uphill: (phi) => -Math.sign(phi) * 0.9,
  // перебегает не до самого края, а на полплощадки: короче путь — меньше опоздание
  uphillHalf: (phi) => -Math.sign(phi) * 0.5,
  wrong: (phi, vel) => Math.sign(vel) * 0.9,
  edge: () => 0.9,
};
function sim(spec: LiftSpec, bot: Bot, react: number, seed: number) {
  const roll: LiftRoll = { variant: 'carriage', floors: 1, down: 0, lair: null, seed: 's' + seed };
  // найти попытку, где на пролёте 0 падает доска
  let a = 0; while (!liftBoard(spec, roll, a, 0)) a++;
  const s = createLift(roll, a);
  stepLift(spec, s, 0, { x: 0, z: 0 });
  s.phase = 'moving'; s.target = 1;
  let p = 0; const hist: number[] = []; const hp: number[] = []; const dt = 1 / 60;
  for (let t = 0; t < 40; t += dt) {
    const sw = s.swing;
    if (sw) {
      hist.push(sw.vel); hp.push(sw.phi);
      const lag = Math.max(0, hist.length - 1 - Math.round(react / dt));
      const tgt = bot(hp[lag], hist[lag], p);
      const half = sw.axis === 'x' ? LIFT_HALF_X : LIFT_HALF_Z;
      p += Math.max(-LIFT_RUN * dt, Math.min(LIFT_RUN * dt, (tgt - p) * half)) / half + LIFT_SLIP * sw.phi * dt / half;
      p = Math.max(-1, Math.min(1, p));
    }
    const pos = sw?.axis === 'x' ? { x: p * LIFT_HALF_X, z: 0 } : { x: 0, z: p * LIFT_HALF_Z };
    const ev = stepLift(spec, s, dt, pos);
    if (ev.some((e) => e.type === 'thrown')) return { thrown: true, t, axis: sw!.axis };
    if (ev.some((e) => e.type === 'steady')) return { thrown: false, t, axis: sw!.axis };
  }
  return { thrown: false, t: 99, axis: s.swing?.axis ?? 'x' };
}
for (const SP of JSON.parse(env.SPECS || '[{}]')) it('tune ' + JSON.stringify(SP), () => {
  const rows: string[] = [];
  const { kd, pumpRate, ...sp } = SP as any;
  EXP.kd = kd ?? 3.5; EXP.pumpRate = pumpRate ?? 0.16;
  const spec = { ...DEFAULT_LIFT, ...sp };
  const N = 200;
  const cases: [string, Bot, number][] = [['idle', bots.idle, 0], ['edge', bots.edge, 0], ['down', bots.downhill, 0.3], ['up.3', bots.uphill, 0.3], ['up.5', bots.uphill, 0.5], ['up.7', bots.uphill, 0.7], ['up1', bots.uphill, 1.0], ['up1.3', bots.uphill, 1.3], ['upH.7', bots.uphillHalf, 0.7], ['upH1', bots.uphillHalf, 1.0], ['upH1.3', bots.uphillHalf, 1.3]];
  for (const [name, bot, react] of cases) {
    const all = Array.from({ length: N }, (_, i) => sim(spec, bot, react, i));
    const part = (ax: string) => {
      const r = all.filter((x) => x.axis === ax);
      const th = r.filter((x) => x.thrown).length;
      const ok = r.filter((x) => !x.thrown).map((x) => x.t).sort((a, b) => a - b);
      return `${ax}${Math.round((100 * th) / (r.length || 1))}%${ok.length ? '/' + ok[ok.length >> 1].toFixed(0) + 'с' : ''}`;
    };
    rows.push(`${name}: ${part('x')} ${part('z')}`);
  }
  console.log('RES ' + JSON.stringify(SP) + ' :: ' + rows.join(' | '));
});
