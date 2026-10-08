// Превью спец-локации «Ангар» без мира: ?fall=1 — с падения (кадр в момент ?t=…), иначе — стоя; ?x=&z=&yaw=&pitch= — вид.
import { Engine } from '@babylonjs/core/Engines/engine';
import { HangarScene } from '../src/locations/sceneHangar';
import { DEFAULT_HANGAR } from '../src/locations/hangar';

const q = new URLSearchParams(location.search);
const canvas = document.getElementById('c') as HTMLCanvasElement;
const engine = new Engine(canvas, true, { preserveDrawingBuffer: true, stencil: true });
const s = await HangarScene.create(engine, canvas, { spec: DEFAULT_HANGAR, seedKey: 'превью', fall: q.get('fall') === '1' });
s.manual = true;
if (q.get('fall') === '1') s.advance(Number(q.get('t') ?? 0.5));
else s.place(Number(q.get('x') ?? -1.6), Number(q.get('z') ?? -1.5), Number(q.get('yaw') ?? 0), Number(q.get('pitch') ?? 0));
s.advance(Number(q.get('adv') ?? 0.05));
engine.runRenderLoop(() => s.render());
(window as unknown as { __hangar: unknown }).__hangar = s.qaState();
