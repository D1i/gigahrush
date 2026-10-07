import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { configDefaults } from 'vitest/config';

// Сборка в одну самодостаточную HTML-страницу (ТЗ §3).
// Замеры скорости (*.perf.test.ts) не идут в обычный прогон: параллельно с тяжёлыми тестами они
// шумят — для них `npm run test:perf` (vitest.perf.config.ts, по одному файлу).
export default defineConfig({
  plugins: [react(), viteSingleFile()],
  test: { environment: 'node', exclude: [...configDefaults.exclude, '**/*.perf.test.ts', '**/perf.test.ts', 'tmp/**'] },
} as any);
