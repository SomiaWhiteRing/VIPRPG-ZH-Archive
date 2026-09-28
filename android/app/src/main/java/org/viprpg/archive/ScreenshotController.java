package org.viprpg.archive;

import android.app.Activity;
import android.content.ClipData;
import android.content.Intent;
import android.net.Uri;
import android.provider.DocumentsContract;
import android.webkit.WebView;

import androidx.webkit.JavaScriptReplyProxy;
import androidx.webkit.WebMessageCompat;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;
import org.json.JSONObject;
import java.io.IOException;
import java.time.Instant;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;

/** The website may prepare a directory and save PNGs. Listing/deletion stay native. */
final class ScreenshotController {
    private static final int DIRECTORY_REQUEST = 1002;
    private final MainActivity activity;
    final ScreenshotStore store;
    private final ExecutorService io = Executors.newSingleThreadExecutor();
    private final AtomicBoolean cancelled = new AtomicBoolean();
    private Callback<Boolean> directoryCallback;
    private boolean busy;
    private boolean closed;

    interface Task<T> { T run() throws Exception; }
    interface Callback<T> { void done(T value, String error); }
    interface Progress { void update(int done, int total); }

    ScreenshotController(MainActivity activity, WebView browser, WebView offlineBrowser) {
        this.activity = activity;
        store = new ScreenshotStore(activity);
        if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            attach(browser, true);
            attach(offlineBrowser, false);
        }
    }

    private void attach(WebView browser, boolean online) {
            WebViewCompat.addWebMessageListener(browser, "VIPRPGScreenshots", Collections.singleton(BuildConfig.SITE_ORIGIN),
                (view, message, sourceOrigin, isMainFrame, reply) -> {
                    if (!isMainFrame || !activity.isScreenshotPage(view)) return;
                    Uri trustedOrigin = Uri.parse(BuildConfig.SITE_ORIGIN);
                    if (!"https".equals(sourceOrigin.getScheme()) || !trustedOrigin.getHost().equalsIgnoreCase(sourceOrigin.getHost())
                        || (sourceOrigin.getPort() != -1 && sourceOrigin.getPort() != 443)) return;
                    if (message.getType() != WebMessageCompat.TYPE_STRING) return;
                    String raw = message.getData();
                    if (raw == null || raw.length() > ScreenshotStore.MAX_BYTES * 4 / 3 + 8192) return;
                    JSONObject request;
                    try { request = new JSONObject(raw); } catch (Exception invalid) { return; }
                    String id = request.optString("id");
                    if (id.isEmpty() || id.length() > 100) return;
                    switch (request.optString("action")) {
                        case "ensureDirectory":
                            ensureDirectory(false, (ready, error) -> reply(reply, id, ready, error));
                            break;
                        case "save":
                            if (busy) { reply(reply, id, null, "截图文件正在处理中，请稍后重试。"); return; }
                            busy = true;
                            execute(() -> {
                                long capturedAt = request.getLong("capturedAt");
                                if (capturedAt < 0 || capturedAt > System.currentTimeMillis() + 60_000) throw new IOException("截图时间无效。");
                                store.save(request, LocalDateTime.ofInstant(Instant.ofEpochMilli(capturedAt), ZoneId.systemDefault()));
                                return true;
                            }, (saved, error) -> { busy = false; reply(reply, id, saved, error); });
                            break;
                        case "playerState":
                            if (online)
                                activity.setOnlinePlaying(request.optBoolean("playing"));
                            reply(reply, id, true, null);
                            break;
                        default:
                            reply(reply, id, null, "不支持此截图操作，请更新客户端。");
                    }
                });
    }

    boolean isBusy() { return busy; }

    <T> void execute(Task<T> task, Callback<T> callback) {
        if (closed) return;
        io.execute(() -> {
            T value = null;
            String error = null;
            try { value = task.run(); }
            catch (Exception failure) { error = errorMessage(failure); }
            T result = value;
            String failure = error;
            activity.runOnUiThread(() -> {
                if (!closed && !activity.isDestroyed()) callback.done(result, failure);
            });
        });
    }

    void ensureDirectory(boolean change, Callback<Boolean> callback) {
        if (busy) { callback.done(false, "截图文件正在处理中，请稍后重试。"); return; }
        busy = true;
        execute(store::status, (directory, error) -> {
            if (error != null) { busy = false; callback.done(false, error); return; }
            if (!change && directory.ready) { busy = false; callback.done(true, null); return; }
            directoryCallback = callback;
            Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE)
                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION
                    | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION | Intent.FLAG_GRANT_PREFIX_URI_PERMISSION);
            Uri initial = store.initialDirectory();
            if (initial != null) intent.putExtra(DocumentsContract.EXTRA_INITIAL_URI, initial);
            try { activity.startActivityForResult(intent, DIRECTORY_REQUEST); }
            catch (Exception unavailable) { finishDirectory(false, "无法打开系统目录选择器。"); }
        });
    }

    boolean onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode != DIRECTORY_REQUEST) return false;
        // The activity may have been recreated while the system picker was open.
        if (directoryCallback == null) {
            busy = true;
            directoryCallback = (ready, error) -> activity.onScreenshotDirectoryResult(error);
        }
        if (resultCode != Activity.RESULT_OK || data == null || data.getData() == null) {
            finishDirectory(false, null);
        } else {
            execute(() -> { store.selectDirectory(data.getData(), data.getFlags()); return true; }, this::finishDirectory);
        }
        return true;
    }

    private void finishDirectory(Boolean success, String error) {
        Callback<Boolean> callback = directoryCallback;
        directoryCallback = null;
        busy = false;
        if (callback != null) callback.done(Boolean.TRUE.equals(success), error);
    }

    void batch(List<ScreenshotStore.Entry> items, boolean delete, Progress progress, Callback<BatchResult> callback) {
        if (busy) { callback.done(null, "截图文件正在处理中，请稍后重试。"); return; }
        busy = true;
        cancelled.set(false);
        List<ScreenshotStore.Entry> snapshot = new ArrayList<>(items);
        execute(() -> {
            BatchResult result = new BatchResult();
            for (int i = 0; i < snapshot.size(); i++) {
                if (cancelled.get() || Thread.currentThread().isInterrupted()) {
                    result.cancelled = true;
                    result.failed.addAll(snapshot.subList(i, snapshot.size()));
                    break;
                }
                ScreenshotStore.Entry entry = snapshot.get(i);
                try {
                    if (delete) store.delete(entry); else store.verifyReadable(entry);
                    result.succeeded.add(entry);
                } catch (Exception failure) {
                    result.failed.add(entry);
                    if (result.error == null) result.error = errorMessage(failure);
                }
                int done = i + 1;
                activity.runOnUiThread(() -> { if (!closed) progress.update(done, snapshot.size()); });
            }
            return result;
        }, (result, error) -> { busy = false; callback.done(result, error); });
    }

    void share(List<ScreenshotStore.Entry> items) throws Exception {
        if (items.isEmpty()) return;
        ArrayList<Uri> uris = new ArrayList<>();
        ClipData clip = new ClipData("游戏截图", new String[]{"image/png"}, new ClipData.Item(items.get(0).uri));
        for (int i = 0; i < items.size(); i++) {
            uris.add(items.get(i).uri);
            if (i > 0) clip.addItem(new ClipData.Item(items.get(i).uri));
        }
        Intent intent = new Intent(items.size() == 1 ? Intent.ACTION_SEND : Intent.ACTION_SEND_MULTIPLE)
            .setType("image/png").addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        if (items.size() == 1) intent.putExtra(Intent.EXTRA_STREAM, uris.get(0));
        else intent.putParcelableArrayListExtra(Intent.EXTRA_STREAM, uris);
        intent.setClipData(clip);
        activity.startActivity(Intent.createChooser(intent, "分享截图"));
    }

    void cancelBatch() { cancelled.set(true); }

    void close() {
        closed = true;
        directoryCallback = null;
        cancelled.set(true);
        io.shutdownNow();
    }

    private void reply(JavaScriptReplyProxy proxy, String id, Object value, String error) {
        if (closed || !WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) return;
        try {
            JSONObject result = new JSONObject().put("id", id).put("ok", error == null);
            if (error == null) result.put("value", value); else result.put("error", error);
            proxy.postMessage(result.toString());
        } catch (Exception stalePage) { /* Replies belong to the originating document, never its replacement. */ }
    }

    static String errorMessage(Exception failure) {
        if (failure instanceof SecurityException) return "截图目录授权已失效，请重新选择目录。";
        if (failure instanceof IOException && failure.getMessage() != null) return failure.getMessage();
        return "截图文件操作失败，请检查目录权限和剩余空间后重试。";
    }

    static final class BatchResult {
        final List<ScreenshotStore.Entry> succeeded = new ArrayList<>();
        final List<ScreenshotStore.Entry> failed = new ArrayList<>();
        String error;
        boolean cancelled;
    }
}
