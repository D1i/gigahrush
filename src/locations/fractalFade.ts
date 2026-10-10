// «Фрактальная станция» (./sceneFractal.ts): своё угасание по расстоянию вместо тумана сцены — для «струн света»
// тессеракта (световые линии, ядра, струны вдоль пилонов, копии себя). Туман сцены LINEAR гасит всё к ~2.5·P в чёрное;
// свету нужна своя кривая: до fade.x м — полная яркость, дальше спад e^(−(d − x)/y), к [z, w] — плавно в ноль (там кончается
// геометрия копий — без обреза). Материалу с плагином туман выключают (material.fogEnabled = false).
//
// Расширение (widen): тонкая полоса вдали уже пикселя мерцает и пропадает. Вершина несёт атрибут frOff — смещение от
// оси полосы (поперёк, в координатах меша); в мире полоса раздувается до frPx.x·d (м на метр дальности ≈ полпикселя),
// а яркость делится на тот же множитель — свет полосы сохраняется, вдали она — ровная тонкая нить без «ползания».
// Глаз — vEyePosition сцены (её буфер обновляется каждый кадр); frPx — обычный uniform, ставится на КАЖДУЮ привязку
// (onBindObservable): bindForSubMesh плагина Babylon зовёт только при «перепривязке» материала — значения в буфере
// материала устаревали (полосы раздувало в серые трубы по расстоянию от точки прибытия).
import { MaterialPluginBase } from '@babylonjs/core/Materials/materialPluginBase';
import type { Material } from '@babylonjs/core/Materials/material';
import type { UniformBuffer } from '@babylonjs/core/Materials/uniformBuffer';
import { Vector4 } from '@babylonjs/core/Maths/math.vector';

/** Имя атрибута вершины: смещение от оси полосы (vec3, координаты меша). */
export const FR_OFF = 'frOff';

/** Кривая угасания (чистая часть, тест — fractalScene.test.ts): тот же расчёт, что в шейдере. */
export function frFadeK(d: number, f: { x: number; y: number; z: number; w: number }): number {
  let k = Math.exp(-Math.max(d - f.x, 0) / f.y);
  if (f.w > f.z) {
    const t = Math.min(1, Math.max(0, (d - f.z) / (f.w - f.z)));
    k *= 1 - t * t * (3 - 2 * t);
  }
  return k;
}

/** Множитель расширения нити (чистая часть): полуширина h, дальность d, м на пиксель на метр k·0.6 → ≥ 1. */
export function frWidenS(h: number, d: number, px: number): number {
  return Math.max(1, (d * px) / Math.max(h, 1e-4));
}

export class FrFadePlugin extends MaterialPluginBase {
  /** x — до стольких м без угасания; y — длина спада, м; [z, w] — плавно в ноль (w ≤ z — без обрезки). Постоянна после
   *  сборки (живёт в буфере материала). */
  readonly fade = new Vector4(30, 110, 0, 0);
  /** x — наименьшая полуширина полосы на метр дальности (только с widen) — на каждую привязку */
  readonly widen = new Vector4(0, 0, 0, 0);
  private readonly widenOn: boolean;

  constructor(material: Material, opts: { widen?: boolean } = {}) {
    super(material, 'FrFade', 210, { FR_FADE: false, FR_WIDEN: false }, true, true);
    this.widenOn = !!opts.widen;
    material.fogEnabled = false;
    if (this.widenOn) material.onBindObservable.add(() => material.getEffect()?.setVector4('frPx', this.widen));
  }

  override getClassName(): string {
    return 'FrFadePlugin';
  }

  override prepareDefines(defines: Record<string, unknown>): void {
    defines.FR_FADE = true;
    defines.FR_WIDEN = this.widenOn;
  }

  override getAttributes(attributes: string[]): void {
    if (this.widenOn) attributes.push(FR_OFF);
  }

  override getUniforms() {
    return {
      // frFade — в буфере материала; frPx — вне буфера (объявлен в коде вершин, ставится на каждую привязку)
      ubo: [{ name: 'frFade', size: 4, type: 'vec4' }],
      fragment: '#ifdef FR_FADE\nuniform vec4 frFade;\n#endif',
      externalUniforms: ['frPx'],
    };
  }

  override bindForSubMesh(ubo: UniformBuffer): void {
    ubo.updateVector4('frFade', this.fade);
  }

  // Точки вставки менеджер плагинов собирает ОДИН раз — ещё в конструкторе базы (до this.widenOn): набор ключей не
  // зависит от настроек, код расширения — под #ifdef FR_WIDEN.
  override getCustomCode(shaderType: string): { [pointName: string]: string } | null {
    if (shaderType === 'vertex') {
      return {
        CUSTOM_VERTEX_DEFINITIONS: `#ifdef FR_WIDEN\nattribute vec3 ${FR_OFF};\nuniform vec4 frPx;\nvarying float vFrDim;\n#endif`,
        CUSTOM_VERTEX_UPDATE_WORLDPOS: `
#ifdef FR_WIDEN
{
  vec3 frW = (finalWorld * vec4(${FR_OFF}, 0.0)).xyz;
  vec3 frC = worldPos.xyz - frW;
  float frH = max(length(frW) * 0.7071, 1e-4);
  float frS = max(1.0, length(frC - vEyePosition.xyz) * frPx.x / frH);
  worldPos.xyz = frC + frW * frS;
  vFrDim = 1.0 / frS;
}
#endif
`,
      };
    }
    if (shaderType === 'fragment') {
      return {
        CUSTOM_FRAGMENT_DEFINITIONS: '#ifdef FR_WIDEN\nvarying float vFrDim;\n#endif',
        CUSTOM_FRAGMENT_BEFORE_FOG: `
#ifdef FR_FADE
{
  float frD = length(vPositionW - vEyePosition.xyz);
  float frK = exp(-max(frD - frFade.x, 0.0) / frFade.y);
  if (frFade.w > frFade.z) frK *= 1.0 - smoothstep(frFade.z, frFade.w, frD);
#ifdef FR_WIDEN
  frK *= vFrDim;
#endif
  color.rgb *= frK;
}
#endif
`,
      };
    }
    return null;
  }
}
