// Процедурные текстуры «Ржавого лифта» (canvas 2D → DynamicTexture), без файлов — то, чего нет в ассете
// пользователя (src/locations/assets/lift.glb): царапины логова, клуб пыли, искра, номера этажей. Всё
// детерминированно (свой ГСЧ по номеру) — кадр QA повторяем. Размеры — степени двойки (мипмапы, повтор).
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import type { Scene } from '@babylonjs/core/scene';

/** mulberry32: детерминированный ГСЧ 0…1. */
export function texRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Ctx = CanvasRenderingContext2D;

function canvas(w: number, h: number): [HTMLCanvasElement, Ctx] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!];
}

function finish(name: string, c: HTMLCanvasElement, scene: Scene, wrap = true, alpha = false): DynamicTexture {
  const t = new DynamicTexture(name, c, scene, true, Texture.TRILINEAR_SAMPLINGMODE);
  t.wrapU = wrap ? Texture.WRAP_ADDRESSMODE : Texture.CLAMP_ADDRESSMODE;
  t.wrapV = wrap ? Texture.WRAP_ADDRESSMODE : Texture.CLAMP_ADDRESSMODE;
  t.hasAlpha = alpha;
  t.anisotropicFilteringLevel = 4;
  t.update(true, false);
  return t;
}

/** Царапины (логово): прозрачный фон, пучки из 3–4 параллельных борозд — светлый край и тёмная сердцевина. */
export function scratchTexture(scene: Scene): DynamicTexture {
  const S = 256;
  const [c, g] = canvas(S, S);
  const R = texRng(6607);
  g.clearRect(0, 0, S, S);
  for (let n = 0; n < 7; n++) {
    const x = 20 + R() * (S - 40), y = 20 + R() * (S - 40);
    const a = R() * Math.PI * 2, len = 60 + R() * 110;
    const dx = Math.cos(a), dy = Math.sin(a);
    const k = 3 + Math.floor(R() * 2);
    for (let i = 0; i < k; i++) {
      const ox = -dy * (i - k / 2) * 9, oy = dx * (i - k / 2) * 9;
      const bend = (R() - 0.5) * 30;
      for (const [w, col] of [[4.5, 'rgba(200,190,170,0.55)'], [1.8, 'rgba(20,10,8,0.85)']] as const) {
        g.strokeStyle = col;
        g.lineWidth = w;
        g.lineCap = 'round';
        g.beginPath();
        g.moveTo(x + ox, y + oy);
        g.quadraticCurveTo(x + ox + dx * len * 0.5 - dy * bend, y + oy + dy * len * 0.5 + dx * bend, x + ox + dx * len, y + oy + dy * len);
        g.stroke();
      }
    }
  }
  // бурые мазки волочения
  for (let i = 0; i < 3; i++) {
    const y = R() * S;
    const gr = g.createLinearGradient(0, y, S, y);
    gr.addColorStop(0, 'rgba(50,14,10,0)');
    gr.addColorStop(0.5, 'rgba(60,16,10,0.45)');
    gr.addColorStop(1, 'rgba(50,14,10,0)');
    g.fillStyle = gr;
    g.fillRect(0, y, S, 6 + R() * 10);
  }
  return finish('lift:scratch', c, scene, true, true);
}

/** Клуб пыли (частицы): мягкое пятно с неровным краем, альфа в канале A. */
export function puffTexture(scene: Scene): DynamicTexture {
  const S = 64;
  const [c, g] = canvas(S, S);
  const R = texRng(7703);
  for (let i = 0; i < 9; i++) {
    const x = S / 2 + (R() - 0.5) * 18, y = S / 2 + (R() - 0.5) * 18, rad = 12 + R() * 14;
    const gr = g.createRadialGradient(x, y, 0, x, y, rad);
    gr.addColorStop(0, 'rgba(255,255,255,0.35)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, S, S);
  }
  return finish('lift:puff', c, scene, false, true);
}

/** Искра: яркая точка с ореолом. */
export function sparkTexture(scene: Scene): DynamicTexture {
  const S = 32;
  const [c, g] = canvas(S, S);
  const gr = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  gr.addColorStop(0, 'rgba(255,255,255,1)');
  gr.addColorStop(0.25, 'rgba(255,200,120,0.8)');
  gr.addColorStop(1, 'rgba(255,120,40,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, S, S);
  return finish('lift:spark', c, scene, false, true);
}

/** Номера этажей по трафарету — атлас: ячейка i (по горизонтали) — подпись labels[i]; прозрачный фон. */
export function numbersAtlas(scene: Scene, labels: string[]): { tex: DynamicTexture; cells: number } {
  const cells = Math.max(1, labels.length);
  const CW = 64, CH = 64;
  let W = 1;
  while (W < cells * CW) W *= 2;
  const [c, g] = canvas(W, CH);
  const R = texRng(8807);
  g.clearRect(0, 0, W, CH);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  labels.forEach((s, i) => {
    g.font = `bold ${s.length > 2 ? 30 : 44}px "Arial Narrow", Arial, sans-serif`;
    g.fillStyle = 'rgba(215,205,180,0.85)';
    g.fillText(s, i * CW + CW / 2, CH / 2 + 2);
    // облезло: стереть часть краски
    g.globalCompositeOperation = 'destination-out';
    for (let k = 0; k < 40; k++) {
      g.fillStyle = `rgba(0,0,0,${0.3 + 0.6 * R()})`;
      g.fillRect(i * CW + R() * CW, R() * CH, 1 + R() * 4, 1 + R() * 3);
    }
    g.globalCompositeOperation = 'source-over';
  });
  return { tex: finish('lift:numbers', c, scene, false, true), cells: W / CW };
}
