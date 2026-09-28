package org.viprpg.archive;

import android.content.ContentResolver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.UriPermission;
import android.database.Cursor;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.net.Uri;
import android.provider.DocumentsContract;
import android.provider.DocumentsContract.Document;
import android.util.Base64;

import org.json.JSONObject;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.time.format.ResolverStyle;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** Only directory files are authoritative; no screenshot database or migration. */
final class ScreenshotStore {
    static final int MAX_BYTES = 8 * 1024 * 1024;
    private static final DateTimeFormatter TIME = DateTimeFormatter.ofPattern("uuuu-MM-dd_HH-mm-ss.SSS", Locale.ROOT)
        .withResolverStyle(ResolverStyle.STRICT);
    private static final Pattern NAME = Pattern.compile(
        "^(\\d{4}-\\d{2}-\\d{2}_\\d{2}-\\d{2}-\\d{2}\\.\\d{3})__w([1-9][0-9]{0,14})__(.+)\\.png$");
    private final ContentResolver resolver;
    private final LocalStorage storage;

    ScreenshotStore(Context context) {
        resolver = context.getContentResolver();
        storage = new LocalStorage(context);
    }
    Directory status() { return new Directory(true, storage.ready(), storage.name() + "/screenshots"); }
    private Uri requireTree() throws IOException { return storage.directory("screenshots"); }
    private static Uri document(Uri directory) { return directory; }

    List<Entry> list() throws IOException {
        Uri tree = requireTree();
        List<Entry> found = new ArrayList<>();
        Uri children = DocumentsContract.buildChildDocumentsUriUsingTree(tree, DocumentsContract.getDocumentId(tree));
        try (Cursor cursor = resolver.query(children, new String[]{Document.COLUMN_DOCUMENT_ID,
            Document.COLUMN_DISPLAY_NAME, Document.COLUMN_SIZE, Document.COLUMN_MIME_TYPE}, null, null, null)) {
            if (cursor == null) throw new IOException("无法读取截图目录，请重新选择目录。");
            while (cursor.moveToNext()) {
                if (Thread.currentThread().isInterrupted()) throw new IOException("读取已取消。");
                String name = cursor.getString(1);
                Matcher match = NAME.matcher(name == null ? "" : name);
                long bytes = cursor.isNull(2) ? -1 : cursor.getLong(2);
                if (!match.matches() || Document.MIME_TYPE_DIR.equals(cursor.getString(3)) || bytes == 0 || bytes > MAX_BYTES) continue;
                try {
                    LocalDateTime time = LocalDateTime.parse(match.group(1), TIME);
                    found.add(new Entry(tree, DocumentsContract.buildDocumentUriUsingTree(tree, cursor.getString(0)),
                        name, match.group(3), Long.parseLong(match.group(2)), time, bytes));
                } catch (IllegalArgumentException | java.time.DateTimeException invalidName) {
                    // A renamed or unrelated file is outside this gallery's managed set.
                }
            }
        }
        found.sort(Comparator.comparing((Entry entry) -> entry.createdAt).reversed().thenComparing(entry -> entry.id));
        return found;
    }

