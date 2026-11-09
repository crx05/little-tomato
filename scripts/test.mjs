import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const tests = resolve(dirname(fileURLToPath(import.meta.url)), '../tests');
for (const name of readdirSync(tests).filter(n => n.endsWith('.test.cjs')).sort()) {
  const result = spawnSync(process.execPath, [resolve(tests, name)], { stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status || 1);
}
