// Dev-сервер для браузерных QA-скриптов без слежения за файлами: в одном дереве правят несколько сессий, и обычный
// vite перезагружал бы страницу посреди проверки (HMR). Модули собираются с диска при первом запросе.
//   npx vite --config tools/vite.qa.config.ts --port 5237
import { fileURLToPath } from 'node:url';
import { mergeConfig } from 'vite';
import base from '../vite.config';

export default mergeConfig(base, {
  root: fileURLToPath(new URL('..', import.meta.url)),
  server: { hmr: false, watch: { ignored: ['**/*'] } },
});
