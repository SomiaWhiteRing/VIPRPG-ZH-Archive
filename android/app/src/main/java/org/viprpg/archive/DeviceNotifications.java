package org.viprpg.archive;

import android.Manifest;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.os.Build;
import android.provider.Settings;
import android.util.Log;
import android.webkit.CookieManager;
import android.webkit.WebView;

import androidx.webkit.JavaScriptReplyProxy;
import androidx.webkit.WebMessageCompat;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;
import androidx.work.Constraints;
import androidx.work.ExistingPeriodicWorkPolicy;
import androidx.work.NetworkType;
import androidx.work.PeriodicWorkRequest;
import androidx.work.WorkManager;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.Arrays;
import java.util.Collections;
import java.util.List;
import java.util.Objects;
import java.util.concurrent.TimeUnit;

final class DeviceNotifications {
    static final String API_PATH = "/api/inbox/device-notifications";
    static final String OPEN_ACTION = "org.viprpg.archive.OPEN_NOTIFICATION";
    static final String INBOX_CHANNEL = "inbox";
    static final String MESSAGE_CHANNEL = "messages";
    static final String ACTIVE_USER = "activeUser";
    static final String LAST_FOREGROUND_AT = "lastForegroundAt";
    static final int PERMISSION_REQUEST = 1005;
    private static final String WORK_NAME = "device-notification-check";
    private static final String PERMISSION_REQUESTED = "permissionRequested";
    private static final List<String> CATEGORIES = Arrays.asList("comments", "replies", "forum", "likes", "friends", "messages", "system");

    private final MainActivity activity;
    private final SharedPreferences preferences;
    private JavaScriptReplyProxy permissionReply;
    private String permissionReplyId;
    private String observedSession;

