package org.viprpg.archive;

import android.app.Dialog;
import android.animation.ValueAnimator;
import android.content.Context;
import android.content.res.ColorStateList;
import android.graphics.Color;
import android.graphics.drawable.BitmapDrawable;
import android.graphics.drawable.GradientDrawable;
import android.graphics.Typeface;
import android.os.Bundle;
import android.text.TextUtils;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import androidx.annotation.NonNull;
import androidx.recyclerview.widget.RecyclerView;
import androidx.viewpager2.widget.MarginPageTransformer;
import androidx.viewpager2.widget.ViewPager2;
import com.github.panpf.zoomimage.ZoomImageView;
import com.google.android.material.button.MaterialButton;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.Future;
import java.util.function.Consumer;

/** Image-first native viewer. ZoomImage handles gestures; ViewPager2 handles adjacent pages. */
final class ScreenshotViewer extends Dialog {
    private final List<ScreenshotStore.Entry> items;
    private final ScreenshotImageLoader images;
    private final Consumer<ScreenshotStore.Entry> share, delete;
    private final Map<String, String> dimensions = new HashMap<>();
    private final List<Page> pages = new ArrayList<>();
    interface ThumbnailTarget { void find(ScreenshotStore.Entry item, Consumer<android.widget.ImageView> ready); }
    private final ThumbnailTarget thumbnailTarget;
    private ValueAnimator imageAnimation;
    private boolean transitioning, closing;
    private final int start;
    private ViewPager2 pager;
    private LinearLayout top, bottom;
    private TextView title, subtitle;
    private ViewerRoot root;
    private ScrollView details;
    private LinearLayout detailContent;
    private android.widget.ImageView detailBack;
    private float detailReveal;
    private ValueAnimator detailAnimation, fileAnimation;
    private boolean chromeVisible = true, closed;

    ScreenshotViewer(Context context, List<ScreenshotStore.Entry> items, int start,
            ScreenshotImageLoader images, ThumbnailTarget thumbnailTarget, Consumer<ScreenshotStore.Entry> share, Consumer<ScreenshotStore.Entry> delete) {
        super(context, R.style.ScreenshotViewerTheme);
        this.items = items; this.start = Math.max(0, start); this.images = images;
        this.share = share; this.delete = delete; this.thumbnailTarget = thumbnailTarget;
    }

