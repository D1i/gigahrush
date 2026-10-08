// Модели мебели и деталей из ассетов пользователя (сейчас — набор подвала basement-3d, tools/optimize-basement.mjs →
// src/view3d/assets/basement_props.glb): узел на предмет, имя узла = id prop проекта (p_bsm_*). Грузится один раз на
// сцену; на каждый предмет — шаблон: меши узла слиты в один (подмеши по материалам), материалы glTF (PBR) заменены
// стандартными — как у болванки (тот же свет, без карты окружения). Болванка мебели (src/blockout/babylon.ts) с шаблоном
// ставит его клон на место предмета, а свой бокс оставляет невидимым коллайдером.
import { LoadAssetContainerAsync } from '@babylonjs/core/Loading/sceneLoader';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { MultiMaterial } from '@babylonjs/core/Materials/multiMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import type { Scene } from '@babylonjs/core/scene';
import type { Material } from '@babylonjs/core/Materials/material';
import type { BaseTexture } from '@babylonjs/core/Materials/Textures/baseTexture';
import '@babylonjs/loaders/glTF/2.0/glTFLoader';
import '@babylonjs/loaders/glTF/2.0/Extensions/EXT_texture_webp';
import '@babylonjs/loaders/glTF/2.0/Extensions/KHR_mesh_quantization';
import '@babylonjs/loaders/glTF/2.0/Extensions/ExtrasAsMetadata';
import basementUrl from './assets/basement_props.glb?url';

/** Поля PBR-материала glTF, которые переносятся (без импорта класса — он тянет весь PBR). */
interface PbrLike extends Material {
  albedoTexture?: BaseTexture | null;
  albedoColor?: Color3;
  emissiveColor?: Color3;
}

export class PropModels {
  private readonly map = new Map<string, Mesh>();
  private readonly mats = new Map<string, StandardMaterial>();
  ready = false;
  error: string | null = null;
  readonly loaded: Promise<void>;
  private disposed = false;

  constructor(readonly scene: Scene, urls: string[] = [basementUrl]) {
    this.loaded = (async () => {
      for (const u of urls) {
        try {
          await this.load(u);
        } catch (e) {
          console.error(e);
          this.error = String((e as Error)?.message ?? e);
        }
      }
      this.ready = true;
    })();
  }

  /** Шаблон модели prop (выключен, не рисуется сам) или null. */
  get(propId: string): Mesh | null {
    return this.map.get(propId) ?? null;
  }

  get size(): number {
    return this.map.size;
  }

  private material(m: Material | null): StandardMaterial | null {
    if (!m) return null;
    let s = this.mats.get(m.name);
    if (s) return s;
    const p = m as PbrLike;
    s = new StandardMaterial(`propModel:${m.name}`, this.scene);
    if (p.albedoTexture) {
      s.diffuseTexture = p.albedoTexture;
      this.scene.addTexture(p.albedoTexture);
    }
    s.diffuseColor = p.albedoTexture ? new Color3(1, 1, 1) : (p.albedoColor ?? new Color3(0.6, 0.6, 0.6)).clone();
    s.specularColor = new Color3(0.05, 0.05, 0.05);
    const em = p.emissiveColor;
    if (em && em.r + em.g + em.b > 0.01) {
      // светящееся (лампочка): свет сцены не нужен
      s.emissiveColor = em.clone();
      s.disableLighting = true;
    }
    s.backFaceCulling = m.backFaceCulling;
    this.mats.set(m.name, s);
    return s;
  }

  private async load(url: string) {
    const c = await LoadAssetContainerAsync(url, this.scene, { pluginExtension: '.glb' });
    if (this.disposed) {
      c.dispose();
      return;
    }
    const root = c.rootNodes[0];
    for (const node of root?.getChildren() ?? []) {
      const id = node.name;
      const parts = [node, ...node.getDescendants(false)].filter((x): x is Mesh => x instanceof Mesh && x.getTotalVertices() > 0);
      if (!parts.length) continue;
      for (const m of parts) {
        m.computeWorldMatrix(true);
        // слить можно только меши с одним набором атрибутов: недостающие UV и нормали — нулями / вверх
        const n = m.getTotalVertices();
        if (!m.isVerticesDataPresent(VertexBuffer.UVKind)) m.setVerticesData(VertexBuffer.UVKind, new Float32Array(n * 2), false);
        if (!m.isVerticesDataPresent(VertexBuffer.NormalKind)) {
          const nr = new Float32Array(n * 3);
          for (let i = 1; i < nr.length; i += 3) nr[i] = 1;
          m.setVerticesData(VertexBuffer.NormalKind, nr, false);
        }
        for (const k of [VertexBuffer.ColorKind, VertexBuffer.UV2Kind, VertexBuffer.TangentKind]) if (m.isVerticesDataPresent(k)) m.removeVerticesData(k);
      }
      // слить в мировых координатах (с разворотом glTF → левая система Babylon), подмеш на материал
      let merged: Mesh | null = null;
      try {
        merged = Mesh.MergeMeshes(parts, false, true, undefined, false, true);
      } catch (e) {
        console.warn(`Модель ${id}: не слилась (${(e as Error)?.message ?? e}) — будет бокс`);
      }
      if (!merged) continue;
      merged.name = `propModel:${id}`;
      const mm = merged.material;
      if (mm instanceof MultiMaterial) {
        mm.subMaterials = mm.subMaterials.map((x) => this.material(x));
      } else merged.material = this.material(mm);
      merged.isPickable = false;
      merged.setEnabled(false);
      this.map.set(id, merged);
    }
    // текстуры остаются (на них ссылаются стандартные материалы), остальное контейнера — освободить
    c.textures.length = 0;
    c.dispose();
  }

  dispose() {
    this.disposed = true;
    for (const m of this.map.values()) m.dispose(false, false);
    for (const s of this.mats.values()) s.dispose(true, false);
    this.map.clear();
    this.mats.clear();
  }
}
