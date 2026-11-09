const test = require('node:test');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
function tarEntry(name, contents, type = '0') {
  const data = Buffer.from(contents);
  const header = Buffer.alloc(512);
  header.write(name); header.write(data.length.toString(8).padStart(11, '0') + '\0', 124); header.write(type, 156);
  return Buffer.concat([header, data, Buffer.alloc((512 - data.length % 512) % 512)]);
}
test('wrapper bootstrap selects only standard wrapper files from the installed template', async () => {
  const { wrapperFiles } = await import(pathToFileURL(path.resolve(__dirname, '../scripts/ensure-wrapper.mjs')));
  const archive = Buffer.concat([
    tarEntry('android/gradlew', '#!/bin/sh'), tarEntry('android/gradlew.bat', '@echo off'),
    tarEntry('android/gradle/wrapper/gradle-wrapper.jar', 'jar data'), tarEntry('../../outside.txt', 'never extract'), Buffer.alloc(1024)
  ]);
  const files = wrapperFiles(archive);
  assert.deepEqual([...files.keys()], ['gradlew', 'gradlew.bat', 'gradle/wrapper/gradle-wrapper.jar']);
  assert.equal(files.get('gradlew').toString(), '#!/bin/sh');
});
test('missing or truncated wrapper archives fail instead of producing a partial runnable bootstrap', async () => {
  const { wrapperFiles } = await import(pathToFileURL(path.resolve(__dirname, '../scripts/ensure-wrapper.mjs')));
  assert.throws(() => wrapperFiles(Buffer.alloc(1024)), /缺少/);
  assert.throws(() => wrapperFiles(tarEntry('gradlew', 'hello').subarray(0, 513)), /损坏/);
});
