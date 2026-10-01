package org.viprpg.archive;

import android.app.Activity;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.provider.OpenableColumns;
import android.util.Base64;
import android.widget.Toast;
import org.json.JSONObject;
import java.io.*;
import java.text.DateFormat;
import java.util.*;
import java.util.concurrent.*;
import java.util.zip.*;

/** User-selected LSD import and single-file/ZIP export; no persistent storage grants. */
final class SaveTransfers {
    private static final int IMPORT = 2101, EXPORT = 2102;
    private final Activity activity;
    private final GameStore store;
    private final ExecutorService io = Executors.newSingleThreadExecutor();
    private long workId;
    private String title;
    private byte[] exportBytes;
    private boolean busy;
    SaveTransfers(Activity activity, GameStore store) { this.activity = activity; this.store = store; }
    void show(String key) {
        if (busy) return;
        try {
            JSONObject game = store.byKey(key);
            if (!"ready".equals(game.optString("status")) || store.playingKey != null) throw new IOException("请先退出游戏。");
            workId = game.getLong("workId"); title = game.getString("title");
            NativeControls.dialog(activity).setTitle(title).setItems(new String[]{"导入存档", "导出存档"}, (dialog, which) -> {
                if (which == 0) {
                    busy = true;
                    try { activity.startActivityForResult(new Intent(Intent.ACTION_OPEN_DOCUMENT).setType("*/*").addCategory(Intent.CATEGORY_OPENABLE).putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true), IMPORT); }
                    catch (Exception e) { fail(e); }
                } else listExports();
            }).setNegativeButton("取消", null).show();
        } catch (Exception e) { fail(e); }
    }
    private String prefix() { return "/work-saves/" + workId + "/"; }
    private static boolean lsd(String name) { return name.matches("(?i)Save[0-9]{2,6}\\.lsd"); }
    private void listExports() {
        busy = true;
        io.execute(() -> {
            try {
                JSONObject files = store.storage.loadSaves(workId), times = store.storage.saveTimes(workId);
                List<String> paths = new ArrayList<>(); Iterator<String> keys = files.keys();
                while (keys.hasNext()) { String path = keys.next(); if (path.startsWith(prefix()) && lsd(path.substring(prefix().length()))) paths.add(path); }
                Collections.sort(paths, String.CASE_INSENSITIVE_ORDER);
                activity.runOnUiThread(() -> {
                    if (paths.isEmpty()) { busy = false; toast("暂无可导出的存档。"); return; }
                    String[] labels = new String[paths.size()]; boolean[] checked = new boolean[paths.size()];
                    for (int i = 0; i < paths.size(); i++) { String path = paths.get(i); labels[i] = path.substring(prefix().length()) + "\n" + DateFormat.getDateTimeInstance(DateFormat.MEDIUM, DateFormat.SHORT).format(new Date(times.optLong(path))); }
                    androidx.appcompat.app.AlertDialog dialog = NativeControls.dialog(activity, R.style.SaveExportDialogTheme).setTitle("导出存档")
                        .setMultiChoiceItems(labels, checked, (d, which, value) -> { checked[which] = value; boolean any = false; for (boolean c : checked) any |= c; ((androidx.appcompat.app.AlertDialog)d).getButton(-1).setEnabled(any); })
                        .setNegativeButton("取消", (d,w) -> busy = false).setPositiveButton("导出", (d, which) -> prepareExport(paths, checked, files)).create();
                    dialog.setOnCancelListener(d -> busy = false);
                    dialog.show(); dialog.getButton(-1).setEnabled(false);
                });
            } catch (Exception e) { activity.runOnUiThread(() -> fail(e)); }
        });
    }
    private void prepareExport(List<String> paths, boolean[] checked, JSONObject files) {
        busy = true;
        io.execute(() -> {
            try {
                List<String> selected = new ArrayList<>(); for (int i = 0; i < paths.size(); i++) if (checked[i]) selected.add(paths.get(i));
                if (selected.isEmpty()) throw new IOException("请选择存档。");
                String name, mime;
                if (selected.size() == 1) { name = selected.get(0).substring(prefix().length()); mime = "application/octet-stream"; exportBytes = Base64.decode(files.getString(selected.get(0)), Base64.NO_WRAP); }
                else {
                    ByteArrayOutputStream out = new ByteArrayOutputStream();
                    try (ZipOutputStream zip = new ZipOutputStream(out)) { for (String path : selected) { zip.putNextEntry(new ZipEntry(path.substring(prefix().length()))); zip.write(Base64.decode(files.getString(path), Base64.NO_WRAP)); zip.closeEntry(); } }
                    exportBytes = out.toByteArray(); name = title.replaceAll("[\\\\/:*?\"<>|]", "_") + "-存档.zip"; mime = "application/zip";
                }
                String outputName = name, outputMime = mime;
                activity.runOnUiThread(() -> { busy = true; try { activity.startActivityForResult(new Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType(outputMime).putExtra(Intent.EXTRA_TITLE, outputName), EXPORT); } catch (Exception e) { fail(e); } });
            } catch (Exception e) { activity.runOnUiThread(() -> fail(e)); }
        });
    }
    boolean result(int code, int result, Intent data) {
        if (code != IMPORT && code != EXPORT) return false;
        if (result != Activity.RESULT_OK || data == null) { busy = false; exportBytes = null; return true; }
        if (code == EXPORT) {
            byte[] bytes = exportBytes; Uri uri = data.getData();
            io.execute(() -> { try { if (bytes == null || uri == null) throw new IOException("导出已失效，请重试。"); try (OutputStream out = activity.getContentResolver().openOutputStream(uri, "wt")) { if (out == null) throw new IOException("无法写入文件。"); out.write(bytes); } activity.runOnUiThread(() -> { busy = false; exportBytes = null; toast("存档已导出"); }); } catch (Exception e) { activity.runOnUiThread(() -> fail(e)); } });
        } else {
            List<Uri> uris = new ArrayList<>(); if (data.getClipData() != null) for (int i = 0; i < data.getClipData().getItemCount(); i++) uris.add(data.getClipData().getItemAt(i).getUri()); else if (data.getData() != null) uris.add(data.getData());
            io.execute(() -> readImports(uris));
        }
        return true;
    }
    private void readImports(List<Uri> uris) {
        try {
            if (uris.isEmpty() || uris.size() > 100) throw new IOException("每次请选择 1 至 100 个 LSD 或 ZIP 文件。");
            JSONObject incoming = new JSONObject(); int[] total = {0};
            for (Uri uri : uris) {
                String name;
                try (Cursor cursor = activity.getContentResolver().query(uri, new String[]{OpenableColumns.DISPLAY_NAME}, null, null, null)) {
                    if (cursor == null || !cursor.moveToFirst()) throw new IOException("无法读取文件名。"); name = cursor.getString(0);
                }
                if (name == null) throw new IOException("无法读取文件名。");
                try (InputStream in = activity.getContentResolver().openInputStream(uri)) {
                    if (in == null) throw new IOException("无法读取存档。");
                    if (name.toLowerCase(Locale.ROOT).endsWith(".zip")) {
                        byte[] archive = GameStore.readStream(in, 40 * 1024 * 1024);
                        int before = incoming.length(), entries = 0;
                        try (ZipInputStream zip = new ZipInputStream(new ByteArrayInputStream(archive))) {
                            ZipEntry entry;
                            while ((entry = zip.getNextEntry()) != null) {
                                if (++entries > 100) throw new IOException("每次最多导入 100 个存档。");
                                String nameInZip = entry.getName();
                                if (entry.isDirectory() || !lsd(nameInZip))
                                    throw new IOException("ZIP 结构不受支持，请使用本应用导出的 ZIP（根目录仅包含 SaveNN.lsd）。");
                                byte[] bytes = GameStore.readStream(zip, 16 * 1024 * 1024);
                                countImportBytes(total, bytes.length);
                                addImport(incoming, nameInZip, bytes);
                                zip.closeEntry();
                            }
                        }
                        if (incoming.length() == before) throw new IOException("ZIP 中没有可导入的 LSD 存档。");
                    } else {
                        byte[] bytes = GameStore.readStream(in, 16 * 1024 * 1024);
                        countImportBytes(total, bytes.length); addImport(incoming, name, bytes);
                    }
                }
            }
            JSONObject existing = store.storage.loadSaves(workId), times = store.storage.saveTimes(workId);
            List<String> conflicts = new ArrayList<>();
            Iterator<String> keys = incoming.keys(); while (keys.hasNext()) { String key = keys.next(); if (existing.has(key)) conflicts.add(key); }
            Collections.sort(conflicts, String.CASE_INSENSITIVE_ORDER);
            activity.runOnUiThread(() -> confirmImports(incoming, existing, times, conflicts));
        } catch (Exception e) { activity.runOnUiThread(() -> fail(e)); }
    }
    private static void countImportBytes(int[] total, int count) throws IOException {
        total[0] += count;
        if (total[0] > 40 * 1024 * 1024) throw new IOException("本次解压后的存档总量超过 40 MiB。");
    }
    private void addImport(JSONObject incoming, String name, byte[] bytes) throws Exception {
        java.util.regex.Matcher slot = java.util.regex.Pattern.compile("(?i)^Save([0-9]{2,6})(?: \\([0-9]+\\))?\\.lsd$").matcher(name);
        if (!slot.matches()) throw new IOException("请选择 Save01.lsd 这类存档文件，保留原始槽位编号。");
        name = "Save" + slot.group(1) + ".lsd";
        if (incoming.has(prefix() + name)) throw new IOException("导入来源包含重复槽位：" + name + "，请分批导入。");
        if (incoming.length() >= 100) throw new IOException("每次最多导入 100 个存档。");
        byte[] signature = "LcfSaveData".getBytes(java.nio.charset.StandardCharsets.US_ASCII);
        if (bytes.length < signature.length + 1 || bytes[0] != signature.length) throw new IOException("不是有效的 LSD 存档：" + name);
        for (int i = 0; i < signature.length; i++) if (bytes[i + 1] != signature[i]) throw new IOException("不是有效的 LSD 存档：" + name);
        incoming.put(prefix() + name, Base64.encodeToString(bytes, Base64.NO_WRAP));
    }
    private void confirmImports(JSONObject incoming, JSONObject existing, JSONObject times, List<String> conflicts) {
        if (conflicts.isEmpty()) {
            NativeControls.dialog(activity).setTitle("导入存档？").setMessage("将为此作品导入 " + incoming.length() + " 个存档。")
                .setNegativeButton("取消", (d,w) -> busy = false).setOnCancelListener(d -> busy = false)
                .setPositiveButton("导入", (d,w) -> importSelected(incoming, existing, Collections.emptySet())).show();
            return;
        }
        int fresh = incoming.length() - conflicts.size();
        boolean[] checked = new boolean[conflicts.size()]; String[] labels = new String[conflicts.size()];
        for (int i = 0; i < conflicts.size(); i++) {
            String key = conflicts.get(i);
            labels[i] = key.substring(prefix().length()) + "\n本地：" + DateFormat.getDateTimeInstance(DateFormat.MEDIUM, DateFormat.SHORT).format(new Date(times.optLong(key)));
        }
        android.widget.TextView titleView = new android.widget.TextView(activity);
        titleView.setText("选择要覆盖的存档\n未勾选的保留本地存档" + (fresh > 0 ? "；另有 " + fresh + " 个新存档将导入" : ""));
        titleView.setTextSize(18); NativeControls.textColor(titleView, R.color.native_ink);
        int padding = NativeControls.dp(activity, 24); titleView.setPadding(padding, padding, padding, NativeControls.dp(activity, 12));
        androidx.appcompat.app.AlertDialog dialog = NativeControls.dialog(activity, R.style.SaveExportDialogTheme).setCustomTitle(titleView)
            .setMultiChoiceItems(labels, checked, (d, which, value) -> {
                checked[which] = value; boolean any = fresh > 0; for (boolean c : checked) any |= c;
                ((androidx.appcompat.app.AlertDialog)d).getButton(-1).setEnabled(any);
            }).setNegativeButton("取消", (d,w) -> busy = false).setOnCancelListener(d -> busy = false)
            .setPositiveButton("导入", (d,w) -> {
                Set<String> overwrite = new HashSet<>(); for (int i = 0; i < checked.length; i++) if (checked[i]) overwrite.add(conflicts.get(i));
                importSelected(incoming, existing, overwrite);
            }).create();
        dialog.show(); dialog.getButton(-1).setEnabled(fresh > 0);
    }
    private void importSelected(JSONObject incoming, JSONObject existing, Set<String> overwrite) {
        io.execute(() -> {
            try {
                synchronized (store) {
                    if (store.playingKey != null) throw new IOException("请先退出游戏。");
                    JSONObject merged = store.storage.loadSaves(workId); Iterator<String> names = incoming.keys();
                    while (names.hasNext()) {
                        String key = names.next();
                        if (existing.has(key) && !overwrite.contains(key)) continue;
                        if (!Objects.equals(existing.opt(key), merged.opt(key))) throw new IOException("本地存档已变化，请重新导入并确认。");
                        merged.put(key, incoming.get(key));
                    }
                    store.storage.save(workId, merged);
                }
                activity.runOnUiThread(() -> { busy = false; toast("存档已导入"); });
            } catch (Exception e) { activity.runOnUiThread(() -> fail(e)); }
        });
    }
    private void toast(String text) { Toast.makeText(activity, text, Toast.LENGTH_LONG).show(); }
    private void fail(Exception e) { busy = false; exportBytes = null; toast(e.getMessage() == null ? "存档操作失败。" : e.getMessage()); }
    void close() { io.shutdownNow(); }
}
