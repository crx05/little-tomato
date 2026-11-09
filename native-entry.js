import { Capacitor, registerPlugin } from '@capacitor/core';

if (Capacitor.getPlatform() === 'android') {
  window.TomatoNative = registerPlugin('TomatoReminder');
  document.documentElement.classList.add('android-app');
}
