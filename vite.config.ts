import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';

// Сборка в одну самодостаточную HTML-страницу (ТЗ §3).
export default defineConfig({
  plugins: [react(), viteSingleFile()],
  test: { environment: 'node' },
} as any);
