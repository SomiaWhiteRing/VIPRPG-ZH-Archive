package org.viprpg.archive;

import android.content.ContentResolver;
import android.content.ContentValues;
import android.net.Uri;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;
import android.webkit.WebView;

import androidx.webkit.WebMessageCompat;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;

import java.io.IOException;
import java.io.OutputStream;
import java.util.Collections;
import java.util.concurrent.ForkJoinPool;

final class ReplayVideoExport {
    private final ContentResolver resolver;
    private Uri item;
    private OutputStream stream;
    private boolean header;

    private ReplayVideoExport(ContentResolver resolver) {
        this.resolver = resolver;
    }

    static void attach(MainActivity activity, WebView view) {
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) return;
        var export = new ReplayVideoExport(activity.getContentResolver());
        WebViewCompat.addWebMessageListener(view, "VIPRPGVideoExport", Collections.singleton(BuildConfig.SITE_ORIGIN),
            (browser, message, origin, mainFrame, reply) -> {
                if (!mainFrame || !activity.isScreenshotPage(browser)
                    || message.getType() != WebMessageCompat.TYPE_STRING) return;
                String command = message.getData();
                ForkJoinPool.commonPool().execute(() -> {
                    String result = export.write(command) ? "saved" : "error";
                    activity.runOnUiThread(() -> reply.postMessage(result));
                });
            });
    }

    private synchronized boolean write(String command) {
        try {
            if (command.startsWith("open:")) {
                discard();
                String name = command.substring(5);
                if (name.length() > 255 || !name.endsWith(".mp4")
                    || name.chars().anyMatch(c -> Character.isISOControl(c) || "/\\:*?\"<>|".indexOf(c) >= 0))
                    return false;
                var values = new ContentValues();
                values.put(MediaStore.MediaColumns.DISPLAY_NAME, name);
                values.put(MediaStore.MediaColumns.MIME_TYPE, "video/mp4");
                values.put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS);
                values.put(MediaStore.MediaColumns.IS_PENDING, 1);
                item = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
                if (item == null || (stream = resolver.openOutputStream(item)) == null)
                    throw new IOException("Could not open the download");
                return true;
            }
            if (stream != null && command.startsWith("data:") && command.length() <= 262149) {
                byte[] data = Base64.decode(command.substring(5), Base64.DEFAULT);
                if (!header) {
                    if (data.length < 12 || data[4] != 'f' || data[5] != 't' || data[6] != 'y' || data[7] != 'p')
                        throw new IOException("Invalid MP4 header");
                    header = true;
                }
                stream.write(data);
                return true;
            }
            if (stream != null && header && command.equals("close")) {
                stream.close();
                stream = null;
                var values = new ContentValues();
                values.put(MediaStore.MediaColumns.IS_PENDING, 0);
                resolver.update(item, values, null, null);
                item = null;
                header = false;
                return true;
            }
        } catch (IOException | RuntimeException failure) {
            android.util.Log.w("ReplayVideoExport", "Could not write video", failure);
        }
        discard();
        return false;
    }

    private void discard() {
        if (stream != null) {
            try { stream.close(); } catch (IOException ignored) {}
            stream = null;
        }
        if (item != null) {
            resolver.delete(item, null, null);
            item = null;
        }
        header = false;
    }
}
