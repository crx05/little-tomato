import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const java = process.env.JAVA_HOME ? resolve(process.env.JAVA_HOME, 'bin', process.platform === 'win32' ? 'java.exe' : 'java') : 'java';
const result = spawnSync(java, ['-version'], { encoding: 'utf8' });
const version = `${result.stdout || ''}${result.stderr || ''}`;
const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
const checks = [
  ['Node.js 20+', Number(process.versions.node.split('.')[0]) >= 20],
  ['npm 依赖已安装', existsSync(resolve(root, 'node_modules/@capacitor/android/capacitor/build.gradle'))],
  ['JDK 21', result.status === 0 && Number(version.match(/version "(\d+)/)?.[1] || 0) === 21],
  ['Android SDK 35', !!sdk && existsSync(resolve(sdk, 'platforms/android-35/android.jar'))],
  ['Android SDK Build-Tools 35.0.0', !!sdk && existsSync(resolve(sdk, 'build-tools/35.0.0'))]
];
for (const [name, ok] of checks) console.log(`${ok ? 'OK  ' : '缺少'} ${name}`);
console.log('完整安装与打包步骤见 ANDROID.md。Android Studio 可使用 android/local.properties 指定 SDK。');
if (checks.some(([, ok]) => !ok)) process.exitCode = 1;
