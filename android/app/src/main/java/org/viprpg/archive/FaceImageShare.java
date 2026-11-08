package org.viprpg.archive;

import android.content.ClipData;
import android.content.Intent;
import android.graphics.BitmapFactory;
import android.net.Uri;
import android.util.Base64;
import android.util.Log;
import android.webkit.WebView;

import androidx.core.content.FileProvider;
import androidx.webkit.WebMessageCompat;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;

import java.io.File;
import java.io.IOException;
import java.nio.file.Files;
import java.util.Collections;

final class FaceImageShare {
    private static final String PNG_PREFIX = "data:image/png;base64,";
    private static final String PNG_TYPE = "image/png";
    private static final int MAX_BYTES = 160 * 1024;
    private static final long CACHE_LIFETIME_MS = 24 * 60 * 60 * 1000L;

    static void attach(MainActivity activity, WebView browser) {
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) return;
        WebViewCompat.addWebMessageListener(browser, "VIPRPGFaceShare", Collections.singleton(BuildConfig.SITE_ORIGIN),
            (view, message, origin, mainFrame, reply) -> {
                if (!mainFrame || message.getType() != WebMessageCompat.TYPE_STRING || activity.isDestroyed()) return;
                String url = view.getUrl();
                String path = url == null ? null : Uri.parse(url).getPath();
                if (path == null || !path.matches("/characters/[0-9]+/?")) return;

                String data = message.getData();
                if (data == null || !data.startsWith(PNG_PREFIX)
                    || data.length() > PNG_PREFIX.length() + ((MAX_BYTES + 2) / 3) * 4) return;
                try {
                    byte[] png = Base64.decode(data.substring(PNG_PREFIX.length()), Base64.DEFAULT);
                    if (png.length > MAX_BYTES) return;
                    BitmapFactory.Options bounds = new BitmapFactory.Options();
                    bounds.inJustDecodeBounds = true;
                    BitmapFactory.decodeByteArray(png, 0, png.length, bounds);
                    if (!PNG_TYPE.equals(bounds.outMimeType) || bounds.outWidth != bounds.outHeight
                        || bounds.outWidth < 48 || bounds.outWidth > 192 || bounds.outWidth % 48 != 0) return;

                    File cache = new File(activity.getCacheDir(), "face-share");
                    Files.createDirectories(cache.toPath());
                    long cutoff = System.currentTimeMillis() - CACHE_LIFETIME_MS;
                    File[] expired = cache.listFiles(file -> file.lastModified() < cutoff);
                    if (expired != null) for (File file : expired) file.delete();
                    File image = File.createTempFile("face-", ".png", cache);
                    Files.write(image.toPath(), png);
                    Uri uri = FileProvider.getUriForFile(activity, activity.getPackageName() + ".face-share", image);
                    Intent send = new Intent(Intent.ACTION_SEND)
                        .setType(PNG_TYPE)
                        .putExtra(Intent.EXTRA_STREAM, uri)
                        .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                    send.setClipData(ClipData.newUri(activity.getContentResolver(), image.getName(), uri));
                    activity.startActivity(Intent.createChooser(send, null));
                } catch (IOException | RuntimeException failure) {
                    Log.w("VipFaceShare", "Could not share a face image", failure);
                }
            });
    }
}
