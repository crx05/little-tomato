const test = require('node:test');
const assert = require('node:assert/strict');
const createPlatform = require('../platform.js');
const Core = require('../core.js');
const ready = { ready: true, notifications: true, exact: true, channelEnabled: true, scheduled: false };
const flush = () => new Promise(resolve => setImmediate(resolve));

test('the original browser app has no native side effects', async () => {
  const platform = createPlatform();
  assert.equal(platform.isNative, false);
  assert.equal(await platform.restore(), null);
  assert.equal(await platform.sync(Core.fresh()), null);
  assert.equal((await platform.listen(() => {})) instanceof Function, true);
});

test('start, pause, resume and reset reach native storage in order even when the bridge is slow', async () => {
  const received = [];
  let releaseFirst;
  const platform = createPlatform({ sync: async ({ snapshot }) => {
    received.push(JSON.parse(snapshot));
    if (received.length === 1) await new Promise(resolve => { releaseFirst = resolve; });
    return ready;
  } });
  const s = Core.fresh();
  Core.start(s, 1000); const p1 = platform.sync(s);
  Core.pause(s, 2000); const p2 = platform.sync(s);
  Core.start(s, 5000); const p3 = platform.sync(s);
  Core.reset(s); const p4 = platform.sync(s);
  await flush();
  assert.equal(received.length, 1);
  assert.equal(platform.getStatus().busy, true);
  releaseFirst(); await Promise.all([p1, p2, p3, p4]); await flush();
  assert.deepEqual(received.map(s => s.timer.status), ['running', 'paused', 'running', 'idle']);
  assert.equal(received[0].timer.endAt, 1201000);
  assert.equal(received[2].timer.endAt, 1204000);
  assert.equal(platform.getStatus().busy, false);
});

test('native failure is visible and cannot block a later cancellation', async () => {
  let failed = false;
  const calls = [];
  const platform = createPlatform({ sync: async ({ snapshot }) => {
    calls.push(JSON.parse(snapshot).timer.status);
    if (!failed) { failed = true; throw new Error('permission revoked'); }
    return ready;
  } });
  const s = Core.fresh(); Core.start(s, 1);
  await assert.rejects(platform.sync(s), /permission revoked/);
  assert.equal(platform.getStatus().ready, false);
  assert.match(platform.getStatus().error, /permission revoked/);
  Core.pause(s, 10); await platform.sync(s); await flush();
  assert.deepEqual(calls, ['running', 'paused']);
  assert.equal(platform.getStatus().error, '');
});

test('recovering native state after process death awards the completed round only once', async () => {
  const s = Core.fresh(); Core.start(s, 1);
  let stored = JSON.stringify(s);
  const platform = createPlatform({ load: async () => ({ snapshot: stored }), sync: async ({ snapshot }) => { stored = snapshot; return ready; } });
  const restored = Core.hydrate(await platform.restore());
  Core.tick(restored, 2000000); await platform.sync(restored);
  assert.equal(restored.sessions.length, 1);
  const again = Core.hydrate(await platform.restore());
  Core.tick(again, 3000000);
  assert.equal(again.sessions.length, 1);
  assert.equal(again.pending.mode, 'focus');
});

test('permission denial is a usable state and changes are exposed to the UI', async () => {
  const seen = [];
  const platform = createPlatform({ requestNotifications: async () => ({ ...ready, ready: false, notifications: false, permissionPrompted: true }) });
  platform.subscribe(s => seen.push(s));
  await platform.requestNotifications(); await flush();
  assert.equal(platform.getStatus().notifications, false);
  assert.equal(platform.getStatus().permissionPrompted, true);
  assert.equal(platform.getStatus().ready, false);
  assert.equal(seen.some(s => s.busy), true);
});

test('resume and notification taps both invoke the caller and listeners are removable', async () => {
  const callbacks = {};
  const removed = [];
  const events = [];
  const platform = createPlatform({ addListener: async (name, cb) => { callbacks[name] = cb; return { remove: () => removed.push(name) }; } });
  const stop = await platform.listen(reason => events.push(reason));
  callbacks.resume(); callbacks.notificationOpened(); stop();
  assert.deepEqual(events, ['resume', 'notification']);
  assert.deepEqual(removed.sort(), ['notificationOpened', 'resume']);
});

test('permission settings and preview never accidentally overwrite readiness', async () => {
  const calls = [];
  const platform = createPlatform({ status: async () => ready, openSettings: async ({ section }) => { calls.push(section); }, testReminder: async () => { calls.push('preview'); } });
  await platform.refresh(); await platform.openSettings('exact'); await platform.testReminder(); await flush();
  assert.deepEqual(calls, ['exact', 'preview']);
  assert.equal(platform.getStatus().ready, true);
});

test('invalid native backup is reported rather than silently replacing it', async () => {
  const platform = createPlatform({ load: async () => ({ snapshot: '{broken' }) });
  await assert.rejects(platform.restore(), SyntaxError);
});

test('unknown or incomplete native data is never silently replaced with an empty model', async () => {
  for (const data of [{ version: 2 }, { version: 1, timer: {}, settings: {} }, null]) {
    const platform = createPlatform({ load: async () => ({ snapshot: JSON.stringify(data) }) });
    await assert.rejects(platform.restore(), /格式无法识别/);
  }
});
