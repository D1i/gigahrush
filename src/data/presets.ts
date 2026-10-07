// Стартовый проект: реальные типовые комнаты хрущёвок, мебель, предметы, экономика, отделка.
import type { Project } from '../model/types';
import { buildEconomy } from './economy';
import { buildFinishes, buildFinishRules } from './finishes';
import { buildItems } from './items';
import { buildProps } from './props';
import { buildRooms, START_ROOM_ID } from './rooms';

/** Собрать стартовый проект. Синхронно. Текстуры рисуются на canvas, если есть document. */
export function createDefaultProject(): Project {
  return {
    settings: { cellM: 0.1 },
    props: buildProps(),
    items: buildItems(),
    rooms: buildRooms(),
    generator: {
      seed: 'hrush-001',
      count: 30,
      gap: 1,
      match: 'exact',
      startRoomId: START_ROOM_ID,
      passId: null,
      // предел прямой видимости: зал 5.4 м и короткие коридоры проходят, длинные анфилады — нет
      sightM: 9,
      fill: true,
      mode: 'euclid',
      // складчатый (4D) генератор — см. docs/GENERATOR-4D.md
      fold: { shiftChance: 0.5, maxShift: 3, localRadius: 1, maxLayer: 12, seamless: false },
    },
    economy: buildEconomy(),
    finishes: buildFinishes(),
    finishRules: buildFinishRules(),
  };
}
