package org.viprpg.archive;

import android.content.ContentResolver;
import android.content.ContentValues;
import android.database.Cursor;
import android.net.Uri;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;
import android.util.Log;
import android.webkit.WebView;
import android.widget.Toast;

import androidx.webkit.WebMessageCompat;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;

import java.io.IOException;
import java.io.OutputStream;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

final class GeneratedFileExport {
    private final MainActivity activity;
    private final ExecutorService io = Executors.newSingleThreadExecutor();
    private final List<Download> downloads = new ArrayList<>();

    GeneratedFileExport(MainActivity activity) {
        this.activity = activity;
    }

    void attach(WebView view) {
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) return;
        listen(view, "VIPRPGFileExport", false);
        // The installed replay runtimes still send the original MP4-only messages.
        listen(view, "VIPRPGVideoExport", true);
    }

    private void listen(WebView view, String name, boolean legacyVideo) {
        var download = new Download(activity.getContentResolver());
        downloads.add(download);
        WebViewCompat.addWebMessageListener(view, name, Collections.singleton(BuildConfig.SITE_ORIGIN),
            (browser, message, origin, mainFrame, reply) -> {
                if (!mainFrame || io.isShutdown() || message.getType() != WebMessageCompat.TYPE_STRING) return;
                String data = message.getData();
                if (data == null) return;
                int separator = legacyVideo ? -1 : data.indexOf(':');
                if (!legacyVideo && separator != 36) return;
                String prefix = legacyVideo ? "" : data.substring(0, separator + 1);
                String command = data.substring(separator + 1);
                boolean player = activity.isScreenshotPage(browser);
                boolean stats = !legacyVideo && activity.isGyokuroStatsPage(browser);
                if (!player && !stats) {
                    reply.postMessage(prefix + "error");
                    return;
                }
                io.execute(() -> {
                    WriteResult result = download.write(command, legacyVideo, stats);
                    activity.runOnUiThread(() -> {
                        if (activity.isDestroyed()) return;
                        if (result.path() != null) {
                            Toast.makeText(activity, activity.getString(R.string.generated_file_saved, result.path()), Toast.LENGTH_LONG).show();
                        }
                        reply.postMessage(prefix + (result.ok() ? "saved" : "error"));
                    });
                });
            });
    }

    void close() {
        io.execute(() -> downloads.forEach(Download::discard));
        io.shutdown();
    }

    private enum Format {
        PNG(".png", "image/png"), ZIP(".zip", "application/zip"),
        JSON(".json", "application/json"), MP4(".mp4", "video/mp4");

        final String extension;
        final String mime;

        Format(String extension, String mime) {
            this.extension = extension;
            this.mime = mime;
        }

        boolean matches(byte[] bytes) {
            return switch (this) {
                case PNG -> bytes.length >= 8 && (bytes[0] & 255) == 137 &&
                    bytes[1] == 'P' && bytes[2] == 'N' && bytes[3] == 'G' &&
                    bytes[4] == 13 && bytes[5] == 10 && bytes[6] == 26 && bytes[7] == 10;
                case ZIP -> bytes.length >= 4 && bytes[0] == 'P' && bytes[1] == 'K' &&
                    ((bytes[2] == 3 && bytes[3] == 4) || (bytes[2] == 5 && bytes[3] == 6));
                case JSON -> bytes.length > 0 && (bytes[0] == '{' || bytes[0] == '[');
                case MP4 -> bytes.length >= 12 && bytes[4] == 'f' && bytes[5] == 't' && bytes[6] == 'y' && bytes[7] == 'p';
            };
        }
    }

    private record WriteResult(boolean ok, String path) {
        static final WriteResult ACCEPTED = new WriteResult(true, null);
        static final WriteResult FAILED = new WriteResult(false, null);
    }

    private static final class Download {
        private final ContentResolver resolver;
        private Uri item;
        private OutputStream stream;
        private Format format;
        private boolean hasData;

        Download(ContentResolver resolver) {
            this.resolver = resolver;
        }

        WriteResult write(String command, boolean legacyVideo, boolean stats) {
            try {
                if (command.startsWith("open:")) {
                    discard();
                    String name = command.substring(5);
                    if (name.length() > 255 || name.chars().anyMatch(c ->
                        Character.isISOControl(c) || "/\\:*?\"<>|".indexOf(c) >= 0)) return WriteResult.FAILED;
                    for (Format candidate : Format.values()) {
                        if (name.length() > candidate.extension.length() && name.endsWith(candidate.extension)) {
                            format = candidate;
                            break;
                        }
                    }
                    if (format == null || (legacyVideo && format != Format.MP4) || (stats && format != Format.PNG)) return WriteResult.FAILED;
                    var values = new ContentValues();
                    values.put(MediaStore.MediaColumns.DISPLAY_NAME, name);
                    values.put(MediaStore.MediaColumns.MIME_TYPE, format.mime);
                    values.put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS);
                    values.put(MediaStore.MediaColumns.IS_PENDING, 1);
                    item = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
                    if (item == null || (stream = resolver.openOutputStream(item)) == null)
                        throw new IOException("Could not open the download");
                    return WriteResult.ACCEPTED;
                }
                if (stream != null && command.startsWith("data:") && command.length() <= 262149) {
                    byte[] bytes = Base64.decode(command.substring(5), Base64.DEFAULT);
                    if (!hasData && !format.matches(bytes)) throw new IOException("Invalid download header");
                    stream.write(bytes);
                    hasData = true;
                    return WriteResult.ACCEPTED;
                }
                if (stream != null && hasData && command.equals("close")) {
                    stream.close();
                    stream = null;
                    var values = new ContentValues();
                    values.put(MediaStore.MediaColumns.IS_PENDING, 0);
                    if (resolver.update(item, values, null, null) != 1) throw new IOException("Could not publish the download");
                    Uri published = item;
                    item = null;
                    hasData = false;
                    return new WriteResult(true, savedPath(published));
                }
                if (!legacyVideo && command.equals("abort")) {
                    discard();
                    return WriteResult.ACCEPTED;
                }
            } catch (IOException | RuntimeException failure) {
                Log.w("GeneratedFileExport", "Could not write the download", failure);
            }
            discard();
            return WriteResult.FAILED;
        }

        private String savedPath(Uri published) {
            String downloads = Environment.DIRECTORY_DOWNLOADS + "/";
            String[] columns = {MediaStore.MediaColumns.RELATIVE_PATH, MediaStore.MediaColumns.DISPLAY_NAME};
            try (Cursor cursor = resolver.query(published, columns, null, null, null)) {
                if (cursor != null && cursor.moveToFirst()) {
                    String directory = cursor.getString(0);
                    String name = cursor.getString(1);
                    if (directory == null || directory.isEmpty()) directory = downloads;
                    if (name != null && !name.isEmpty()) return (directory.endsWith("/") ? directory : directory + "/") + name;
                }
            } catch (RuntimeException failure) {
                Log.w("GeneratedFileExport", "Could not read the saved download path", failure);
            }
            return downloads;
        }

        void discard() {
            if (stream != null) {
                try { stream.close(); } catch (IOException ignored) {}
                stream = null;
            }
            if (item != null) {
                try { resolver.delete(item, null, null); }
                catch (RuntimeException failure) { Log.w("GeneratedFileExport", "Could not discard the download", failure); }
                item = null;
            }
            format = null;
            hasData = false;
        }
    }
}
