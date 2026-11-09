package com.littletomato.focus;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

public class ReminderReceiver extends BroadcastReceiver {
    @Override public void onReceive(Context context, Intent intent) {
        if (!ReminderScheduler.ACTION_REMIND.equals(intent.getAction())) return;
        ReminderScheduler.deliver(context, intent.getStringExtra("alarmKey"), System.currentTimeMillis());
    }
}
