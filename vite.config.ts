import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { configDefaults } from 'vitest/config';
import { attachCoopRelay, createCoopHub } from './tools/coop-server.mjs';

// Сборка в одну самодостаточную HTML-страницу (ТЗ §3).
// Замеры скорости (*.perf.test.ts) не идут в обычный прогон: параллельно с тяжёлыми тестами они
// шумят — для них `npm run test:perf` (vitest.perf.config.ts, по одному файлу).
// Кооп «Прогулки» (docs/COOP.md): relay лобби — на том же dev-сервере, путь /coop (npm run dev --host — и по сети).
// Хаб — один на процесс: перезапуск dev-сервера (правка конфига) лобби не теряет.
const g = globalThis as { __rfCoopHub?: ReturnType<typeof createCoopHub> };
const coopHub = (g.__rfCoopHub ??= createCoopHub({ log: (s) => console.log('[coop]', s) }));
const coopRelay = {
  name: 'coop-relay',
  configureServer(server: { httpServer: unknown }) {
    if (server.httpServer) attachCoopRelay(server.httpServer as never, { hub: coopHub });
  },
  configurePreviewServer(server: { httpServer: unknown }) {
    if (server.httpServer) attachCoopRelay(server.httpServer as never, { hub: coopHub });
  },
};
export default defineConfig({
  plugins: [react(), viteSingleFile(), coopRelay],
  test: { environment: 'node', exclude: [...configDefaults.exclude, '**/*.perf.test.ts', '**/perf.test.ts', 'tmp/**'] },
} as any);
