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
import java.util.*;
import org.json.*;

/** One persisted local tree. No legacy OPFS or screenshot-directory migration. */
final class LocalStorage {
    final ContentResolver resolver;
    private final SharedPreferences preferences;
    LocalStorage(Context context) {
        resolver = context.getContentResolver();
        preferences = context.getSharedPreferences("local-storage-" + Uri.parse(BuildConfig.SITE_ORIGIN).getHost(), 0);
    }
    Uri tree() throws IOException {
        String value = preferences.getString("tree", null);
        if (value != null) for (UriPermission grant : resolver.getPersistedUriPermissions())
            if (grant.getUri().toString().equals(value) && grant.isReadPermission() && grant.isWritePermission()) return grant.getUri();
        throw new IOException("本地目录授权已失效，请重新选择目录。");
    }
    boolean ready() { try { children(root()); return true; } catch (Exception e) { return false; } }
    String name() { return preferences.getString("name", "本地数据目录"); }
    Uri root() throws IOException { Uri tree = tree(); return DocumentsContract.buildDocumentUriUsingTree(tree, DocumentsContract.getTreeDocumentId(tree)); }
    void select(Uri tree, int flags) throws Exception {
        // Cloud providers may expose pipes instead of seekable files and cannot host an offline game library.
        if (!"com.android.externalstorage.documents".equals(tree.getAuthority())) throw new IOException("请选择设备内部存储或 SD 卡中的文件夹。");
        if ((flags & 3) != 3) throw new IOException("目录需要读写权限。");
        resolver.takePersistableUriPermission(tree, Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
        Uri root = DocumentsContract.buildDocumentUriUsingTree(tree, DocumentsContract.getTreeDocumentId(tree));
        String name;
        try (Cursor c = resolver.query(root, new String[]{Document.COLUMN_DISPLAY_NAME, Document.COLUMN_FLAGS}, null, null, null)) {
            if (c == null || !c.moveToFirst() || (c.getInt(1) & Document.FLAG_DIR_SUPPORTS_CREATE) == 0) throw new IOException("目录不可写。");
            name = c.getString(0);
        }
        // Commit the selection only after all three directories can be created.
        for (String child : new String[]{"games", "screenshots", "saves"}) childAt(tree, root, child, Document.MIME_TYPE_DIR, true);
        if (!preferences.edit().putString("tree", tree.toString()).putString("name", name).commit()) throw new IOException("目录设置保存失败。");
    }
    Uri directory(String name) throws IOException { return child(root(), name, Document.MIME_TYPE_DIR, true); }
    Uri child(Uri parent, String name, String mime, boolean create) throws IOException { return childAt(tree(), parent, name, mime, create); }
    private Uri childAt(Uri tree, Uri parent, String name, String mime, boolean create) throws IOException {
        if (name.isEmpty() || name.contains("/") || name.contains("\\") || name.equals("..")) throw new IOException("文件名无效。");
        Uri query = DocumentsContract.buildChildDocumentsUriUsingTree(tree, DocumentsContract.getDocumentId(parent));
        try (Cursor c = resolver.query(query, new String[]{Document.COLUMN_DOCUMENT_ID, Document.COLUMN_DISPLAY_NAME, Document.COLUMN_MIME_TYPE}, null, null, null)) {
            if (c == null) throw new IOException("无法读取目录。");
            while (c.moveToNext()) if (name.equals(c.getString(1))) {
                if (Document.MIME_TYPE_DIR.equals(mime) != Document.MIME_TYPE_DIR.equals(c.getString(2))) throw new IOException("同名文件与目录冲突：" + name);
                return DocumentsContract.buildDocumentUriUsingTree(tree, c.getString(0));
            }
        }
        if (!create) return null;
        Uri result = DocumentsContract.createDocument(resolver, parent, mime, name);
        if (result == null) throw new IOException("无法创建：" + name);
        return result;
    }
    Map<String, Uri> children(Uri parent) throws IOException {
        Map<String, Uri> result = new HashMap<>();
        Uri tree = tree();
        try (Cursor c = resolver.query(DocumentsContract.buildChildDocumentsUriUsingTree(tree, DocumentsContract.getDocumentId(parent)),
                new String[]{Document.COLUMN_DOCUMENT_ID, Document.COLUMN_DISPLAY_NAME}, null, null, null)) {
            if (c == null) throw new IOException("无法读取目录。");
            while (c.moveToNext()) result.put(c.getString(1), DocumentsContract.buildDocumentUriUsingTree(tree, c.getString(0)));
        }
        return result;
    }
    byte[] read(Uri uri, int limit) throws IOException {
        if (uri == null) throw new IOException("文件不存在。");
        try (InputStream in = resolver.openInputStream(uri); ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            if (in == null) throw new IOException("无法读取文件。");
            byte[] buffer = new byte[65536]; int n;
            while ((n = in.read(buffer)) != -1) { if (out.size() + n > limit) throw new IOException("文件过大。"); out.write(buffer, 0, n); }
            return out.toByteArray();
        }
    }
    void write(Uri uri, byte[] bytes) throws IOException {
        try (ParcelFileDescriptor descriptor = resolver.openFileDescriptor(uri, "rwt");
             FileOutputStream out = new ParcelFileDescriptor.AutoCloseOutputStream(descriptor)) {
            out.write(bytes); out.flush(); out.getFD().sync();
        }
    }
    JSONObject json(Uri uri) throws Exception { return new JSONObject(new String(read(uri, 64 * 1024 * 1024), StandardCharsets.UTF_8)); }
    static String hash(byte[] bytes) throws Exception {
        byte[] digest = MessageDigest.getInstance("SHA-256").digest(bytes); StringBuilder result = new StringBuilder();
        for (byte b : digest) result.append(String.format(Locale.ROOT, "%02x", b & 255)); return result.toString();
    }
    // Immutable, hash-named generations make interrupted writes detectable without relying on SAF rename atomicity.
    synchronized JSONObject loadSaves(long workId) throws Exception {
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
    synchronized void save(long workId, JSONObject files) throws Exception {
        Iterator<String> paths = files.keys();
        while (paths.hasNext()) {
            String path = paths.next();
            if (!(path.startsWith("/work-saves/" + workId + "/") || path.startsWith("/home/web_user/.config/"))
                || Arrays.asList(path.split("/")).contains("..") || Arrays.asList(path.split("/")).contains(".")) throw new IOException("存档路径无效。");
            android.util.Base64.decode(files.getString(path), android.util.Base64.NO_WRAP);
        }
        byte[] bytes = files.toString().getBytes(StandardCharsets.UTF_8);
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
            try { DocumentsContract.deleteDocument(resolver, child(folder, old, "application/json", false)); } catch (Exception ignored) { }
        }
    }
}
