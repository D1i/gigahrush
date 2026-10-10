// Бестиарий ↔ проект: правки ручек (Project.bestiary) действуют сразу — на загрузке и после каждого изменения проекта
// в сторе (правка, undo/redo, импорт, сброс к пресетам), в редакторе и в игре без отладки (тот же стор). Кооп: проект
// лобби подменяет набор у всех игроков (src/coop/session.ts → setLobbyBestiary). Импортируется один раз из App.
import { getProject, subscribe } from '../model/store';
import { setLocalBestiary } from '../game/bestiary';
import '../data/bestiaryEntries';

const sync = () => setLocalBestiary(getProject().bestiary);
subscribe(sync);
sync();
