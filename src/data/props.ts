// Декор: советская мебель и сантехника с реальными габаритами (м).
// w — ширина вдоль стены (по X при rot=0), h — глубина (по Y при rot=0).
// «Передняя» грань — нижняя (S) при rot=0: шкаф дверцами, диван сиденьем, кровать изножьем.
// Теги используются правилами лута тиров («where»): напр. "сервант", "шкаф-инструменты".
import type { Prop } from '../model/types';
import { makeTexture, type TextureKind } from './textures';

export interface PropDef {
  id: string;
  name: string;
  w: number;
  h: number;
  color: string;
  tags: string[];
  kind: TextureKind;
}

export const PROP_DEFS: PropDef[] = [
  // ── Корпусная мебель ──
  { id: 'p_servant', name: 'Сервант', w: 1.2, h: 0.45, color: '#7a4b2a', tags: ['сервант', 'мебель', 'посуда', 'хранение'], kind: 'sideboard' },
  { id: 'p_stenka', name: 'Стенка мебельная', w: 2.8, h: 0.5, color: '#6b3f22', tags: ['стенка', 'сервант', 'мебель', 'хранение'], kind: 'wall_unit' },
  { id: 'p_wardrobe', name: 'Шкаф платяной двухстворчатый', w: 1.0, h: 0.55, color: '#8a5a33', tags: ['шкаф', 'мебель', 'одежда', 'хранение'], kind: 'wardrobe' },
  { id: 'p_bookshelf', name: 'Шкаф книжный', w: 0.8, h: 0.35, color: '#7d5230', tags: ['книги', 'шкаф', 'мебель'], kind: 'bookshelf' },
  { id: 'p_trumo', name: 'Трюмо', w: 1.0, h: 0.45, color: '#9a6a40', tags: ['трюмо', 'зеркало', 'мебель'], kind: 'dresser' },
  { id: 'p_komod', name: 'Комод', w: 0.9, h: 0.45, color: '#86552f', tags: ['комод', 'мебель', 'одежда', 'хранение'], kind: 'dresser' },
  { id: 'p_nightstand', name: 'Тумбочка прикроватная', w: 0.4, h: 0.4, color: '#8f6038', tags: ['тумбочка', 'мебель'], kind: 'nightstand' },
  // ── Мягкая мебель и спальные места ──
  { id: 'p_sofa', name: 'Диван-книжка', w: 1.9, h: 0.85, color: '#8c3b3b', tags: ['диван', 'мебель', 'спальное'], kind: 'sofa' },
  { id: 'p_armchair', name: 'Кресло', w: 0.75, h: 0.8, color: '#8c4a3b', tags: ['кресло', 'мебель', 'сиденье'], kind: 'armchair' },
  { id: 'p_bed1', name: 'Кровать односпальная', w: 0.9, h: 2.0, color: '#b0a080', tags: ['кровать', 'спальное', 'мебель'], kind: 'bed_single' },
  { id: 'p_bed2', name: 'Кровать двуспальная', w: 1.6, h: 2.0, color: '#b8a57f', tags: ['кровать', 'спальное', 'мебель'], kind: 'bed_double' },
  { id: 'p_cot', name: 'Раскладушка', w: 0.7, h: 1.9, color: '#6f7f5a', tags: ['раскладушка', 'спальное'], kind: 'cot' },
  { id: 'p_mattress', name: 'Матрас на полу', w: 0.9, h: 1.9, color: '#9c9a8a', tags: ['матрас', 'спальное', 'пол'], kind: 'mattress' },
  // ── Столы и сиденья ──
  { id: 'p_table_kitchen', name: 'Стол кухонный', w: 0.9, h: 0.6, color: '#c9b48a', tags: ['стол', 'кухня'], kind: 'table_rect' },
  { id: 'p_table_book', name: 'Стол-книжка (сложен)', w: 0.8, h: 0.35, color: '#a0703f', tags: ['стол', 'мебель'], kind: 'table_rect' },
  { id: 'p_table_round', name: 'Стол круглый обеденный', w: 1.0, h: 1.0, color: '#a57445', tags: ['стол', 'мебель'], kind: 'table_round' },
  { id: 'p_desk', name: 'Стол письменный', w: 1.2, h: 0.6, color: '#94643a', tags: ['стол', 'письменный', 'мебель'], kind: 'desk' },
  { id: 'p_stool', name: 'Табурет', w: 0.35, h: 0.35, color: '#b58f5c', tags: ['табурет', 'сиденье'], kind: 'stool' },
  { id: 'p_chair', name: 'Стул', w: 0.42, h: 0.45, color: '#a3794a', tags: ['стул', 'сиденье'], kind: 'chair' },
  // ── Кухня ──
  { id: 'p_fridge_zil', name: 'Холодильник «ЗИЛ»', w: 0.6, h: 0.6, color: '#e8e6df', tags: ['холодильник', 'кухня', 'еда', 'техника'], kind: 'fridge' },
  { id: 'p_fridge_saratov', name: 'Холодильник «Саратов»', w: 0.5, h: 0.55, color: '#eeeeea', tags: ['холодильник', 'кухня', 'еда', 'техника'], kind: 'fridge' },
  { id: 'p_stove', name: 'Плита газовая 4-конфорочная', w: 0.5, h: 0.6, color: '#d8d6cf', tags: ['плита', 'кухня', 'газ'], kind: 'stove' },
  { id: 'p_sink_kitchen', name: 'Мойка с тумбой', w: 0.6, h: 0.6, color: '#c4ccd0', tags: ['мойка', 'кухня', 'вода'], kind: 'sink_kitchen' },
  { id: 'p_kitchen_counter', name: 'Стол-тумба кухонный', w: 0.6, h: 0.6, color: '#d9cfb8', tags: ['тумба', 'кухня', 'хранение'], kind: 'kitchen_counter' },
  { id: 'p_boiler', name: 'Газовая колонка', w: 0.35, h: 0.25, color: '#e0ddd5', tags: ['колонка', 'кухня', 'газ'], kind: 'boiler' },
  // ── Санузел ──
  { id: 'p_bath', name: 'Ванна чугунная 1.5 м', w: 1.5, h: 0.7, color: '#f2f2ee', tags: ['ванна', 'санузел', 'вода'], kind: 'bathtub' },
  { id: 'p_bath_sit', name: 'Ванна сидячая 1.2 м', w: 1.2, h: 0.7, color: '#f0f0ea', tags: ['ванна', 'санузел', 'вода'], kind: 'bathtub' },
  { id: 'p_toilet', name: 'Унитаз с бачком', w: 0.36, h: 0.65, color: '#f4f4f0', tags: ['унитаз', 'санузел'], kind: 'toilet' },
  { id: 'p_washbasin', name: 'Раковина', w: 0.5, h: 0.4, color: '#eef0f0', tags: ['раковина', 'санузел', 'вода'], kind: 'washbasin' },
  { id: 'p_malyutka', name: 'Стиральная машина «Малютка»', w: 0.4, h: 0.4, color: '#dfe4e8', tags: ['стиралка', 'санузел', 'техника'], kind: 'washing_machine' },
  // ── Техника, интерьер ──
  { id: 'p_rug', name: 'Ковёр', w: 1.5, h: 2.0, color: '#9b2d2d', tags: ['ковёр', 'пол'], kind: 'rug' },
  { id: 'p_rug_big', name: 'Ковёр большой', w: 2.0, h: 3.0, color: '#8a2530', tags: ['ковёр', 'пол'], kind: 'rug' },
  { id: 'p_tv', name: 'Тумба с телевизором «Рубин»', w: 0.8, h: 0.5, color: '#4a3a2c', tags: ['телевизор', 'техника', 'электроника'], kind: 'tv_stand' },
  { id: 'p_radio', name: 'Радиола «Ригонда»', w: 1.0, h: 0.4, color: '#6d4a2b', tags: ['радиола', 'техника', 'электроника'], kind: 'radio' },
  { id: 'p_piano', name: 'Пианино «Красный Октябрь»', w: 1.45, h: 0.6, color: '#2e1f16', tags: ['пианино', 'мебель'], kind: 'piano' },
  { id: 'p_sewing', name: 'Швейная машинка «Подольск» на тумбе', w: 0.9, h: 0.45, color: '#3d3d3d', tags: ['швейная', 'мебель'], kind: 'sewing_machine' },
  { id: 'p_plant', name: 'Фикус в кадке', w: 0.5, h: 0.5, color: '#3f7a3a', tags: ['растение'], kind: 'plant' },
  { id: 'p_radiator', name: 'Батарея чугунная МС-140', w: 0.8, h: 0.15, color: '#cfcac0', tags: ['батарея', 'отопление'], kind: 'radiator' },
  // ── Прихожая ──
  { id: 'p_coat_rack', name: 'Вешалка настенная с полкой', w: 0.9, h: 0.3, color: '#7b5534', tags: ['вешалка', 'прихожая', 'одежда'], kind: 'coat_rack' },
  { id: 'p_shoe_rack', name: 'Обувница', w: 0.6, h: 0.3, color: '#6e4d31', tags: ['обувь', 'прихожая'], kind: 'shoe_rack' },
  // ── Мастерская радиолюбителя ──
  { id: 'p_workbench', name: 'Верстак радиолюбителя', w: 1.4, h: 0.7, color: '#5b6b4a', tags: ['верстак', 'электроника', 'радио'], kind: 'workbench' },
  { id: 'p_shelf', name: 'Стеллаж металлический', w: 1.0, h: 0.4, color: '#7d8488', tags: ['стеллаж', 'хранение'], kind: 'shelf' },
  { id: 'p_tool_cab', name: 'Шкафчик инструментов', w: 0.8, h: 0.4, color: '#4f6f8f', tags: ['шкаф-инструменты', 'инструменты', 'электроника'], kind: 'tool_cabinet' },
  // ── Хлам и быт ──
  { id: 'p_boxes', name: 'Коробки', w: 0.6, h: 0.4, color: '#b08d57', tags: ['коробки', 'хлам', 'хранение'], kind: 'boxes' },
  { id: 'p_bottle_crate', name: 'Ящик с бутылками', w: 0.6, h: 0.4, color: '#6d8f5a', tags: ['бутылки', 'самогон', 'хлам'], kind: 'bottle_crate' },
  { id: 'p_moonshine', name: 'Самогонный аппарат', w: 0.5, h: 0.4, color: '#b87333', tags: ['самогон', 'аппарат'], kind: 'moonshine_still' },
  { id: 'p_trash', name: 'Мусор', w: 0.5, h: 0.5, color: '#6b6457', tags: ['мусор', 'хлам', 'пол'], kind: 'trash' },
  { id: 'p_riser', name: 'Стояк канализационный', w: 0.15, h: 0.15, color: '#8a8f93', tags: ['стояк', 'труба'], kind: 'pipe' },
  { id: 'p_chute', name: 'Ствол мусоропровода', w: 0.5, h: 0.5, color: '#7f8589', tags: ['мусоропровод', 'труба', 'хлам'], kind: 'pipe' },
  // ── Подъезд, лифты, служебные помещения ──
  // Лифт: кабина ПП-0401 (400 кг) вместе со шахтой ~1.2×1.3 м, передняя грань — двери
  { id: 'p_lift', name: 'Лифт пассажирский', w: 1.2, h: 1.3, color: '#6c7a86', tags: ['лифт', 'техника'], kind: 'elevator' },
  { id: 'p_mailboxes', name: 'Почтовые ящики', w: 1.2, h: 0.25, color: '#5b7f5a', tags: ['почта', 'хранение'], kind: 'mailboxes' },
  { id: 'p_bench', name: 'Скамья', w: 1.2, h: 0.4, color: '#8d6a43', tags: ['скамья', 'сиденье'], kind: 'bench' },
  { id: 'p_locker', name: 'Шкафчик металлический', w: 0.6, h: 0.5, color: '#6d7f8f', tags: ['шкафчик', 'хранение'], kind: 'locker' },
  { id: 'p_office_desk', name: 'Стол канцелярский', w: 1.2, h: 0.7, color: '#8a6440', tags: ['стол', 'контора'], kind: 'office_desk' },
  { id: 'p_shower', name: 'Душевая кабинка', w: 0.9, h: 0.9, color: '#cfe0e6', tags: ['душ', 'вода'], kind: 'shower' },
  { id: 'p_sink_row', name: 'Ряд умывальников', w: 2.0, h: 0.45, color: '#e3e8ea', tags: ['раковина', 'вода'], kind: 'sink_row' },
  { id: 'p_drying_rack', name: 'Сушилка для белья', w: 1.5, h: 0.6, color: '#b9c0c4', tags: ['сушилка', 'одежда'], kind: 'drying_rack' },
  { id: 'p_panel', name: 'Щит этажный электрический', w: 0.8, h: 0.3, color: '#7d8a7a', tags: ['щиток', 'электроника', 'шкаф-инструменты'], kind: 'electrical_panel' },
  { id: 'p_vru', name: 'Щит ВРУ', w: 1.2, h: 0.5, color: '#6b786a', tags: ['щиток', 'электроника'], kind: 'electrical_panel' },
  { id: 'p_pipes', name: 'Трубы отопления (пучок)', w: 2.0, h: 0.4, color: '#8b7d6b', tags: ['трубы', 'отопление'], kind: 'pipes' },
  { id: 'p_boiler_tank', name: 'Бак-теплообменник', w: 0.9, h: 0.9, color: '#9a8f7f', tags: ['бак', 'отопление'], kind: 'boiler_tank' },
  { id: 'p_stroller', name: 'Коляска детская', w: 0.6, h: 1.0, color: '#4f6b8a', tags: ['коляска', 'хлам'], kind: 'stroller' },
  { id: 'p_bicycle', name: 'Велосипед «Кама»', w: 1.6, h: 0.5, color: '#9b3a2e', tags: ['велосипед', 'хлам'], kind: 'bicycle' },
  { id: 'p_lenin', name: 'Бюст Ленина на постаменте', w: 0.5, h: 0.5, color: '#c9b37a', tags: ['ленин', 'красный уголок'], kind: 'lenin_bust' },
  { id: 'p_chess', name: 'Шахматный столик', w: 0.6, h: 0.6, color: '#8a5a33', tags: ['шахматы', 'стол'], kind: 'chess_table' },
  { id: 'p_coat_hooks', name: 'Вешалка-крючки', w: 1.2, h: 0.2, color: '#6e4d31', tags: ['вешалка', 'одежда'], kind: 'coat_hooks' },
  { id: 'p_washer', name: 'Стиральная машина «Вятка»', w: 0.6, h: 0.5, color: '#e6eaec', tags: ['стиралка', 'техника'], kind: 'washing_machine' },
];

export const PROP_BY_ID: Record<string, PropDef> = Object.fromEntries(PROP_DEFS.map((p) => [p.id, p]));

/** Собрать список Prop для проекта; текстуры рисуются, если доступен document. */
export function buildProps(): Prop[] {
  return PROP_DEFS.map((d) => ({
    id: d.id,
    name: d.name,
    w: d.w,
    h: d.h,
    color: d.color,
    tex: makeTexture(d.kind, d.w, d.h),
    tags: [...d.tags],
  }));
}
