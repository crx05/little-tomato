import { existsSync } from 'node:fs';
import { readFile, writeFile, mkdir, chmod } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { resolve } from 'node:path';

// Copy only the standard wrapper from the pinned, npm-verified Capacitor CLI
// template. No separate Gradle installation and no arbitrary archive extraction.
export function wrapperFiles(archive) {
  const files = new Map();
  const names = ['gradlew', 'gradlew.bat', 'gradle/wrapper/gradle-wrapper.jar'];
  for (let offset = 0; offset + 512 <= archive.length;) {
    const header = archive.subarray(offset, offset + 512);
    if (header.every(byte => byte === 0)) break;
    const name = header.subarray(0, 100).toString().replace(/\0.*$/s, '');
    const prefix = header.subarray(345, 500).toString().replace(/\0.*$/s, '');
    const fullName = prefix ? `${prefix}/${name}` : name;
    const size = Number.parseInt(header.subarray(124, 136).toString().replace(/\0.*$/s, '').trim(), 8);
    if (!Number.isSafeInteger(size) || size < 0 || offset + 512 + size > archive.length) throw new Error('Capacitor Android 模板损坏');
    const match = names.find(n => fullName === n || fullName.endsWith(`/${n}`));
    if (match && (header[156] === 0 || header[156] === 48)) files.set(match, archive.subarray(offset + 512, offset + 512 + size));
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  if (files.size !== names.length) throw new Error('安装的 Capacitor CLI 中缺少标准 Gradle wrapper，请重新运行 npm install。');
  return files;
}

export async function ensureWrapper(root) {
  const android = resolve(root, 'android');
  if (['gradlew', 'gradlew.bat', 'gradle/wrapper/gradle-wrapper.jar'].every(n => existsSync(resolve(android, n)))) return;
  const template = resolve(root, 'node_modules/@capacitor/cli/assets/android-template.tar.gz');
  const files = wrapperFiles(gunzipSync(await readFile(template)));
  await mkdir(resolve(android, 'gradle/wrapper'), { recursive: true });
  for (const [name, bytes] of files) await writeFile(resolve(android, name), bytes);
  if (process.platform !== 'win32') await chmod(resolve(android, 'gradlew'), 0o755);
}
