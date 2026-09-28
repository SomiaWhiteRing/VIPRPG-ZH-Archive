package org.viprpg.archive;

import android.graphics.Bitmap;
import android.os.Handler;
import android.os.Looper;
import android.util.LruCache;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;

/** Decode off the UI thread, bound memory, and cancel recycled cells' requests. */
final class ScreenshotImageLoader {
    interface Result { void loaded(Bitmap bitmap); }
    private final ScreenshotStore store;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final ExecutorService workers = Executors.newFixedThreadPool(2);
    private final LruCache<String, Bitmap> thumbnails = new LruCache<String, Bitmap>(12 * 1024 * 1024) {
        @Override protected int sizeOf(String key, Bitmap value) { return value.getAllocationByteCount(); }
    };
    private volatile boolean closed;
    private volatile int generation;

    ScreenshotImageLoader(ScreenshotStore store) { this.store = store; }

    Bitmap cachedThumbnail(ScreenshotStore.Entry entry) {
        return thumbnails.get(generation + ":" + entry.id);
    }

    Future<?> load(ScreenshotStore.Entry entry, boolean fullSize, Result result) {
        String cacheKey = generation + ":" + entry.id;
        return workers.submit(() -> {
            Bitmap bitmap = fullSize ? null : thumbnails.get(cacheKey);
            try {
                if (bitmap == null) {
                    bitmap = store.bitmap(entry, fullSize ? 4096 : 512);
                    if (!fullSize && !closed && !Thread.currentThread().isInterrupted()) thumbnails.put(cacheKey, bitmap);
                }
            } catch (Exception | OutOfMemoryError unavailable) { bitmap = null; }
            if (Thread.currentThread().isInterrupted() || closed) return;
            Bitmap image = bitmap;
            main.post(() -> { if (!closed) result.loaded(image); });
        });
    }

    void clear() { generation++; thumbnails.evictAll(); }
    void close() { closed = true; workers.shutdownNow(); main.removeCallbacksAndMessages(null); clear(); }
}
