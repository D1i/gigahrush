// Пауза игры (BlockoutViewer.setPaused, ./viewer.ts): звук. Модули звука (лестница, лифт, ангар, болото, общага, снег,
// метро, катакомбы, люк…) создают каждый свой AudioContext — здесь реестр живых контекстов: конструктор
// window.AudioContext один раз подменяется наследником, который записывает себя в реестр (ставит просмотрщик — до первого
// звука). На паузе играющие контексты — suspend (их время стоит: запланированные звуки ждут), после паузы — resume тех
// же. Модуль сам запустил свой контекст на паузе (resume по жесту, новый контекст) — снова suspend.

/** контексты страницы (закрытые выпадают) */
const live = new Set<AudioContext>();
/** остановлены паузой — их и запустить после неё */
const held = new Set<AudioContext>();
let paused = false;
let installed = false;

function hold(c: AudioContext) {
  held.add(c);
  void c.suspend().catch(() => {});
}

/** Подменить конструктор AudioContext регистрирующим наследником (один раз; без WebAudio — ничего). */
export function trackAudioContexts() {
  if (installed || typeof window === 'undefined') return;
  const w = window as unknown as { AudioContext?: typeof AudioContext };
  const Base = w.AudioContext;
  if (!Base) return;
  installed = true;
  class TrackedAudioContext extends Base {
    constructor(opts?: AudioContextOptions) {
      super(opts);
      live.add(this);
      this.addEventListener('statechange', () => {
        if (this.state === 'closed') {
          live.delete(this);
          held.delete(this);
        } else if (this.state === 'running' && paused) hold(this);
      });
      // создан на паузе уже играющим (жест) — тоже на паузу
      if (paused) queueMicrotask(() => paused && this.state === 'running' && hold(this));
    }
  }
  w.AudioContext = TrackedAudioContext;
}

/** Пауза звука: on — играющие контексты suspend; off — resume остановленных паузой. */
export function setAudioPaused(on: boolean) {
  if (on === paused) return;
  paused = on;
  if (on) {
    for (const c of live) if (c.state === 'running') hold(c);
    return;
  }
  for (const c of held) if (c.state === 'suspended') void c.resume().catch(() => {});
  held.clear();
}

/** Снять паузу, не запуская звук (просмотрщик закрывается: контексты закроют их модули). */
export function dropAudioPause() {
  paused = false;
  held.clear();
}
