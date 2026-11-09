package com.littletomato.focus;

/** Pure policy shared by registration and delivery, independent of Android lifecycle. */
final class ReminderRules {
    private ReminderRules() {}
    static String key(String id, long deadline) { return id + "@" + deadline; }
    static boolean canDeliver(String expected, String incoming, String delivered, long deadline, long now) {
        return expected != null && !expected.isEmpty() && expected.equals(incoming)
            && !expected.equals(delivered) && deadline > 0 && deadline <= now;
    }
    static boolean isFutureRunning(String status, String id, long deadline, long now) {
        return "running".equals(status) && id != null && !id.isEmpty() && deadline > now;
    }
}
