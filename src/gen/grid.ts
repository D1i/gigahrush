// Разрежённая сетка клеток кусками 64×64 (Int32Array) — быстрее Set/Map на десятках тысяч клеток.
// Значение 0 — «пусто». Координаты: |x|, |y| < 2^20.

const SH = 6;
const MASK = 63;
const CHUNK = 1 << (SH * 2);

export class CellGrid {
  private readonly chunks = new Map<number, Int32Array>();
  private lastKey = NaN;
  private last: Int32Array | undefined;

  private chunk(x: number, y: number, create: boolean): Int32Array | undefined {
    const key = (x >> SH) * 65536 + (y >> SH);
    if (key === this.lastKey) return this.last;
    let c = this.chunks.get(key);
    if (!c) {
      if (!create) return undefined;
      c = new Int32Array(CHUNK);
      this.chunks.set(key, c);
    }
    this.lastKey = key;
    this.last = c;
    return c;
  }

  get(x: number, y: number): number {
    const c = this.chunk(x, y, false);
    return c ? c[((y & MASK) << SH) | (x & MASK)] : 0;
  }

  set(x: number, y: number, v: number): void {
    this.chunk(x, y, true)![((y & MASK) << SH) | (x & MASK)] = v;
  }
}
