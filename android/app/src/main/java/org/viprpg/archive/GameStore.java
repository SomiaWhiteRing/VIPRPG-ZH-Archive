package org.viprpg.archive;

import android.content.Context;
import android.net.Uri;
import android.provider.DocumentsContract;
import android.util.AtomicFile;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.*;
import java.util.zip.CRC32;
import org.json.*;

/** Durable task journal is private; installed resources and completion records live in the selected tree. */
final class GameStore {
    private static GameStore instance;
    static synchronized GameStore get(Context context) { if (instance == null) instance = new GameStore(context.getApplicationContext()); return instance; }
    final LocalStorage storage;
    final Context context;
    private final AtomicFile journal;
    private JSONArray tasks;
    private final Set<JSONObject> active = Collections.newSetFromMap(new IdentityHashMap<>());
    volatile String playingKey;
    volatile Runnable changed;
    volatile java.util.function.Consumer<JSONObject> progress;
    private GameStore(Context context) {
        this.context = context; storage = new LocalStorage(context);
        journal = new AtomicFile(new File(context.getFilesDir(), "private-install-tasks.json"));
        try (InputStream in = journal.openRead()) { tasks = new JSONArray(new String(readStream(in, 8 * 1024 * 1024), StandardCharsets.UTF_8)); }
        catch (Exception missing) { tasks = new JSONArray(); }
        for (int i = 0; i < tasks.length(); i++) { JSONObject task = tasks.optJSONObject(i); if (task != null) { if ("installing".equals(task.optString("status")) || task.optBoolean("resumeRequested")) put(task, "status", "created"); task.remove("resumeRequested"); put(task, "bytesPerSecond", 0); } }
    }
    static void put(JSONObject object, String key, Object value) { try { object.put(key, value); } catch (JSONException impossible) { throw new IllegalArgumentException(impossible); } }
    synchronized void persist() throws IOException {
        FileOutputStream out = journal.startWrite();
        try { out.write(tasks.toString().getBytes(StandardCharsets.UTF_8)); journal.finishWrite(out); }
        catch (Exception e) { journal.failWrite(out); throw new IOException("任务状态保存失败。", e); }
        Runnable callback = changed; if (callback != null) callback.run();
        if (progress != null) for (int i = 0; i < tasks.length(); i++) {
            JSONObject task = tasks.optJSONObject(i); if ("installing".equals(task.optString("status"))) { progress.accept(task); break; }
        }
    }
    synchronized JSONObject find(long id) { for (int i = 0; i < tasks.length(); i++) if (tasks.optJSONObject(i).optLong("archiveVersionId") == id) return tasks.optJSONObject(i); return null; }
    synchronized JSONObject enqueue(long id) throws Exception { return enqueue(id, null); }
    synchronized JSONObject enqueue(long id, JSONObject preview) throws Exception {
        if (id <= 0) throw new IOException("版本编号无效。");
        if (!storage.ready()) throw new IOException("应用存储不可用，请检查剩余空间。");
        JSONObject task = find(id);
        if (task != null && active.contains(task) && "deleted".equals(task.optString("status"))) throw new IOException("正在取消上次安装，请稍后重试。");
        if (task != null && ("ready".equals(task.optString("status")) || "created".equals(task.optString("status")) || "installing".equals(task.optString("status")))) return task;
        if (task == null) { task = new JSONObject().put("archiveVersionId", id).put("playKey", "native-" + id).put("title", "版本 " + id); tasks.put(task); }
        if ("deleted".equals(task.optString("status"))) {
            task.put("downloadedBytes", 0).put("downloadBytesTotal", 0).remove("readyAt");
        }
        if (preview != null) {
            String hash = preview.optString("coverBlobSha256");
            if (hash.matches("[a-f0-9]{64}")) task.put("coverBlobSha256", hash);
            String data = preview.optString("coverDataUrl");
            if (hash.matches("[a-f0-9]{64}") && data.startsWith("data:image/jpeg;base64,") && data.length() <= 200000) {
                try {
                    byte[] image = android.util.Base64.decode(data.substring(data.indexOf(',') + 1), android.util.Base64.DEFAULT);
                    android.graphics.BitmapFactory.Options bounds = new android.graphics.BitmapFactory.Options(); bounds.inJustDecodeBounds = true;
                    android.graphics.BitmapFactory.decodeByteArray(image, 0, image.length, bounds);
                    if (bounds.outWidth > 0 && bounds.outHeight > 0 && bounds.outWidth <= 256 && bounds.outHeight <= 256)
                        try (FileOutputStream out = new FileOutputStream(new File(context.getCacheDir(), "cover-" + hash + ".jpg"))) { out.write(image); }
                } catch (Exception invalidPreview) { android.util.Log.w("GameStore", "Invalid cover preview", invalidPreview); }
            }
            String title = preview.optString("title"); if (!title.isEmpty() && title.length() <= 500) task.put("title", title);
            if (preview.optLong("workId") > 0) task.put("workId", preview.getLong("workId"));
        }
        if (active.contains(task)) { task.put("resumeRequested", true); persist(); return task; }
        task.put("status", "created").put("error", JSONObject.NULL).put("installedBytes", 0).put("bytesPerSecond", 0)
            .put("updatedAt", Instant.now().toString()); persist(); return task;
    }
    synchronized void toggleDownload(String key) throws Exception {
        JSONObject task = byKey(key); String status = task.optString("status");
        if ("ready".equals(status) || "deleted".equals(status)) return;
        if ("created".equals(status) || "installing".equals(status)) {
            task.put("status", "paused").put("bytesPerSecond", 0).remove("resumeRequested"); persist();
        } else enqueue(task.getLong("archiveVersionId"));
    }
    synchronized JSONObject next() { for (int i = 0; i < tasks.length(); i++) if ("created".equals(tasks.optJSONObject(i).optString("status"))) return tasks.optJSONObject(i); return null; }
    synchronized boolean busy() { return next() != null || !active.isEmpty(); }
    synchronized boolean writing() { return !active.isEmpty(); }
    synchronized void begin(JSONObject task) { active.add(task); }
    synchronized void finish(JSONObject task) {
        active.remove(task);
        if ("paused".equals(task.optString("status")) && task.optBoolean("resumeRequested")) {
            task.remove("resumeRequested"); put(task, "status", "created");
            try { persist(); } catch (IOException ignored) { }
        }
        if ("deleted".equals(task.optString("status"))) try { delete(task.getString("playKey")); } catch (Exception ignored) { }
    }
    synchronized void update(JSONObject task, String status, String error) throws Exception {
        if ("deleted".equals(task.optString("status")) || "paused".equals(task.optString("status"))) return;
        task.put("bytesPerSecond", 0).put("status", status).put("error", error == null ? JSONObject.NULL : error).put("updatedAt", Instant.now().toString()); persist();
    }
    synchronized void check(JSONObject task) throws IOException { if (Thread.currentThread().isInterrupted() || "deleted".equals(task.optString("status")) || "paused".equals(task.optString("status"))) throw new IOException("安装已取消。"); }
    synchronized String snapshot() throws Exception {
        JSONArray rows = new JSONArray(); long usage = 0;
        for (int i = 0; i < tasks.length(); i++) { JSONObject task = tasks.getJSONObject(i); if (!"deleted".equals(task.optString("status"))) { rows.put(task); usage += task.optLong("installedBytes"); } }
        return new JSONObject().put("items", rows).put("usage", usage).toString();
    }
    synchronized void reconcile() throws Exception {
        if (busy()) return;
        Map<String, Uri> folders = storage.children(storage.directory("games"));
        for (int i = 0; i < tasks.length(); i++) { JSONObject task = tasks.getJSONObject(i); if ("ready".equals(task.optString("status"))) task.put("status", "failed").put("error", "游戏目录不可用，请重新安装。"); }
        for (Map.Entry<String, Uri> entry : folders.entrySet()) {
            if (!entry.getKey().matches("[1-9][0-9]*")) continue;
            try {
                JSONObject installed = storage.json(storage.child(entry.getValue(), "installation.json", "application/json", false));
                if (!"ready".equals(installed.optString("status")) || !installed.optString("playKey").equals("native-" + installed.optLong("archiveVersionId"))) continue;
                if (storage.child(entry.getValue(), "game.zip", "application/zip", false) == null || storage.child(entry.getValue(), "index.json", "application/json", false) == null) continue;
                long id = installed.getLong("archiveVersionId"); if (!entry.getKey().equals(Long.toString(id))) continue;
                JSONObject old = find(id);
                if (old != null && "deleted".equals(old.optString("status"))) {
                    storage.delete(entry.getValue()); continue;
                }
                if (old != null && old.has("lastPlayedAt")) installed.put("lastPlayedAt", old.get("lastPlayedAt"));
                if (old != null) { for (int i = 0; i < tasks.length(); i++) if (tasks.getJSONObject(i) == old) tasks.put(i, installed); }
                else tasks.put(installed);
            } catch (Exception incomplete) { /* Incomplete folders are never published as installed games. */ }
        }
        persist();
    }
    synchronized void delete(String key) throws Exception {
        if (key.equals(playingKey)) throw new IOException("请先退出游戏。");
        JSONObject task = byKey(key); task.put("status", "deleted").remove("resumeRequested"); persist();
        if (active.contains(task)) return; // The writer cleans up after it observes cancellation.
        try {
            Uri folder = folder(task, false);
            if (folder != null) requireManaged(folder, task);
            if (folder != null && !storage.delete(folder)) throw new IOException("游戏文件未删除。");
        } catch (Exception e) { task.put("status", "failed").put("error", "删除失败：" + e.getMessage()); persist(); throw e; }
        File partial = new File(context.getCacheDir(), "game-" + task.getLong("archiveVersionId") + ".part"); partial.delete();
    }
    synchronized JSONObject byKey(String key) throws Exception {
        for (int i = 0; i < tasks.length(); i++) if (key.equals(tasks.getJSONObject(i).optString("playKey"))) return tasks.getJSONObject(i);
        throw new IOException("游戏不存在。");
    }
    Uri folder(JSONObject task, boolean create) throws Exception { return storage.child(storage.directory("games"), Long.toString(task.getLong("archiveVersionId")), DocumentsContract.Document.MIME_TYPE_DIR, create); }
    private void requireManaged(Uri folder, JSONObject task) throws Exception {
        Map<String, Uri> children = storage.children(folder);
        if (children.isEmpty()) return;
        for (String name : new String[]{"installation.json", ".viprpg-install.json"}) {
            Uri record = children.get(name); if (record == null) continue;
            try {
                JSONObject owner = storage.json(record);
                if (owner.optLong("archiveVersionId") == task.getLong("archiveVersionId") && task.getString("playKey").equals(owner.optString("playKey"))) return;
            } catch (Exception invalidMarker) { }
        }
        throw new IOException("安装记录损坏，无法覆盖现有游戏文件。");
    }
    synchronized JSONObject start(String key) throws Exception {
        if (playingKey != null && !playingKey.equals(key)) throw new IOException("请先退出当前游戏。");
        JSONObject task = byKey(key);
        if (!"ready".equals(task.optString("status"))) throw new IOException("游戏尚未安装完成。");
        storage.root(); playingKey = key; task.put("lastPlayedAt", Instant.now().toString()); persist(); return new JSONObject(task.toString());
    }
    HttpURLConnection connect(String path, long offset) throws Exception {
        URI url = new URI(BuildConfig.SITE_ORIGIN).resolve(path);
        URI origin = new URI(BuildConfig.SITE_ORIGIN);
        if (!"https".equals(url.getScheme()) || !origin.getHost().equals(url.getHost()) || url.getPort() != -1 || url.getUserInfo() != null) throw new IOException("下载地址无效。");
        HttpURLConnection connection = (HttpURLConnection) url.toURL().openConnection();
        connection.setInstanceFollowRedirects(false); connection.setConnectTimeout(20000); connection.setReadTimeout(30000); connection.setRequestProperty("Accept-Encoding", "identity");
        if (offset > 0) connection.setRequestProperty("Range", "bytes=" + offset + "-");
        return connection;
    }
    static byte[] readStream(InputStream in, int limit) throws IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream(); byte[] buffer = new byte[65536]; int n;
        while ((n = in.read(buffer)) != -1) { if (out.size() + n > limit) throw new IOException("响应过大。"); out.write(buffer, 0, n); } return out.toByteArray();
    }
    void install(JSONObject task) throws Exception {
        long id = task.getLong("archiveVersionId");
        HttpURLConnection metadataRequest = connect("/api/archive-versions/" + id + "/web-play", 0);
        JSONObject metadata;
        try { if (metadataRequest.getResponseCode() != 200) throw new IOException("读取版本信息失败（" + metadataRequest.getResponseCode() + "）。");
            try (InputStream in = metadataRequest.getInputStream()) { metadata = new JSONObject(new String(readStream(in, 1048576), StandardCharsets.UTF_8)); }
        } finally { metadataRequest.disconnect(); }
        if (metadata.getLong("archiveVersionId") != id || metadata.getLong("workId") <= 0 || !metadata.getString("manifestSha256").matches("[a-f0-9]{64}")
            || !Arrays.asList("rpg_maker_2000", "rpg_maker_2003", "rpg_maker_2003_maniac").contains(metadata.optString("engineFamily"))
            || metadata.getLong("installTotalSizeBytes") < 1 || metadata.getLong("installTotalSizeBytes") > 1024L * 1024 * 1024
            || metadata.getInt("installTotalFiles") < 1 || metadata.getInt("installTotalFiles") > 50000) throw new IOException("此版本不支持本地安装。");
        File partial = new File(context.getCacheDir(), "game-" + id + ".part");
        if (!metadata.optString("manifestSha256").equals(task.optString("manifestSha256")) || !metadata.optString("downloadUrl").equals(task.optString("downloadUrl"))) partial.delete();
        synchronized (this) {
            check(task);
            for (String field : new String[]{"workId", "title", "manifestSha256", "coverBlobSha256", "engineFamily", "downloadUrl", "installTotalSizeBytes", "installTotalFiles"}) task.put(field, metadata.opt(field));
            update(task, "installing", null);
        }
        long offset = partial.length(); HttpURLConnection download = connect(metadata.getString("downloadUrl"), offset);
        try {
            int code = download.getResponseCode();
            if (offset > 0 && code != 206) { download.disconnect(); offset = 0; download = connect(metadata.getString("downloadUrl"), 0); code = download.getResponseCode(); }
            if (code != 200 && code != 206) throw new IOException("游戏下载失败（" + code + "）。");
            if (code == 206 && (download.getHeaderField("Content-Range") == null || !download.getHeaderField("Content-Range").startsWith("bytes " + offset + "-"))) throw new IOException("续传范围无效。");
            long length = download.getContentLengthLong(); long total = length < 0 ? metadata.getLong("installTotalSizeBytes") : offset + length;
            synchronized (this) { check(task); task.put("downloadedBytes", offset).put("downloadBytesTotal", total).put("bytesPerSecond", 0); persist(); }
            try (InputStream in = download.getInputStream(); FileOutputStream out = new FileOutputStream(partial, offset > 0)) {
                byte[] bytes = new byte[262144]; int n; long count = offset, emitted = android.os.SystemClock.elapsedRealtime(), previousCount = offset;
                while ((n = in.read(bytes)) != -1) { check(task); out.write(bytes, 0, n); count += n;
                    if (count > 1200L * 1024 * 1024) throw new IOException("下载文件超出大小限制。");
                    long now = android.os.SystemClock.elapsedRealtime();
                    if (now - emitted >= 500) { synchronized(this) { check(task); task.put("downloadedBytes", count).put("downloadBytesTotal", total).put("bytesPerSecond", (count - previousCount) * 1000 / (now - emitted)); persist(); } emitted = now; previousCount = count; }
                }
                out.getFD().sync(); if (length >= 0 && count != offset + length) throw new IOException("下载文件不完整。");
                synchronized (this) { check(task); task.put("bytesPerSecond", 0).put("downloadedBytes", count).put("downloadBytesTotal", count); persist(); }
            }
        } finally { download.disconnect(); }
        check(task);
        JSONArray index;
        try { index = indexZip(partial, task); } catch (Exception invalid) { check(task); partial.delete(); throw invalid; }
        Uri folder = folder(task, true);
        requireManaged(folder, task);
        storage.write(storage.child(folder, ".viprpg-install.json", "application/json", true), new JSONObject()
            .put("archiveVersionId", id).put("playKey", task.getString("playKey")).toString().getBytes(StandardCharsets.UTF_8));
        Uri marker = storage.child(folder, "installation.json", "application/json", false);
        if (marker != null) storage.delete(marker);
        Uri zip = storage.child(folder, "game.zip", "application/zip", true);
        java.security.MessageDigest digest = java.security.MessageDigest.getInstance("SHA-256");
        try (InputStream in = new FileInputStream(partial); android.os.ParcelFileDescriptor descriptor = storage.open(zip, "rwt");
            FileOutputStream out = new android.os.ParcelFileDescriptor.AutoCloseOutputStream(descriptor)) {
            byte[] bytes = new byte[262144]; int n;
            while ((n = in.read(bytes)) != -1) { check(task); out.write(bytes, 0, n); digest.update(bytes, 0, n); } out.getFD().sync();
        }
        byte[] expected = digest.digest(); digest.reset();
        try (InputStream in = storage.input(zip)) { byte[] bytes = new byte[262144]; int n; while ((n = in.read(bytes)) != -1) { check(task); digest.update(bytes, 0, n); } }
        if (!Arrays.equals(expected, digest.digest())) throw new IOException("目录写入校验失败。");
        storage.write(storage.child(folder, "index.json", "application/json", true), new JSONObject().put("files", index).toString().getBytes(StandardCharsets.UTF_8));
        synchronized (this) {
            check(task); task.put("bytesPerSecond", 0).put("installedBytes", metadata.getLong("installTotalSizeBytes")).put("readyAt", Instant.now().toString()).put("status", "ready");
            try { storage.write(storage.child(folder, "installation.json", "application/json", true), task.toString().getBytes(StandardCharsets.UTF_8)); persist(); }
            catch (Exception e) { task.put("status", "failed"); throw e; }
        }
        partial.delete();
        File cover = new File(context.getCacheDir(), "cover-" + task.optString("coverBlobSha256") + ".jpg");
        if (cover.isFile()) try (InputStream in = new FileInputStream(cover)) {
            storage.write(storage.child(folder, "cover.jpg", "image/jpeg", true), readStream(in, 150000));
        } catch (Exception optionalCover) { }
        reportInstalledPlay(task.getLong("workId"));
    }
    private void reportInstalledPlay(long workId) {
        try {
            HttpURLConnection request = connect("/api/works/" + workId + "/played", 0);
            try {
                request.setConnectTimeout(10000); request.setReadTimeout(10000);
                request.setRequestMethod("POST"); request.setRequestProperty("Origin", BuildConfig.SITE_ORIGIN);
                request.setRequestProperty("User-Agent", android.webkit.WebSettings.getDefaultUserAgent(context));
                String cookies = android.webkit.CookieManager.getInstance().getCookie(BuildConfig.SITE_ORIGIN);
                if (cookies != null) request.setRequestProperty("Cookie", cookies);
                request.setDoOutput(true); request.setFixedLengthStreamingMode(0);
                request.getOutputStream().close();
                if (request.getResponseCode() != 204) throw new IOException("安装统计上报失败（" + request.getResponseCode() + "）。");
            } finally { request.disconnect(); }
        } catch (Exception unavailable) {
            // Counting is independent of a completed installation and never runs on game launch.
            android.util.Log.w("GameStore", "Installation play report unavailable", unavailable);
        }
    }
    private void cacheCover(JSONObject task) {
        String hash = task.optString("coverBlobSha256");
        if (!hash.matches("[a-f0-9]{64}")) return;
        try {
            HttpURLConnection connection = connect("/api/media/blobs/" + hash, 0);
            try {
                if (connection.getResponseCode() != 200) return;
                byte[] bytes; try (InputStream in = connection.getInputStream()) { bytes = readStream(in, 8 * 1024 * 1024); }
                android.graphics.BitmapFactory.Options bounds = new android.graphics.BitmapFactory.Options(); bounds.inJustDecodeBounds = true;
                android.graphics.BitmapFactory.decodeByteArray(bytes, 0, bytes.length, bounds);
                if (bounds.outWidth < 1 || bounds.outHeight < 1) return;
                bounds.inJustDecodeBounds = false; bounds.inSampleSize = 1;
                while (Math.max(bounds.outWidth, bounds.outHeight) / bounds.inSampleSize > 256) bounds.inSampleSize *= 2;
                android.graphics.Bitmap bitmap = android.graphics.BitmapFactory.decodeByteArray(bytes, 0, bytes.length, bounds);
                if (bitmap == null) return;
                ByteArrayOutputStream out = new ByteArrayOutputStream(); bitmap.compress(android.graphics.Bitmap.CompressFormat.JPEG, 80, out); bitmap.recycle();
                File target = new File(context.getCacheDir(), "cover-" + hash + ".jpg");
                try (FileOutputStream file = new FileOutputStream(target)) { file.write(out.toByteArray()); }
                Runnable callback = changed; if (callback != null) callback.run();
            } finally { connection.disconnect(); }
        } catch (Exception optionalCover) { android.util.Log.w("GameStore", "Cover download failed", optionalCover); }
    }
    String cover(String key) throws Exception {
        JSONObject task; synchronized (this) { task = new JSONObject(byKey(key).toString()); }
        String hash = task.optString("coverBlobSha256"); if (!hash.matches("[a-f0-9]{64}")) return null;
        File file = new File(context.getCacheDir(), "cover-" + hash + ".jpg");
        if (!file.isFile()) {
            try {
                Uri folder = folder(task, false);
                Uri saved = folder == null ? null : storage.child(folder, "cover.jpg", "image/jpeg", false);
                if (saved != null) return "data:image/jpeg;base64," + android.util.Base64.encodeToString(storage.read(saved, 150000), android.util.Base64.NO_WRAP);
            } catch (Exception missingCover) { }
            cacheCover(task);
        }
        if (!file.isFile()) return null;
        try (InputStream in = new FileInputStream(file)) {
            return "data:image/jpeg;base64," + android.util.Base64.encodeToString(readStream(in, 150000), android.util.Base64.NO_WRAP);
        }
    }
    private JSONArray indexZip(File source, JSONObject metadata) throws Exception {
        JSONArray files = new JSONArray(); Set<String> paths = new HashSet<>(); long total = 0, archiveTotal = 0;
        try (RandomAccessFile zip = new RandomAccessFile(source, "r")) {
            while (true) {
                check(metadata); long signature = Integer.toUnsignedLong(Integer.reverseBytes(zip.readInt()));
                if (signature == 0x02014b50L || signature == 0x06054b50L) break;
                if (signature != 0x04034b50L) throw new IOException("ZIP 结构无效。");
                zip.skipBytes(2); int flags = Short.toUnsignedInt(Short.reverseBytes(zip.readShort())); int method = Short.toUnsignedInt(Short.reverseBytes(zip.readShort())); zip.skipBytes(4);
                long crc = Integer.toUnsignedLong(Integer.reverseBytes(zip.readInt())); long size = Integer.toUnsignedLong(Integer.reverseBytes(zip.readInt())); long unpacked = Integer.toUnsignedLong(Integer.reverseBytes(zip.readInt()));
                int nameSize = Short.toUnsignedInt(Short.reverseBytes(zip.readShort())), extra = Short.toUnsignedInt(Short.reverseBytes(zip.readShort()));
                if ((flags & 9) != 0 || method != 0 || size != unpacked) throw new IOException("ZIP 格式不受支持。");
                byte[] name = new byte[nameSize]; zip.readFully(name); zip.skipBytes(extra); String path = new String(name, StandardCharsets.UTF_8).replace('\\', '/');
                String checkedPath = path.endsWith("/") ? path.substring(0, path.length() - 1) : path;
                List<String> segments = Arrays.asList(checkedPath.split("/", -1));
                if (segments.contains("") || segments.contains(".") || segments.contains("..") || path.contains(":") || path.indexOf('\0') >= 0) throw new IOException("游戏路径无效。");
                long start = zip.getFilePointer(); CRC32 sum = new CRC32(); byte[] buffer = new byte[262144]; long left = size;
                while (left > 0) { check(metadata); int n = zip.read(buffer, 0, (int)Math.min(left, buffer.length)); if (n < 0) throw new IOException("ZIP 不完整。"); sum.update(buffer, 0, n); left -= n; }
                if (sum.getValue() != crc) throw new IOException("游戏文件校验失败：" + path);
                if (path.endsWith("/")) continue;
                if (!paths.add(path.toLowerCase(Locale.ROOT))) throw new IOException("游戏文件路径重复。");
                archiveTotal += size;
                if (paths.size() > 50000 || archiveTotal > 1024L * 1024 * 1024) throw new IOException("游戏过大。");
                if (shouldSkipLocalInstallFile(path)) continue;
                files.put(new JSONObject().put("filename", path).put("start", start).put("end", start + size)); total += size;
            }
        }
        if (files.length() != metadata.getInt("installTotalFiles") || total != metadata.getLong("installTotalSizeBytes")) throw new IOException("游戏文件数量或大小与版本信息不一致。");
        return files;
    }
    // Keep aligned with lib/archive/web-play-local-policy.ts: metadata counts only runtime files.
    // Root DLLs used for engine/patch detection must remain in the runtime index.
    private static boolean shouldSkipLocalInstallFile(String path) {
        String lower = path.toLowerCase(Locale.ROOT);
        switch (lower) {
            case "accord.dll": case "ultimate_rt_eb.dll": case "harmony.dll":
            case "dynloader.dll": case "destiny.dll": return false;
            default:
                String name = lower.substring(lower.lastIndexOf('/') + 1);
                return name.endsWith(".dll") || name.endsWith(".exe") || name.endsWith(".txt");
        }
    }
}
