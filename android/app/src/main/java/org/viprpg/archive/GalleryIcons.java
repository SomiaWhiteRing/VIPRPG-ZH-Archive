package org.viprpg.archive;

import android.graphics.Canvas;
import android.graphics.ColorFilter;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.PixelFormat;
import android.graphics.drawable.Drawable;
import androidx.core.graphics.PathParser;

/** Small, consistent 24dp line icons, matching the site's Lucide-style controls. */
final class GalleryIcons extends Drawable {
    static final String MORE = "M12,5 L12,5.01 M12,12 L12,12.01 M12,19 L12,19.01";
    static final String CHECK = "M5,12 L9,16 L19,6";
    static final String SELECT = "M9,3 H5 Q3,3 3,5 V9 M15,3 H19 Q21,3 21,5 V9 M21,15 V19 Q21,21 19,21 H15 M9,21 H5 Q3,21 3,19 V15 M8,12 L11,15 L16,9";
    static final String CLOSE = "M6,6 L18,18 M18,6 L6,18";
    static final String BACK = "M15,6 L9,12 L15,18";
    static final String NEXT = "M9,6 L15,12 L9,18";
    static final String DOWN = "M7,10 L12,15 L17,10";
    static final String SHARE = "M9,11 L16,7 M9,13 L16,17 M9,12 A3,3 0,1 1,3,12 A3,3 0,1 1,9,12 M22,5 A3,3 0,1 1,16,5 A3,3 0,1 1,22,5 M22,19 A3,3 0,1 1,16,19 A3,3 0,1 1,22,19";
    static final String DELETE = "M3,6 H21 M9,6 V3 H15 V6 M5,6 L6,21 H18 L19,6 M10,10 V17 M14,10 V17";
    static final String FOLDER = "M3,7 V5 Q3,3 5,3 H10 L12,6 H19 Q21,6 21,8 V19 Q21,21 19,21 H5 Q3,21 3,19 Z";
    static final String IMAGE = "M4,3 H20 Q22,3 22,5 V19 Q22,21 20,21 H4 Q2,21 2,19 V5 Q2,3 4,3 M2,16 L8,10 L15,17 M13,15 L17,11 L22,16 M17,7 L17,7.01";
    static final String CLOCK = "M12,2 A10,10 0,1 1,12,22 A10,10 0,1 1,12,2 M12,6 V12 L16,14";
    static final String GAMEPAD = "M6.5,8 H17.5 C19.5,8 20.5,9.2 21,11 L22,16 C22.7,19.3 20.2,21 18,19.4 L15.7,17.7 H8.3 L6,19.4 C3.8,21 1.3,19.3 2,16 L3,11 C3.5,9.2 4.5,8 6.5,8 Z M7,11 V15 M5,13 H9 M16,11.5 L16,11.51 M19,14 L19,14.01";
    static final String REFRESH = "M20,11 A8,8 0,1 0,20,14 M20,4 V11 H13 M4,13 A8,8 0,1 0,4,10 M4,20 V13 H11";
    static final String PAUSE = "M8,5 V19 M16,5 V19";
    static final String PLAY = "M7,4 L20,12 L7,20 Z";
    static final String SORT = "M4,6 H20 M4,12 H15 M4,18 H10";
    static final String SEARCH = "M21,21 L16.5,16.5 M18,10.5 A7.5,7.5 0,1 1,3,10.5 A7.5,7.5 0,1 1,18,10.5";
    static final String INFO = "M12,17 V11 M12,7 L12,7.01 M22,12 A10,10 0,1 1,2,12 A10,10 0,1 1,22,12";
    private final Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Path path;
    private final int intrinsicSize;
    GalleryIcons(String data, int color) { this(data, color, 24); }
    GalleryIcons(String data, int color, int intrinsicSize) {
        this.intrinsicSize = intrinsicSize;
        path = PathParser.createPathFromPathData(data);
        paint.setColor(color); paint.setStyle(Paint.Style.STROKE); paint.setStrokeWidth(1.8f);
        paint.setStrokeCap(Paint.Cap.ROUND); paint.setStrokeJoin(Paint.Join.ROUND);
    }
    @Override public void draw(Canvas canvas) {
        canvas.save(); canvas.translate(getBounds().left, getBounds().top);
        canvas.scale(getBounds().width() / 24f, getBounds().height() / 24f);
        canvas.drawPath(path, paint); canvas.restore();
    }
    @Override public void setAlpha(int alpha) { paint.setAlpha(alpha); invalidateSelf(); }
    @Override public void setColorFilter(ColorFilter filter) { paint.setColorFilter(filter); invalidateSelf(); }
    @Override public int getOpacity() { return PixelFormat.TRANSLUCENT; }
    @Override public int getIntrinsicWidth() { return intrinsicSize; }
    @Override public int getIntrinsicHeight() { return intrinsicSize; }
}
