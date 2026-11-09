package com.littletomato.focus;

import android.annotation.SuppressLint;
import android.app.AlarmManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.media.AudioAttributes;
import android.media.RingtoneManager;
import android.os.Build;
import android.util.Log;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import com.getcapacitor.JSObject;
import org.json.JSONException;
import org.json.JSONObject;

/** One durable alarm, independent of the WebView and of the app process lifetime. */
final class ReminderScheduler {
    static final String PREFS = "little_tomato_native_v1";
    static final String ACTION_REMIND = "com.littletomato.focus.REMIND";
    static final String CHANNEL_SOUND = "tomato_sound_v1";
    static final String CHANNEL_QUIET = "tomato_vibrate_v1";
    static final int NOTICE_ID = 31001;
    private static final int PREVIEW_ID = 31002;
    private static final Object LOCK = new Object();

    private ReminderScheduler() {}
    static SharedPreferences prefs(Context context) { return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE); }
    private static AlarmManager alarms(Context context) { return (AlarmManager) context.getSystemService(Context.ALARM_SERVICE); }
    private static NotificationManager notices(Context context) { return (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE); }
    static String load(Context context) { synchronized (LOCK) { return prefs(context).getString("snapshot", null); } }

    static void createChannels(Context context) {
        NotificationManager manager = notices(context);
        if (manager.getNotificationChannel(CHANNEL_SOUND) == null) {
            NotificationChannel sound = new NotificationChannel(CHANNEL_SOUND, "番茄提醒 · 铃声和振动", NotificationManager.IMPORTANCE_HIGH);
            sound.setDescription("专注和休息结束时提醒一次");
            sound.enableVibration(true);
            sound.setVibrationPattern(new long[]{0, 180, 100, 180});
            sound.setSound(RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION),
                new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_NOTIFICATION).setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build());
            manager.createNotificationChannel(sound);
        }
        if (manager.getNotificationChannel(CHANNEL_QUIET) == null) {
            NotificationChannel quiet = new NotificationChannel(CHANNEL_QUIET, "番茄提醒 · 仅振动", NotificationManager.IMPORTANCE_HIGH);
            quiet.setDescription("关闭 App 提示音时使用，可在系统设置中调整");
            quiet.enableVibration(true);
            quiet.setVibrationPattern(new long[]{0, 180, 100, 180});
            quiet.setSound(null, null);
            manager.createNotificationChannel(quiet);
        }
    }

    private static boolean exactAllowed(Context context) {
        return Build.VERSION.SDK_INT < Build.VERSION_CODES.S || alarms(context).canScheduleExactAlarms();
    }
    private static boolean soundEnabled(SharedPreferences preferences) {
        try { return new JSONObject(preferences.getString("snapshot", "{}")).optJSONObject("settings").optBoolean("sound", true); }
        catch (Exception ignored) { return true; }
    }
    static JSObject status(Context context) {
        synchronized (LOCK) {
            createChannels(context);
            SharedPreferences preferences = prefs(context);
            boolean enabled = NotificationManagerCompat.from(context).areNotificationsEnabled();
            boolean exact = exactAllowed(context);
            NotificationChannel channel = notices(context).getNotificationChannel(soundEnabled(preferences) ? CHANNEL_SOUND : CHANNEL_QUIET);
            boolean channelEnabled = channel != null && channel.getImportance() != NotificationManager.IMPORTANCE_NONE;
            JSObject result = new JSObject();
            result.put("notifications", enabled);
            result.put("exact", exact);
            result.put("channelEnabled", channelEnabled);
            result.put("ready", enabled && exact && channelEnabled);
            result.put("scheduled", enabled && exact && channelEnabled && preferences.getBoolean("scheduled", false));
            result.put("scheduledKey", preferences.getString("alarmKey", ""));
            result.put("permissionPrompted", preferences.getBoolean("permissionPrompted", false));
            return result;
        }
    }

    private static JSONObject validate(String snapshot) throws JSONException {
        if (snapshot == null || snapshot.length() > 2_000_000) throw new JSONException("记录大小无效");
        JSONObject value = new JSONObject(snapshot);
        if (value.optInt("version") != 1) throw new JSONException("不支持的记录版本");
        JSONObject timer = value.getJSONObject("timer");
        value.getJSONObject("settings");
        String state = timer.getString("status");
        String mode = timer.getString("mode");
        if (!(state.equals("idle") || state.equals("running") || state.equals("paused") || state.equals("complete"))) throw new JSONException("无效计时状态");
        if (!(mode.equals("focus") || mode.equals("short") || mode.equals("long"))) throw new JSONException("无效计时模式");
        if (state.equals("running") && (timer.optString("id", "").isEmpty() || timer.getLong("endAt") <= 0)) throw new JSONException("无效结束时间");
        return value;
    }

    private static Intent alarmIntent(Context context) {
        return new Intent(context, ReminderReceiver.class).setAction(ACTION_REMIND);
    }
    private static void cancel(Context context, boolean removeNotice) {
        PendingIntent intent = PendingIntent.getBroadcast(context, NOTICE_ID, alarmIntent(context), PendingIntent.FLAG_NO_CREATE | PendingIntent.FLAG_IMMUTABLE);
        if (intent != null) { alarms(context).cancel(intent); intent.cancel(); }
        prefs(context).edit().remove("alarmKey").remove("activeId").remove("deadline").remove("mode").remove("sound").putBoolean("scheduled", false).commit();
        if (removeNotice) notices(context).cancel(NOTICE_ID);
    }

    @SuppressLint("ScheduleExactAlarm") // Checked immediately before registration; revocation races are caught.
    static JSObject sync(Context context, String snapshot, long now) throws JSONException {
        JSONObject value = validate(snapshot);
        synchronized (LOCK) {
            SharedPreferences preferences = prefs(context);
            if (!preferences.edit().putString("snapshot", snapshot).commit()) throw new IllegalStateException("手机暂时无法保存记录");
            JSONObject timer = value.getJSONObject("timer");
            String state = timer.getString("status");
            String id = timer.optString("id", "");
            long deadline = timer.optLong("endAt", 0);
            String previous = preferences.getString("alarmKey", "");
            if ("complete".equals(state)) {
                // JS may reach zero just before Android dispatches the broadcast. Deliver via
                // this same native path, then invalidate that broadcast rather than losing it.
                if (id.equals(preferences.getString("activeId", ""))) deliver(context, previous, now);
                cancel(context, false);
                return status(context);
            }
            if (!ReminderRules.isFutureRunning(state, id, deadline, now)) {
                if ("running".equals(state) && id.equals(preferences.getString("activeId", ""))) deliver(context, previous, now);
                cancel(context, !"running".equals(state));
                return status(context);
            }
            JSObject availability = status(context);
            if (!availability.optBoolean("ready")) { cancel(context, true); return status(context); }
            String key = ReminderRules.key(id, deadline);
            boolean sound = value.getJSONObject("settings").optBoolean("sound", true);
            String mode = timer.getString("mode");
            if (key.equals(previous) && preferences.getBoolean("scheduled", false)
                && preferences.getBoolean("sound", true) == sound && mode.equals(preferences.getString("mode", ""))) return status(context);

            cancel(context, true);
            if (!preferences.edit().putString("alarmKey", key).putString("activeId", id).putLong("deadline", deadline)
                .putString("mode", mode).putBoolean("sound", sound).putBoolean("scheduled", true).commit()) {
                throw new IllegalStateException("未能保存系统提醒");
            }
            PendingIntent operation = PendingIntent.getBroadcast(context, NOTICE_ID,
                alarmIntent(context).putExtra("alarmKey", key), PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
            try {
                alarms(context).setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, deadline, operation);
            } catch (SecurityException error) {
                cancel(context, true);
                throw new IllegalStateException("精确提醒权限已改变，请重新开启", error);
            } catch (RuntimeException error) {
                cancel(context, true);
                throw error;
            }
            return status(context);
        }
    }

    @SuppressLint("MissingPermission") // The native permission and channel checks precede notify().
    static boolean deliver(Context context, String incomingKey, long now) {
        synchronized (LOCK) {
            SharedPreferences preferences = prefs(context);
            String expected = preferences.getString("alarmKey", "");
            if (!ReminderRules.canDeliver(expected, incomingKey, preferences.getString("deliveredKey", ""), preferences.getLong("deadline", 0), now)) return false;
            boolean sound = preferences.getBoolean("sound", true);
            String mode = preferences.getString("mode", "focus");
            // Mark before posting so a subsequent foreground tick cannot ring a second time.
            if (!preferences.edit().putString("deliveredKey", expected).putBoolean("scheduled", false).commit()) return false;
            createChannels(context);
            NotificationChannel channel = notices(context).getNotificationChannel(sound ? CHANNEL_SOUND : CHANNEL_QUIET);
            if (!NotificationManagerCompat.from(context).areNotificationsEnabled() || channel == null || channel.getImportance() == NotificationManager.IMPORTANCE_NONE) return false;
            boolean focus = mode.equals("focus");
            try {
                notices(context).notify(NOTICE_ID, notification(context, sound, expected,
                    focus ? "这一轮，你做到了！" : "休息结束，准备好了吗？",
                    focus ? "收获一颗小番茄。喝口水、伸伸懒腰吧。" : "回到小番茄，开始下一小段专注。"));
                return true;
            } catch (SecurityException error) {
                Log.w("LittleTomato", "Notification permission changed before delivery");
                return false;
            }
        }
    }

    private static Notification notification(Context context, boolean sound, String key, String title, String message) {
        Intent intent = new Intent(context, MainActivity.class).setAction(Intent.ACTION_MAIN)
            .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP)
            .putExtra("tomatoNotification", true).putExtra("alarmKey", key);
        PendingIntent content = PendingIntent.getActivity(context, NOTICE_ID, intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        return new NotificationCompat.Builder(context, sound ? CHANNEL_SOUND : CHANNEL_QUIET)
            .setSmallIcon(R.drawable.ic_stat_tomato).setColor(0xffb94c35).setContentTitle(title).setContentText(message)
            .setContentIntent(content).setAutoCancel(true).setOnlyAlertOnce(true)
            .setCategory(NotificationCompat.CATEGORY_REMINDER).setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setPriority(NotificationCompat.PRIORITY_HIGH).build();
    }

    @SuppressLint("MissingPermission")
    static void preview(Context context) {
        synchronized (LOCK) {
            JSObject availability = status(context);
            if (!availability.optBoolean("notifications") || !availability.optBoolean("channelEnabled")) throw new IllegalStateException("请先允许小番茄发送通知");
            notices(context).cancel(PREVIEW_ID);
            notices(context).notify(PREVIEW_ID, notification(context, soundEnabled(prefs(context)), "preview", "这就是小番茄的提醒", "到点后会这样提醒你。声音和振动以系统设置为准。"));
        }
    }

    static void restore(Context context, long now) {
        synchronized (LOCK) {
            String snapshot = load(context);
            if (snapshot == null) return;
            // Android clears alarms on reboot and exact-alarm permission changes.
            prefs(context).edit().putBoolean("scheduled", false).commit();
            try { sync(context, snapshot, now); }
            catch (Exception error) { cancel(context, false); Log.w("LittleTomato", "Reminder could not be restored", error); }
        }
    }
}