    void save(JSONObject request, LocalDateTime capturedAt) throws Exception {
        Uri tree = requireTree();
        long workId = request.getLong("workId");
        if (workId <= 0 || workId > 999999999999999L) throw new IOException("作品编号无效。");
        String encoded = request.getString("png");
        if (encoded.length() > (MAX_BYTES * 4 / 3 + 4)) throw new IOException("截图文件过大。");
        byte[] png = Base64.decode(encoded, Base64.NO_WRAP);
        byte[] signature = {(byte)137, 80, 78, 71, 13, 10, 26, 10};
        if (png.length < signature.length || png.length > MAX_BYTES) throw new IOException("截图文件无效。");
        for (int i = 0; i < signature.length; i++) if (png[i] != signature[i]) throw new IOException("截图必须为 PNG。");
        imageBounds(png);
        String title = request.optString("title", "游戏 " + workId).replace('"', '_')
            .replaceAll("[\\p{Cntrl}\\\\/:*?<>|]", "_").trim();
        if (title.isEmpty()) title = "游戏 " + workId;
        title = title.substring(0, title.offsetByCodePoints(0, Math.min(40, title.codePointCount(0, title.length()))));
        String name = TIME.format(capturedAt) + "__w" + workId + "__" + title + ".png";
        Uri target = DocumentsContract.createDocument(resolver, document(tree), "image/png", name);
        if (target == null) throw new IOException("无法创建截图文件。");
        try {
            try (OutputStream output = resolver.openOutputStream(target, "wt")) {
                if (output == null) throw new IOException("无法写入截图文件。");
                output.write(png);
                output.flush();
            }
            // Report success only after the provider committed the complete PNG.
            try (InputStream input = resolver.openInputStream(target)) {
                if (!Arrays.equals(readImage(input), png)) throw new IOException("截图写入不完整。");
            }
        } catch (Exception failure) {
            try { DocumentsContract.deleteDocument(resolver, target); } catch (Exception ignored) { }
            throw failure;
        }
    }

    private void checkDirectory(Entry entry) throws IOException {
        if (!entry.tree.equals(requireTree())) throw new IOException("截图目录已更换，请刷新图库。");
    }

    void delete(Entry entry) throws Exception {
        checkDirectory(entry);
        if (!DocumentsContract.deleteDocument(resolver, entry.uri)) throw new IOException("文件未删除。");
    }

    void verifyReadable(Entry entry) throws IOException {
        checkDirectory(entry);
        try (InputStream input = resolver.openInputStream(entry.uri)) {
            if (input == null || input.read() == -1) throw new IOException("无法读取截图。");
        }
    }

    Bitmap bitmap(Entry entry, int maxSide) throws IOException {
        checkDirectory(entry);
        byte[] bytes;
        try (InputStream input = resolver.openInputStream(entry.uri)) { bytes = readImage(input); }
        BitmapFactory.Options options = imageBounds(bytes);
        options.inJustDecodeBounds = false;
        options.inSampleSize = 1;
        while (Math.max(options.outWidth, options.outHeight) / options.inSampleSize > maxSide) options.inSampleSize *= 2;
        Bitmap image = BitmapFactory.decodeByteArray(bytes, 0, bytes.length, options);
        if (image == null) throw new IOException("无法解码截图，请刷新图库。");
        return image;
    }

    private static BitmapFactory.Options imageBounds(byte[] bytes) throws IOException {
        BitmapFactory.Options options = new BitmapFactory.Options();
        options.inJustDecodeBounds = true;
        BitmapFactory.decodeByteArray(bytes, 0, bytes.length, options);
        if (options.outWidth <= 0 || options.outHeight <= 0 || options.outWidth > 4096 || options.outHeight > 4096) {
            throw new IOException("截图尺寸无效。");
        }
        return options;
    }

    private static byte[] readImage(InputStream input) throws IOException {
        if (input == null) throw new IOException("无法读取截图文件。");
        ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        byte[] buffer = new byte[16 * 1024];
        int count;
        while ((count = input.read(buffer)) != -1) {
            if (Thread.currentThread().isInterrupted()) throw new IOException("读取已取消。");
            if (bytes.size() + count > MAX_BYTES) throw new IOException("截图文件过大。");
            bytes.write(buffer, 0, count);
        }
        if (bytes.size() == 0) throw new IOException("截图文件为空。");
        return bytes.toByteArray();
    }

    static final class Directory {
        final boolean configured, ready;
        final String name;
        Directory(boolean configured, boolean ready, String name) {
            this.configured = configured; this.ready = ready; this.name = name;
        }
    }

    static final class Entry {
        final Uri tree, uri;
        final String id, name, title;
        final long workId, bytes;
        final LocalDateTime createdAt;
        Entry(Uri tree, Uri uri, String name, String title, long workId, LocalDateTime createdAt, long bytes) {
            this.tree = tree; this.uri = uri; this.id = uri.toString(); this.name = name; this.title = title;
            this.workId = workId; this.createdAt = createdAt; this.bytes = bytes;
        }
    }
}