    @Override protected void onCreate(Bundle state) {
        super.onCreate(state);
        // Use the scoped Material theme supplied by the gallery for library widgets.
        Context context = new android.view.ContextThemeWrapper(getContext(), R.style.GalleryTheme);
        root = new ViewerRoot(context); root.setBackgroundColor(Color.WHITE);
        root.setAlpha(0);
        pager = new ViewPager2(context); pager.setBackgroundColor(Color.TRANSPARENT);
        pager.setPageTransformer(new MarginPageTransformer(dp(12)));
        root.addView(pager, new FrameLayout.LayoutParams(-1, -1));
        pager.setAdapter(new RecyclerView.Adapter<Page>() {
            @NonNull @Override public Page onCreateViewHolder(@NonNull ViewGroup parent, int type) {
                Page page = new Page(context); pages.add(page); return page;
            }
            @Override public void onBindViewHolder(@NonNull Page page, int position) { page.bind(items.get(position)); }
            @Override public void onViewRecycled(@NonNull Page page) { page.clear(); }
            @Override public int getItemCount() { return items.size(); }
        });
        top = new LinearLayout(context); top.setGravity(Gravity.CENTER_VERTICAL); top.setPadding(dp(8), dp(8), dp(12), dp(8));
        top.setBackgroundColor(Color.WHITE);
        icon(top, "返回", GalleryIcons.BACK, this::dismiss);
        LinearLayout info = new LinearLayout(context); info.setOrientation(LinearLayout.VERTICAL); info.setPadding(dp(8), 0, 0, 0);
        title = text(context, 17); title.setTypeface(null, Typeface.BOLD); title.setMaxLines(1); title.setEllipsize(TextUtils.TruncateAt.END); info.addView(title);
        subtitle = text(context, 12); subtitle.setTextColor(0xff68737d); subtitle.setPadding(0, dp(3), 0, 0); info.addView(subtitle);
        top.addView(info, new LinearLayout.LayoutParams(0, -2, 1));
        root.addView(top, new FrameLayout.LayoutParams(-1, -2, Gravity.TOP));
        bottom = new LinearLayout(context); bottom.setGravity(Gravity.CENTER); bottom.setPadding(dp(16), dp(8), dp(16), dp(10));
        bottom.setBackgroundColor(Color.WHITE);
        action(bottom, "分享", GalleryIcons.SHARE, () -> share.accept(items.get(pager.getCurrentItem())));
        action(bottom, "详情", GalleryIcons.INFO, this::showDetails);
        action(bottom, "删除", GalleryIcons.DELETE, () -> delete.accept(items.get(pager.getCurrentItem())));
        root.addView(bottom, new FrameLayout.LayoutParams(-1, -2, Gravity.BOTTOM));
        details = new ScrollView(context); details.setFillViewport(true);
        detailContent = new LinearLayout(context); detailContent.setOrientation(LinearLayout.VERTICAL);
        detailContent.setPadding(dp(20), dp(12), dp(20), dp(28)); details.addView(detailContent);
        GradientDrawable paper = new GradientDrawable(); paper.setColor(Color.WHITE);
        paper.setCornerRadii(new float[]{dp(24), dp(24), dp(24), dp(24), 0, 0, 0, 0});
        details.setBackground(paper); details.setClipToOutline(true); details.setVisibility(View.INVISIBLE);
        root.addView(details, new FrameLayout.LayoutParams(-1, -1));
        detailBack = new android.widget.ImageView(context); detailBack.setImageDrawable(new GalleryIcons(GalleryIcons.BACK, 0xff17212b));
        detailBack.setPadding(dp(12), dp(12), dp(12), dp(12));
        GradientDrawable backCircle = new GradientDrawable(); backCircle.setColor(Color.WHITE); backCircle.setCornerRadius(dp(24));
        detailBack.setBackground(backCircle); detailBack.setContentDescription("收起详情");
        detailBack.setOnClickListener(view -> animateDetails(0));
        FrameLayout.LayoutParams backParams = new FrameLayout.LayoutParams(dp(48), dp(48), Gravity.TOP | Gravity.START);
        backParams.setMargins(dp(8), dp(8), 0, 0); root.addView(detailBack, backParams); detailBack.setVisibility(View.INVISIBLE);
        setContentView(root);
        pager.registerOnPageChangeCallback(new ViewPager2.OnPageChangeCallback() {
            @Override public void onPageSelected(int position) { if (closed || closing || position < 0 || position >= items.size()) return; updateTitle(position); thumbnailTarget.find(items.get(position), view -> {}); }
        });
        pager.setCurrentItem(start, false); updateTitle(start);
        Window window = getWindow();
        if (window != null) {
            window.setStatusBarColor(Color.WHITE); window.setNavigationBarColor(Color.WHITE);
            window.getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR | View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR);
            window.setLayout(-1, -1);
            window.setBackgroundDrawableResource(android.R.color.transparent);
            window.clearFlags(android.view.WindowManager.LayoutParams.FLAG_DIM_BEHIND);
            window.setWindowAnimations(0);
        }
        root.post(() -> thumbnailTarget.find(items.get(start), source -> animateImage(source, true)));
    }

    private void updateTitle(int position) {
        ScreenshotStore.Entry item = items.get(position);
        title.setText(item.createdAt.format(DateTimeFormatter.ofPattern("M月d日 EEEE", Locale.CHINA)));
        subtitle.setText(item.createdAt.format(DateTimeFormatter.ofPattern("HH:mm", Locale.CHINA)) + "  ·  " + item.title);
    }

    private void showDetails() {
        if (closed) return;
        prepareDetails();
        animateDetails(detailTarget());
    }

    private void prepareDetails() {
        ScreenshotStore.Entry item = items.get(pager.getCurrentItem());
        Context context = root.getContext();
        detailContent.removeAllViews(); details.scrollTo(0, 0);
        View handle = new View(context); GradientDrawable shape = new GradientDrawable();
        shape.setColor(0xffc4d1cc); shape.setCornerRadius(dp(4)); handle.setBackground(shape);
        LinearLayout handleRow = new LinearLayout(context); handleRow.setGravity(Gravity.CENTER);
        handleRow.addView(handle, new LinearLayout.LayoutParams(dp(28), dp(4)));
        detailContent.addView(handleRow, new LinearLayout.LayoutParams(-1, dp(24)));
        TextView date = text(context, 18); date.setTypeface(null, Typeface.BOLD);
        date.setText(item.createdAt.format(DateTimeFormatter.ofPattern("yyyy年M月d日 EEEE · HH:mm:ss", Locale.CHINA)));
        date.setPadding(0, dp(16), 0, dp(20)); detailContent.addView(date);
        TextView game = text(context, 16); game.setText(item.title); game.setPadding(0, 0, 0, dp(28)); detailContent.addView(game);
        TextView heading = text(context, 17); heading.setText("详细信息"); heading.setTypeface(null, Typeface.BOLD);
        heading.setPadding(0, 0, 0, dp(14)); detailContent.addView(heading);
        String resolution = dimensions.get(item.id);
        fileInformation(item, resolution);
    }

    private void fileInformation(ScreenshotStore.Entry item, String resolution) {
        Context context = root.getContext();
        if (fileAnimation != null) fileAnimation.cancel();
        LinearLayout card = new LinearLayout(context); card.setOrientation(LinearLayout.VERTICAL);
        detailContent.addView(card, new LinearLayout.LayoutParams(-1, -2));
        LinearLayout row = new LinearLayout(context); row.setGravity(Gravity.CENTER_VERTICAL);
        row.setPadding(dp(16), dp(16), dp(8), dp(16));
        GradientDrawable upper = new GradientDrawable(); upper.setColor(0xffedf3ef); upper.setCornerRadius(dp(24)); row.setBackground(upper);
        android.widget.ImageView image = new android.widget.ImageView(context);
        image.setImageDrawable(new GalleryIcons(GalleryIcons.IMAGE, 0xff1f6f67)); row.addView(image, new LinearLayout.LayoutParams(dp(24), dp(24)));
        LinearLayout labels = new LinearLayout(context); labels.setOrientation(LinearLayout.VERTICAL); labels.setPadding(dp(16), 0, dp(8), 0);
        TextView name = text(context, 15); name.setText(item.name); name.setTextIsSelectable(true); labels.addView(name);
        TextView info = text(context, 13); info.setTextColor(0xff68737d); info.setText(resolution == null ? "图片" : resolution); info.setPadding(0, dp(8), 0, 0); labels.addView(info);
        row.addView(labels, new LinearLayout.LayoutParams(0, -2, 1));
        MaterialButton arrow = NativeControls.icon(context, GalleryIcons.DOWN, 0xff1f6f67, () -> {});
        arrow.setContentDescription("展开文件路径");
        row.addView(arrow, new LinearLayout.LayoutParams(dp(48), dp(48)));
        card.addView(row, new LinearLayout.LayoutParams(-1, -2));
        FrameLayout reveal = new FrameLayout(context); reveal.setClipChildren(true);
        LinearLayout.LayoutParams revealParams = new LinearLayout.LayoutParams(-1, 0); card.addView(reveal, revealParams);
        TextView path = text(context, 14); path.setTextColor(0xff68737d); path.setTextIsSelectable(true);
        path.setText("设备端 · " + formatBytes(item.bytes) + "\n" + (item.folderPath.isEmpty() ? "系统未提供文件路径" : item.folderPath));
        path.setPadding(dp(20), dp(18), dp(20), dp(20));
        GradientDrawable lower = new GradientDrawable(); lower.setColor(0xfff3f6f4); lower.setCornerRadius(dp(24)); path.setBackground(lower);
        reveal.addView(path, new FrameLayout.LayoutParams(-1, -2));
        final float[] fraction = {0}; final boolean[] expanded = {false};
        arrow.setOnClickListener(view -> {
            if (fileAnimation != null) fileAnimation.cancel();
            expanded[0] = !expanded[0];
            arrow.setContentDescription(expanded[0] ? "收起文件路径" : "展开文件路径");
            androidx.core.view.ViewCompat.setStateDescription(arrow, expanded[0] ? "已展开" : "已收起");
            path.measure(View.MeasureSpec.makeMeasureSpec(card.getWidth(), View.MeasureSpec.EXACTLY), View.MeasureSpec.makeMeasureSpec(0, View.MeasureSpec.UNSPECIFIED));
            int height = path.getMeasuredHeight();
            path.setLayoutParams(new FrameLayout.LayoutParams(-1, height));
            fileAnimation = ValueAnimator.ofFloat(fraction[0], expanded[0] ? 1f : 0f);
            fileAnimation.setDuration(280);
            fileAnimation.setInterpolator(new androidx.interpolator.view.animation.FastOutSlowInInterpolator());
            fileAnimation.addUpdateListener(animation -> {
                float value = (float) animation.getAnimatedValue(); fraction[0] = value;
                revealParams.height = Math.round(height * value); revealParams.topMargin = Math.round(dp(2) * value); reveal.setLayoutParams(revealParams);
                path.setAlpha(value); arrow.setRotation(180 * value);
                float outer = dp(24), inner = dp(24) - dp(20) * value;
                upper.setCornerRadii(new float[]{outer, outer, outer, outer, inner, inner, inner, inner});
                lower.setCornerRadii(new float[]{inner, inner, inner, inner, outer, outer, outer, outer});
            });
            fileAnimation.start();
        });
    }

    private float detailTarget() { return root.getHeight() * .64f; }

    private void animateDetails(float target) {
        if (detailAnimation != null) detailAnimation.cancel();
        detailAnimation = ValueAnimator.ofFloat(detailReveal, target);
        detailAnimation.setDuration(220);
        detailAnimation.addUpdateListener(animation -> applyDetails((float) animation.getAnimatedValue()));
        detailAnimation.start();
    }

    private void applyDetails(float reveal) {
        detailReveal = reveal;
        details.setTranslationY(root.getHeight() - reveal);
        details.setVisibility(reveal > 0 ? View.VISIBLE : View.INVISIBLE);
        // Preserve the image's width; move the image and the information together with the finger.
        pager.setTranslationY(-reveal * .55f);
        pager.setUserInputEnabled(reveal == 0);
        boolean showChrome = chromeVisible && reveal == 0;
        top.setVisibility(showChrome ? View.VISIBLE : View.INVISIBLE);
        bottom.setVisibility(showChrome ? View.VISIBLE : View.INVISIBLE);
        detailBack.setVisibility(reveal > 0 ? View.VISIBLE : View.INVISIBLE);
        int background = chromeVisible || reveal > 0 ? Color.WHITE : Color.BLACK;
        root.setBackgroundColor(background);
        pager.setBackgroundColor(background);
        for (Page page : pages) page.itemView.setBackgroundColor(background);
        Window window = getWindow();
        if (window != null) {
            window.setStatusBarColor(background); window.setNavigationBarColor(background);
            window.getDecorView().setSystemUiVisibility(Color.red(background) > 128
                ? View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR | View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR : 0);
        }
    }

    private boolean currentImageCanPan() {
        for (Page page : pages) if (page.getBindingAdapterPosition() == pager.getCurrentItem()) {
            return page.image.canScrollVertically(1) || page.image.canScrollVertically(-1)
                || page.image.canScrollHorizontally(1) || page.image.canScrollHorizontally(-1);
        }
        return false;
    }

    private final class ViewerRoot extends FrameLayout {
        private float downX, downY, initialReveal;
        private boolean dragging, multiTouch, eligible;
        private boolean cancellingChild;
        ViewerRoot(Context context) { super(context); }
        private boolean detectDrag(MotionEvent event) {
            if (event.getActionMasked() == MotionEvent.ACTION_DOWN) {
                downX = event.getX(); downY = event.getY(); initialReveal = detailReveal;
                dragging = false; multiTouch = false;
                eligible = detailReveal > 0 || downY > top.getBottom() && downY < bottom.getTop();
            } else if (event.getActionMasked() == MotionEvent.ACTION_POINTER_DOWN) multiTouch = true;
            else if (event.getActionMasked() == MotionEvent.ACTION_MOVE && eligible && !multiTouch) {
                float dx = event.getX() - downX, dy = event.getY() - downY;
                boolean mayDrag = detailReveal == 0 ? dy < 0 && !currentImageCanPan()
                    : downY < details.getY() || dy > 0 && details.getScrollY() == 0;
                if (mayDrag && Math.abs(dy) > dp(8) && Math.abs(dy) > Math.abs(dx) * 1.25f) {
                    if (detailAnimation != null) detailAnimation.cancel();
                    if (detailReveal == 0) {
                        chromeVisible = true;
                        prepareDetails();
                    }
                    dragging = true; getParent().requestDisallowInterceptTouchEvent(true);
                    return true;
                }
            }
            return dragging;
        }
        @Override public boolean dispatchTouchEvent(MotionEvent event) {
            if (transitioning || closing) return true;
            boolean wasDragging = dragging;
            if (detectDrag(event)) {
                if (!wasDragging) {
                    MotionEvent cancel = MotionEvent.obtain(event); cancel.setAction(MotionEvent.ACTION_CANCEL);
                    cancellingChild = true;
                    super.dispatchTouchEvent(cancel); cancel.recycle();
                    cancellingChild = false;
                }
                return onTouchEvent(event);
            }
            return super.dispatchTouchEvent(event);
        }
        @Override public boolean onTouchEvent(MotionEvent event) {
            if (cancellingChild) return false;
            if (!dragging) return super.onTouchEvent(event);
            if (event.getActionMasked() == MotionEvent.ACTION_MOVE) {
                applyDetails(Math.max(0, Math.min(detailTarget(), initialReveal + downY - event.getY())));
            } else if (event.getActionMasked() == MotionEvent.ACTION_UP || event.getActionMasked() == MotionEvent.ACTION_CANCEL) {
                float movement = downY - event.getY();
                boolean open = initialReveal == 0 ? detailReveal > detailTarget() * .22f
                    : movement > -dp(80) && detailReveal > detailTarget() * .45f;
                dragging = false; animateDetails(open ? detailTarget() : 0);
            }
            return true;
        }
        @Override protected void onSizeChanged(int w, int h, int oldw, int oldh) {
            super.onSizeChanged(w, h, oldw, oldh);
            post(() -> { if (!closed) applyDetails(detailReveal > 0 ? detailTarget() : 0); });
        }
    }
    private String formatBytes(long bytes) {
        if (bytes < 1024) return bytes + " B";
        if (bytes < 1024 * 1024) return String.format(Locale.CHINA, "%.1f KB", bytes / 1024.0);
        return String.format(Locale.CHINA, "%.1f MB", bytes / (1024.0 * 1024));
    }

    private void toggleChrome() {
        if (detailReveal > 0) { animateDetails(0); return; }
        chromeVisible = !chromeVisible;
        applyDetails(0);
    }

    @Override public void onBackPressed() {
        if (detailReveal > 0) animateDetails(0);
        else dismiss();
    }

    @Override public void dismiss() {
        if (closed || closing) return;
        if (root == null || !isShowing()) { finishDismiss(); return; }
        closing = true;
        if (imageAnimation != null) imageAnimation.cancel();
        thumbnailTarget.find(items.get(pager.getCurrentItem()), target -> animateImage(target, false));
    }

    private void finishDismiss() {
        closed = true;
        if (fileAnimation != null) fileAnimation.cancel();
        if (detailAnimation != null) detailAnimation.cancel();
        for (Page page : pages) page.clear();
        if (pager != null) pager.setAdapter(null);
        super.dismiss();
    }

    private void animateImage(android.widget.ImageView thumbnail, boolean opening) {
        if (closed) return;
        android.graphics.Bitmap bitmap = null;
        for (Page page : pages) if (page.getBindingAdapterPosition() == pager.getCurrentItem()
                && page.image.getDrawable() instanceof BitmapDrawable)
            bitmap = ((BitmapDrawable) page.image.getDrawable()).getBitmap();
        if (bitmap == null) bitmap = images.cachedThumbnail(items.get(pager.getCurrentItem()));
        if (thumbnail == null || bitmap == null || root.getWidth() == 0) {
            root.setAlpha(1);
            if (!opening) finishDismiss();
            return;
        }
        final android.graphics.Bitmap picture = bitmap;
        int[] origin = new int[2], small = new int[2]; root.getLocationOnScreen(origin); thumbnail.getLocationOnScreen(small);
        android.graphics.RectF smallRect = new android.graphics.RectF(small[0] - origin[0], small[1] - origin[1],
            small[0] - origin[0] + thumbnail.getWidth(), small[1] - origin[1] + thumbnail.getHeight());
        float fit = Math.min((float) root.getWidth() / picture.getWidth(), (float) root.getHeight() / picture.getHeight());
        float w = picture.getWidth() * fit, h = picture.getHeight() * fit;
        android.graphics.RectF largeRect = new android.graphics.RectF((root.getWidth() - w) / 2, (root.getHeight() - h) / 2 - detailReveal * .55f,
            (root.getWidth() + w) / 2, (root.getHeight() + h) / 2 - detailReveal * .55f);
        if (!opening) for (Page page : pages) if (page.getBindingAdapterPosition() == pager.getCurrentItem()) {
            com.github.panpf.zoomimage.util.RectCompat rect = page.image.getZoomable().getContentDisplayRectFState().getValue();
            if (!rect.isEmpty()) {
                int[] location = new int[2]; page.image.getLocationOnScreen(location);
                largeRect.set(rect.getLeft() + location[0] - origin[0], rect.getTop() + location[1] - origin[1],
                    rect.getRight() + location[0] - origin[0], rect.getBottom() + location[1] - origin[1]);
            }
        }
        float cover = Math.max(smallRect.width() / picture.getWidth(), smallRect.height() / picture.getHeight());
        android.graphics.RectF smallImage = new android.graphics.RectF(smallRect.centerX() - picture.getWidth() * cover / 2,
            smallRect.centerY() - picture.getHeight() * cover / 2, smallRect.centerX() + picture.getWidth() * cover / 2,
            smallRect.centerY() + picture.getHeight() * cover / 2);
        android.graphics.RectF largeClip = new android.graphics.RectF(largeRect);
        largeClip.intersect(0, 0, root.getWidth(), root.getHeight());
        final float[] fraction = {opening ? 0 : 1};
        View overlay = new View(getContext()) {
            private final android.graphics.Paint paint = new android.graphics.Paint(android.graphics.Paint.ANTI_ALIAS_FLAG);
            @Override protected void onDraw(android.graphics.Canvas canvas) {
                float t = fraction[0];
                android.graphics.RectF box = new android.graphics.RectF(
                    smallRect.left + (largeClip.left - smallRect.left) * t, smallRect.top + (largeClip.top - smallRect.top) * t,
                    smallRect.right + (largeClip.right - smallRect.right) * t, smallRect.bottom + (largeClip.bottom - smallRect.bottom) * t);
                android.graphics.RectF drawn = new android.graphics.RectF(
                    smallImage.left + (largeRect.left - smallImage.left) * t, smallImage.top + (largeRect.top - smallImage.top) * t,
                    smallImage.right + (largeRect.right - smallImage.right) * t, smallImage.bottom + (largeRect.bottom - smallImage.bottom) * t);
                canvas.save(); canvas.clipRect(box);
                canvas.drawBitmap(picture, null, drawn, paint); canvas.restore();
            }
        };
        transitioning = true; root.setAlpha(1); pager.setAlpha(0);
        // The thumbnail belongs to a different window. Keep it drawn until the
        // opaque transition image covers it; cross-window alpha updates can leave a blank frame.
        root.addView(overlay, new FrameLayout.LayoutParams(-1, -1));
        root.setBackgroundColor(opening ? Color.TRANSPARENT : (chromeVisible || detailReveal > 0 ? Color.WHITE : Color.BLACK));
        top.setAlpha(opening ? 0f : 1f); bottom.setAlpha(opening ? 0f : 1f);
        details.setAlpha(opening ? 0f : 1f); detailBack.setAlpha(opening ? 0f : 1f);
        imageAnimation = ValueAnimator.ofFloat(opening ? 0 : 1, opening ? 1 : 0);
        imageAnimation.setDuration(280); imageAnimation.setInterpolator(new androidx.interpolator.view.animation.FastOutSlowInInterpolator());
        imageAnimation.addUpdateListener(animation -> {
            fraction[0] = (float) animation.getAnimatedValue(); float alpha = fraction[0];
            root.setBackgroundColor(Color.argb(Math.round(255 * alpha), chromeVisible || detailReveal > 0 ? 255 : 0, chromeVisible || detailReveal > 0 ? 255 : 0, chromeVisible || detailReveal > 0 ? 255 : 0));
            top.setAlpha(alpha); bottom.setAlpha(alpha); details.setAlpha(alpha); detailBack.setAlpha(alpha); overlay.invalidate();
        });
        imageAnimation.addListener(new android.animation.AnimatorListenerAdapter() {
            @Override public void onAnimationEnd(android.animation.Animator animation) {
                if (opening) {
                    pager.setAlpha(1f); applyDetails(detailReveal);
                    // Keep the last overlay frame until the actual image has completed layout.
                    androidx.core.view.OneShotPreDrawListener.add(pager, () -> {
                        root.removeView(overlay); transitioning = false;
                    });
                    pager.invalidate();
                } else {
                    // Dismiss with the final thumbnail-sized image still in the window.
                    // The already drawn gallery underneath takes over atomically.
                    transitioning = false; finishDismiss();
                }
            }
        });
        imageAnimation.start();
    }

    private final class Page extends RecyclerView.ViewHolder {
        final ZoomImageView image;
        final TextView message;
        Future<?> request;
        int generation;
        Page(Context context) {
            super(new FrameLayout(context));
            FrameLayout frame = (FrameLayout)itemView;
            frame.setBackgroundColor(Color.TRANSPARENT);
            frame.setLayoutParams(new ViewGroup.LayoutParams(-1, -1));
            image = new ZoomImageView(context); image.setScaleType(android.widget.ImageView.ScaleType.FIT_CENTER);
            image.setBackgroundColor(Color.TRANSPARENT);
            image.setScrollBar(null);
            image.setContentDescription("游戏截图，左右滑动切图，双击或双指缩放，轻点隐藏控件，上拉查看详情");
            image.setOnViewTapListener((view, offset) -> toggleChrome());
            frame.addView(image, new FrameLayout.LayoutParams(-1, -1));
            message = text(context, 14); message.setGravity(Gravity.CENTER); message.setPadding(dp(32), 0, dp(32), 0);
            frame.addView(message, new FrameLayout.LayoutParams(-1, -1));
        }
        void bind(ScreenshotStore.Entry item) {
            clear(); int token = generation;
            android.graphics.Bitmap cached = images.cachedThumbnail(item);
            if (cached != null) {
                BitmapDrawable preview = new BitmapDrawable(getContext().getResources(), cached);
                preview.setFilterBitmap(false); image.setImageDrawable(preview); message.setVisibility(View.GONE);
            } else { message.setText("正在读取…"); message.setVisibility(View.VISIBLE); }
            request = images.load(item, true, bitmap -> {
                if (closed || token != generation) return;
                if (bitmap == null) message.setText("图片无法读取\n请返回刷新图库");
                else {
                    dimensions.put(item.id, bitmap.getWidth() + " × " + bitmap.getHeight());
                    BitmapDrawable drawable = new BitmapDrawable(getContext().getResources(), bitmap); drawable.setFilterBitmap(false);
                    image.setImageDrawable(drawable); message.setVisibility(View.GONE);
                }
            });
        }
        void clear() { generation++; if (request != null) request.cancel(true); request = null; image.setImageDrawable(null); }
    }

    private TextView text(Context context, int size) { TextView view = new TextView(context); view.setTextColor(0xff17212b); view.setTextSize(size); return view; }
    private int dp(int value) { return Math.round(value * getContext().getResources().getDisplayMetrics().density); }
    private void action(LinearLayout parent, String label, String path, Runnable callback) {
        LinearLayout box = new LinearLayout(parent.getContext()); box.setOrientation(LinearLayout.VERTICAL);
        box.setGravity(Gravity.CENTER); box.setContentDescription(label); box.setOnClickListener(view -> callback.run());
        android.widget.ImageView image = new android.widget.ImageView(parent.getContext());
        image.setImageDrawable(new GalleryIcons(path, 0xff1f6f67));
        box.addView(image, new LinearLayout.LayoutParams(dp(24), dp(24)));
        TextView caption = text(parent.getContext(), 12); caption.setText(label); caption.setGravity(Gravity.CENTER);
        caption.setIncludeFontPadding(false); caption.setPadding(0, dp(7), 0, 0);
        box.addView(caption, new LinearLayout.LayoutParams(-1, -2));
        parent.addView(box, new LinearLayout.LayoutParams(0, dp(52), 1));
    }
    private MaterialButton icon(LinearLayout parent, String label, String path, Runnable action) {
        MaterialButton button = new MaterialButton(parent.getContext(), null, com.google.android.material.R.attr.borderlessButtonStyle);
        button.setIcon(new GalleryIcons(path, 0xff17212b)); button.setIconTint(ColorStateList.valueOf(0xff17212b));
        button.setIconSize(dp(24)); button.setIconPadding(0); button.setPadding(dp(12), 0, dp(12), 0);
        button.setMinWidth(0); button.setMinimumWidth(0); button.setInsetTop(0); button.setInsetBottom(0);
        button.setContentDescription(label); button.setTooltipText(label); button.setCornerRadius(dp(24));
        button.setOnClickListener(view -> action.run()); parent.addView(button, new LinearLayout.LayoutParams(dp(48), dp(48))); return button;
    }
}
