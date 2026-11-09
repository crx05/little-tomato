(async function () {
  'use strict';
  const C = window.TomatoCore;
  const platform = window.TomatoPlatform;
  const native = platform.isNative;
  const KEY = 'little-tomato:v1';
  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => [...document.querySelectorAll(selector)];
  const icon = (name) => `<svg class="icon" aria-hidden="true"><use href="#i-${name}"></use></svg>`;
  const tomato = (extra = '') => `<span class="tomato ${extra}" aria-hidden="true"><i></i></span>`;
  const escapeHTML = (value) => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  let state, audioContext, toastTimeout, confirmAction, lastDate;
  let zen = false;
  let storageFailed = false;
  let nativeRestoring = native;
  let nativeRestoreFailed = false;
  let nativeStatus = platform.getStatus();
  try { state = C.hydrate(JSON.parse(localStorage.getItem(KEY))); }
  catch { state = C.fresh(); storageFailed = true; }

  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
      storageFailed = false;
    } catch { storageFailed = true; }
    $('#storage-notice').hidden = !storageFailed;
    if (!native || nativeRestoreFailed) return Promise.resolve(!storageFailed);
    return platform.sync(state).then(() => {
      // The native snapshot is authoritative even if WebView localStorage is unavailable.
      $('#storage-notice').hidden = true;
      return true;
    }).catch(() => false);
  }
  function toast(message) {
    clearTimeout(toastTimeout);
    $('#toast').textContent = message; $('#toast').hidden = false;
    toastTimeout = setTimeout(() => { $('#toast').hidden = true; }, 3600);
  }
  function isActive() { return ['running', 'paused'].includes(state.timer.status); }
  function showDialog(dialog) { if (!dialog.open) dialog.showModal(); }
  function closeDialog(id) { $(id).close(); }
  function requestConfirm(title, description, action, accept = '重新开始') {
    confirmAction = action;
    $('#confirm-title').textContent = title;
    $('#confirm-description').textContent = description;
    $('#confirm-accept').textContent = accept;
    showDialog($('#confirm-dialog'));
    $('#confirm-cancel').focus();
  }

  function initAudio() {
    if (native) return null;
    const AudioClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioClass) return null;
    try {
      if (!audioContext) audioContext = new AudioClass();
      if (audioContext.state === 'suspended') audioContext.resume().catch(() => {});
      return audioContext;
    } catch { return null; }
  }
  function chime(force = false) {
    if (native) {
      if (force) platform.testReminder().catch(() => toast('请先开启系统通知，再测试提醒。'));
      return;
    }
    if (!force && !state.settings.sound) return;
    const context = initAudio();
    if (!context) { if (force) toast('这个浏览器暂不支持提示音，结束时仍会弹窗提醒。'); return; }
    const play = () => {
      if (context.state !== 'running') { if (force) toast('提示音未能播放，请检查浏览器的声音权限。'); return; }
      [523.25, 659.25, 783.99].forEach((frequency, index) => {
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        const start = context.currentTime + index * 0.24;
        oscillator.type = 'sine'; oscillator.frequency.value = frequency;
        gain.gain.setValueAtTime(0, start);
        gain.gain.linearRampToValueAtTime(.1, start + .025);
        gain.gain.exponentialRampToValueAtTime(.001, start + .85);
        oscillator.connect(gain); gain.connect(context.destination);
        oscillator.start(start); oscillator.stop(start + .9);
        oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
      });
    };
    if (context.state === 'running') play();
    else context.resume().then(play).catch(() => { if (force) toast('请检查浏览器的声音权限。'); });
  }
  function notify(completion) {
    if (native) return;
    if (!state.settings.notifications || !('Notification' in window) || Notification.permission !== 'granted') return;
    try {
      const notice = new Notification(completion.mode === 'focus' ? '小番茄：这一轮，你做到了！' : '休息结束，准备好下一小步了吗？', {
        body: completion.mode === 'focus' ? '收获一颗小番茄。放下笔，喝口水、看看远处吧。' : '回到小番茄，选择下一件小任务。',
        icon: 'favicon.svg', tag: `little-tomato-${state.timer.id}`
      });
      notice.onclick = () => { window.focus(); notice.close(); };
    } catch { /* In-page dialog remains available when OS notifications are unsupported. */ }
  }

  function renderClock() {
    const t = state.timer;
    const seconds = Math.ceil(C.remaining(state, Date.now()) / 1000);
    const minutes = Math.floor(seconds / 60);
    const formatted = `${String(minutes).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
    $('#timer-number').textContent = formatted;
    $('#timer-number').setAttribute('aria-label', `剩余 ${minutes} 分 ${seconds % 60} 秒`);
    $('#clock-ring').style.setProperty('--progress', `${C.remaining(state, Date.now()) / t.durationMs * 100}%`);
    document.title = t.status === 'running' ? `${formatted} · ${t.mode === 'focus' ? '专心写作业' : '好好休息'} · 小番茄` : '小番茄 · 一起专心长大';
  }
  function renderTimer() {
    const t = state.timer;
    $('.timer-card').dataset.mode = t.mode;
    const focus = t.mode === 'focus';
    const active = isActive();
    $('#timer-state').textContent = { idle: focus ? '准备好，就出发' : '休息，也是成长的一部分', running: focus ? '正在专注，慢慢来就好' : '放下笔，好好休息一下', paused: '已暂停，准备好再继续', complete: focus ? '完成一轮，真棒！' : '休息结束，精神满满' }[t.status];
    $('#clock-caption').textContent = t.status === 'paused' ? '喝口水，准备好就继续' : focus ? '每一小段专注，都算数' : '看看远处，让眼睛休息一下';
    $$('[data-mode]').filter(el => el.tagName === 'BUTTON').forEach(button => {
      const selected = button.dataset.mode === t.mode;
      button.classList.toggle('active', selected); button.setAttribute('aria-pressed', selected);
    });
    $('#duration-picker').hidden = !focus;
    $$('[data-duration]').forEach(button => {
      const selected = Number(button.dataset.duration) === t.durationMs / C.MINUTE;
      button.classList.toggle('selected', selected); button.setAttribute('aria-pressed', selected);
      button.disabled = active;
    });
    const custom = ![15, 20, 25].includes(t.durationMs / C.MINUTE);
    $('#custom-duration').textContent = custom ? `${t.durationMs / C.MINUTE} 分钟 · 修改` : '自定义';
    $('#custom-duration').classList.toggle('selected', custom);
    const task = state.tasks.find(task => task.id === state.selectedTaskId && !task.done);
    const currentTitle = active || t.status === 'complete' ? t.taskTitle : task?.title;
    $('#current-task-label').textContent = focus ? `本轮：${currentTitle || '自由专注，也很棒'}` : (t.mode === 'short' ? '休息小任务：喝水、伸伸懒腰' : '长休息：离开书桌，活动一下身体');
    $('#start-label').textContent = t.status === 'running' ? '暂停一下' : t.status === 'paused' ? (focus ? '继续专注' : '继续休息') : t.status === 'complete' ? '看看这一轮的收获' : focus ? '开始专注' : '开始休息';
    $('#start-button>span:first-child').className = t.status === 'running' ? 'pause-icon' : 'play-icon';
    const nextLong = (C.stats(state, Date.now()).count + 1) % 4 === 0;
    $('#timer-footnote').innerHTML = `<span class="small-check">✓</span>${focus ? `专注结束后，记得${nextLong ? '长' : ''}休息 ${state.settings[nextLong ? 'long' : 'short']} 分钟` : '休息好了，再由你决定什么时候开始'} `;
    $('#sound-button').setAttribute('aria-pressed', state.settings.sound);
    $('#sound-button').setAttribute('aria-label', state.settings.sound ? '关闭提醒声音' : '开启提醒声音');
    $('#sound-button').innerHTML = icon(state.settings.sound ? 'sound' : 'mute');
    updateNativeControls();
    renderClock();
  }
  function renderTasks() {
    const completed = state.tasks.filter(task => task.done).length;
    $('#task-count').textContent = `${completed} / ${state.tasks.length}`;
    $('#empty-tasks').hidden = state.tasks.length > 0;
    $('#task-list').innerHTML = [...state.tasks].sort((a, b) => Number(a.done) - Number(b.done)).map(task => {
      const rounds = state.sessions.filter(r => r.taskId === task.id).length;
      const selected = task.id === state.selectedTaskId && !task.done;
      return `<div class="task-item ${selected ? 'selected' : ''} ${task.done ? 'done' : ''}" data-task-id="${escapeHTML(task.id)}"><button class="task-checkbox" data-task-action="toggle" aria-label="${task.done ? '重新打开' : '完成'}作业：${escapeHTML(task.title)}" aria-pressed="${task.done}">${task.done ? icon('check') : ''}</button><button class="task-select" data-task-action="select" aria-label="选择作业：${escapeHTML(task.title)}" aria-pressed="${selected}" ${task.done ? 'disabled' : ''}><span class="task-name">${escapeHTML(task.title)}</span><span class="task-meta"><span class="subject-tag" data-subject="${task.subject}">${task.subject}</span><span>${selected ? '本轮小目标' : task.done ? '已经完成啦' : '点击选为本轮目标'}${rounds ? ` · ${rounds} 颗番茄` : ''}</span></span></button><button class="delete-task" data-task-action="delete" aria-label="删除作业：${escapeHTML(task.title)}">${icon('trash')}</button></div>`;
    }).join('');
  }
  function renderStats() {
    const now = Date.now();
    const { today, count, minutes } = C.stats(state, now);
    const goal = state.settings.goal;
    $('#today-date').textContent = new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' }).format(now);
    $('#today-minutes').innerHTML = `${minutes}<small> 分钟</small>`;
    const shown = Math.min(goal, 6);
    $('#garden').innerHTML = Array.from({ length: shown }, (_, i) => tomato(i < count ? '' : 'unearned')).join('') + (goal > shown ? `<span class="garden-extra">${count} / ${goal}</span>` : count > goal ? `<span class="garden-extra">+${count - goal}</span>` : '');
    $('#garden').setAttribute('aria-label', `今天已收获 ${count} 颗番茄，目标 ${goal} 颗`);
    $('#garden-message').textContent = count >= goal ? `收获 ${count} 颗，今天的小目标完成啦！` : count ? `已收获 ${count} 颗，再来 ${goal - count} 颗就完成小目标。` : '每专注一轮，就收获一颗小番茄。';
    $('#harvest-count').innerHTML = `${count}<small> 颗</small>`;
    $('#harvest-minutes').innerHTML = `${minutes}<small> 分钟</small>`;
    $('#harvest-days').innerHTML = `${new Set(state.sessions.map(r => C.dayKey(r.endedAt))).size}<small> 天</small>`;
    $('#harvest-goal').textContent = count >= goal ? '今天的小目标完成啦！' : `今天的小目标：${goal} 颗`;
    const days = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(now); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() - (6 - i));
      const key = C.dayKey(d);
      const value = Math.round(state.sessions.filter(r => C.dayKey(r.endedAt) === key).reduce((n, r) => n + r.durationMs, 0) / C.MINUTE);
      return { label: i === 6 ? '今天' : `${d.getMonth() + 1}/${d.getDate()}`, value, key };
    });
    const max = Math.max(30, ...days.map(d => d.value));
    $('#week-chart').innerHTML = days.map((day, i) => `<div class="chart-column ${i === 6 ? 'today' : ''}" aria-label="${day.key} 专注 ${day.value} 分钟"><span class="chart-value">${day.value}</span><div class="chart-bar" style="height:${Math.max(2, day.value / max * 75)}%"></div><span>${day.label}</span></div>`).join('');
    $('#history-count').textContent = `${count} 次专注`;
    $('#history-list').innerHTML = today.length ? [...today].sort((a, b) => b.endedAt - a.endedAt).map(r => `<div class="history-row">${tomato()}<div class="history-detail"><strong>${escapeHTML(r.title)}</strong><span>${new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }).format(r.endedAt)} 完成一轮专注</span></div><span class="history-minutes">${Math.round(r.durationMs / C.MINUTE)} 分钟</span></div>`).join('') : `<div class="history-empty">${icon('leaf')}<span>第一颗小番茄，正在等你</span><p>完成一轮专注后，<br>你的认真就会出现在这里。</p><button class="text-button" data-view="focus">去开始一轮 ${icon('arrow')}</button></div>`;
    lastDate = C.dayKey(now);
  }
  function renderAll() { renderTimer(); renderTasks(); renderStats(); $('#storage-notice').hidden = native ? !nativeRestoreFailed : !storageFailed; }
  function renderCompletion() {
    const p = state.pending;
    if (!p) return;
    const focus = p.mode === 'focus';
    $('#completion-eyebrow').textContent = focus ? '认真专注，值得一颗小番茄' : '给大脑充充电，再出发';
    $('#completion-title').textContent = focus ? '这一轮，你做到了！' : '休息好了吗？';
    $('#completion-description').textContent = focus ? `认真投入了 ${Math.round(p.durationMs / C.MINUTE)} 分钟，收获 1 颗番茄。${p.nextMode === 'long' ? '已经完成 4 轮，来一次长休息吧！' : '现在，给自己一点休息时间。'}` : '活动一下肩膀，准备好后，再开始下一小段专注吧。';
    const task = state.tasks.find(task => task.id === p.taskId);
    $('#complete-task-button').hidden = !focus || !task;
    $('#complete-task-button').disabled = !!task?.done;
    $('#complete-task-button span').textContent = task?.done ? '这项作业已完成，真棒！' : '这项作业也写完啦';
    $('#break-suggestions').hidden = !focus;
    $('#next-round-button').textContent = focus ? `开始${p.nextMode === 'long' ? '长' : ''}休息 · ${state.settings[p.nextMode]} 分钟` : '开始下一轮专注';
    showDialog($('#completion-dialog'));
  }
  function completeRound(completion, withSound = true) {
    save();
    if ($('#confirm-dialog').open) { closeDialog('#confirm-dialog'); confirmAction = null; }
    if ($('#settings-dialog').open) closeDialog('#settings-dialog');
    if ($('#reminder-dialog').open) closeDialog('#reminder-dialog');
    renderAll(); renderCompletion();
    if (withSound && !native) { chime(); notify(completion); }
  }
  function tick() {
    const completion = C.tick(state, Date.now());
    if (completion) completeRound(completion);
    else renderClock();
    if (C.dayKey(Date.now()) !== lastDate) { renderStats(); renderTimer(); }
  }
  function switchMode(mode) {
    if (mode === state.timer.mode) return;
    const change = () => { C.reset(state, mode); save(); renderAll(); };
    if (isActive()) requestConfirm('要切换计时模式吗？', '这一轮还没完成，切换后将重新计时，不会获得这一轮的番茄。', change, '切换模式');
    else change();
  }
  function openSettings() {
    const form = $('#settings-form');
    for (const key of ['focus', 'short', 'long', 'goal']) form.elements[key].value = state.settings[key];
    form.elements.sound.checked = state.settings.sound;
    if (native) {
      form.elements.notifications.closest('.setting-row').hidden = true;
      $('#test-sound').textContent = '测试系统提醒';
      $('.settings-helper>span').textContent = '息屏提醒由手机系统发送。';
      showDialog($('#settings-dialog'));
      return;
    }
    const supported = 'Notification' in window && window.isSecureContext;
    const denied = supported && Notification.permission === 'denied';
    form.elements.notifications.checked = supported && !denied && state.settings.notifications;
    form.elements.notifications.disabled = !supported || denied;
    $('#notification-hint').textContent = !supported ? '当前浏览器不支持桌面提醒，仍会显示页面提醒' : denied ? '提醒权限已关闭，可在浏览器网站设置中开启' : '需要浏览器允许；请保持网页打开';
    showDialog($('#settings-dialog'));
  }
  function view(name) {
    const harvest = name === 'harvest';
    $('#focus-view').hidden = harvest; $('#harvest-view').hidden = !harvest;
    $$('.main-nav [data-view]').forEach(button => {
      const active = button.dataset.view === name;
      button.classList.toggle('active', active);
      if (active) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current');
    });
    if (location.hash !== `#${name}`) {
      try { history.replaceState(null, '', `#${name}`); } catch { /* Some file viewers restrict history. */ }
    }
    renderStats();
  }
  function setZen(value) {
    zen = value; document.body.classList.toggle('zen-mode', zen);
    $('#exit-zen').hidden = !zen;
    $('#zen-button').setAttribute('aria-label', zen ? '退出沉浸模式' : '进入沉浸模式');
    $('#zen-button').title = zen ? '退出沉浸模式' : '沉浸模式';
    if (zen) $('#start-button').focus(); else $('#zen-button').focus();
  }

  function updateNativeControls() {
    if (!native) return;
    const busy = nativeRestoring || nativeStatus.busy || nativeRestoreFailed;
    for (const button of [$('#start-button'), $('#reset-button'), ...$$('.mode-tabs button')]) button.disabled = busy;
    $$('[data-duration]').forEach(button => { button.disabled = busy || isActive(); });
    $('#custom-duration').disabled = busy;
  }
  function renderNativeStatus(value) {
    nativeStatus = value;
    if (!native) return;
    $('#native-reminder-status').hidden = false;
    const problem = nativeRestoreFailed || !!value.error;
    const working = nativeRestoring || value.busy;
    const registered = state.timer.status !== 'running' || (value.scheduled && value.scheduledKey === `${state.timer.id}@${state.timer.endAt}`);
    $('#native-status-label').textContent = problem ? '手机提醒未就绪，点此检查' : working ? '正在保存到手机，请稍等…' : value.ready && registered ? '息屏提醒已开启 · 可离线使用' : '息屏提醒未开启 · 点此设置';
    $('#native-reminder-status').classList.toggle('needs-attention', problem || (!working && (!value.ready || !registered)));
    $('#native-notification-detail').textContent = value.notifications && value.channelEnabled ? '已允许，可在系统中调整声音和振动' : value.notifications ? '提醒类别已关闭，请在系统通知设置中开启' : '尚未允许，目前只能在页面内提示';
    $('#native-notification-button').textContent = value.notifications || value.permissionPrompted ? '系统设置' : '允许通知';
    $('#native-exact-detail').textContent = value.exact ? '已允许，手机可以安排到点提醒' : '需要在系统中允许“闹钟和提醒”';
    $('#native-exact-button').textContent = value.exact ? '已允许' : '去开启';
    $('#native-exact-button').disabled = working || nativeRestoreFailed || value.exact;
    $('#native-notification-button').disabled = working || nativeRestoreFailed;
    $('#native-test-button').disabled = working || nativeRestoreFailed || !value.notifications || !value.channelEnabled;
    $('#native-reminder-error').hidden = !problem;
    $('#native-reminder-error').textContent = nativeRestoreFailed ? '暂时无法读取手机记录，请重试。为保护已有记录，计时尚未开启。' : value.error ? '手机未能保存提醒。请保持应用打开，检查权限后重新开始本轮。' : '';
    $('#native-retry-button').hidden = !nativeRestoreFailed;
    $('#native-test-button').hidden = nativeRestoreFailed;
    $('#native-reminder-dismiss').textContent = value.ready && !problem ? '准备好了' : nativeRestoreFailed ? '稍后重试' : '先使用前台计时';
    updateNativeControls();
  }
  async function resumeNative(reason) {
    if (!native || nativeRestoring || nativeRestoreFailed) return;
    tick();
    await save();
    renderAll();
    if (reason === 'notification') view('focus');
  }
  function openReminders() {
    showDialog($('#reminder-dialog'));
    if (!nativeRestoreFailed) platform.refresh().catch(() => {});
  }
  platform.subscribe(renderNativeStatus);
  if (native) {
    $('#storage-notice').textContent = '暂时无法读取手机记录。请点击“息屏提醒”检查并重试。';
    $('main').inert = true; $('.site-header').inert = true;
    try {
      const stored = await platform.restore();
      if (stored) state = C.hydrate(stored);
      await platform.listen(resumeNative);
    } catch {
      nativeRestoreFailed = true;
    } finally {
      nativeRestoring = false;
      $('main').inert = false; $('.site-header').inert = false;
      renderNativeStatus(platform.getStatus());
    }
  }
  $('#native-reminder-status').addEventListener('click', openReminders);
  $('#native-retry-button').addEventListener('click', () => location.reload());
  $('#native-notification-button').addEventListener('click', async () => {
    try {
      if (!nativeStatus.notifications && !nativeStatus.permissionPrompted) await platform.requestNotifications();
      else await platform.openSettings('notifications');
      await resumeNative('permission');
    } catch { toast('请到手机设置 → 应用 → 小番茄中开启通知。'); }
  });
  $('#native-exact-button').addEventListener('click', () => {
    platform.openSettings('exact').catch(() => toast('请在手机设置中允许小番茄使用“闹钟和提醒”。'));
  });
  $('#native-test-button').addEventListener('click', () => {
    platform.testReminder().then(() => toast('已发送测试通知，请检查铃声和振动。')).catch(() => toast('测试未能发送，请检查手机通知设置。'));
  });
  $('#native-reminder-dismiss').addEventListener('click', () => closeDialog('#reminder-dialog'));
  $('#reminder-dialog').addEventListener('close', () => {
    try { localStorage.setItem('little-tomato:reminder-guide', 'shown'); } catch { /* Optional onboarding marker. */ }
  });

  $('#start-button').addEventListener('click', async () => {
    if (native && (nativeRestoring || nativeStatus.busy || nativeRestoreFailed)) return;
    tick(); initAudio();
    if (state.pending) { renderCompletion(); return; }
    if (state.timer.status === 'running') C.pause(state, Date.now()); else C.start(state, Date.now());
    if (state.pending) { completeRound(state.pending); return; }
    const saved = await save(); renderTimer();
    if (native && !saved) toast('手机提醒未能更新，请保持应用打开并检查提醒设置。');
    else if (native && state.timer.status === 'running' && !nativeStatus.ready) toast('正在计时，但息屏提醒未开启。请保持页面打开或开启提醒权限。');
  });
  $('#reset-button').addEventListener('click', () => {
    tick();
    if (state.pending) { renderCompletion(); return; }
    if (!isActive()) { toast('已经准备好了，点击开始就能专注。'); return; }
    requestConfirm('要重新开始这一轮吗？', '这一轮还没完成，不会计入收获。已经完成的番茄都会保留。', () => {
      C.reset(state); save(); renderTimer(); toast('重新准备好了，我们再来一次。');
    });
  });
  $$('.mode-tabs button').forEach(button => button.addEventListener('click', () => { tick(); if (!state.pending) switchMode(button.dataset.mode); }));
  $$('[data-duration]').forEach(button => button.addEventListener('click', () => {
    if (isActive() || state.pending) return;
    C.updateSettings(state, { focus: Number(button.dataset.duration) }); save(); renderTimer();
  }));
  $('#custom-duration').addEventListener('click', openSettings);
  $('#settings-button').addEventListener('click', openSettings);
  $('#sound-button').addEventListener('click', () => {
    state.settings.sound = !state.settings.sound;
    if (state.settings.sound) initAudio();
    save(); renderTimer(); toast(native ? (state.settings.sound ? '已选择铃声和振动，实际效果以手机通知设置为准。' : '已选择仅振动提醒，实际效果以手机通知设置为准。') : state.settings.sound ? '结束时会播放轻柔的提示音。' : '已关闭声音，结束时仍会弹窗提醒。');
  });
  $('#test-sound').addEventListener('click', () => chime(true));
  $('#settings-form').addEventListener('submit', async event => {
    event.preventDefault();
    const form = event.currentTarget;
    if (!form.reportValidity()) return;
    const values = Object.fromEntries(['focus', 'short', 'long', 'goal'].map(k => [k, Number(form.elements[k].value)]));
    values.sound = form.elements.sound.checked;
    values.notifications = native ? state.settings.notifications : false;
    let notificationMessage = '';
    if (!native && form.elements.notifications.checked && 'Notification' in window) {
      try {
        const permission = Notification.permission === 'default' ? await Notification.requestPermission() : Notification.permission;
        values.notifications = permission === 'granted';
        if (!values.notifications) notificationMessage = '桌面提醒尚未开启，结束时仍会弹窗提醒。';
      } catch { notificationMessage = '桌面提醒暂不可用，结束时仍会弹窗提醒。'; }
    }
    C.updateSettings(state, values); const saved = await save(); renderAll();
    closeDialog('#settings-dialog');
    toast(native && !saved ? '手机暂时无法保存提醒设置，请检查后重试。' : notificationMessage || (isActive() ? '设置已保存，新时长从下一轮生效。' : '设置已保存，找到适合自己的节奏。'));
  });
  $('#task-form').addEventListener('submit', event => {
    event.preventDefault();
    const title = $('#task-title').value.trim();
    if (!title) { toast('先写下一件小任务吧。'); $('#task-title').focus(); return; }
    if (!C.addTask(state, title, $('#task-subject').value)) { toast('任务已经很多啦，先完成或整理一些吧。'); return; }
    $('#task-title').value = ''; save(); renderTasks(); renderTimer(); $('#task-title').focus();
  });
  $('#task-list').addEventListener('click', event => {
    const button = event.target.closest('[data-task-action]');
    if (!button) return;
    tick();
    const id = button.closest('[data-task-id]').dataset.taskId;
    const task = state.tasks.find(task => task.id === id);
    if (!task) return;
    const action = button.dataset.taskAction;
    if (isActive() && state.timer.mode === 'focus' && (action === 'select' || state.timer.taskId === id)) {
      toast('先完成这一轮，或重新计时，再调整本轮小目标。'); return;
    }
    if (action === 'select') {
      state.selectedTaskId = task.id; save(); renderTasks(); renderTimer();
    } else if (action === 'toggle') {
      task.done = !task.done;
      if (task.done && state.selectedTaskId === id) state.selectedTaskId = state.tasks.find(t => !t.done)?.id || null;
      if (!task.done && !state.selectedTaskId) state.selectedTaskId = task.id;
      save(); renderTasks(); renderTimer(); toast(task.done ? '又完成了一件小事，真棒！' : '这项作业重新放回清单了。');
    } else if (action === 'delete') {
      requestConfirm('从清单里移除这项作业？', `「${task.title}」将从清单中移除，已经获得的番茄和专注记录都会保留。`, () => {
        state.tasks = state.tasks.filter(t => t.id !== id);
        if (state.selectedTaskId === id) state.selectedTaskId = state.tasks.find(t => !t.done)?.id || null;
        save(); renderTasks(); renderTimer();
      }, '移除任务');
      $('#confirm-cancel').textContent = '保留任务';
    }
  });
  $('#confirm-cancel').addEventListener('click', () => closeDialog('#confirm-dialog'));
  $('#confirm-accept').addEventListener('click', () => {
    const action = confirmAction; confirmAction = null;
    closeDialog('#confirm-dialog');
    tick();
    if (!state.pending) action?.();
  });
  $('#confirm-dialog').addEventListener('close', () => { $('#confirm-cancel').textContent = '继续当前一轮'; });
  $$('[data-close]').forEach(button => button.addEventListener('click', () => closeDialog(`#${button.dataset.close}`)));
  $('#complete-task-button').addEventListener('click', () => {
    const task = state.tasks.find(t => t.id === state.pending?.taskId);
    if (!task) return;
    task.done = true;
    if (state.selectedTaskId === task.id) state.selectedTaskId = state.tasks.find(t => !t.done)?.id || null;
    save(); renderTasks(); renderCompletion();
  });
  $('#next-round-button').addEventListener('click', async () => {
    if (!state.pending) return;
    const mode = state.pending.nextMode;
    C.reset(state, mode); C.start(state, Date.now()); initAudio();
    $('#next-round-button').disabled = true;
    await save(); closeDialog('#completion-dialog'); view('focus'); renderAll();
    $('#next-round-button').disabled = false;
    if (native && !nativeStatus.ready) toast('息屏提醒未开启，请保持页面打开或开启提醒权限。');
  });
  function dismissCompletion() {
    C.reset(state, 'focus'); save(); closeDialog('#completion-dialog'); renderAll();
  }
  $('#dismiss-completion').addEventListener('click', dismissCompletion);
  $('#completion-dialog').addEventListener('cancel', event => { event.preventDefault(); dismissCompletion(); });
  $('#zen-button').addEventListener('click', () => setZen(!zen));
  $('#exit-zen').addEventListener('click', () => setZen(false));
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && zen && !$('dialog[open]')) setZen(false); });
  document.addEventListener('click', event => {
    const button = event.target.closest('[data-view]');
    if (button) view(button.dataset.view);
  });
  $('.brand').addEventListener('click', event => { event.preventDefault(); view('focus'); });
  window.addEventListener('hashchange', () => view(location.hash === '#harvest' ? 'harvest' : 'focus'));
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { if (native) resumeNative('visible'); else tick(); } });
  window.addEventListener('pageshow', tick);
  window.addEventListener('storage', event => {
    if (native) return;
    if (event.key !== KEY || !event.newValue) return;
    try {
      state = C.hydrate(JSON.parse(event.newValue));
      if ($('#confirm-dialog').open) { closeDialog('#confirm-dialog'); confirmAction = null; }
      renderAll();
      if (state.pending) renderCompletion(); else closeDialog('#completion-dialog');
    } catch { /* Ignore malformed writes from other pages. */ }
  });

  renderAll(); view(!native && location.hash === '#harvest' ? 'harvest' : 'focus');
  const restored = C.tick(state, Date.now());
  if (restored) completeRound(restored, false);
  else if (state.pending) renderCompletion();
  if (native && !nativeRestoreFailed) await save();
  if (native) {
    let seen = false;
    try { seen = localStorage.getItem('little-tomato:reminder-guide') === 'shown'; } catch { /* Show the guide if storage is blocked. */ }
    if (nativeRestoreFailed || (!seen && !nativeStatus.ready && !state.pending)) openReminders();
  }
  setInterval(tick, 250);
})();
