package org.viprpg.archive;

import android.net.Uri;
import android.os.ParcelFileDescriptor;
import android.webkit.*;
import androidx.webkit.*;
import java.io.*;
import java.util.*;
import java.util.concurrent.*;
import org.json.*;

/** Main-frame, origin-scoped commands; opaque per-session read capability for player workers. */
final class LocalGames {
    private final MainActivity activity;
    final GameStore store;
    private final ExecutorService io = Executors.newSingleThreadExecutor();
    private volatile Session session;
    private static final class Session {
        final String token = UUID.randomUUID().toString(); final Uri zip; final long workId;
        Session(Uri zip, long workId) { this.zip = zip; this.workId = workId; }
    }
    LocalGames(MainActivity activity, WebView online, WebView offline) {
        this.activity = activity; store = GameStore.get(activity);
        attach(online, false); attach(offline, true);
    }
    private void attach(WebView web, boolean offline) {
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) return;
        WebViewCompat.addWebMessageListener(web, "VIPRPGLocal", Collections.singleton(BuildConfig.SITE_ORIGIN), (view, message, origin, main, reply) -> {
            if (!main || message.getType() != WebMessageCompat.TYPE_STRING) return;
            if (offline && !activity.isScreenshotPage(view)) return;
            String raw = message.getData(); if (raw == null || raw.length() > 64 * 1024 * 1024) return;
            io.execute(() -> {
                String id = "";
                try {
                    JSONObject request = new JSONObject(raw); id = request.getString("id");
                    if (id.isEmpty() || id.length() > 100) throw new IOException("请求编号无效。");
                    String action = request.getString("action"); Object value;
                    switch (action) {
                        case "list": value = new JSONObject(store.snapshot()); break;
                        case "install": {
                            JSONObject task = store.enqueue(request.getLong("archiveVersionId"), request);
                            value = new JSONObject(task.toString());
                            activity.runOnUiThread(() -> activity.installQueued(task)); break;
                        }
                        case "open": {
                            JSONObject task = request.has("archiveVersionId") ? store.find(request.getLong("archiveVersionId")) : null;
                            if (request.has("archiveVersionId") && (task == null || !"ready".equals(task.optString("status")))) throw new IOException("游戏尚未安装完成。");
                            String key = task == null ? null : task.getString("playKey");
                            activity.runOnUiThread(() -> activity.openLocalLibrary(key)); value = true; break;
                        }
                        case "pendingPlay": {
                            if (!offline) throw new IOException("无效操作。");
                            value = activity.pendingLocalPlay; activity.pendingLocalPlay = null; break;
                        }
                        case "start": {
                            if (!offline) throw new IOException("请从本地游戏启动。");
                            JSONObject task = store.start(request.getString("key"));
                            Uri folder = store.folder(task, false);
                            Session next = new Session(store.storage.child(folder, "game.zip", "application/zip", false), task.getLong("workId"));
                            JSONObject index = store.storage.json(store.storage.child(folder, "index.json", "application/json", false));
                            JSONArray files = index.getJSONArray("files");
                            if (files.length() > 50000) throw new IOException("游戏索引过大。");
                            Set<String> paths = new HashSet<>();
                            for (int i = 0; i < files.length(); i++) {
                                JSONObject file = files.getJSONObject(i); String path = file.getString("filename");
                                if (path.isEmpty() || path.startsWith("/") || path.contains("\\") || path.contains(":") || path.indexOf('\0') >= 0
                                    || Arrays.asList(path.split("/", -1)).contains("..") || Arrays.asList(path.split("/", -1)).contains(".")
                                    || Arrays.asList(path.split("/", -1)).contains("") || !paths.add(path.toLowerCase(Locale.ROOT))
                                    || file.getLong("start") < 0 || file.getLong("end") < file.getLong("start")) throw new IOException("游戏索引无效，请重新安装。");
                            }
                            JSONObject saves = store.storage.loadSaves(next.workId);
                            session = next;
                            value = new JSONObject().put("installation", task).put("files", index.getJSONArray("files"))
                                .put("url", BuildConfig.SITE_ORIGIN + "/_native/read/" + next.token).put("saves", saves); break;
                        }
                        case "save": {
                            Session current = session;
                            if (!offline || current == null || !request.getString("url").endsWith("/" + current.token)) throw new IOException("游玩会话已失效。");
                            store.storage.save(current.workId, request.getJSONObject("files")); value = true; break;
                        }
                        case "stop": if (!offline) throw new IOException("无效操作。"); session = null; store.playingKey = null; value = true; break;
                        default: throw new IOException("未知本地操作。");
                    }
                    respond(reply, id, value, null);
                } catch (Exception error) {
                    if (session == null) store.playingKey = null;
                    respond(reply, id, null, error.getMessage() == null ? "本地文件操作失败。" : error.getMessage());
                }
            });
        });
    }
    private void respond(JavaScriptReplyProxy reply, String id, Object value, String error) {
        try {
            String json = new JSONObject().put("id", id).put("ok", error == null).put("value", value).put("error", error).toString();
            activity.runOnUiThread(() -> { if (!activity.isDestroyed()) try { reply.postMessage(json); } catch (Exception ignored) { } });
        } catch (Exception ignored) { }
    }
    WebResourceResponse read(WebResourceRequest request) {
        Uri url = request.getUrl();
        try {
            Session current = session;
            if (current == null || !("/_native/read/" + current.token).equals(url.getPath())) throw new IOException("会话不存在。");
            long start = Long.parseLong(url.getQueryParameter("start")); int size = Integer.parseInt(url.getQueryParameter("size"));
            if ("1".equals(url.getQueryParameter("media"))) {
                if (start < 0 || size < 0 || size > 1024 * 1024 * 1024) throw new IOException("视频读取范围无效。");
                long from = 0, to = size - 1;
                String range = request.getRequestHeaders().get("Range");
                if (range == null) range = request.getRequestHeaders().get("range");
                if (range != null) {
                    if (!range.matches("bytes=[0-9]+-[0-9]*")) throw new IOException("视频范围无效。");
                    String[] values = range.substring(6).split("-", -1); from = Long.parseLong(values[0]);
                    if (!values[1].isEmpty()) to = Math.min(to, Long.parseLong(values[1]));
                    if (from > to) throw new IOException("视频读取越界。");
                }
                ParcelFileDescriptor descriptor = store.storage.open(current.zip, "r");
                FileInputStream input = new ParcelFileDescriptor.AutoCloseInputStream(descriptor);
                try {
                    if (start > input.getChannel().size() - size) throw new IOException("视频读取越界。");
                    input.getChannel().position(start + from);
                } catch (Exception e) { input.close(); throw e; }
                final long length = to - from + 1;
                InputStream bounded = new FilterInputStream(input) {
                    long remaining = length;
                    @Override public int read() throws IOException { if (remaining == 0) return -1; int value = super.read(); if (value >= 0) remaining--; return value; }
                    @Override public int read(byte[] bytes, int offset, int count) throws IOException {
                        if (remaining == 0) return -1; int n = in.read(bytes, offset, (int)Math.min(count, remaining)); if (n > 0) remaining -= n; return n;
                    }
                };
                Map<String, String> headers = new HashMap<>(); headers.put("Accept-Ranges", "bytes"); headers.put("Content-Length", Long.toString(length)); headers.put("Cache-Control", "no-store");
                if (range != null) headers.put("Content-Range", "bytes " + from + "-" + to + "/" + size);
                return new WebResourceResponse("application/octet-stream", null, range == null ? 200 : 206, range == null ? "OK" : "Partial Content", headers, bounded);
            }
            if (start < 0 || size < 0 || size > 16 * 1024 * 1024) throw new IOException("读取范围无效。");
            byte[] bytes = new byte[size];
            try (ParcelFileDescriptor descriptor = store.storage.open(current.zip, "r");
                 FileInputStream in = new ParcelFileDescriptor.AutoCloseInputStream(descriptor)) {
                if (start > in.getChannel().size() - size) throw new IOException("读取越界。");
                in.getChannel().position(start); int offset = 0, n;
                while (offset < size && (n = in.read(bytes, offset, size - offset)) > 0) offset += n;
                if (offset != size) throw new IOException("文件读取不完整。");
            }
            return new WebResourceResponse("application/octet-stream", null, 200, "OK", Collections.singletonMap("Cache-Control", "no-store"), new ByteArrayInputStream(bytes));
        } catch (Exception failure) {
            return new WebResourceResponse("text/plain", "UTF-8", 400, "Read failed", Collections.emptyMap(), new ByteArrayInputStream(new byte[0]));
        }
    }
    void close() { store.playingKey = null; session = null; io.shutdownNow(); }
}
