package org.viprpg.archive;

import android.net.Uri;
import android.os.ParcelFileDescriptor;
import android.os.SystemClock;
import java.io.*;
import java.net.HttpURLConnection;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.zip.CRC32;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;
import org.json.*;

/** Rebuild a runtime ZIP from checked local files and immutable remote byte ranges. */
final class GameDelta {
    static boolean install(GameStore store, JSONObject task, JSONObject metadata, File output) throws Exception {
        JSONObject base = store.deltaBase(metadata.getLong("workId"), task.getString("playKey"));
        if (base == null) return false;
        Uri oldZip;
        JSONArray oldFiles;
        try {
            Uri folder = store.folder(base, false);
            oldZip = store.storage.child(folder, "game.zip", "application/zip", false);
            oldFiles = store.storage.json(store.storage.child(folder, "index.json", "application/json", false)).getJSONArray("files");
            if (oldZip == null) return false;
        } catch (Exception missing) { return false; }
        HttpURLConnection request = store.connect("/api/archive-versions/" + metadata.getLong("archiveVersionId") + "/file-index", 0);
        JSONObject index;
        try {
            int code = request.getResponseCode();
            if (code == 404) return false;
            if (code != 200) throw new IOException("读取版本信息失败（" + code + "）。");
            try (InputStream input = request.getInputStream()) {
                index = new JSONObject(new String(GameStore.readStream(input, 16 * 1024 * 1024), StandardCharsets.UTF_8));
            }
        } finally { request.disconnect(); }
        long zipSize = index.getLong("zipSize");
        String etag = index.getString("etag");
        JSONArray files = index.getJSONArray("files");
        if (index.getInt("schema") != 1 || index.getLong("archiveVersionId") != metadata.getLong("archiveVersionId")
            || index.getLong("workId") != metadata.getLong("workId") || !index.getString("manifestSha256").equals(metadata.getString("manifestSha256"))
            || zipSize <= 0 || !etag.matches("\"[^\"\\r\\n]+\"") || files.length() != metadata.getInt("installTotalFiles"))
            throw new IOException("游戏索引无效，请重新安装。");
        Set<String> paths = new HashSet<>();
        long total = 0;
        for (int i = 0; i < files.length(); i++) {
            JSONObject file = files.getJSONObject(i);
            String path = file.getString("path");
            List<String> parts = Arrays.asList(path.split("/", -1));
            long size = file.getLong("size"), offset = file.getLong("offset"), crc = file.getLong("crc32");
            if (parts.contains("") || parts.contains(".") || parts.contains("..") || path.contains("\\") || path.contains(":") || path.indexOf('\0') >= 0
                || !paths.add(path.toLowerCase(Locale.ROOT)) || size < 0 || size > 1024L * 1024 * 1024 || offset < 0 || offset > zipSize - size
                || crc < 0 || crc > 0xffffffffL) throw new IOException("游戏索引无效，请重新安装。");
            total += size;
        }
        if (total != metadata.getLong("installTotalSizeBytes")) throw new IOException("游戏文件数量或大小与版本信息不一致。");
        Map<String, JSONObject> old = new HashMap<>(), reusable = new HashMap<>();
        for (int i = 0; i < oldFiles.length(); i++) {
            JSONObject file = oldFiles.getJSONObject(i); old.put(file.getString("filename").toLowerCase(Locale.ROOT), file);
        }
        long needed = 0, downloaded = 0, reusedBytes = 0, downloadMillis = 0;
        int reusedFiles = 0;
        byte[] buffer = new byte[262144];
        try (ParcelFileDescriptor descriptor = store.storage.open(oldZip, "r");
             FileInputStream local = new ParcelFileDescriptor.AutoCloseInputStream(descriptor)) {
            for (int i = 0; i < files.length(); i++) {
                store.check(task);
                JSONObject file = files.getJSONObject(i), previous = old.get(file.getString("path").toLowerCase(Locale.ROOT));
                long size = file.getLong("size");
                if (previous != null && previous.getLong("start") >= 0 && previous.getLong("end") <= local.getChannel().size()
                    && previous.getLong("end") - previous.getLong("start") == size) {
                    local.getChannel().position(previous.getLong("start"));
                    CRC32 crc = new CRC32(); long left = size;
                    while (left > 0) { store.check(task); int n = local.read(buffer, 0, (int)Math.min(left, buffer.length));
                        if (n < 0) break; crc.update(buffer, 0, n); left -= n; }
                    if (left == 0 && crc.getValue() == file.getLong("crc32")) { reusable.put(file.getString("path"), previous); continue; }
                }
                needed += size;
            }
            synchronized (store) {
                task.put("downloadedBytes", 0).put("downloadBytesTotal", needed).put("bytesPerSecond", 0)
                    .put("reusedFiles", 0).put("reusedBytes", 0); store.persist();
            }
            try (FileOutputStream raw = new FileOutputStream(output); ZipOutputStream zip = new ZipOutputStream(new BufferedOutputStream(raw), StandardCharsets.UTF_8)) {
                for (int i = 0; i < files.length(); i++) {
                    store.check(task);
                    JSONObject file = files.getJSONObject(i), previous = reusable.get(file.getString("path"));
                    long size = file.getLong("size"), offset = file.getLong("offset");
                    ZipEntry entry = new ZipEntry(file.getString("path"));
                    entry.setMethod(ZipEntry.STORED); entry.setSize(size); entry.setCompressedSize(size); entry.setCrc(file.getLong("crc32")); entry.setTime(0);
                    zip.putNextEntry(entry);
                    if (previous != null) {
                        local.getChannel().position(previous.getLong("start"));
                        long left = size;
                        while (left > 0) { store.check(task); int n = local.read(buffer, 0, (int)Math.min(left, buffer.length));
                            if (n < 0) throw new EOFException("ZIP 不完整。"); zip.write(buffer, 0, n); left -= n; }
                        reusedFiles++; reusedBytes += size;
                    } else if (size > 0) {
                        long started = SystemClock.elapsedRealtime(), reported = started;
                        HttpURLConnection download = store.connect(metadata.getString("downloadUrl"), 0);
                        download.setRequestProperty("Range", "bytes=" + offset + "-" + (offset + size - 1));
                        download.setRequestProperty("If-Range", etag);
                        try {
                            if (download.getResponseCode() != 206 || !etag.equals(download.getHeaderField("ETag")) ||
                                !("bytes " + offset + "-" + (offset + size - 1) + "/" + zipSize).equals(download.getHeaderField("Content-Range")))
                                throw new IOException("续传范围无效。");
                            try (InputStream input = download.getInputStream()) {
                                long left = size;
                                while (left > 0) {
                                    store.check(task);
                                    int n = input.read(buffer, 0, (int)Math.min(left, buffer.length));
                                    if (n < 0) throw new EOFException("下载文件不完整。");
                                    zip.write(buffer, 0, n); left -= n; downloaded += n;
                                    long now = SystemClock.elapsedRealtime();
                                    if (now - reported >= 500) {
                                        synchronized (store) {
                                            store.check(task);
                                            task.put("downloadedBytes", downloaded)
                                                .put("bytesPerSecond", downloaded * 1000 / (downloadMillis + now - started));
                                            store.persist();
                                        }
                                        reported = now;
                                    }
                                }
                                if (input.read() != -1) throw new IOException("下载文件不完整。");
                            }
                        } finally { download.disconnect(); }
                        downloadMillis += Math.max(1, SystemClock.elapsedRealtime() - started);
                    }
                    zip.closeEntry(); // ZipOutputStream also verifies the CRC of copied and downloaded bytes.
                    synchronized (store) {
                        store.check(task);
                        task.put("downloadedBytes", downloaded).put("bytesPerSecond", downloaded * 1000 / Math.max(1, downloadMillis))
                            .put("reusedFiles", reusedFiles).put("reusedBytes", reusedBytes); store.persist();
                    }
                }
                zip.finish(); zip.flush(); raw.getFD().sync();
            }
        }
        return true;
    }
}
