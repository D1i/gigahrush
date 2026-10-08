// Превью финала «Болото на крыше» без мира: ?t=… — кадр сценария в момент t (с от шага на зуб), иначе — стоя на
// крыше в ?x=&z=&yaw=&pitch= (по умолчанию — у люка, лицом к шестерне); ?adv= — сколько секунд прокрутить.
import { Engine } from '@babylonjs/core/Engines/engine';
import { SwampScene } from '../src/locations/sceneSwampEnd';
import { DEFAULT_SWAMP } from '../src/locations/swampEnd';

const q = new URLSearchParams(location.search);
const canvas = document.getElementById('c') as HTMLCanvasElement;
const engine = new Engine(canvas, true, { preserveDrawingBuffer: true, stencil: true });
const s = await SwampScene.create(engine, canvas, { spec: DEFAULT_SWAMP, seedKey: 'превью', audio: false });
s.manual = true;
s.place(Number(q.get('x') ?? 0), Number(q.get('z') ?? 0.6), Number(q.get('yaw') ?? 0), Number(q.get('pitch') ?? 0));
s.advance(Number(q.get('adv') ?? 0.05));
if (q.has('t')) {
  s.startEnd();
  s.advance(Number(q.get('t')));
}
engine.runRenderLoop(() => s.render());
(window as unknown as { __swamp: unknown }).__swamp = s.qaState();
(window as unknown as { __swampScene: unknown }).__swampScene = s;
