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
    private final String directory;
    private final Map<String, String> dimensions = new HashMap<>();
    private final List<Page> pages = new ArrayList<>();
    private final int start;
    private ViewPager2 pager;
    private LinearLayout top, bottom;
    private TextView title, subtitle;
    private ViewerRoot root;
    private ScrollView details;
    private LinearLayout detailContent;
    private android.widget.ImageView detailBack;
    private float detailReveal;
    private ValueAnimator detailAnimation;
    private boolean chromeVisible = true, closed;

    ScreenshotViewer(Context context, List<ScreenshotStore.Entry> items, int start,
            ScreenshotImageLoader images, String directory, Consumer<ScreenshotStore.Entry> share, Consumer<ScreenshotStore.Entry> delete) {
        super(context, android.R.style.Theme_Material_Light_NoActionBar);
        this.items = items; this.start = Math.max(0, start); this.images = images; this.directory = directory;
        this.share = share; this.delete = delete;
    }

    @Override protected void onCreate(Bundle state) {
        super.onCreate(state);
        // Use the scoped Material theme supplied by the gallery for library widgets.
        Context context = new android.view.ContextThemeWrapper(getContext(), R.style.GalleryTheme);
        root = new ViewerRoot(context); root.setBackgroundColor(Color.WHITE);
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
            @Override public void onPageSelected(int position) { updateTitle(position); }
        });
        pager.setCurrentItem(start, false); updateTitle(start);
        Window window = getWindow();
        if (window != null) {
            window.setStatusBarColor(Color.WHITE); window.setNavigationBarColor(Color.WHITE);
            window.getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR | View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR);
            window.setLayout(-1, -1);
        }
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
        infoElement("文件", GalleryIcons.IMAGE, item.name,
            (resolution == null ? "图片" : resolution) + "  ·  " + formatBytes(item.bytes));
        if (!directory.isEmpty()) infoElement("保存目录", GalleryIcons.FOLDER, directory, "截图保存目录");
    }

    private void infoElement(String label, String path, String value, String secondary) {
        Context context = root.getContext();
        LinearLayout row = new LinearLayout(context); row.setGravity(Gravity.CENTER_VERTICAL);
        row.setPadding(dp(16), dp(16), dp(16), dp(16));
        GradientDrawable fill = new GradientDrawable(); fill.setColor(0xffedf3ef); fill.setCornerRadius(dp(20)); row.setBackground(fill);
        android.widget.ImageView icon = new android.widget.ImageView(context);
        icon.setImageDrawable(new GalleryIcons(path, 0xff1f6f67)); row.addView(icon, new LinearLayout.LayoutParams(dp(24), dp(24)));
        LinearLayout labels = new LinearLayout(context); labels.setOrientation(LinearLayout.VERTICAL); labels.setPadding(dp(16), 0, 0, 0);
        TextView name = text(context, 15); name.setText(value); name.setTextIsSelectable(true); labels.addView(name);
        TextView info = text(context, 13); info.setTextColor(0xff68737d); info.setText(secondary); info.setPadding(0, dp(8), 0, 0); labels.addView(info);
        row.addView(labels, new LinearLayout.LayoutParams(0, -2, 1)); row.setContentDescription(label);
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(-1, -2); params.bottomMargin = dp(12); detailContent.addView(row, params);
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
        else super.onBackPressed();
    }

    @Override public void dismiss() {
        closed = true;
        if (detailAnimation != null) detailAnimation.cancel();
        for (Page page : pages) page.clear();
        if (pager != null) pager.setAdapter(null);
        super.dismiss();
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
            message.setText("正在读取…"); message.setVisibility(View.VISIBLE);
            request = images.load(item, true, bitmap -> {
                if (closed || token != generation) return;
                if (bitmap == null) message.setText("图片无法读取\n请返回刷新或重新授权目录");
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
