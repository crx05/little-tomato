import { copyFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { ensureWrapper } from './ensure-wrapper.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const android = resolve(root, 'android');
const release = process.argv[2] === 'release';
const windows = process.platform === 'win32';
const wrapper = resolve(android, windows ? 'gradlew.bat' : 'gradlew');
const run = (cmd, args) => {
  const result = spawnSync(cmd, args, { cwd: android, stdio: 'inherit' });
  if (result.error || result.status !== 0) {
    console.error(result.error?.message || `构建退出码：${result.status}`);
    process.exit(result.status || 1);
  }
};
await ensureWrapper(root);
const args = [release ? 'assembleRelease' : 'assembleDebug', 'testDebugUnitTest', 'lintDebug', '--no-daemon'];
if (windows) run(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `gradlew.bat ${args.join(' ')}`]);
else run('sh', [wrapper, ...args]);
const kind = release ? 'release' : 'debug';
const source = resolve(android, `app/build/outputs/apk/${kind}/app-${kind}.apk`);
await mkdir(resolve(root, 'dist'), { recursive: true });
await copyFile(source, resolve(root, `dist/little-tomato-${kind}.apk`));
console.log(`安装包已生成：dist/little-tomato-${kind}.apk`);
