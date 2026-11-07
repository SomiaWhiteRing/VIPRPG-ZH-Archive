package org.viprpg.archive;

import android.app.Notification;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.util.Log;

import androidx.annotation.NonNull;
import androidx.work.Worker;
import androidx.work.WorkerParameters;
import androidx.work.WorkManager;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.IOException;
import java.net.HttpURLConnection;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.util.Objects;
import java.util.StringJoiner;
import java.util.concurrent.TimeUnit;

public final class NotificationCheckWorker extends Worker {
    public NotificationCheckWorker(@NonNull Context context, @NonNull WorkerParameters params) {
        super(context, params);
    }

    @NonNull @Override public Result doWork() {
        Context context = getApplicationContext();
        SharedPreferences preferences = DeviceNotifications.preferences(context);
        synchronized (DeviceNotifications.class) {
            long lastForeground = preferences.getLong(DeviceNotifications.LAST_FOREGROUND_AT, 0);
            if (lastForeground == 0 || System.currentTimeMillis() - lastForeground >= TimeUnit.DAYS.toMillis(7)) {
                WorkManager.getInstance(context).cancelWorkById(getId());
                return Result.success();
            }
        }
        long user = preferences.getLong(DeviceNotifications.ACTIVE_USER, 0);
        String key = Long.toString(user);
        String snapshot = preferences.getString(key, "{}");
        NotificationManager manager = DeviceNotifications.manager(context);
        if (user == 0 || !manager.areNotificationsEnabled()) return Result.success();
        try {
            JSONObject state = new JSONObject(snapshot);
            if (!state.optBoolean("enabled")) return Result.success();
            JSONArray categories = state.getJSONArray("categories");
            if (categories.length() == 0) return Result.success();
            StringJoiner selected = new StringJoiner(",");
            for (int i = 0; i < categories.length(); i++) selected.add(categories.getString(i));

            String endpoint = BuildConfig.SITE_ORIGIN + DeviceNotifications.API_PATH;
            // Bound the work after a long offline period. Remaining pages can be fetched on the next run.
            for (int page = 0; page < 4 && !isStopped(); page++) {
                String cookie = DeviceNotifications.sessionCookie();
                JSONObject response = cookie == null ? null : fetch(endpoint, cookie, state, selected.toString());
                synchronized (DeviceNotifications.class) {
                    if (isStopped() || preferences.getLong(DeviceNotifications.ACTIVE_USER, 0) != user
                        || !snapshot.equals(preferences.getString(key, "{}"))
                        || !Objects.equals(cookie, DeviceNotifications.sessionCookie()) || !manager.areNotificationsEnabled()) return Result.success();
                    if (response == null || response.getLong("userId") != user) {
                        DeviceNotifications.clear(context, user);
                        WorkManager.getInstance(context).cancelWorkById(getId());
                        return Result.success();
                    }
                    long session = response.getLong("sessionId");
                    if (session != state.getLong("sessionId")) DeviceNotifications.clear(context, user);
                    else {
                        JSONArray items = response.getJSONArray("items");
                        for (int i = 0; i < items.length(); i++) show(context, manager, user, items.getJSONObject(i));
                    }
                    state.put("sessionId", session).put("inboxAfter", response.getLong("inboxAfter"))
                        .put("messageAfter", response.getLong("messageAfter"));
                    snapshot = state.toString();
                    if (!preferences.edit().putString(key, snapshot).commit()) return Result.retry();
                }
                if (!response.getBoolean("more")) break;
            }
            return Result.success();
        } catch (IOException error) {
            return getRunAttemptCount() < 2 ? Result.retry() : Result.success();
        } catch (JSONException | RuntimeException error) {
            Log.w("VipNotifications", "Notification check failed", error);
            return Result.success();
        }
    }

    private JSONObject fetch(String endpoint, String cookie, JSONObject state, String categories) throws IOException, JSONException {
        Uri url = Uri.parse(endpoint).buildUpon()
            .appendQueryParameter("sessionId", state.getString("sessionId"))
            .appendQueryParameter("inboxAfter", state.getString("inboxAfter"))
            .appendQueryParameter("messageAfter", state.getString("messageAfter"))
            .appendQueryParameter("categories", categories).build();
        HttpURLConnection connection = (HttpURLConnection) URI.create(url.toString()).toURL().openConnection();
        connection.setInstanceFollowRedirects(false);
        connection.setConnectTimeout(10_000);
        connection.setReadTimeout(15_000);
        connection.setRequestProperty("Accept", "application/json");
        connection.setRequestProperty("Cookie", cookie);
        try {
            int status = connection.getResponseCode();
            if (status == 401) return null;
            if (status != 200) throw new IOException("Notification check HTTP " + status);
            try (java.io.InputStream stream = connection.getInputStream()) {
                return new JSONObject(new String(GameStore.readStream(stream, 128 * 1024), StandardCharsets.UTF_8));
            }
        } finally {
            connection.disconnect();
        }
    }

    private void show(Context context, NotificationManager manager, long user, JSONObject item) throws JSONException {
        String tag = "device:" + user + ":" + item.getString("id");
        String channel = "messages".equals(item.getString("group")) ? DeviceNotifications.MESSAGE_CHANNEL : DeviceNotifications.INBOX_CHANNEL;
        Intent intent = new Intent(context, MainActivity.class).setAction(DeviceNotifications.OPEN_ACTION)
            .setIdentifier(tag).putExtra("notificationPath", item.getString("url"))
            .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent click = PendingIntent.getActivity(context, 0, intent, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        String body = item.getString("body");
        manager.notify(tag, 0, new Notification.Builder(context, channel)
            .setSmallIcon(R.drawable.ic_notification).setContentTitle(item.getString("title")).setContentText(body)
            .setStyle(new Notification.BigTextStyle().bigText(body)).setWhen(item.getLong("timestamp"))
            .setContentIntent(click).setVisibility(Notification.VISIBILITY_PRIVATE).setAutoCancel(true).setOnlyAlertOnce(true).build());
    }
}
