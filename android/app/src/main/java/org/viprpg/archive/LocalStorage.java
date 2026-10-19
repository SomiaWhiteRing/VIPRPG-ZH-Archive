package org.viprpg.archive;

import android.content.*;
import android.database.Cursor;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import android.provider.DocumentsContract;
import android.provider.DocumentsContract.Document;
import android.util.JsonReader;
import android.util.JsonToken;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.security.DigestInputStream;
import java.security.MessageDigest;
import java.text.Normalizer;
import java.util.*;
import org.json.*;

/** App-owned persistent storage. Old selected trees are intentionally untouched. */
final class LocalStorage {
    private final File base;
    private boolean warnedSharedConfig;
    LocalStorage(Context context) { base = new File(context.getFilesDir(), "local-" + Uri.parse(BuildConfig.SITE_ORIGIN).getHost()); }
    File file(Uri uri) throws IOException {
        if (uri == null || !"file".equals(uri.getScheme())) throw new IOException("文件路径无效。");
        File value = new File(uri.getPath()).getCanonicalFile();
        if (!value.toPath().startsWith(base.getCanonicalFile().toPath())) throw new IOException("文件路径越界。");
        return value;
    }
    boolean ready() { try { root(); return true; } catch (IOException e) { return false; } }
    Uri root() throws IOException { if (!base.isDirectory() && !base.mkdirs()) throw new IOException("无法创建应用数据目录。"); return Uri.fromFile(base); }
    Uri directory(String name) throws IOException { return child(root(), name, Document.MIME_TYPE_DIR, true); }
    Uri child(Uri parent, String name, String mime, boolean create) throws IOException {
        if (name.isEmpty() || name.contains("/") || name.contains("\\") || name.equals("..") || name.equals(".")) throw new IOException("文件名无效。");
        File target = new File(file(parent), name); file(Uri.fromFile(target));
        boolean dir = Document.MIME_TYPE_DIR.equals(mime);
        if (target.exists()) { if (dir != target.isDirectory()) throw new IOException("文件类型冲突。"); }
        else if (!create) return null;
        else if (dir ? !target.mkdirs() : !target.createNewFile()) throw new IOException("无法创建文件。");
        return Uri.fromFile(target);
    }
    Map<String, Uri> children(Uri parent) throws IOException {
        Map<String, Uri> result = new HashMap<>(); File[] files = file(parent).listFiles();
        if (files == null) throw new IOException("无法读取目录。");
        for (File child : files) result.put(child.getName(), Uri.fromFile(child)); return result;
    }
    InputStream input(Uri uri) throws IOException { return new FileInputStream(file(uri)); }
    ParcelFileDescriptor open(Uri uri, String mode) throws IOException { return ParcelFileDescriptor.open(file(uri), ParcelFileDescriptor.parseMode(mode)); }
    boolean delete(Uri uri) throws IOException {
        File target = file(uri);
        if (target.isDirectory()) for (Uri child : children(uri).values()) delete(child);
        return !target.exists() || target.delete();
    }
    byte[] read(Uri uri, int limit) throws IOException {
        try (InputStream in = input(uri)) { return GameStore.readStream(in, limit); }
    }
    void write(Uri uri, byte[] bytes) throws IOException {
        android.util.AtomicFile atomic = new android.util.AtomicFile(file(uri));
        FileOutputStream out = atomic.startWrite();
        try { out.write(bytes); atomic.finishWrite(out); } catch (Exception e) { atomic.failWrite(out); throw new IOException("写入失败。", e); }
    }
    JSONObject json(Uri uri) throws Exception { return new JSONObject(new String(read(uri, 64 * 1024 * 1024), StandardCharsets.UTF_8)); }
    static String hash(byte[] bytes) throws Exception {
        return hex(MessageDigest.getInstance("SHA-256").digest(bytes));
    }
    private static String hex(byte[] digest) {
        StringBuilder result = new StringBuilder();
        for (byte b : digest) result.append(String.format(Locale.ROOT, "%02x", b & 255)); return result.toString();
    }
    private static final class Generation {
        final JSONObject data;
        final boolean upgraded;
        final String name;
        Generation(JSONObject data, boolean upgraded, String name) { this.data = data; this.upgraded = upgraded; this.name = name; }
    }
    private static Object readValue(JsonReader reader) throws Exception {
        switch (reader.peek()) {
            case BEGIN_OBJECT: {
                JSONObject value = new JSONObject(); reader.beginObject();
                while (reader.hasNext()) value.put(reader.nextName(), readValue(reader));
                reader.endObject(); return value;
            }
            case BEGIN_ARRAY: {
                JSONArray value = new JSONArray(); reader.beginArray();
                while (reader.hasNext()) value.put(readValue(reader));
                reader.endArray(); return value;
            }
            case STRING: return reader.nextString();
            case NUMBER: return new JSONTokener(reader.nextString()).nextValue();
            case BOOLEAN: return reader.nextBoolean();
            case NULL: reader.nextNull(); return JSONObject.NULL;
            default: throw new IOException("存档快照结构无效。");
        }
    }
    private Generation readSnapshot(Uri source, boolean compact) throws Exception {
        if (file(source).length() > 64 * 1024 * 1024) throw new IOException("存档快照过大。");
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        try (InputStream in = new DigestInputStream(input(source), digest)) {
            byte[] buffer = new byte[65536];
            while (in.read(buffer) != -1) { /* Verify the immutable generation before interpreting save data. */ }
        }
        String name = file(source).getName();
        if (!name.substring(14, 78).equals(hex(digest.digest()))) throw new IOException("存档快照校验失败。");
        JSONObject snapshot = new JSONObject(); boolean upgraded = false;
        try (JsonReader reader = new JsonReader(new InputStreamReader(input(source), StandardCharsets.UTF_8))) {
            if (reader.peek() != JsonToken.BEGIN_OBJECT) throw new IOException("存档快照结构无效。");
            reader.beginObject();
            while (reader.hasNext()) {
                String key = reader.nextName();
                if (!"files".equals(key)) { snapshot.put(key, readValue(reader)); continue; }
                if (reader.peek() != JsonToken.BEGIN_OBJECT) throw new IOException("存档文件列表无效。");
                JSONObject files = new JSONObject(); reader.beginObject();
                while (reader.hasNext()) {
                    String path = reader.nextName(), value = reader.nextString();
                    if (compact && path.toLowerCase(Locale.ROOT).endsWith(".lsd")) {
                        try {
                            byte[] original = android.util.Base64.decode(value, android.util.Base64.NO_WRAP);
                            byte[] updated = LsdSaveUpgrade.compact(original);
                            if (updated != original) {
                                value = android.util.Base64.encodeToString(updated, android.util.Base64.NO_WRAP);
                                upgraded = true;
                            }
                        } catch (IOException | IllegalArgumentException invalidSave) {
                            throw new IllegalStateException("存档升级失败，原文件已保留。", invalidSave);
                        }
                    }
                    files.put(path, value);
                }
                reader.endObject(); snapshot.put(key, files);
            }
            reader.endObject();
            if (reader.peek() != JsonToken.END_DOCUMENT) throw new IOException("存档快照末尾无效。");
        }
        return new Generation(snapshot, upgraded, name);
    }
    // Atomic, hash-named generations retain one previous save snapshot.
    synchronized JSONObject loadGeneration(long workId) throws Exception {
        return readGeneration(workId, false).data;
    }
    private Generation readGeneration(long workId, boolean compact) throws Exception {
        Uri folder = child(directory("saves"), Long.toString(workId), Document.MIME_TYPE_DIR, true);
        Map<String, Uri> files = children(folder); List<String> names = new ArrayList<>(files.keySet()); names.sort(Collections.reverseOrder());
        boolean found = false;
        for (String name : names) {
            if (!name.matches("[0-9]{13}-[a-f0-9]{64}\\.json")) continue;
            found = true;
            try {
                return readSnapshot(files.get(name), compact);
            } catch (IOException | JSONException damagedGeneration) { /* Try the retained preceding generation. */ }
        }
        if (found) throw new IOException("存档文件损坏，已保留原文件，请检查目录。");
        return new Generation(new JSONObject(), false, null);
    }
    synchronized void upgradeSaves(long workId) throws Exception {
        Generation generation = readGeneration(workId, true);
        // The source hash has been verified; preserve every file timestamp and the preceding generation.
        if (generation.upgraded) writeGeneration(workId, generation.data, generation.name);
    }
    synchronized JSONObject loadSaves(long workId) throws Exception {
        return withSharedConfig(loadGeneration(workId).optJSONObject("files"));
    }
    private JSONObject withSharedConfig(JSONObject files) throws Exception {
        if (files == null) files = new JSONObject();
        // openRead also restores AtomicFile's .bak when the base is absent.
        File shared = new File(file(root()), "player-config.json");
        if (shared.exists() || new File(shared.getPath() + ".bak").exists()) {
            try {
                JSONObject config;
                try (InputStream in = new android.util.AtomicFile(shared).openRead()) {
                    config = new JSONObject(new String(GameStore.readStream(in, 64 * 1024 * 1024), StandardCharsets.UTF_8));
                }
                // Validate the complete object before replacing any generation settings.
                for (String path : toKeys(config)) {
                    if (!isPlayerConfig(path) || Arrays.asList(path.split("/")).contains("..")
                        || Arrays.asList(path.split("/")).contains(".") || !(config.get(path) instanceof String))
                        throw new IOException("播放器配置无效。");
                    android.util.Base64.decode(config.getString(path), android.util.Base64.NO_WRAP);
                }
                // Shared settings supersede historical per-game config snapshots.
                for (String path : toKeys(files)) if (isPlayerConfig(path)) files.remove(path);
                for (String path : toKeys(config)) files.put(path, config.getString(path));
            } catch (IOException | JSONException | IllegalArgumentException invalidConfig) {
                // Keep the validated generation (or defaults for a new Work), and retain
                // the damaged shared file until a later successful atomic write replaces it.
                warnSharedConfig();
            }
        }
        return files;
    }
    private void warnSharedConfig() {
        // At most once per store lifetime; never log configuration contents or stack traces.
        if (!warnedSharedConfig) {
            warnedSharedConfig = true;
            android.util.Log.w("LocalStorage", "播放器共享配置不可用，作品存档已保留；使用作品配置或默认设置。");
        }
    }
    private static boolean isPlayerConfig(String path) { return path.startsWith("/home/web_user/.config/"); }
    private static List<String> toKeys(JSONObject object) {
        List<String> keys = new ArrayList<>(); object.keys().forEachRemaining(keys::add); return keys;
    }
    // Seed on launch so already-installed archives also gain their bundled saves after an APK update.
    synchronized JSONObject seedBundledSaves(long workId, Uri gameZip, JSONArray gameFiles) throws Exception {
        JSONObject saves = loadSaves(workId);
        Set<String> paths = new HashSet<>();
        Iterator<String> existing = saves.keys();
        while (existing.hasNext()) paths.add(Normalizer.normalize(existing.next(), Normalizer.Form.NFC).toLowerCase(Locale.ROOT));
        long encodedSize = -1;
        boolean changed = false;
        try (RandomAccessFile zip = new RandomAccessFile(file(gameZip), "r")) {
            for (int i = 0; i < gameFiles.length(); i++) {
                JSONObject entry = gameFiles.getJSONObject(i);
                String name = entry.getString("filename");
                if (!name.matches("(?i)[^/\\\\]+\\.lsd")) continue;
                String path = "/work-saves/" + workId + "/" + name;
                if (!paths.add(Normalizer.normalize(path, Normalizer.Form.NFC).toLowerCase(Locale.ROOT))) continue;
                if (encodedSize < 0) encodedSize = saves.toString().getBytes(StandardCharsets.UTF_8).length;
                long start = entry.getLong("start"), end = entry.getLong("end"), size = end - start;
                if (start < 0 || end < start || end > zip.length() || size > 64 * 1024 * 1024) throw new IOException("随包存档读取范围无效。");
                byte[] bytes = new byte[(int)size];
                zip.seek(start); zip.readFully(bytes);
                bytes = LsdSaveUpgrade.compact(bytes);
                encodedSize += 4 * ((bytes.length + 2L) / 3);
                if (encodedSize > 64 * 1024 * 1024) throw new IOException("存档及播放器配置超过 64 MiB。");
                saves.put(path, android.util.Base64.encodeToString(bytes, android.util.Base64.NO_WRAP));
                changed = true;
            }
        }
        if (changed) save(workId, saves);
        return saves;
    }
    synchronized JSONObject saveTimes(long workId) throws Exception { JSONObject times = loadGeneration(workId).optJSONObject("modified"); return times == null ? new JSONObject() : times; }
    synchronized void save(long workId, JSONObject files) throws Exception {
        Iterator<String> paths = files.keys();
        while (paths.hasNext()) {
            String path = paths.next();
            if (!(path.startsWith("/work-saves/" + workId + "/") || path.startsWith("/home/web_user/.config/"))
                || Arrays.asList(path.split("/")).contains("..") || Arrays.asList(path.split("/")).contains(".")) throw new IOException("存档路径无效。");
            android.util.Base64.decode(files.getString(path), android.util.Base64.NO_WRAP);
        }
        Generation snapshot = readGeneration(workId, false);
        JSONObject generation = snapshot.data, previous = withSharedConfig(generation.optJSONObject("files"));
        JSONObject times = generation.optJSONObject("modified"), nextTimes = new JSONObject();
        if (times == null) times = new JSONObject();
        Iterator<String> savedPaths = files.keys();
        while (savedPaths.hasNext()) { String path = savedPaths.next(); nextTimes.put(path, files.getString(path).equals(previous.optString(path)) ? times.optLong(path, System.currentTimeMillis()) : System.currentTimeMillis()); }
        writeGeneration(workId, new JSONObject().put("files", files).put("modified", nextTimes), snapshot.name);
        JSONObject config = new JSONObject();
        Iterator<String> configPaths = files.keys();
        while (configPaths.hasNext()) {
            String path = configPaths.next();
            if (isPlayerConfig(path)) config.put(path, files.getString(path));
        }
        // Keep old generations for recovery, but load the latest config for every Work.
        if (config.length() > 0) {
            try {
                // Do not precreate the base: a failed first AtomicFile write must leave
                // no empty config behind. The durable generation already contains it.
                write(Uri.fromFile(new File(file(root()), "player-config.json")), config.toString().getBytes(StandardCharsets.UTF_8));
            } catch (IOException unavailableConfig) { warnSharedConfig(); }
        }
    }
    private void writeGeneration(long workId, JSONObject generation, String previousName) throws Exception {
        byte[] bytes = generation.toString().getBytes(StandardCharsets.UTF_8);
        if (bytes.length > 64 * 1024 * 1024) throw new IOException("存档及播放器配置超过 64 MiB。");
        Uri folder = child(directory("saves"), Long.toString(workId), Document.MIME_TYPE_DIR, true);
        long sequence = System.currentTimeMillis();
        for (String existing : children(folder).keySet()) if (existing.matches("[0-9]{13}-[a-f0-9]{64}\\.json")) sequence = Math.max(sequence, Long.parseLong(existing.substring(0, 13)) + 1);
        String name = sequence + "-" + hash(bytes) + ".json";
        Uri target = child(folder, name, "application/json", true);
        write(target, bytes);
        if (!Arrays.equals(bytes, read(target, bytes.length))) throw new IOException("存档写入校验失败。");
        // Retain the actual verified source, even when a failed newer write is present.
        for (String old : children(folder).keySet()) if (old.matches("[0-9]{13}-[a-f0-9]{64}\\.json") && !old.equals(name) && !old.equals(previousName)) {
            try { delete(child(folder, old, "application/json", false)); } catch (Exception ignored) { }
        }
    }
}
