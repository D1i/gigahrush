import { defineConfig } from 'vitest/config';

// Замеры скорости — последовательно, без соседних тяжёлых тестов (npm run test:perf).
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.perf.test.ts', 'src/**/perf.test.ts'],
    fileParallelism: false,
  },
});
