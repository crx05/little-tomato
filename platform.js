/* Serializes native persistence and alarm updates. No native runtime is needed on the web. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory;
  else root.TomatoPlatform = factory(root.TomatoNative);
})(typeof globalThis !== 'undefined' ? globalThis : this, function createPlatform(plugin) {
  'use strict';
  let tail = Promise.resolve();
  let pending = 0;
  let status = { native: !!plugin, busy: false, ready: false, notifications: false, exact: false, channelEnabled: true, scheduled: false, error: '' };
  const subscribers = new Set();
  const publish = (next = {}) => {
    status = { ...status, ...next, native: !!plugin, busy: pending > 0 };
    for (const subscriber of subscribers) subscriber({ ...status });
    return { ...status };
  };
  function enqueue(operation, reportsStatus = true) {
    if (!plugin) return Promise.resolve(null);
    pending++; publish();
    const result = tail.then(operation).then(value => {
      if (reportsStatus) publish({ ...value, error: '' });
      return value;
    }, error => {
      publish({ ready: false, error: String(error?.message || error || '无法连接系统提醒') });
      throw error;
    });
    // A failed operation must not prevent subsequent cancellation or rescheduling.
    tail = result.catch(() => {}).then(() => { pending--; publish(); });
    return result;
  }
  return {
    isNative: !!plugin,
    getStatus: () => ({ ...status }),
    subscribe(listener) { subscribers.add(listener); listener({ ...status }); return () => subscribers.delete(listener); },
    async restore() {
      if (!plugin) return null;
      const result = await enqueue(() => plugin.load(), false);
      if (!result?.snapshot) return null;
      const value = JSON.parse(result.snapshot);
      if (!value || value.version !== 1 || !value.timer || !value.settings || !Array.isArray(value.tasks) || !Array.isArray(value.sessions)) {
        throw new Error('手机记录格式无法识别，请保留应用数据后重试。');
      }
      return value;
    },
    sync(state) {
      // Capture immediately; callers may mutate their model while this operation is queued.
      const snapshot = JSON.stringify(state);
      return enqueue(() => plugin.sync({ snapshot }));
    },
    refresh: () => enqueue(() => plugin.status()),
    requestNotifications: () => enqueue(() => plugin.requestNotifications()),
    openSettings(section) { return enqueue(() => plugin.openSettings({ section }), false); },
    testReminder() { return enqueue(() => plugin.testReminder(), false); },
    async listen(callback) {
      if (!plugin) return () => {};
      const handles = await Promise.all([
        plugin.addListener('resume', () => callback('resume')),
        plugin.addListener('notificationOpened', () => callback('notification'))
      ]);
      return () => handles.forEach(handle => handle.remove());
    }
  };
});
