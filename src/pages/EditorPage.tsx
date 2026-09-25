import { useUI } from '../model/ui';
import { RoomList } from '../editor/RoomList';
import { LayerToggles } from '../editor/LayerToggles';
import { RoomCanvas } from '../editor/RoomCanvas';
import { Inspector } from '../panels/Inspector';
import { VariantEditor } from '../panels/VariantEditor';

/** ТЗ §5: слева — список комнат и слои, в центре — холст, справа — инспектор. */
export function EditorPage() {
  const ui = useUI();
  return (
    <div className="cols3">
      <aside className="side">
        <RoomList />
        <LayerToggles />
      </aside>
      <section className="stage">
        <RoomCanvas />
      </section>
      <aside className="side right">
        <Inspector />
      </aside>
      {ui.variantsGroupId && <VariantEditor />}
    </div>
  );
}
