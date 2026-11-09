/* Independent timer model. Time is supplied explicitly so suspend/resume is testable. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.TomatoCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const MINUTE = 60000;
  const MODES = ['focus', 'short', 'long'];
  const SUBJECTS = ['数学', '语文', '英语', '其他'];
  const DEFAULTS = { focus: 20, short: 5, long: 15, goal: 4, sound: true, notifications: false };
  const LIMITS = { focus: [1, 60], short: [1, 30], long: [1, 60], goal: [1, 12] };
  const uid = () => globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const text = (v, length = 80) => typeof v === 'string' ? v.trim().slice(0, length) : '';
  const validTime = (value) => Number.isFinite(value) && value >= 0 && value <= 8640000000000000;
  const dayKey = (time) => {
    const d = new Date(time);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  const makeTimer = (settings, mode = 'focus') => ({ mode, status: 'idle', durationMs: settings[mode] * MINUTE,
    remainingMs: settings[mode] * MINUTE, endAt: null, id: null, taskId: null, taskTitle: '', startedAt: null });
  function fresh() {
    const settings = { ...DEFAULTS };
    return { version: 1, settings, tasks: [], selectedTaskId: null, sessions: [], timer: makeTimer(settings), pending: null };
  }
  function sanitizeSettings(raw = {}) {
    const result = { ...DEFAULTS };
    for (const [key, [min, max]] of Object.entries(LIMITS)) {
      if (Number.isInteger(raw[key]) && raw[key] >= min && raw[key] <= max) result[key] = raw[key];
    }
    for (const key of ['sound', 'notifications']) if (typeof raw[key] === 'boolean') result[key] = raw[key];
    return result;
  }
  function hydrate(raw) {
    const s = fresh();
    if (!raw || raw.version !== 1) return s;
    s.settings = sanitizeSettings(raw.settings || {});
    const taskIds = new Set();
    s.tasks = (Array.isArray(raw.tasks) ? raw.tasks : []).filter(t => t && text(t.id) && text(t.title) && !taskIds.has(t.id) && taskIds.add(t.id)).slice(0, 100).map(t => ({
      id: text(t.id), title: text(t.title), subject: SUBJECTS.includes(t.subject) ? t.subject : '其他', done: t.done === true
    }));
    s.selectedTaskId = s.tasks.some(t => t.id === raw.selectedTaskId && !t.done) ? raw.selectedTaskId : s.tasks.find(t => !t.done)?.id || null;
    const sessionIds = new Set();
    s.sessions = (Array.isArray(raw.sessions) ? raw.sessions : []).filter(r => r && text(r.id) && validTime(r.endedAt) && Number.isFinite(r.durationMs) && r.durationMs >= MINUTE && r.durationMs <= 60 * MINUTE && !sessionIds.has(r.id) && sessionIds.add(r.id)).slice(-1000).map(r => ({
      id: text(r.id), taskId: text(r.taskId) || null, title: text(r.title) || '自由专注', durationMs: r.durationMs, endedAt: r.endedAt
    }));
    s.timer = makeTimer(s.settings);
    const t = raw.timer;
    if (t && MODES.includes(t.mode) && ['idle', 'running', 'paused', 'complete'].includes(t.status) &&
      Number.isFinite(t.durationMs) && t.durationMs >= MINUTE && t.durationMs <= 60 * MINUTE &&
      Number.isFinite(t.remainingMs) && t.remainingMs >= 0 && t.remainingMs <= t.durationMs &&
      (t.status !== 'running' || validTime(t.endAt) && text(t.id)) &&
      (t.status !== 'paused' || text(t.id))) {
      s.timer = { mode: t.mode, status: t.status, durationMs: t.durationMs, remainingMs: t.remainingMs,
        endAt: t.status === 'running' ? t.endAt : null, id: text(t.id) || null, taskId: text(t.taskId) || null,
        taskTitle: text(t.taskTitle), startedAt: Number.isFinite(t.startedAt) ? t.startedAt : null };
      if (t.status === 'complete' && raw.pending && MODES.includes(raw.pending.mode)) {
        s.pending = { mode: raw.pending.mode, taskId: text(raw.pending.taskId) || null,
          title: text(raw.pending.title) || '自由专注', durationMs: t.durationMs,
          nextMode: MODES.includes(raw.pending.nextMode) ? raw.pending.nextMode : 'focus' };
      } else if (t.status === 'complete') s.timer = makeTimer(s.settings, t.mode);
    }
    return s;
  }
  const remaining = (s, now) => s.timer.status === 'running' ? Math.max(0, Math.min(s.timer.durationMs, s.timer.endAt - now)) : s.timer.remainingMs;
  function start(s, now) {
    const t = s.timer;
    if (t.status === 'running' || t.status === 'complete') return false;
    if (t.status === 'idle') {
      t.id = uid(); t.startedAt = now;
      const task = s.tasks.find(task => task.id === s.selectedTaskId && !task.done);
      t.taskId = t.mode === 'focus' ? task?.id || null : null;
      t.taskTitle = t.mode === 'focus' ? task?.title || '自由专注' : '';
    }
    t.endAt = now + t.remainingMs; t.status = 'running';
    return true;
  }
  function tick(s, now) {
    const t = s.timer;
    if (t.status !== 'running' || remaining(s, now) > 0) return null;
    const endedAt = t.endAt;
    t.remainingMs = 0; t.endAt = null; t.status = 'complete';
    if (t.mode === 'focus' && !s.sessions.some(r => r.id === t.id)) {
      s.sessions.push({ id: t.id, taskId: t.taskId, title: t.taskTitle || '自由专注', durationMs: t.durationMs, endedAt });
      s.sessions = s.sessions.slice(-1000);
    }
    const roundsToday = s.sessions.filter(r => dayKey(r.endedAt) === dayKey(endedAt)).length;
    s.pending = { mode: t.mode, taskId: t.taskId, title: t.taskTitle, durationMs: t.durationMs,
      nextMode: t.mode === 'focus' ? (roundsToday % 4 === 0 ? 'long' : 'short') : 'focus' };
    return s.pending;
  }
  function pause(s, now) {
    if (s.timer.status !== 'running') return false;
    if (tick(s, now)) return false;
    s.timer.remainingMs = remaining(s, now); s.timer.endAt = null; s.timer.status = 'paused';
    return true;
  }
  function reset(s, mode = s.timer.mode) {
    if (!MODES.includes(mode)) return false;
    s.timer = makeTimer(s.settings, mode); s.pending = null; return true;
  }
  function updateSettings(s, values) {
    s.settings = sanitizeSettings({ ...s.settings, ...values });
    if (s.timer.status === 'idle') s.timer = makeTimer(s.settings, s.timer.mode);
  }
  function addTask(s, title, subject) {
    title = text(title);
    if (!title || s.tasks.length >= 100) return null;
    const task = { id: uid(), title, subject: SUBJECTS.includes(subject) ? subject : '其他', done: false };
    s.tasks.push(task); if (!s.selectedTaskId) s.selectedTaskId = task.id;
    return task;
  }
  function stats(s, now) {
    const today = s.sessions.filter(r => dayKey(r.endedAt) === dayKey(now));
    return { today, count: today.length, minutes: Math.round(today.reduce((sum, r) => sum + r.durationMs, 0) / MINUTE) };
  }
  return { MINUTE, MODES, SUBJECTS, DEFAULTS, LIMITS, fresh, hydrate, remaining, start, tick, pause, reset, updateSettings, addTask, stats, dayKey };
});
