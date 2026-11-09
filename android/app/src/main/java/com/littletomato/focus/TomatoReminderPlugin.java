package com.littletomato.focus;

import android.Manifest;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

@CapacitorPlugin(name = "TomatoReminder", permissions = {
    @Permission(alias = "notifications", strings = { Manifest.permission.POST_NOTIFICATIONS })
})
public class TomatoReminderPlugin extends Plugin {
    @PluginMethod public void load(PluginCall call) {
        JSObject result = new JSObject();
        result.put("snapshot", ReminderScheduler.load(getContext()));
        call.resolve(result);
    }
    @PluginMethod public void sync(PluginCall call) {
        try { call.resolve(ReminderScheduler.sync(getContext(), call.getString("snapshot"), System.currentTimeMillis())); }
        catch (Exception error) { call.reject("系统提醒未能保存：" + error.getMessage(), error); }
    }
    @PluginMethod public void status(PluginCall call) {
        try { call.resolve(ReminderScheduler.status(getContext())); }
        catch (Exception error) { call.reject("无法读取系统提醒状态", error); }
    }
    @PluginMethod public void requestNotifications(PluginCall call) {
        ReminderScheduler.prefs(getContext()).edit().putBoolean("permissionPrompted", true).commit();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) requestPermissionForAlias("notifications", call, "notificationPermissionResult");
        else call.resolve(ReminderScheduler.status(getContext()));
    }
    @PermissionCallback private void notificationPermissionResult(PluginCall call) {
        call.resolve(ReminderScheduler.status(getContext()));
    }
    @PluginMethod public void openSettings(PluginCall call) {
        String section = call.getString("section", "notifications");
        Intent intent;
        if ("exact".equals(section) && Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            intent = new Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM, Uri.parse("package:" + getContext().getPackageName()));
        } else {
            intent = new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, getContext().getPackageName());
        }
        try { getActivity().startActivity(intent); call.resolve(); }
        catch (Exception error) { call.reject("无法打开系统设置，请从手机设置中找到小番茄", error); }
    }
    @PluginMethod public void testReminder(PluginCall call) {
        try { ReminderScheduler.preview(getContext()); call.resolve(); }
        catch (Exception error) { call.reject(error.getMessage(), error); }
    }
    @Override protected void handleOnResume() {
        notifyListeners("resume", new JSObject());
    }
    @Override protected void handleOnNewIntent(Intent intent) {
        if (intent != null && intent.getBooleanExtra("tomatoNotification", false)) {
            JSObject result = new JSObject();
            result.put("key", intent.getStringExtra("alarmKey"));
            notifyListeners("notificationOpened", result, true);
        }
    }
}
