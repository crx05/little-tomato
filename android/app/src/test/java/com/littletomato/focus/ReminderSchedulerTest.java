package com.littletomato.focus;

import static org.junit.Assert.*;
import static org.robolectric.Shadows.shadowOf;
import android.app.AlarmManager;
import android.app.NotificationManager;
import android.content.Context;
import org.json.JSONObject;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.annotation.Config;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = 28)
public class ReminderSchedulerTest {
    private Context context;
    private long now;
    @Before public void setup() {
        context = RuntimeEnvironment.getApplication();
        ReminderScheduler.prefs(context).edit().clear().commit();
        now = System.currentTimeMillis();
    }
    private String snapshot(String state, String id, long deadline) throws Exception {
        return new JSONObject().put("version", 1).put("settings", new JSONObject().put("sound", true))
            .put("timer", new JSONObject().put("status", state).put("mode", "focus").put("id", id)
                .put("endAt", state.equals("running") ? deadline : JSONObject.NULL)).toString();
    }
    private AlarmManager alarms() { return (AlarmManager) context.getSystemService(Context.ALARM_SERVICE); }
    private NotificationManager notices() { return (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE); }

    @Test public void pauseCancelsAndResumeReplacesDeadline() throws Exception {
        ReminderScheduler.sync(context, snapshot("running", "one", now + 60000), now);
        assertEquals(1, shadowOf(alarms()).getScheduledAlarms().size());
        ReminderScheduler.sync(context, snapshot("paused", "one", 0), now + 1000);
        assertEquals(0, shadowOf(alarms()).getScheduledAlarms().size());
        ReminderScheduler.sync(context, snapshot("running", "one", now + 90000), now + 2000);
        assertEquals(1, shadowOf(alarms()).getScheduledAlarms().size());
        assertFalse(ReminderScheduler.deliver(context, ReminderRules.key("one", now + 60000), now + 60000));
    }
    @Test public void systemDeliveryAndForegroundCompletionProduceOneNotification() throws Exception {
        String key = ReminderRules.key("one", now + 60000);
        ReminderScheduler.sync(context, snapshot("running", "one", now + 60000), now);
        assertTrue(ReminderScheduler.deliver(context, key, now + 60000));
        assertFalse(ReminderScheduler.deliver(context, key, now + 60001));
        ReminderScheduler.sync(context, snapshot("complete", "one", 0), now + 60002);
        assertEquals(1, shadowOf(notices()).getAllNotifications().size());
    }
    @Test public void foregroundCompletionCannotCancelTheOnlyReminderBeforeBroadcastDispatch() throws Exception {
        ReminderScheduler.sync(context, snapshot("running", "one", now + 60000), now);
        ReminderScheduler.sync(context, snapshot("complete", "one", 0), now + 60000);
        assertEquals(1, shadowOf(notices()).getAllNotifications().size());
        assertFalse(ReminderScheduler.deliver(context, ReminderRules.key("one", now + 60000), now + 60000));
    }
    @Test public void resetInvalidatesAnAlreadyQueuedOldBroadcast() throws Exception {
        ReminderScheduler.sync(context, snapshot("running", "one", now + 60000), now);
        ReminderScheduler.sync(context, snapshot("idle", "", 0), now + 1000);
        assertFalse(ReminderScheduler.deliver(context, ReminderRules.key("one", now + 60000), now + 60000));
        assertEquals(0, shadowOf(notices()).getAllNotifications().size());
    }
    @Test public void rebootRestoresTheOneOutstandingAlarmWithoutReplayingCompletedOnes() throws Exception {
        String data = snapshot("running", "one", now + 60000);
        ReminderScheduler.sync(context, data, now);
        ReminderScheduler.restore(context, now + 1000);
        assertEquals(1, shadowOf(alarms()).getScheduledAlarms().size());
        assertEquals(data, ReminderScheduler.load(context));
        assertTrue(ReminderScheduler.deliver(context, ReminderRules.key("one", now + 60000), now + 60000));
        ReminderScheduler.restore(context, now + 100000);
        assertEquals(1, shadowOf(notices()).getAllNotifications().size());
    }
    @Test public void deniedNotificationsPersistTheTimerWithoutPretendingToRegisterAnAlarm() throws Exception {
        shadowOf(notices()).setNotificationsEnabled(false);
        String data = snapshot("running", "one", now + 60000);
        assertFalse(ReminderScheduler.sync(context, data, now).getBoolean("ready"));
        assertEquals(data, ReminderScheduler.load(context));
        assertEquals(0, shadowOf(alarms()).getScheduledAlarms().size());
    }
    @Test @Config(sdk = 31) public void deniedExactAlarmPermissionDoesNotSilentlyUseAnInexactAlarm() throws Exception {
        shadowOf(alarms()).setCanScheduleExactAlarms(false);
        assertFalse(ReminderScheduler.sync(context, snapshot("running", "one", now + 60000), now).getBoolean("ready"));
        assertEquals(0, shadowOf(alarms()).getScheduledAlarms().size());
    }
}
