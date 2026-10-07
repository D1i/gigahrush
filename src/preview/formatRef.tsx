// Справка по формату JSON (ТЗ §4 + формат прогона). Собрана по model/types.ts.
// Если в docs/ лежат .md (например, GENERATOR.md от агента генератора) — показываются ниже.

type Row = [string, string, string] | string;

const PROJECT: Row[] = [
  'Проект (room-forge-project.json)',
  ['format, version', 'string, int', '"room-forge", версия формата'],
  ['settings.cellM', 'number', 'размер клетки, м (0.1). Все координаты — в клетках, ось Y вниз'],
  ['props[]', 'Prop', 'id, name, w, h (м; w — по X при rot=0), color, tex (PNG data:URI ≤512 px | null), tags[]'],
  ['items[]', 'Item', 'id, name, color, tags[] ("currency" — валюта), note'],
  ['rooms[]', 'Room', 'комната-компонент, см. ниже'],
  ['generator', 'GeneratorSettings', 'seed, count, gap (клеток), match, startRoomId | null, passId | null, sightM, fill, mode, fold'],
  ['economy', 'Economy', 'tiers[], shops[], passes[], dangerLimit'],
  ['finishes[]', 'Finish', 'отделка: id, name, surface wall|floor, color, tex (JPEG/PNG data:URI | null), tileW, tileH (м), dado {finishId, heightM} | null, tags[]'],
  ['finishRules[]', 'FinishRule', 'tag → wall[{finishId, weight}], floor[…]; правило комнаты — по первому её тегу, у которого есть правило'],
  ['generator.sightM', 'number', 'предел прямой видимости, м (0 — без ограничения): по полу и сквозь проёмы связанных дверей, по горизонтали/вертикали/диагоналям 45°'],
  ['generator.mode', "'euclid' | 'fold'", 'генератор: евклидов (по умолчанию) или складчатый 4D — пороги сдвигают слой W (docs/GENERATOR-4D.md)'],
  ['generator.fold', 'FoldSettings', 'shiftChance 0..1 (сдвиг на пороге «авто» даже при наличии места), maxShift (|ΔW| за порог), localRadius (комнаты ближе стольких дверей не пересекаются в 3D; 2 — «комната + соседи»), maxLayer (|W| ≤)'],
  ['generator.fill', 'boolean', 'достраивать тупики: после набора count закрыть открытые метки листовыми комнатами (без новых хабов)'],
  'Комната (rooms[])',
  ['id, name, tags[], note', '', 'тег "start" — кандидат в стартовые'],
  ['unique', 'bool', 'не больше одной копии в прогоне'],
  ['gen', '{weight,min,max}', 'вес выбора и границы числа копий'],
  ['cells', 'string[]', 'сжатые ряды "y:x1-x2,x3"; клетка (x,y) = [x,x+1]×[y,y+1]'],
  ['areaM2', 'number', 'площадь, м² (вычисляется при экспорте)'],
  ['doors[]', 'Segment', 'id, cx, cy, side N|S|E|W, len (клеток) — отрезок на границе'],
  ['connectors[]', 'Segment + name, tag', 'метки стыковки комнат'],
  ['connectors[].shift', "'always' | 'never'", "порог в 4D: всегда сдвигает слой W / никогда; нет поля — 'auto' (по настройкам). Евклидов генератор игнорирует"],
  ['decor[]', 'Decor', 'id, propId, x, y (точка, допускается .5), rot (° по часовой)'],
  ['spots[]', 'Spot', 'id, name, x, y, rot, groupId | null'],
  ['spotGroups[]', 'SpotGroup', 'id, name, color, variants[{id, weight, assign{spotId → {kind prop|item, id, rot}}}]'],
  ['loot[]', 'LootRow', 'id, itemId, chance 0..1, min, max'],
  ['elite[]', 'RoomElite', 'tierId, weight — розыгрыш тира при заходе; пусто — всегда базовая'],
  ['finish', '{wall, floor}', 'явная отделка комнаты (id) | null — по правилам finishRules'],
  'Экономика (economy)',
  ['tiers[]', 'Tier', 'id, name, level 1..N, danger (+опасность за проход), color, note, loot[]'],
  ['tiers[].loot[]', 'TierLootRow', 'source {kind item|shop, id}, steps[{upTo, chance}], where (тег декора)'],
  ['shops[]', 'Shop', 'id, name, currencyItemId, offers[{itemId, price}], note'],
  ['passes[]', 'Pass', 'id, name, priceItemId, price, tierBoost (×веса тиров ≥2), itemBoost{itemId→×}'],
  ['dangerLimit', 'number', 'порог опасности уровня'],
];

