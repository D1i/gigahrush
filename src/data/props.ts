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
  // ── Подвал (набор пользователя basement-3d): в 3D — модели из src/view3d/assets/basement_props.glb, габариты — по ним ──
  { id: 'p_bsm_shelf_wood', name: 'Стеллаж деревянный', w: 1.16, h: 0.52, color: '#6f5a44', tags: ['стеллаж', 'подвал', 'хранение'], kind: 'shelf' },
  { id: 'p_bsm_shelf_jars', name: 'Стеллаж с банками заготовок', w: 1.16, h: 0.52, color: '#5f6b4a', tags: ['стеллаж', 'банки', 'консервы', 'подвал', 'хранение'], kind: 'shelf' },
  { id: 'p_bsm_shelf_metal', name: 'Стеллаж металлический ржавый', w: 1.16, h: 0.52, color: '#3e4a44', tags: ['стеллаж', 'металл', 'подвал', 'хранение'], kind: 'shelf' },
  { id: 'p_bsm_cabinet', name: 'Шкаф с открытой створкой', w: 0.9, h: 0.48, color: '#2f4a44', tags: ['шкаф', 'подвал', 'хранение'], kind: 'tool_cabinet' },
  { id: 'p_bsm_locker', name: 'Шкафчик металлический двустворчатый', w: 0.78, h: 0.54, color: '#3d4a46', tags: ['шкаф', 'металл', 'подвал', 'шкаф-инструменты'], kind: 'locker' },
  { id: 'p_bsm_workbench', name: 'Верстак с ящиком', w: 1.5, h: 0.72, color: '#6f5a44', tags: ['верстак', 'инструменты', 'подвал'], kind: 'workbench' },
  { id: 'p_bsm_crate', name: 'Ящик деревянный', w: 0.6, h: 0.45, color: '#6f5a44', tags: ['ящик', 'подвал', 'хранение'], kind: 'boxes' },
  { id: 'p_bsm_box', name: 'Коробка картонная', w: 0.48, h: 0.37, color: '#8a6a40', tags: ['коробка', 'хлам'], kind: 'boxes' },
  { id: 'p_bsm_chair', name: 'Стул деревянный', w: 0.46, h: 0.44, color: '#6f5a44', tags: ['стул', 'сиденье'], kind: 'chair' },
  { id: 'p_bsm_seats', name: 'Ряд кресел из кинотеатра (3)', w: 1.7, h: 0.49, color: '#5a1a14', tags: ['сиденье', 'кинотеатр', 'подвал'], kind: 'bench' },
  { id: 'p_bsm_radiator', name: 'Радиатор чугунный, 8 секций', w: 0.7, h: 0.13, color: '#9a9078', tags: ['радиатор', 'отопление'], kind: 'radiator' },
  { id: 'p_bsm_pipe', name: 'Труба у пола, 2 м', w: 2.0, h: 0.12, color: '#5a2a14', tags: ['трубы', 'отопление', 'подвал'], kind: 'pipe' },
  { id: 'p_bsm_pipe_high', name: 'Труба под потолком, 2 м', w: 2.0, h: 0.12, color: '#5a2a14', tags: ['трубы', 'потолок', 'подвал'], kind: 'pipe' },
  { id: 'p_bsm_valve', name: 'Задвижка на трубе', w: 0.7, h: 0.24, color: '#5a2a14', tags: ['трубы', 'вентиль', 'подвал'], kind: 'pipes' },
  { id: 'p_bsm_bulb', name: 'Лампочка под потолком', w: 0.09, h: 0.09, color: '#f2b45a', tags: ['лампа', 'потолок', 'свет'], kind: 'pipe' },
  { id: 'p_bsm_rubble', name: 'Обломки кирпича и штукатурки', w: 1.13, h: 0.95, color: '#7a4a34', tags: ['мусор', 'обломки'], kind: 'trash' },
  { id: 'p_bsm_litter', name: 'Мусор: пакеты, бумага, банки', w: 1.0, h: 0.8, color: '#5a4a30', tags: ['мусор', 'хлам'], kind: 'trash' },
  { id: 'p_bsm_trash', name: 'Мешок с мусором', w: 0.44, h: 0.4, color: '#1c2a1c', tags: ['мусор', 'мешок'], kind: 'trash' },
  { id: 'p_bsm_puddle', name: 'Лужа', w: 1.87, h: 1.07, color: '#3c3c22', tags: ['лужа', 'сырость'], kind: 'rug' },
  { id: 'p_bsm_water', name: 'Вода на полу 2×2 м', w: 2.0, h: 2.0, color: '#3c3c22', tags: ['лужа', 'затоплено'], kind: 'rug' },
  { id: 'p_bsm_plank', name: 'Доска на полу', w: 1.3, h: 0.17, color: '#6f5a44', tags: ['доска', 'мусор'], kind: 'rug' },
  { id: 'p_bsm_jar', name: 'Банка стеклянная', w: 0.15, h: 0.15, color: '#2c4a30', tags: ['банка', 'консервы'], kind: 'bottle_crate' },
  { id: 'p_bsm_bottle', name: 'Бутылка пластиковая', w: 0.1, h: 0.1, color: '#2c4a30', tags: ['бутылка', 'хлам'], kind: 'bottle_crate' },
  { id: 'p_bsm_slats', name: 'Перегородка из реек, 2 м', w: 2.0, h: 0.09, color: '#6f5a44', tags: ['перегородка', 'подвал'], kind: 'coat_hooks' },
  { id: 'p_bsm_pillar', name: 'Столб кирпичный 0.32 м', w: 0.32, h: 0.32, color: '#a88f80', tags: ['столб', 'подвал'], kind: 'boiler_tank' },
  { id: 'p_bsm_door', name: 'Дверь из досок (снята, у стены)', w: 0.75, h: 0.1, color: '#6f5a44', tags: ['дверь', 'хлам'], kind: 'wardrobe' },
  { id: 'p_bsm_stairs', name: 'Ступени, 5 шт.', w: 1.0, h: 1.35, color: '#8c867c', tags: ['ступени', 'подвал'], kind: 'boxes' },
  // ── Сарай (референсы набора пользователя barn-kit, моделей в нём нет — болванки с габаритами; гирлянда, перегородка
  //    стойла и ясли — модели из примитивов src/view3d/assets/barn_props.glb, tools/make-barn-props.mjs) ──
  { id: 'p_barn_garland', name: 'Гирлянда на стене, 1 м', w: 1.0, h: 0.1, color: '#c8963c', tags: ['гирлянда', 'потолок', 'свет', 'сарай'], kind: 'pipe' },
  { id: 'p_barn_stall_div', name: 'Перегородка стойла: столб с шаром, жердь, доски', w: 2.4, h: 0.12, color: '#4a3524', tags: ['перегородка', 'стойло', 'сарай'], kind: 'coat_hooks' },
  { id: 'p_barn_manger', name: 'Ясли с решёткой для сена', w: 1.2, h: 0.5, color: '#4e3826', tags: ['ясли', 'кормушка', 'сарай'], kind: 'bench' },
  { id: 'p_barn_workbench', name: 'Верстак сарая с ящиками', w: 1.5, h: 0.7, color: '#5e4a36', tags: ['верстак', 'инструменты', 'сарай'], kind: 'workbench' },
  { id: 'p_barn_chest', name: 'Сундук деревянный, окованный', w: 0.9, h: 0.5, color: '#4e3a2a', tags: ['сундук', 'хранение', 'сарай'], kind: 'dresser' },
  { id: 'p_barn_tools', name: 'Инструменты на стене: лопата, вилы, грабли, серп', w: 1.3, h: 0.15, color: '#6a5440', tags: ['инструменты', 'вешалка', 'сарай'], kind: 'coat_hooks' },
  { id: 'p_barn_ladder', name: 'Приставная лестница у стены', w: 0.5, h: 0.12, color: '#6a5440', tags: ['лестница', 'перегородка', 'сарай'], kind: 'coat_hooks' },
  { id: 'p_barn_coat', name: 'Ватник на гвозде', w: 0.5, h: 0.15, color: '#3c3f38', tags: ['вешалка', 'одежда', 'сарай'], kind: 'coat_hooks' },
  // люк в погреб (сюжет, «Люк в погреб» — src/data/roomsSpecial.ts): крышка вровень с полом, высота болванки — как у доски
  { id: 'p_cellar_hatch', name: 'Люк в погреб (крышка в полу)', w: 1.0, h: 1.0, color: '#5a4330', tags: ['люк', 'доска', 'пол', 'сарай'], kind: 'hatch' },
  // ── Завод (набор пользователя factory-to-swamp: tools/optimize-factory.mjs → src/view3d/assets/factory_props.glb,
  //    габариты — по моделям; подвижные части крутятся — src/view3d/propAnim.ts) ──
  { id: 'p_fac_gear_large', name: 'Шестерня 24 зуба на стойке', w: 1.81, h: 0.32, color: '#7a3e1e', tags: ['шестерня', 'станок', 'завод'], kind: 'boiler_tank' },
  { id: 'p_fac_gear_small', name: 'Шестерня 12 зубьев на стойке', w: 0.9, h: 0.32, color: '#7a3e1e', tags: ['шестерня', 'станок', 'завод'], kind: 'boiler_tank' },
  { id: 'p_fac_gear_pair', name: 'Пара шестерён 24/12 на станине', w: 2.81, h: 0.9, color: '#3a3c3e', tags: ['шестерня', 'станок', 'завод'], kind: 'workbench' },
  { id: 'p_fac_flywheel', name: 'Маховик на стойке', w: 1.49, h: 0.25, color: '#3a3c3e', tags: ['маховик', 'станок', 'завод'], kind: 'boiler_tank' },
  { id: 'p_fac_shaft', name: 'Вал на подшипниках, 2 м', w: 2.0, h: 0.38, color: '#3a3c3e', tags: ['вал', 'станок', 'завод'], kind: 'pipe' },
  { id: 'p_fac_fan', name: 'Вентилятор на стойке', w: 1.28, h: 0.39, color: '#5a5e60', tags: ['вентилятор', 'завод'], kind: 'boiler_tank' },
  { id: 'p_fac_conveyor', name: 'Роликовый конвейер, 3 м', w: 3.2, h: 1.41, color: '#3a3c3e', tags: ['конвейер', 'станок', 'завод'], kind: 'workbench' },
  { id: 'p_fac_press', name: 'Гидравлический пресс', w: 1.76, h: 1.13, color: '#b08a1e', tags: ['пресс', 'станок', 'завод'], kind: 'workbench' },
  { id: 'p_fac_pump', name: 'Насос с поршнем', w: 2.1, h: 0.9, color: '#2f6a66', tags: ['насос', 'станок', 'завод'], kind: 'workbench' },
  { id: 'p_fac_platform', name: 'Поворотный круг в полу', w: 2.5, h: 2.5, color: '#3a3c3e', tags: ['поворотный круг', 'доска', 'завод'], kind: 'rug' },
  { id: 'p_fac_gate', name: 'Шлагбаум цеха', w: 1.64, h: 0.1, color: '#b08a1e', tags: ['шлагбаум', 'завод'], kind: 'coat_hooks' },
  { id: 'p_fac_furnace', name: 'Плавильная печь', w: 1.57, h: 1.28, color: '#2c2e30', tags: ['печь', 'расплав', 'станок', 'завод'], kind: 'boiler_tank' },
  { id: 'p_fac_ladle', name: 'Наклонный ковш с расплавом', w: 1.85, h: 1.25, color: '#b08a1e', tags: ['ковш', 'расплав', 'станок', 'завод'], kind: 'boiler_tank' },
  { id: 'p_fac_mold', name: 'Форма с расплавом', w: 1.6, h: 0.85, color: '#c8501e', tags: ['форма', 'расплав', 'завод'], kind: 'boxes' },
  { id: 'p_fac_hoist', name: 'Козловая таль', w: 1.89, h: 0.81, color: '#b08a1e', tags: ['таль', 'станок', 'завод'], kind: 'workbench' },
  { id: 'p_fac_pipe', name: 'Труба под потолком, 3 м', w: 3.0, h: 0.38, color: '#5a2a14', tags: ['трубы', 'потолок', 'завод'], kind: 'pipe' },
  { id: 'p_fac_valve', name: 'Труба с вентилем', w: 1.0, h: 0.42, color: '#5a2a14', tags: ['трубы', 'вентиль', 'завод'], kind: 'pipes' },
  { id: 'p_fac_leak', name: 'Течь с потолка: труба и капли', w: 1.2, h: 0.2, color: '#4a6a7a', tags: ['течь', 'потолок', 'трубы', 'завод'], kind: 'pipe' },
  { id: 'p_fac_barrel', name: 'Ржавая бочка', w: 0.58, h: 0.58, color: '#6a3a1e', tags: ['бочка', 'завод'], kind: 'boiler_tank' },
  { id: 'p_fac_scrap', name: 'Металлолом', w: 1.51, h: 1.39, color: '#6a3a1e', tags: ['мусор', 'металлолом', 'завод'], kind: 'trash' },
  { id: 'p_fac_railing', name: 'Перила, 2 м', w: 2.0, h: 0.06, color: '#b08a1e', tags: ['перила', 'завод'], kind: 'coat_hooks' },
  { id: 'p_fac_walkway', name: 'Решётчатый настил, 2 м', w: 1.24, h: 2.0, color: '#5a5e60', tags: ['настил', 'доска', 'завод'], kind: 'rug' },
  { id: 'p_fac_stairs', name: 'Железная лестница', w: 1.2, h: 1.69, color: '#3a3c3e', tags: ['ступени', 'завод'], kind: 'boxes' },
  { id: 'p_fac_water', name: 'Болотная вода 4×4 м', w: 4.0, h: 4.0, color: '#3c4a2a', tags: ['лужа', 'затоплено', 'болото'], kind: 'rug' },
  { id: 'p_fac_mud', name: 'Грязевой островок с мхом', w: 2.09, h: 1.5, color: '#4a4026', tags: ['лужа', 'грязь', 'болото'], kind: 'rug' },
  { id: 'p_fac_reeds', name: 'Камыш', w: 0.98, h: 0.81, color: '#6a7a3a', tags: ['камыш', 'растение', 'болото'], kind: 'plant' },
  { id: 'p_fac_tree', name: 'Сухое дерево', w: 1.52, h: 0.28, color: '#4a3a2a', tags: ['дерево', 'болото'], kind: 'plant' },
  { id: 'p_fac_boardwalk', name: 'Деревянный настил по воде, 2 м', w: 1.16, h: 2.0, color: '#5e4a36', tags: ['настил', 'доска', 'болото'], kind: 'rug' },
  // перевёрнутое болото: свисает с потолка мокрых цехов (финал — вверх, в болото над головой)
  { id: 'p_fac_reeds_hang', name: 'Камыш вниз головой, свисает с потолка', w: 0.73, h: 0.61, color: '#6a7a3a', tags: ['камыш', 'потолок', 'болото'], kind: 'plant' },
  { id: 'p_fac_mud_hang', name: 'Ком грязи на потолке', w: 1.67, h: 1.2, color: '#4a4026', tags: ['грязь', 'потолок', 'болото'], kind: 'rug' },
  { id: 'p_fac_column', name: 'Колонна-двутавр у стены', w: 0.2, h: 0.2, color: '#2c2e30', tags: ['колонна', 'завод'], kind: 'boiler_tank' },
  { id: 'p_fac_lamp', name: 'Лампа-«тарелка» под потолком', w: 0.6, h: 0.6, color: '#f2b45a', tags: ['лампа', 'потолок', 'свет', 'завод'], kind: 'pipe' },
  // ── Общага (src/data/roomsObshaga.ts; модели — src/view3d/assets/obshaga_props.glb, tools/make-obshaga-props.mjs:
  //    имя узла = id). Настенное (окно, часы, доски, огнетушитель, лейка душа, трубы) — тег «настенное»: болванка-коллайдер
  //    в 1 см (src/blockout/core.ts, PROP_HEIGHTS), модель висит на своей высоте. Свет — тег «потолок» и «свет»:
  //    плафон и лампа ЛДС (их гасит отключение света — src/locations/obshaga.ts) ──
  { id: 'p_obsh_bed', name: 'Кровать железная с панцирной сеткой', w: 1.9, h: 0.8, color: '#7d8a8c', tags: ['кровать', 'спальное', 'мебель', 'общага'], kind: 'bed_single' },
  { id: 'p_obsh_nightstand', name: 'Тумбочка казённая', w: 0.4, h: 0.4, color: '#a07a4c', tags: ['тумбочка', 'мебель', 'общага'], kind: 'nightstand' },
  { id: 'p_obsh_table', name: 'Стол казённый', w: 1.2, h: 0.7, color: '#a8875a', tags: ['стол', 'мебель', 'общага'], kind: 'table_rect' },
  { id: 'p_obsh_stool', name: 'Табурет', w: 0.35, h: 0.35, color: '#b58f5c', tags: ['табурет', 'сиденье', 'общага'], kind: 'stool' },
  { id: 'p_obsh_wardrobe', name: 'Шкаф платяной казённый', w: 0.8, h: 0.5, color: '#8a6440', tags: ['шкаф', 'одежда', 'хранение', 'общага'], kind: 'wardrobe' },
  { id: 'p_obsh_radiator', name: 'Батарея чугунная под окном', w: 0.8, h: 0.12, color: '#cfcac0', tags: ['батарея', 'отопление', 'общага'], kind: 'radiator' },
  { id: 'p_obsh_window', name: 'Окно с облупленной рамой', w: 1.4, h: 0.1, color: '#9fb4c2', tags: ['окно', 'настенное', 'общага'], kind: 'pipe' },
  { id: 'p_obsh_stove', name: 'Плита электрическая общей кухни', w: 0.5, h: 0.6, color: '#d8d6cf', tags: ['плита', 'кухня', 'общага'], kind: 'stove' },
  { id: 'p_obsh_sink', name: 'Раковина-умывальник на кронштейнах', w: 0.55, h: 0.45, color: '#e3e8ea', tags: ['раковина', 'умывальник', 'вода', 'общага'], kind: 'washbasin' },
  { id: 'p_obsh_fridge', name: 'Холодильник общей кухни', w: 0.6, h: 0.6, color: '#e8e6df', tags: ['холодильник', 'кухня', 'еда', 'общага'], kind: 'fridge' },
  { id: 'p_obsh_washer', name: 'Стиральная машина «Сибирь»', w: 0.5, h: 0.5, color: '#e6eaec', tags: ['стиральная', 'техника', 'прачечная', 'общага'], kind: 'washing_machine' },
  { id: 'p_obsh_tub', name: 'Корыто-мойка на подставке', w: 0.6, h: 0.4, color: '#a9b1b4', tags: ['мойка', 'корыто', 'вода', 'прачечная', 'общага'], kind: 'sink_kitchen' },
  { id: 'p_obsh_toilet', name: 'Чаша «Генуя» с высоким бачком', w: 0.5, h: 0.6, color: '#f0f0ea', tags: ['унитаз', 'туалет', 'общага'], kind: 'toilet' },
  { id: 'p_obsh_partition', name: 'Перегородка кабинки, кафель, 1.8 м', w: 0.05, h: 1.5, color: '#9fb39a', tags: ['перегородка', 'кафель', 'общага'], kind: 'coat_hooks' },
  { id: 'p_obsh_shower', name: 'Душ: лейка на стене и поддон с трапом', w: 0.9, h: 0.9, color: '#cfe0e6', tags: ['душ', 'настенное', 'вода', 'общага'], kind: 'shower' },
  { id: 'p_obsh_bench', name: 'Скамья', w: 1.0, h: 0.3, color: '#8d6a43', tags: ['скамья', 'сиденье', 'общага'], kind: 'bench' },
  { id: 'p_obsh_vahter_desk', name: 'Стол вахтёра: телефон, лампа, журнал', w: 1.2, h: 0.6, color: '#7a5a3a', tags: ['стол', 'вахта', 'общага'], kind: 'office_desk' },
  { id: 'p_obsh_keyboard', name: 'Щит с ключами от комнат', w: 0.6, h: 0.08, color: '#6e4d31', tags: ['ключи', 'настенное', 'вахта', 'общага'], kind: 'coat_hooks' },
  { id: 'p_obsh_noticeboard', name: 'Доска объявлений', w: 1.0, h: 0.05, color: '#b8a070', tags: ['объявления', 'настенное', 'общага'], kind: 'coat_hooks' },
  { id: 'p_obsh_sofa', name: 'Диван дерматиновый', w: 1.8, h: 0.8, color: '#5a3a2a', tags: ['диван', 'мебель', 'общага'], kind: 'sofa' },
  { id: 'p_obsh_chair', name: 'Стул казённый', w: 0.45, h: 0.45, color: '#a3794a', tags: ['стул', 'сиденье', 'общага'], kind: 'chair' },
  { id: 'p_obsh_tv', name: 'Телевизор «Рекорд» на тумбе', w: 0.5, h: 0.45, color: '#4a3a2c', tags: ['телевизор', 'тумба', 'техника', 'общага'], kind: 'tv_stand' },
  { id: 'p_obsh_clock', name: 'Часы настенные', w: 0.35, h: 0.06, color: '#e8e2d0', tags: ['часы', 'настенное', 'общага'], kind: 'coat_hooks' },
  { id: 'p_obsh_fire_ext', name: 'Огнетушитель на стене', w: 0.2, h: 0.15, color: '#b8322a', tags: ['огнетушитель', 'настенное', 'общага'], kind: 'pipe' },
  { id: 'p_obsh_bucket', name: 'Ведро оцинкованное', w: 0.3, h: 0.3, color: '#9aa3a6', tags: ['ведро', 'общага'], kind: 'trash' },
  { id: 'p_obsh_pipes', name: 'Трубопровод по стене подвала, 2 м', w: 2.0, h: 0.25, color: '#5a3a24', tags: ['трубопровод', 'настенное', 'подвал', 'общага'], kind: 'pipes' },
  { id: 'p_obsh_plafond', name: 'Плафон под потолком', w: 0.3, h: 0.3, color: '#f2e6c0', tags: ['лампа', 'потолок', 'свет', 'общага'], kind: 'pipe' },
  { id: 'p_obsh_tube', name: 'Светильник ЛДС под потолком', w: 1.2, h: 0.15, color: '#e8f0f0', tags: ['лампа', 'потолок', 'свет', 'общага'], kind: 'pipe' },
  { id: 'p_obsh_stair_flight', name: 'Марш лестницы с перилами (декорация)', w: 1.2, h: 3.0, color: '#8c867c', tags: ['марш', 'накладное', 'лестница', 'общага'], kind: 'boxes' },
  { id: 'p_obsh_lantern', name: 'Керосиновая лампа «летучая мышь»', w: 0.25, h: 0.25, color: '#c8963c', tags: ['керосиновая', 'лампа', 'свет', 'находка', 'общага'], kind: 'bottle_crate' },
  // metro
  // ── Метро (src/data/roomsMetro.ts; модели — src/view3d/assets/metro_props.glb, tools/make-metro-props.mjs: имя
  //    узла = id). Пути и кромка платформы — накладное на пол (пути «на уровне пола», проходимы; рельсы вдоль h,
  //    контактный рельс — на −X при rot 0, у путевой стены); панно, часы-интервал, кабели — настенное; кессон, полоса
  //    света, указатель — потолок (верх модели — потолок своей комнаты). Станции поменьше и крошечные — те же пути,
  //    кромка и панно вдвое и вчетверо мельче. Высоты коллайдеров — по тегам (src/blockout/core.ts, PROP_HEIGHTS) ──
  { id: 'p_metro_track', name: 'Пути: щебень, шпалы, рельсы, контактный рельс, 9 м', w: 3.0, h: 9.0, color: '#3e3c39', tags: ['пути', 'рельсы', 'накладное', 'метро'], kind: 'rug' },
  { id: 'p_metro_edge', name: 'Кромка платформы: гранит с жёлтой линией, 9 м', w: 0.4, h: 9.0, color: '#e6e1d6', tags: ['кромка', 'платформа', 'накладное', 'метро'], kind: 'rug' },
  { id: 'p_metro_panel', name: 'Мозаичное панно путевой стены', w: 2.4, h: 0.06, color: '#a0352a', tags: ['панно', 'мозаика', 'настенное', 'метро'], kind: 'coat_hooks' },
  { id: 'p_metro_light', name: 'Кессон потолка с полосами света', w: 3.0, h: 4.5, color: '#f3f1e8', tags: ['лампа', 'кессон', 'потолок', 'свет', 'метро'], kind: 'pipe' },
  { id: 'p_metro_light_strip', name: 'Полоса света под потолком', w: 0.3, h: 4.5, color: '#f3f1e8', tags: ['лампа', 'потолок', 'свет', 'метро'], kind: 'pipe' },
  { id: 'p_metro_bench', name: 'Скамья деревянная с мраморными торцами', w: 2.4, h: 0.9, color: '#87532c', tags: ['скамья', 'сиденье', 'метро'], kind: 'bench' },
  { id: 'p_metro_sign', name: 'Указатель подвесной световой', w: 1.6, h: 0.15, color: '#262729', tags: ['указатель', 'потолок', 'свет', 'метро'], kind: 'pipe' },
  { id: 'p_metro_turnstile', name: 'Турникет АКП-73', w: 0.2, h: 1.3, color: '#d5cfbd', tags: ['турникет', 'вестибюль', 'метро'], kind: 'locker' },
  { id: 'p_metro_kassa', name: 'Касса: два окошка, световая вывеска', w: 2.4, h: 1.2, color: '#e6e1d6', tags: ['касса', 'вестибюль', 'метро'], kind: 'office_desk' },
  { id: 'p_metro_esc_booth', name: 'Будка дежурной у эскалатора с пультом', w: 1.3, h: 1.1, color: '#d5cfbd', tags: ['будка', 'дежурная', 'эскалатор', 'метро'], kind: 'office_desk' },
  { id: 'p_metro_esc_wreck', name: 'Обгоревший эскалатор: каркас, балюстрады, обломки', w: 6.0, h: 3.6, color: '#161412', tags: ['эскалатор', 'обломки', 'гарь', 'метро'], kind: 'trash' },
  { id: 'p_metro_debris', name: 'Обломки и пепел', w: 1.2, h: 1.0, color: '#67625a', tags: ['мусор', 'обломки', 'гарь', 'метро'], kind: 'trash' },
  { id: 'p_metro_clock', name: 'Часы-интервал на кронштейне', w: 0.8, h: 0.2, color: '#262729', tags: ['часы', 'настенное', 'свет', 'метро'], kind: 'coat_hooks' },
  { id: 'p_metro_gears', name: 'Привод эскалатора: двигатель и шестерни', w: 2.0, h: 1.0, color: '#4c6a56', tags: ['шестерни', 'машина', 'метро'], kind: 'workbench' },
  { id: 'p_metro_cable', name: 'Кабели по стене служебного хода, 2 м', w: 2.0, h: 0.1, color: '#262729', tags: ['кабель', 'настенное', 'метро'], kind: 'pipes' },
  { id: 'p_metro_mini_track', name: 'Пути станции поменьше, 9 м', w: 1.5, h: 9.0, color: '#3e3c39', tags: ['пути', 'рельсы', 'накладное', 'метро'], kind: 'rug' },
  { id: 'p_metro_mini_edge', name: 'Кромка платформы станции поменьше, 9 м', w: 0.2, h: 9.0, color: '#e6e1d6', tags: ['кромка', 'платформа', 'накладное', 'метро'], kind: 'rug' },
  { id: 'p_metro_mini_panel', name: 'Мозаичное панно станции поменьше', w: 1.2, h: 0.1, color: '#a0352a', tags: ['панно', 'мозаика', 'настенное', 'метро'], kind: 'coat_hooks' },
  { id: 'p_metro_micro_track', name: 'Пути крошечной станции, 9 м', w: 0.75, h: 9.0, color: '#3e3c39', tags: ['пути', 'рельсы', 'накладное', 'метро'], kind: 'rug' },
  { id: 'p_metro_micro_edge', name: 'Кромка платформы крошечной станции, 9 м', w: 0.1, h: 9.0, color: '#e6e1d6', tags: ['кромка', 'платформа', 'накладное', 'метро'], kind: 'rug' },
  { id: 'p_metro_micro_panel', name: 'Мозаичное панно крошечной станции', w: 0.6, h: 0.1, color: '#a0352a', tags: ['панно', 'мозаика', 'настенное', 'метро'], kind: 'coat_hooks' },
  // cellar
  // ── Погреб (src/data/roomsCellar.ts; модели — src/view3d/assets/cellar_props.glb, tools/optimize-cellar.mjs из набора
  //    пользователя earth-cellar-3d: имя узла = id). Крепь — стойки по стенам хода и перемычка (низ 1.78 м), поперёк
  //    хода: w — проход в свету (стойки уходят в стены), тег «накладное» — коллайдер в 1 см, проход не загораживает.
  //    Куча земли — тег «мусор» (коллайдер 0.25 м); оползень — земляная стенка, наклонённая к стене ──
  { id: 'p_cel_frame', name: 'Крепь хода: стойки и перемычка, в свету 0.6 м', w: 0.6, h: 0.1, color: '#5e4a36', tags: ['крепь', 'накладное', 'погреб'], kind: 'coat_hooks' },
  { id: 'p_cel_frame_narrow', name: 'Крепь щели: стойки и перемычка, в свету 0.4 м', w: 0.4, h: 0.1, color: '#5e4a36', tags: ['крепь', 'накладное', 'погреб'], kind: 'coat_hooks' },
  { id: 'p_cel_shelf', name: 'Стеллаж погреба с банками', w: 0.7, h: 0.34, color: '#4e3e2e', tags: ['стеллаж', 'банки', 'консервы', 'погреб', 'хранение'], kind: 'shelf' },
  { id: 'p_cel_heap', name: 'Куча осыпавшейся земли', w: 0.85, h: 0.77, color: '#2e241b', tags: ['земля', 'мусор', 'погреб'], kind: 'trash' },
  { id: 'p_cel_heap_small', name: 'Горка осыпавшейся земли', w: 0.47, h: 0.42, color: '#2e241b', tags: ['земля', 'мусор', 'погреб'], kind: 'trash' },
  { id: 'p_cel_slump', name: 'Оползень: земляная стенка привалилась к стене', w: 1.08, h: 0.5, color: '#2a2119', tags: ['земля', 'оползень', 'погреб'], kind: 'trash' },
  { id: 'p_cel_sack', name: 'Мешок с картошкой', w: 0.42, h: 0.31, color: '#7a6448', tags: ['мешок', 'погреб', 'хранение'], kind: 'trash' },
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