    DeviceNotifications(MainActivity activity, WebView browser) {
        this.activity = activity;
        preferences = preferences(activity);
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) return;
        WebViewCompat.addWebMessageListener(browser, "VIPRPGNotifications", Collections.singleton(BuildConfig.SITE_ORIGIN),
            (view, message, origin, mainFrame, reply) -> {
                if (!mainFrame || message.getType() != WebMessageCompat.TYPE_STRING) return;
                String raw = message.getData();
                if (raw == null || raw.length() > 4096) return;
                String id = "";
                try {
                    JSONObject request = new JSONObject(raw);
                    id = request.getString("id");
                    switch (request.getString("action")) {
                        case "state" -> respond(reply, id, state(request.getLong("userId")));
                        case "save" -> {
                            long user = request.getLong("userId");
                            save(user, request);
                            respond(reply, id, state(user));
                        }
                        case "permission" -> {
                            String permission = permission();
                            if ("default".equals(permission) && permissionReply == null) {
                                permissionReply = reply;
                                permissionReplyId = id;
                                activity.requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, PERMISSION_REQUEST);
                            } else respond(reply, id, permission);
                        }
                        case "openSettings" -> {
                            activity.startActivity(new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
                                .putExtra(Settings.EXTRA_APP_PACKAGE, activity.getPackageName()));
                            respond(reply, id, true);
                        }
                        default -> respond(reply, id, null);
                    }
                } catch (JSONException | RuntimeException error) {
                    Log.w("VipNotifications", "Notification settings operation failed", error);
                    respond(reply, id, null);
                }
            });
    }

    static SharedPreferences preferences(Context context) {
        return context.getSharedPreferences("device-notifications", Context.MODE_PRIVATE);
    }

    static NotificationManager manager(Context context) {
        return context.getSystemService(NotificationManager.class);
    }

    static String sessionCookie() {
        String cookies = CookieManager.getInstance().getCookie(BuildConfig.SITE_ORIGIN + API_PATH);
        if (cookies == null) return null;
        String prefix = "viprpg_session=";
        for (String part : cookies.split(";")) {
            String cookie = part.trim();
            if (cookie.startsWith(prefix) && cookie.length() > prefix.length()) return cookie;
        }
        return null;
    }

    void foregroundChanged(boolean foreground) {
        synchronized (DeviceNotifications.class) {
            preferences.edit().putLong(LAST_FOREGROUND_AT, System.currentTimeMillis()).apply();
            if (foreground) syncSessionSchedule(true);
        }
    }

    void syncSessionSchedule(boolean enteringForeground) {
        synchronized (DeviceNotifications.class) {
            long user = preferences.getLong(ACTIVE_USER, 0);
            if (user == 0 || !manager(activity).areNotificationsEnabled()) return;
            try {
                JSONObject state = new JSONObject(preferences.getString(Long.toString(user), "{}"));
                if (!state.optBoolean("enabled")) return;
                String session = sessionCookie();
                if (!enteringForeground && Objects.equals(observedSession, session)) return;
                observedSession = session;
                if (session == null) clear(activity, user);
                schedule(session != null);
            } catch (JSONException error) {
                Log.w("VipNotifications", "Unable to restore notification schedule", error);
            }
        }
    }

    private String permission() {
        if (Build.VERSION.SDK_INT >= 33 && activity.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            return !preferences.getBoolean(PERMISSION_REQUESTED, false)
                || activity.shouldShowRequestPermissionRationale(Manifest.permission.POST_NOTIFICATIONS) ? "default" : "denied";
        }
        return manager(activity).areNotificationsEnabled() ? "granted" : "denied";
    }

    void permissionResult(boolean answered) {
        if (permissionReply == null) return;
        if (answered) preferences.edit().putBoolean(PERMISSION_REQUESTED, true).apply();
        respond(permissionReply, permissionReplyId, permission());
        permissionReply = null;
        permissionReplyId = null;
    }

    private JSONObject state(long user) throws JSONException {
        synchronized (DeviceNotifications.class) {
            long previousUser = preferences.getLong(ACTIVE_USER, 0);
            JSONObject saved = new JSONObject(preferences.getString(Long.toString(user), "{}"));
            boolean enabled = saved.optBoolean("enabled");
            if (previousUser != user) {
                clear(activity, previousUser);
                preferences.edit().putLong(ACTIVE_USER, user).apply();
                schedule(enabled && manager(activity).areNotificationsEnabled());
            }
            return new JSONObject().put("enabled", enabled).put("permission", permission())
                .put("categories", saved.optJSONArray("categories") == null ? JSONObject.NULL : saved.getJSONArray("categories"));
        }
    }

    private void save(long user, JSONObject request) throws JSONException {
        boolean enabled = request.getBoolean("enabled");
        JSONArray categories = request.getJSONArray("categories");
        if (categories.length() > CATEGORIES.size()) throw new JSONException("Invalid categories");
        for (int i = 0; i < categories.length(); i++) {
            if (!CATEGORIES.contains(categories.getString(i))) throw new JSONException("Invalid category");
        }
        JSONObject saved = new JSONObject().put("enabled", enabled).put("categories", categories);
        JSONObject position = enabled ? request.getJSONObject("position") : null;
        if (enabled) {
            if (position.getLong("userId") != user || !"granted".equals(permission())) throw new JSONException("Notifications unavailable");
            saved.put("sessionId", position.getLong("sessionId"));
            saved.put("inboxAfter", position.getLong("inboxAfter"));
            saved.put("messageAfter", position.getLong("messageAfter"));
            CookieManager.getInstance().flush();
            observedSession = sessionCookie();
            manager(activity).createNotificationChannels(Arrays.asList(
                new NotificationChannel(INBOX_CHANNEL, "提醒", NotificationManager.IMPORTANCE_DEFAULT),
                new NotificationChannel(MESSAGE_CHANNEL, "私信", NotificationManager.IMPORTANCE_DEFAULT)));
        }
        synchronized (DeviceNotifications.class) {
            long previousUser = preferences.getLong(ACTIVE_USER, 0);
            if (previousUser != user || !enabled) clear(activity, previousUser);
            String key = Long.toString(user);
            JSONObject previous = new JSONObject(preferences.getString(key, "{}"));
            if (enabled && previous.optBoolean("enabled") && previous.optLong("sessionId") == saved.getLong("sessionId")
                && categories.toString().equals(previous.getJSONArray("categories").toString())) saved = previous;
            preferences.edit().putLong(ACTIVE_USER, user).putString(key, saved.toString()).apply();
            schedule(enabled);
        }
    }

    private void schedule(boolean enabled) {
        WorkManager work = WorkManager.getInstance(activity);
        if (!enabled) {
            work.cancelUniqueWork(WORK_NAME);
            return;
        }
        PeriodicWorkRequest check = new PeriodicWorkRequest.Builder(NotificationCheckWorker.class, 30, TimeUnit.MINUTES)
            .setInitialDelay(30, TimeUnit.MINUTES)
            .setConstraints(new Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
            .build();
        work.enqueueUniquePeriodicWork(WORK_NAME, ExistingPeriodicWorkPolicy.KEEP, check);
    }

    static void clear(Context context, long user) {
        NotificationManager manager = manager(context);
        for (android.service.notification.StatusBarNotification notification : manager.getActiveNotifications()) {
            String tag = notification.getTag();
            if (tag != null && tag.startsWith("device:" + user + ":")) manager.cancel(tag, notification.getId());
        }
    }

    static String target(Intent intent) {
        if (intent == null || !OPEN_ACTION.equals(intent.getAction())) return null;
        String path = intent.getStringExtra("notificationPath");
        return path != null && path.matches("/(inbox|me/messages)/[1-9][0-9]*") ? BuildConfig.SITE_ORIGIN + path : null;
    }

    private static void respond(JavaScriptReplyProxy reply, String id, Object value) {
        try {
            JSONObject response = new JSONObject().put("id", id).put("ok", value != null);
            if (value != null) response.put("value", value);
            reply.postMessage(response.toString());
        } catch (JSONException | IllegalStateException ignored) { /* The requesting page may have closed. */ }
    }
}
