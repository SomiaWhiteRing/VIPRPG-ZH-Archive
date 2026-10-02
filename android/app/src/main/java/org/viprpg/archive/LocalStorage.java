package org.viprpg.archive;

import android.content.*;
import android.database.Cursor;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import android.provider.DocumentsContract;
import android.provider.DocumentsContract.Document;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.text.Normalizer;
import java.util.*;
import org.json.*;

/** App-owned persistent storage. Old selected trees are intentionally untouched. */
final class LocalStorage {
    private final File base;
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
        byte[] digest = MessageDigest.getInstance("SHA-256").digest(bytes); StringBuilder result = new StringBuilder();
        for (byte b : digest) result.append(String.format(Locale.ROOT, "%02x", b & 255)); return result.toString();
    }
    // Atomic, hash-named generations retain one previous save snapshot.
    synchronized JSONObject loadGeneration(long workId) throws Exception {
        Uri folder = child(directory("saves"), Long.toString(workId), Document.MIME_TYPE_DIR, true);
        Map<String, Uri> files = children(folder); List<String> names = new ArrayList<>(files.keySet()); names.sort(Collections.reverseOrder());
        boolean found = false;
        for (String name : names) {
            if (!name.matches("[0-9]{13}-[a-f0-9]{64}\\.json")) continue;
            found = true;
            try {
                byte[] bytes = read(files.get(name), 64 * 1024 * 1024);
                if (name.substring(14, 78).equals(hash(bytes))) return new JSONObject(new String(bytes, StandardCharsets.UTF_8));
            } catch (IOException | JSONException damagedGeneration) { /* Try the retained preceding generation. */ }
        }
        if (found) throw new IOException("存档文件损坏，已保留原文件，请检查目录。");
        return new JSONObject();
    }
    synchronized JSONObject loadSaves(long workId) throws Exception { JSONObject files = loadGeneration(workId).optJSONObject("files"); return files == null ? new JSONObject() : files; }
    // Seed on launch so already-installed archives also gain their bundled saves after an APK update.
    synchronized JSONObject seedBundledSaves(long workId, Uri gameZip, JSONArray gameFiles) throws Exception {
        JSONObject saves = loadSaves(workId);
        Set<String> paths = new HashSet<>();
        Iterator<String> existing = saves.keys();
        while (existing.hasNext()) paths.add(Normalizer.normalize(existing.next(), Normalizer.Form.NFC).toLowerCase(Locale.ROOT));
        long encodedSize = saves.toString().getBytes(StandardCharsets.UTF_8).length;
        boolean changed = false;
        try (RandomAccessFile zip = new RandomAccessFile(file(gameZip), "r")) {
            for (int i = 0; i < gameFiles.length(); i++) {
                JSONObject entry = gameFiles.getJSONObject(i);
                String name = entry.getString("filename");
                if (!name.matches("(?i)[^/\\\\]+\\.lsd")) continue;
                String path = "/work-saves/" + workId + "/" + name;
                if (!paths.add(Normalizer.normalize(path, Normalizer.Form.NFC).toLowerCase(Locale.ROOT))) continue;
                long start = entry.getLong("start"), end = entry.getLong("end"), size = end - start;
                if (start < 0 || end < start || end > zip.length()) throw new IOException("随包存档读取范围无效。");
                encodedSize += 4 * ((size + 2) / 3);
                if (encodedSize > 64 * 1024 * 1024) throw new IOException("存档及播放器配置超过 64 MiB。");
                byte[] bytes = new byte[(int)size];
                zip.seek(start); zip.readFully(bytes);
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
        JSONObject previous = loadSaves(workId), times = saveTimes(workId), nextTimes = new JSONObject();
        Iterator<String> savedPaths = files.keys();
        while (savedPaths.hasNext()) { String path = savedPaths.next(); nextTimes.put(path, files.getString(path).equals(previous.optString(path)) ? times.optLong(path, System.currentTimeMillis()) : System.currentTimeMillis()); }
        byte[] bytes = new JSONObject().put("files", files).put("modified", nextTimes).toString().getBytes(StandardCharsets.UTF_8);
        if (bytes.length > 64 * 1024 * 1024) throw new IOException("存档及播放器配置超过 64 MiB。");
        Uri folder = child(directory("saves"), Long.toString(workId), Document.MIME_TYPE_DIR, true);
        long sequence = System.currentTimeMillis();
        for (String existing : children(folder).keySet()) if (existing.matches("[0-9]{13}-[a-f0-9]{64}\\.json")) sequence = Math.max(sequence, Long.parseLong(existing.substring(0, 13)) + 1);
        String name = sequence + "-" + hash(bytes) + ".json";
        Uri target = child(folder, name, "application/json", true);
        write(target, bytes);
        if (!Arrays.equals(bytes, read(target, bytes.length))) throw new IOException("存档写入校验失败。");
        List<String> names = new ArrayList<>(children(folder).keySet()); names.sort(Collections.reverseOrder());
        int retained = 0;
        for (String old : names) if (old.matches("[0-9]{13}-[a-f0-9]{64}\\.json") && ++retained > 2) {
            try { delete(child(folder, old, "application/json", false)); } catch (Exception ignored) { }
        }
    }
}
