package org.viprpg.archive;

import android.app.*;
import android.content.*;
import android.os.*;
import org.json.JSONObject;
import java.util.concurrent.*;

/** Foreground lifetime is independent of the Activity/WebView. Journal survives process death. */
public final class InstallService extends Service {
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private boolean running;
    private volatile boolean closing;
    private GameStore store;
    static void start(Context context) {
        try { context.startForegroundService(new Intent(context, InstallService.class)); }
        catch (IllegalStateException restricted) {
            // The user may have backgrounded the Activity between enqueue and this callback.
            // Keep the durable queued task; onResume starts it when foreground launch is permitted.
        }
    }
    @Override public void onCreate() {
        super.onCreate(); store = GameStore.get(this);
        getSystemService(NotificationManager.class).createNotificationChannel(new NotificationChannel("installs", "游戏安装", NotificationManager.IMPORTANCE_LOW));
        store.progress = task -> {
            long total = task.optLong("downloadBytesTotal");
            String percent = total > 0 ? " · " + Math.min(100, task.optLong("downloadedBytes") * 100 / total) + "%" : "";
            getSystemService(NotificationManager.class).notify(31, notification(task.optString("title") + percent));
        };
    }
    private Notification notification(String text) {
        PendingIntent open = PendingIntent.getActivity(this, 0, new Intent(this, MainActivity.class).putExtra("library", true), PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        return new Notification.Builder(this, "installs").setSmallIcon(android.R.drawable.stat_sys_download)
            .setContentTitle("安装本地游戏").setContentText(text).setContentIntent(open).setOngoing(true).build();
    }
    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        startForeground(31, notification("正在准备下载…"));
        if (!running) {
            running = true;
            worker.execute(() -> {
                PowerManager.WakeLock wake = getSystemService(PowerManager.class).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "viprpg:install");
                wake.acquire(6 * 60 * 60 * 1000L);
                try {
                    JSONObject task;
                    while ((task = store.next()) != null && !Thread.currentThread().isInterrupted()) {
                        store.begin(task);
                        try {
                            getSystemService(NotificationManager.class).notify(31, notification(task.optString("title")));
                            for (int attempt = 0; ; attempt++) {
                                try { store.install(task); break; }
                                catch (java.net.SocketTimeoutException | java.net.ConnectException | java.net.UnknownHostException transientFailure) {
                                    if (attempt >= 2) throw transientFailure;
                                    store.check(task); Thread.sleep(1500L * (attempt + 1));
                                }
                            }
                        } catch (Exception e) {
                            try { store.update(task, "failed", e.getMessage() == null ? "安装失败，请重试。" : e.getMessage()); } catch (Exception ignored) { }
                        } finally { store.finish(task); }
                    }
                } finally {
                    if (wake.isHeld()) wake.release();
                    new Handler(getMainLooper()).post(() -> {
                        running = false;
                        if (closing) return;
                        if (store.next() != null) onStartCommand(null, 0, startId);
                        else { stopForeground(STOP_FOREGROUND_REMOVE); stopSelf(); }
                    });
                }
            });
        }
        return START_STICKY;
    }
    @Override public void onTimeout(int startId, int fgsType) { closing = true; worker.shutdownNow(); stopSelf(); }
    @Override public void onDestroy() { closing = true; store.progress = null; worker.shutdownNow(); super.onDestroy(); }
    @Override public IBinder onBind(Intent intent) { return null; }
}