const RUN: Row[] = [
  'Прогон (run-<seed>.json)',
  ['seed, settings', '', 'сид и настройки генерации'],
  ['instances[]', 'Instance', 'id "i0…", roomId, rot 0|90|180|270, dx, dy (клеток), order, parent | null, depth'],
  ['', '', 'геометрия экземпляра: поворот вокруг (0,0), затем сдвиг (dx, dy)'],
  ['instances[].w', 'int', 'слой W (складчатый прогон); нет поля — 0. Одна мировая клетка может принадлежать нескольким экземплярам разных слоёв'],
  ['links[]', 'Link', 'a/b: {inst, connector} — состыкованные метки'],
  ['links[].dw', 'int', 'сдвиг слоя порога: w(b) − w(a); из b в a — −dw; нет поля — 0 (обычный порог)'],
  ['openConnectors[]', '{inst, connector}', 'тупики — незадействованные метки'],
  ['content[]', 'InstanceContent', 'inst, tierId | null, danger, dangerAcc (по пути от старта), groups[{groupId, variantId, fallback?}] — fallback: вариант подменён ради прохода игрока'],
  ['content[].spots[]', 'SpawnedSpot', 'spotId, x, y, rot (мировые), groupId, variantId, content {kind, id, rot} | null'],
  ['content[].loot[]', 'SpawnedLoot', 'itemId, count, from room|tier, rowId, decorId?, shopId?'],
  ['content[].finish', '{wall, floor}', 'разыгранная отделка экземпляра (id | null); в экспорте — instances[].finish + таблица finishes[]'],
  ['sight', '{maxM, line}', 'самая длинная линия обзора: длина, м, и отрезок [x1,y1,x2,y2] в мировых клетках | null; в складчатом — линия идёт сквозь проёмы в связанные комнаты любых слоёв W'],
  ['settings.mode, settings.fold', '', "'fold' + нормализованные FoldSettings у складчатого прогона"],
  ['fold', 'FoldStats', 'только складчатый: minW, maxW, layers (занято слоёв), overlaps (пар, пересекающихся в 3D), shifted (порогов с dw ≠ 0)'],
  ['totals', '{itemId: n}', 'суммарно по прогону'],
  ['warnings[], ms', '', 'предупреждения и время генерации'],
];

const docs = import.meta.glob('../../docs/*.md', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

function Table({ rows }: { rows: Row[] }) {
  return (
    <table className="table dp-fmt">
      <tbody>
        {rows.map((r, i) =>
          typeof r === 'string' ? (
            <tr key={i} className="grp">
              <td colSpan={3}>{r}</td>
            </tr>
          ) : (
            <tr key={i}>
              <td>{r[0]}</td>
              <td>{r[1]}</td>
              <td>{r[2]}</td>
            </tr>
          ),
        )}
      </tbody>
    </table>
  );
}

export function FormatRef({ exportKeys }: { exportKeys: string[] | null }) {
  const docList = Object.entries(docs);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <Table rows={PROJECT} />
      <Table rows={RUN} />
      <div className="hint">
        Экспорт готовой раскладки (exportRunJSON) — самодостаточный JSON: всё в мировых координатах, клетки сжаты, ссылки на декор и предметы по id
        вместе с их таблицами.
        {exportKeys && (
          <>
            {' '}
            Ключи верхнего уровня: <span className="mono">{exportKeys.join(', ')}</span>
          </>
        )}
      </div>
      {docList.map(([path, text]) => (
        <div key={path}>
          <div className="cap" style={{ marginBottom: 4 }}>
            {path.replace(/^.*\//, 'docs/')}
          </div>
          <pre className="dp-pre" style={{ whiteSpace: 'pre-wrap', maxHeight: 'none' }}>
            {text}
          </pre>
        </div>
      ))}
    </div>
  );
}
