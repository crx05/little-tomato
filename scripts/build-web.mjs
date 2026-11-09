import { mkdir, readFile, writeFile, copyFile, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import { ensureWrapper } from './ensure-wrapper.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = resolve(root, 'www');
const { build } = await import('esbuild').catch(() => {
  throw new Error('缺少构建依赖。请在本目录先运行 npm install（首次需要联网）。');
});
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
for (const file of ['styles.css', 'core.js', 'platform.js', 'app.js', 'favicon.svg']) {
  await copyFile(resolve(root, file), resolve(output, file));
}
const html = (await readFile(resolve(root, 'index.html'), 'utf8'))
  .replace('<script src="core.js" defer></script>', '<script src="native.js" defer></script>\n  <script src="core.js" defer></script>');
await writeFile(resolve(output, 'index.html'), html);
await build({ entryPoints: [resolve(root, 'native-entry.js')], outfile: resolve(output, 'native.js'), bundle: true, format: 'iife', target: 'chrome89', minify: true });
console.log('已构建离线网页资源：www/（仅包含应用资源，不包含文档和测试）。');
await ensureWrapper(root);
