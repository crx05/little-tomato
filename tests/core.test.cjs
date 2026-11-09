const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../core.js');
const at = new Date(2026, 10, 6, 16, 0, 0).getTime();

test('a delayed tick completes exactly one round using its scheduled end time', () => {
  const s = C.fresh();
  C.start(s, at);
  assert.equal(C.remaining(s, at + 12345), 20 * C.MINUTE - 12345);
  assert.equal(C.tick(s, at + 19 * C.MINUTE), null);
  const result = C.tick(s, at + 90 * C.MINUTE);
  assert.equal(result.mode, 'focus');
  assert.equal(s.sessions.length, 1);
  assert.equal(s.sessions[0].endedAt, at + 20 * C.MINUTE);
  assert.equal(s.timer.status, 'complete');
  assert.equal(C.tick(s, at + 100 * C.MINUTE), null);
  assert.equal(C.start(s, at + 100 * C.MINUTE), false);
  assert.equal(s.sessions.length, 1);
});

test('pause excludes paused time and resume uses the exact remaining milliseconds', () => {
  const s = C.fresh(); C.start(s, at);
  C.pause(s, at + 12345);
  const left = 20 * C.MINUTE - 12345;
  assert.equal(C.remaining(s, at + 60 * C.MINUTE), left);
  const restored = C.hydrate(JSON.parse(JSON.stringify(s)));
  C.start(restored, at + 60 * C.MINUTE);
  assert.equal(restored.timer.endAt, at + 60 * C.MINUTE + left);
  assert.equal(C.tick(restored, restored.timer.endAt - 1), null);
  C.tick(restored, restored.timer.endAt);
  assert.equal(restored.sessions.length, 1);
  assert.equal(restored.sessions[0].durationMs, 20 * C.MINUTE);
});

test('refresh restores the running deadline and does not duplicate rewards after completion', () => {
  const s = C.fresh(); C.start(s, at);
  const r = C.hydrate(JSON.parse(JSON.stringify(s)));
  assert.equal(C.remaining(r, at + 10 * C.MINUTE), 10 * C.MINUTE);
  C.tick(r, at + 21 * C.MINUTE);
  const completed = C.hydrate(JSON.parse(JSON.stringify(r)));
  assert.equal(completed.pending.mode, 'focus');
  C.tick(completed, at + 22 * C.MINUTE);
  assert.equal(completed.sessions.length, 1);
});

test('reset and changing mode cancel a partial round without awarding a tomato', () => {
  const s = C.fresh(); C.start(s, at); C.pause(s, at + C.MINUTE);
  C.reset(s, 'short');
  assert.equal(s.sessions.length, 0);
  assert.equal(s.timer.remainingMs, 5 * C.MINUTE);
  C.start(s, at + 2 * C.MINUTE); C.tick(s, at + 7 * C.MINUTE);
  assert.equal(s.sessions.length, 0);
  assert.equal(s.pending.nextMode, 'focus');
});

test('every fourth focus of the completion day suggests a long break', () => {
  const s = C.fresh();
  for (let i = 0; i < 4; i++) {
    C.reset(s, 'focus'); C.start(s, at + i * 30 * C.MINUTE); C.tick(s, at + (i * 30 + 20) * C.MINUTE);
    assert.equal(s.pending.nextMode, i === 3 ? 'long' : 'short');
  }
});

test('a sleeping page attributes a completed round to the deadline date, not reopen date', () => {
  const s = C.fresh();
  const yesterday = new Date(2026, 10, 5, 23, 0).getTime();
  C.start(s, yesterday); C.tick(s, at);
  assert.equal(C.stats(s, at).count, 0);
  assert.equal(C.stats(s, yesterday).count, 1);
  C.reset(s); C.start(s, at); C.tick(s, at + 20 * C.MINUTE);
  assert.equal(C.stats(s, at).count, 1);
  assert.equal(C.stats(s, at).minutes, 20);
});

test('midnight crossing counts toward the new local day', () => {
  const s = C.fresh();
  const start = new Date(2026, 10, 5, 23, 50).getTime();
  C.start(s, start); C.tick(s, start + 20 * C.MINUTE);
  assert.equal(C.stats(s, start).count, 0);
  assert.equal(C.stats(s, at).count, 1);
});

test('settings affect the next round without rewriting a running or paused timer', () => {
  const s = C.fresh(); C.start(s, at);
  C.updateSettings(s, { focus: 15, short: 3 });
  assert.equal(s.timer.durationMs, 20 * C.MINUTE);
  C.pause(s, at + C.MINUTE); C.updateSettings(s, { focus: 25 });
  assert.equal(s.timer.remainingMs, 19 * C.MINUTE);
  C.reset(s); assert.equal(s.timer.durationMs, 25 * C.MINUTE);
  C.updateSettings(s, { focus: 10 }); assert.equal(s.timer.durationMs, 10 * C.MINUTE);
});

test('task snapshots preserve attribution and completed rounds do not mark homework done', () => {
  const s = C.fresh();
  const task = C.addTask(s, '  数学第 12 页  ', '数学');
  C.start(s, at); task.title = 'changed'; C.tick(s, at + 20 * C.MINUTE);
  assert.equal(s.sessions[0].title, '数学第 12 页');
  assert.equal(s.sessions[0].taskId, task.id);
  assert.equal(task.done, false);
  assert.equal(C.addTask(s, '   ', '数学'), null);
});

test('malformed storage and invalid settings recover to usable defaults', () => {
  for (const data of [null, false, [], 'bad', { version: 99 }]) assert.deepEqual(C.hydrate(data).settings, C.DEFAULTS);
  const r = C.hydrate({ version: 1, settings: { focus: -1, goal: 99, short: 1.5, sound: 'false' }, tasks: [null, {}, { id: 'a', title: '数学' }, { id: 'a', title: 'duplicate' }], sessions: [null, { id: 'bad', durationMs: NaN }], timer: { mode: 'focus', status: 'running', durationMs: 0, remainingMs: 0 } });
  assert.deepEqual(r.settings, C.DEFAULTS);
  assert.equal(r.tasks.length, 1);
  assert.equal(r.sessions.length, 0);
  assert.equal(r.timer.status, 'idle');
});

test('a pause at the exact deadline completes rather than stranding a zero timer', () => {
  const s = C.fresh(); C.start(s, at);
  assert.equal(C.pause(s, at + 20 * C.MINUTE), false);
  assert.equal(s.timer.status, 'complete');
  assert.equal(s.sessions.length, 1);
});

test('impossible stored dates are rejected before rendering a history list', () => {
  const s = C.fresh(); C.start(s, at);
  s.timer.endAt = 1e30;
  s.sessions.push({ id: 'invalid-date', endedAt: 1e30, durationMs: C.MINUTE, title: 'invalid' });
  const restored = C.hydrate(s);
  assert.equal(restored.sessions.length, 0);
  assert.equal(restored.timer.status, 'idle');
});
