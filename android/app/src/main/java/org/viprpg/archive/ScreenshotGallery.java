package org.viprpg.archive;

import android.app.Dialog;
import android.content.res.ColorStateList;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.BitmapDrawable;
import android.graphics.drawable.GradientDrawable;
import android.view.ContextThemeWrapper;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.BaseAdapter;
import com.google.android.material.checkbox.MaterialCheckBox;
import android.widget.FrameLayout;
import android.widget.GridView;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ListView;
import android.widget.TextView;
import android.widget.Toast;
import android.widget.ProgressBar;
import android.text.TextUtils;
import com.google.android.material.button.MaterialButton;
import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.Future;
import java.util.function.Consumer;

/** Android owns timeline, selection and viewer; the website never reads directory files. */
final class ScreenshotGallery extends LinearLayout {
    private static final int PAPER = 0xfff5f4ef, INK = 0xff17212b, MUTED = 0xff68737d,
        TEAL = 0xff1f6f67, TINT = 0xffe0f0eb, DARK = 0xff101418;
    private final MainActivity activity;
    private final ScreenshotController controller;
    private final ScreenshotImageLoader images;
    private final TextView status, selectionCount, emptyTitle;
    private final MaterialButton manage, selectAll, share, delete, cancel, leaveSelection, gameBack, timelineTab, gamesTab;
    private final LinearLayout selectionBar, selectionHeader, tabs, empty;
    private final ArchivePageHeader normalHeader;
    private final ProgressBar progress;
    private final androidx.swiperefreshlayout.widget.SwipeRefreshLayout refreshLayout;
    private boolean directoryReady;
    private final ListView list;
    private final GridView gameGrid;
    private final TimelineAdapter adapter = new TimelineAdapter();
    private final GameAdapter gameAdapter = new GameAdapter();
    private final Set<String> selected = new HashSet<>();
    private List<ScreenshotStore.Entry> all = new ArrayList<>(), visible = new ArrayList<>();
    private final List<Row> rows = new ArrayList<>();
    private final List<GameGroup> games = new ArrayList<>();
    private long gameId;
    private boolean gamesPage;
    private boolean selecting, loading, operating, closed, dirty = true, initialized;
    private final android.os.Handler changes = new android.os.Handler(android.os.Looper.getMainLooper());
    private final Runnable refreshChanged = () -> { if (!closed && isShown() && dirty && !loading && !operating) refresh(null); };
    private final android.database.ContentObserver mediaObserver = new android.database.ContentObserver(changes) {
        @Override public void onChange(boolean selfChange) {
            dirty = true;
            changes.removeCallbacks(refreshChanged);
            changes.postDelayed(refreshChanged, 180);
        }
    };
    private int generation;
    private Dialog viewer;
    private int columns = 3;

    ScreenshotGallery(MainActivity activity, ScreenshotController controller) {
        super(new ContextThemeWrapper(activity, R.style.GalleryTheme));
        this.activity = activity; this.controller = controller;
        images = new ScreenshotImageLoader(controller.store);
        setOrientation(VERTICAL); setBackgroundColor(PAPER);
        normalHeader = new ArchivePageHeader(activity, "图库");
        gameBack = icon(normalHeader.leading(), "返回游戏合集", GalleryIcons.BACK, () -> { gameId = 0; selected.clear(); rebuild(); }, false);
        manage = icon(normalHeader.actions(), "选择截图", GalleryIcons.SELECT, () -> { selecting = true; selected.clear(); rebuild(); }, false);
        addView(normalHeader);
        selectionHeader = row(); selectionHeader.setPadding(dp(8), dp(12), dp(12), dp(8));
        leaveSelection = icon(selectionHeader, "退出选择", GalleryIcons.CLOSE, () -> { selecting = false; selected.clear(); rebuild(); }, false);
        selectionCount = text("", 20); selectionCount.setTypeface(null, Typeface.BOLD);
        selectionHeader.addView(selectionCount, new LinearLayout.LayoutParams(0, dp(56), 1)); selectionCount.setGravity(Gravity.CENTER_VERTICAL);
        selectAll = button(selectionHeader, "全选", () -> {
            boolean complete = !visible.isEmpty() && visible.stream().allMatch(item -> selected.contains(item.id));
            for (ScreenshotStore.Entry item : visible) { if (complete) selected.remove(item.id); else selected.add(item.id); }
            rebuild();
        });
        addView(selectionHeader);
        LinearLayout feedback = row(); feedback.setPadding(dp(20), 0, dp(12), 0);
        status = text("", 12); status.setTextColor(MUTED); status.setPadding(0, dp(4), 0, dp(6));
        status.setAccessibilityLiveRegion(View.ACCESSIBILITY_LIVE_REGION_POLITE);
        feedback.addView(status, new LinearLayout.LayoutParams(0, -2, 1));
        cancel = button(feedback, "取消任务", this::cancelOperation);
        cancel.setVisibility(GONE); addView(feedback);
        progress = new ProgressBar(getContext(), null, android.R.attr.progressBarStyleHorizontal);
        progress.setIndeterminate(true); progress.setIndeterminateTintList(ColorStateList.valueOf(TEAL));
        addView(progress, new LinearLayout.LayoutParams(-1, dp(2)));
        refreshLayout = new androidx.swiperefreshlayout.widget.SwipeRefreshLayout(getContext());
        refreshLayout.setColorSchemeColors(TEAL);
        refreshLayout.setProgressBackgroundColorSchemeColor(Color.WHITE);
        refreshLayout.setOnRefreshListener(() -> refresh(null, true));
        addView(refreshLayout, new LinearLayout.LayoutParams(-1, 0, 1));
        FrameLayout body = new FrameLayout(getContext()); refreshLayout.addView(body, new androidx.swiperefreshlayout.widget.SwipeRefreshLayout.LayoutParams(-1, -1));
        list = new ListView(getContext()); list.setDivider(null); list.setAdapter(adapter);
        list.setPadding(0, 0, 0, dp(96)); list.setClipToPadding(false); list.setSelector(android.R.color.transparent);
        body.addView(list, new FrameLayout.LayoutParams(-1, -1));
        gameGrid = new GridView(getContext()); gameGrid.setNumColumns(2); gameGrid.setHorizontalSpacing(dp(12));
        gameGrid.setVerticalSpacing(dp(18)); gameGrid.setPadding(dp(16), dp(12), dp(16), dp(96));
        gameGrid.setClipToPadding(false); gameGrid.setSelector(android.R.color.transparent); gameGrid.setAdapter(gameAdapter);
        body.addView(gameGrid, new FrameLayout.LayoutParams(-1, -1));
        refreshLayout.setOnChildScrollUpCallback((parent, child) -> (gamesPage && gameId == 0 ? gameGrid : list).canScrollVertically(-1));
        empty = new LinearLayout(getContext()); empty.setOrientation(VERTICAL); empty.setGravity(Gravity.CENTER); empty.setPadding(dp(32), 0, dp(32), dp(48));
        ImageView emptyIcon = new ImageView(getContext()); emptyIcon.setImageDrawable(new GalleryIcons(GalleryIcons.IMAGE, TEAL));
        emptyIcon.setPadding(dp(20), dp(20), dp(20), dp(20)); emptyIcon.setBackground(shape(TINT, 24));
        empty.addView(emptyIcon, new LinearLayout.LayoutParams(dp(80), dp(80)));
        emptyTitle = text("暂无截图", 21); emptyTitle.setTypeface(null, Typeface.BOLD); emptyTitle.setGravity(Gravity.CENTER); emptyTitle.setPadding(0, dp(20), 0, dp(8)); empty.addView(emptyTitle);
        body.addView(empty, new FrameLayout.LayoutParams(-1, -1));
        tabs = row(); tabs.setGravity(Gravity.CENTER); tabs.setPadding(dp(6), dp(6), dp(6), dp(6));
        tabs.setBackground(shape(0xfff8f7fa, 36)); tabs.setElevation(dp(10));
        timelineTab = button(tabs, "时间轴", () -> { gamesPage = false; gameId = 0; selected.clear(); rebuild(); list.setSelection(0); });
        gamesTab = button(tabs, "按游戏", () -> { gamesPage = true; gameId = 0; selected.clear(); rebuild(); });
        timelineTab.setContentDescription("时间轴"); gamesTab.setContentDescription("按游戏");
        FrameLayout.LayoutParams tabPosition = new FrameLayout.LayoutParams(-2, dp(64), Gravity.BOTTOM | Gravity.CENTER_HORIZONTAL);
        tabPosition.bottomMargin = dp(16); body.addView(tabs, tabPosition);
        selectionBar = row(); selectionBar.setGravity(Gravity.CENTER); selectionBar.setPadding(dp(16), dp(8), dp(16), dp(8)); selectionBar.setBackgroundColor(Color.WHITE);
        share = button(selectionBar, "分享", () -> shareEntries(selectedEntries())); share.setIcon(new GalleryIcons(GalleryIcons.SHARE, TEAL));
        delete = button(selectionBar, "删除", () -> confirmDelete(selectedEntries())); delete.setIcon(new GalleryIcons(GalleryIcons.DELETE, 0xffad4037)); delete.setTextColor(0xffad4037); delete.setIconTint(ColorStateList.valueOf(0xffad4037));
        share.setLayoutParams(new LinearLayout.LayoutParams(0, dp(48), 1)); delete.setLayoutParams(new LinearLayout.LayoutParams(0, dp(48), 1));
        addView(selectionBar);
        activity.getContentResolver().registerContentObserver(android.provider.MediaStore.Images.Media.EXTERNAL_CONTENT_URI, true, mediaObserver);
        updateControls();
    }

    void open() { refresh(null); }

    void refreshOnResume() { if (!loading && !operating && !controller.isBusy()) refresh(null); }

    private void cancelOperation() { controller.cancelBatch(); cancel.setEnabled(false); }

    private void refresh(String message) { refresh(message, false); }
    private void refresh(String message, boolean manual) {
        if (closed || operating || loading) {
            dirty = true;
            if (manual) refreshLayout.setRefreshing(loading);
            return;
        }
        dirty = false;
        int request = ++generation;
        loading = true; if (manual) refreshLayout.setRefreshing(true); updateControls();
        controller.execute(() -> {
            ScreenshotStore.Directory state = controller.store.status();
            return new Snapshot(state, state.ready ? controller.store.list() : new ArrayList<>());
        }, (snapshot, error) -> {
            if (closed || request != generation) return;
            loading = false; initialized = true;
            refreshLayout.setRefreshing(false);
            List<ScreenshotStore.Entry> next = snapshot == null ? all : snapshot.items;
            boolean changed = all.size() != next.size();
            if (!changed) for (int i = 0; i < all.size(); i++) {
                ScreenshotStore.Entry before = all.get(i), after = next.get(i);
                if (!before.id.equals(after.id) || before.bytes != after.bytes || !before.name.equals(after.name) || !before.folderPath.equals(after.folderPath) || before.modified != after.modified) { changed = true; break; }
            }
            all = next;
            if (snapshot == null) directoryReady = false;
            Set<String> available = new HashSet<>(); for (ScreenshotStore.Entry item : all) available.add(item.id);
            selected.retainAll(available);
            if (snapshot != null) {
                directoryReady = snapshot.directory.ready;

            }
            if (gameId != 0 && all.stream().noneMatch(item -> item.workId == gameId)) gameId = 0;
            if (changed) {
                android.os.Parcelable listPosition = list.onSaveInstanceState(), gridPosition = gameGrid.onSaveInstanceState();
                rebuild(); list.onRestoreInstanceState(listPosition); gameGrid.onRestoreInstanceState(gridPosition);
            } else updateControls();
            status.setText(error != null ? error : message != null ? message : "");
            status.setVisibility(status.getText().length() == 0 ? GONE : VISIBLE);
            emptyTitle.setText(error != null ? "暂时无法读取截图" : "暂无截图");
            if (dirty) changes.post(refreshChanged);
        });
    }

    private void rebuild() {
        visible = new ArrayList<>();
        for (ScreenshotStore.Entry entry : all) if (gameId == 0 || entry.workId == gameId) visible.add(entry);
        Map<Long, GameGroup> grouped = new LinkedHashMap<>();
        for (ScreenshotStore.Entry entry : all)
            grouped.computeIfAbsent(entry.workId, id -> new GameGroup(id, entry.title)).items.add(entry);
        games.clear(); games.addAll(grouped.values()); gameAdapter.notifyDataSetChanged();
        if (gameId != 0 && !visible.isEmpty()) normalHeader.setFolderTitle(visible.get(0).title);
        else normalHeader.setTitle("图库");
        rows.clear();
        for (int i = 0; i < visible.size();) {
            LocalDate date = visible.get(i).createdAt.toLocalDate();
            List<ScreenshotStore.Entry> day = new ArrayList<>();
            while (i < visible.size() && visible.get(i).createdAt.toLocalDate().equals(date)) day.add(visible.get(i++));
            rows.add(new Row(date, day));
            for (int j = 0; j < day.size(); j += columns) rows.add(new Row(null, day.subList(j, Math.min(j + columns, day.size()))));
        }
        adapter.notifyDataSetChanged(); updateControls();
    }

    private void updateControls() {
        boolean enabled = !operating;
        refreshLayout.setEnabled(!operating && !selecting);
        manage.setEnabled(enabled && !all.isEmpty());
        manage.setVisibility(gamesPage && gameId == 0 ? GONE : VISIBLE);
        gameBack.setVisibility(gameId == 0 ? GONE : VISIBLE);
        normalHeader.setVisibility(selecting ? GONE : VISIBLE); selectionHeader.setVisibility(selecting ? VISIBLE : GONE);
        tabs.setVisibility(selecting || gameId != 0 || all.isEmpty() ? GONE : VISIBLE);
        styleTab(timelineTab, !gamesPage, GalleryIcons.CLOCK);
        styleTab(gamesTab, gamesPage, GalleryIcons.GAMEPAD);
        selectionBar.setVisibility(selecting ? VISIBLE : GONE);
        selectionCount.setText("已选 " + selected.size() + " 张");
        leaveSelection.setEnabled(enabled);
        progress.setVisibility(operating ? VISIBLE : GONE);
        status.setVisibility(status.getText().length() == 0 ? GONE : VISIBLE);
        empty.setVisibility(all.isEmpty() && (initialized || !loading) ? VISIBLE : GONE);
        boolean showGames = gamesPage && gameId == 0;
        list.setVisibility(!showGames && !visible.isEmpty() ? VISIBLE : GONE);
        gameGrid.setVisibility(showGames && !games.isEmpty() ? VISIBLE : GONE);
        selectAll.setEnabled(enabled && !visible.isEmpty());
        boolean complete = !visible.isEmpty() && visible.stream().allMatch(item -> selected.contains(item.id));
        selectAll.setText(complete ? "取消全选" : "全选");
        share.setEnabled(enabled && !selected.isEmpty()); delete.setEnabled(enabled && !selected.isEmpty());
        cancel.setVisibility(operating ? VISIBLE : GONE); cancel.setEnabled(operating);
    }

    private void styleTab(MaterialButton tab, boolean active, String icon) {
        tab.setCornerRadius(dp(30)); tab.setElevation(0);
        tab.setTextSize(15); tab.setIconSize(dp(20)); tab.setIconPadding(dp(7));
        tab.setIcon(active ? new GalleryIcons(icon, INK) : null);
        tab.setLayoutParams(new LinearLayout.LayoutParams(dp(active ? 108 : 84), dp(52)));
        tab.setBackgroundTintList(ColorStateList.valueOf(active ? 0xffdfe5fb : 0xfff8f7fa));
        tab.setTextColor(active ? INK : 0xff4e515c);
        tab.setIconTint(ColorStateList.valueOf(INK));
        tab.setSelected(active);
    }

    private List<ScreenshotStore.Entry> selectedEntries() {
        List<ScreenshotStore.Entry> result = new ArrayList<>();
        for (ScreenshotStore.Entry item : visible) if (selected.contains(item.id)) result.add(item);
        return result;
    }

    private void toggle(ScreenshotStore.Entry entry) {
        if (operating) return;
        selecting = true;
        if (!selected.add(entry.id)) selected.remove(entry.id);
        rebuild();
    }

    private void confirmDelete(List<ScreenshotStore.Entry> items) {
        if (items.isEmpty()) return;
        NativeControls.dialog(getContext()).setTitle("删除 " + items.size() + " 张截图？")
            .setMessage("将永久删除截图目录中的原文件，无法撤销。游戏和存档不受影响。")
            .setNegativeButton("取消", null).setPositiveButton("删除", (dialog, which) -> runBatch(items, true)).show();
    }

    private void shareEntries(List<ScreenshotStore.Entry> items) { if (!items.isEmpty()) runBatch(items, false); }

    private void runBatch(List<ScreenshotStore.Entry> items, boolean deleting) {
        if (operating || loading) return;
        if (deleting && viewer != null) viewer.dismiss();
        operating = true; updateControls();
        status.setText((deleting ? "正在删除" : "准备分享") + " 0 / " + items.size());
        controller.batch(items, deleting, (done, total) -> status.setText((deleting ? "正在删除 " : "准备分享 ") + done + " / " + total),
            (result, error) -> {
                operating = false;
                if (error != null) { status.setText(error); updateControls(); return; }
                selected.clear();
                for (ScreenshotStore.Entry failed : result.failed) selected.add(failed.id);
                selecting = !selected.isEmpty();
                String message = (result.cancelled ? "已取消；" : "") + (deleting ? "已删除 " : "可分享 ")
                    + result.succeeded.size() + " 张" + (result.failed.isEmpty() ? "。" : "，未完成 " + result.failed.size() + " 张。")
                    + (result.error == null ? "" : " " + result.error);
                if (!deleting && !result.cancelled && !result.succeeded.isEmpty()) {
                    try { controller.share(result.succeeded); }
                    catch (Exception unavailable) {
                        message = "无法打开分享应用，请减少所选数量后重试。";
                        selected.clear();
                        for (ScreenshotStore.Entry item : items) selected.add(item.id);
                        selecting = true;
                    }
                }
                images.clear(); refresh(message);
            });
    }

    private void showViewer(ScreenshotStore.Entry entry) {
        viewer = new ScreenshotViewer(getContext(), new ArrayList<>(visible), visible.indexOf(entry), images, this::thumbnailFor,
            item -> shareEntries(java.util.Collections.singletonList(item)),
            item -> confirmDelete(java.util.Collections.singletonList(item)));
        viewer.setOnDismissListener(ignored -> viewer = null);
        viewer.show();
    }

    private void thumbnailFor(ScreenshotStore.Entry entry, Consumer<android.widget.ImageView> ready) {
        int position = -1;
        for (int i = 0; i < rows.size(); i++) {
            Row row = rows.get(i);
            if (row.date == null && row.items.stream().anyMatch(item -> item.id.equals(entry.id))) { position = i; break; }
        }
        if (closed || position < 0) { ready.accept(null); return; }
        View current = list.getChildAt(position - list.getFirstVisiblePosition());
        // Keep the current scroll position unless the destination is clipped or outside the viewport.
        if (current == null || current.getTop() < list.getPaddingTop() || current.getBottom() > list.getHeight() - dp(110))
            list.setSelectionFromTop(position, dp(56));
        androidx.core.view.OneShotPreDrawListener.add(list, () -> {
            android.widget.ImageView found = null;
            for (int i = 0; i < list.getChildCount(); i++) {
                View row = list.getChildAt(i);
                if (!(row instanceof LinearLayout)) continue;
                for (int j = 0; j < ((LinearLayout) row).getChildCount(); j++) {
                    View child = ((LinearLayout) row).getChildAt(j);
                    if (child instanceof Cell && entry.id.equals(((Cell) child).bound)) found = ((Cell) child).image;
                }
            }
            ready.accept(found);
        });
        list.invalidate();
    }

    boolean onBack() {
        if (operating) { Toast.makeText(activity, "可点击“取消任务”停止剩余操作", Toast.LENGTH_SHORT).show(); return true; }
        if (selecting) { selecting = false; selected.clear(); rebuild(); return true; }
        if (gameId != 0) { gameId = 0; rebuild(); return true; }
        return false;
    }

    void directoryResult(String error) { refresh(error); }

    void close() { activity.getContentResolver().unregisterContentObserver(mediaObserver); changes.removeCallbacksAndMessages(null); closed = true; ++generation; if (viewer != null) viewer.dismiss(); images.close(); }

    @Override protected void onSizeChanged(int w, int h, int oldw, int oldh) {
        super.onSizeChanged(w, h, oldw, oldh);
        int count = w >= dp(600) ? 5 : 3;
        if (columns != count) { columns = count; post(this::rebuild); }
    }

    private int dp(int value) { return Math.round(value * getResources().getDisplayMetrics().density); }
    private TextView text(String value, int size) { TextView view = new TextView(getContext()); view.setText(value); view.setTextSize(size); view.setTextColor(INK); return view; }
    private GradientDrawable shape(int color, int radius) { GradientDrawable drawable = new GradientDrawable(); drawable.setColor(color); drawable.setCornerRadius(dp(radius)); return drawable; }
    private LinearLayout row() { LinearLayout row = new LinearLayout(getContext()); row.setGravity(Gravity.CENTER_VERTICAL); return row; }
    private MaterialButton button(LinearLayout parent, String label, Runnable action) {
        MaterialButton button = NativeControls.button(getContext(), label, action);
        parent.addView(button, new LinearLayout.LayoutParams(-2, dp(48))); return button;
    }
    private MaterialButton icon(LinearLayout parent, String label, String path, Runnable action, boolean dark) {
        MaterialButton button = NativeControls.icon(getContext(), path, dark ? Color.WHITE : INK, action);
        button.setContentDescription(label); button.setTooltipText(label);
        parent.addView(button, new LinearLayout.LayoutParams(dp(48), dp(48))); return button;
    }

    private static final class Snapshot {
        final ScreenshotStore.Directory directory; final List<ScreenshotStore.Entry> items;
        Snapshot(ScreenshotStore.Directory directory, List<ScreenshotStore.Entry> items) { this.directory = directory; this.items = items; }
    }
    private static final class Row {
        final LocalDate date; final List<ScreenshotStore.Entry> items;
        Row(LocalDate date, List<ScreenshotStore.Entry> items) { this.date = date; this.items = items; }
    }
    private static final class GameGroup {
        final long id; final String title; final List<ScreenshotStore.Entry> items = new ArrayList<>();
        GameGroup(long id, String title) { this.id = id; this.title = title; }
    }

    private final class GameAdapter extends BaseAdapter {
        @Override public int getCount() { return games.size(); }
        @Override public Object getItem(int position) { return games.get(position); }
        @Override public long getItemId(int position) { return games.get(position).id; }
        @Override public View getView(int position, View reusable, ViewGroup parent) {
            GameCard card = reusable instanceof GameCard ? (GameCard) reusable : new GameCard();
            card.bind(games.get(position)); return card;
        }
    }

    private final class GameCard extends LinearLayout {
        private final ImageView[] covers = new ImageView[4];
        private final Future<?>[] requests = new Future<?>[4];
        private final TextView title, count;
        private int bindGeneration;
        private GameGroup current;
        GameCard() {
            super(ScreenshotGallery.this.getContext()); setOrientation(VERTICAL);
            LinearLayout mosaic = new LinearLayout(getContext()); mosaic.setOrientation(VERTICAL);
            for (int y = 0; y < 2; y++) {
                LinearLayout line = row();
                for (int x = 0; x < 2; x++) {
                    ImageView image = new ImageView(getContext()); image.setScaleType(ImageView.ScaleType.CENTER_CROP);
                    image.setBackgroundColor(TINT);
                    LinearLayout.LayoutParams tile = new LinearLayout.LayoutParams(0, 0, 1);
                    tile.height = dp(82); tile.setMargins(dp(1), dp(1), dp(1), dp(1)); line.addView(image, tile);
                    covers[y * 2 + x] = image;
                }
                mosaic.addView(line, new LinearLayout.LayoutParams(-1, dp(84)));
            }
            mosaic.setBackground(shape(TINT, 14)); mosaic.setClipToOutline(true); addView(mosaic);
            title = text("", 16); title.setTypeface(null, Typeface.BOLD); title.setSingleLine();
            title.setEllipsize(TextUtils.TruncateAt.END); title.setPadding(dp(2), dp(9), dp(2), 0); addView(title);
            count = text("", 12); count.setTextColor(MUTED); count.setPadding(dp(2), dp(3), dp(2), 0); addView(count);
        }
        void bind(GameGroup group) {
            cancel(); final int token = bindGeneration;
            current = group;
            title.setText(group.title); count.setText(group.items.size() + " 张截图");
            boolean mosaic = group.items.size() >= 4;
            LinearLayout firstRow = (LinearLayout) covers[0].getParent();
            LinearLayout secondRow = (LinearLayout) covers[2].getParent();
            firstRow.setLayoutParams(new LinearLayout.LayoutParams(-1, dp(mosaic ? 84 : 168)));
            secondRow.setVisibility(mosaic ? VISIBLE : GONE);
            for (int i = 0; i < covers.length; i++) {
                covers[i].setVisibility(mosaic || i == 0 ? VISIBLE : GONE);
                LinearLayout.LayoutParams tile = (LinearLayout.LayoutParams) covers[i].getLayoutParams();
                tile.height = dp(mosaic ? 82 : 166); covers[i].setLayoutParams(tile);
            }
            setContentDescription(group.title + "，" + group.items.size() + "张截图");
            setOnClickListener(view -> { if (operating) return;
                gameId = group.id; rebuild(); list.setSelection(0);
            });
            for (int i = 0; i < covers.length; i++) {
                ImageView cover = covers[i]; cover.setImageDrawable(null);
                if (i >= group.items.size() || !mosaic && i > 0) continue;
                ScreenshotStore.Entry entry = group.items.get(i);
                android.graphics.Bitmap cached = images.cachedThumbnail(entry);
                if (cached != null) {
                    BitmapDrawable drawable = new BitmapDrawable(getResources(), cached);
                    drawable.setFilterBitmap(false); cover.setImageDrawable(drawable);
                    continue;
                }
                requests[i] = images.load(entry, false, bitmap -> {
                    if (token != bindGeneration || bitmap == null) return;
                    BitmapDrawable drawable = new BitmapDrawable(getResources(), bitmap);
                    drawable.setFilterBitmap(false); cover.setImageDrawable(drawable);
                });
            }
        }
        void cancel() {
            bindGeneration++;
            for (int i = 0; i < requests.length; i++) { if (requests[i] != null) requests[i].cancel(true); requests[i] = null; }
        }
        @Override protected void onDetachedFromWindow() { cancel(); super.onDetachedFromWindow(); }
        @Override protected void onAttachedToWindow() {
            super.onAttachedToWindow();
            if (current != null && requests[0] == null) bind(current);
        }
    }

    private final class TimelineAdapter extends BaseAdapter {
        @Override public int getCount() { return rows.size(); }
        @Override public Object getItem(int position) { return rows.get(position); }
        @Override public long getItemId(int position) { return position; }
        @Override public int getViewTypeCount() { return 2; }
        @Override public int getItemViewType(int position) { return rows.get(position).date == null ? 1 : 0; }
        @Override public boolean isEnabled(int position) { return false; }
        @Override public View getView(int position, View reusable, ViewGroup parent) {
            Row row = rows.get(position);
            if (row.date != null) {
                LinearLayout section = reusable instanceof LinearLayout ? (LinearLayout) reusable : row();
                section.removeAllViews(); section.setPadding(dp(16), dp(8), dp(12), dp(6));
                LocalDate today = LocalDate.now();
                String date = row.date.equals(today) ? "今天" : row.date.equals(today.minusDays(1)) ? "昨天"
                    : row.date.format(DateTimeFormatter.ofPattern("yyyy年M月d日"));
                TextView day = text(date, 17); day.setTypeface(null, Typeface.BOLD);
                section.addView(day, new LinearLayout.LayoutParams(0, dp(40), 1)); day.setGravity(Gravity.CENTER_VERTICAL);
                if (selecting) {
                    MaterialCheckBox check = new MaterialCheckBox(getContext()); check.setButtonTintList(ColorStateList.valueOf(TEAL));
                    check.setContentDescription("选择" + date + "的截图"); check.setMinHeight(dp(48)); check.setMinWidth(dp(48));
                    check.setChecked(row.items.stream().allMatch(item -> selected.contains(item.id)));
                    check.setEnabled(!operating);
                    check.setOnCheckedChangeListener((button, checked) -> {
                    for (ScreenshotStore.Entry item : row.items) { if (checked) selected.add(item.id); else selected.remove(item.id); }
                    rebuild();
                    }); section.addView(check);
                }
                return section;
            }
            LinearLayout line = reusable instanceof LinearLayout ? (LinearLayout)reusable : new LinearLayout(activity);
            if (line.getChildCount() != columns) {
                for (int i = 0; i < line.getChildCount(); i++) ((Cell)line.getChildAt(i)).cancel();
                line.removeAllViews();
                for (int i = 0; i < columns; i++) line.addView(new Cell(), new LinearLayout.LayoutParams(0, -2, 1));
            }
            for (int i = 0; i < columns; i++) ((Cell)line.getChildAt(i)).bind(i < row.items.size() ? row.items.get(i) : null);
            return line;
        }
    }

    private final class Cell extends FrameLayout {
        final ImageView image; final TextView badge;
        Future<?> request; String bound; int bindGeneration;
        ScreenshotStore.Entry currentEntry;
        Cell() {
            super(ScreenshotGallery.this.getContext()); setPadding(dp(1), dp(1), dp(1), dp(1));
            image = new ImageView(getContext()); image.setScaleType(ImageView.ScaleType.CENTER_CROP); image.setBackgroundColor(TINT);
            addView(image, new FrameLayout.LayoutParams(-1, -1));
            badge = text("", 14); badge.setTextColor(Color.WHITE); badge.setGravity(Gravity.CENTER);
            FrameLayout.LayoutParams params = new FrameLayout.LayoutParams(dp(24), dp(24), Gravity.TOP | Gravity.END); params.setMargins(dp(8), dp(8), dp(8), 0); addView(badge, params);
            setFocusable(true);
        }
        void cancel() { ++bindGeneration; if (request != null) request.cancel(true); request = null; }
        void bind(ScreenshotStore.Entry entry) {
            boolean sameImage = entry != null && entry.id.equals(bound) && currentEntry != null && entry.modified == currentEntry.modified && entry.bytes == currentEntry.bytes && image.getDrawable() != null;
            cancel();
            if (!sameImage) image.setImageDrawable(null);
            currentEntry = entry;
            bound = entry == null ? null : entry.id; setVisibility(entry == null ? INVISIBLE : VISIBLE);
            if (entry == null) return;
            boolean checked = selected.contains(entry.id);
            badge.setText(checked ? "✓" : ""); badge.setVisibility(selecting ? VISIBLE : GONE);
            GradientDrawable circle = shape(checked ? TEAL : 0x88000000, 24); circle.setStroke(dp(2), Color.WHITE); badge.setBackground(circle);
            int inset = dp(selecting && checked ? 7 : 1); setPadding(inset, inset, inset, inset);
            setBackground(checked && selecting ? shape(TINT, 8) : null);
            setContentDescription(entry.title + "，" + entry.createdAt + (selecting ? checked ? "，已选" : "，未选" : ""));
            setOnClickListener(view -> { if (!operating) { if (selecting) toggle(entry); else showViewer(entry); } });
            setOnLongClickListener(view -> { toggle(entry); return true; });
            android.graphics.Bitmap cached = images.cachedThumbnail(entry);
            if (cached != null) {
                BitmapDrawable drawable = new BitmapDrawable(getResources(), cached);
                drawable.setFilterBitmap(false); image.setImageDrawable(drawable);
                return;
            }
            if (sameImage) return;
            int token = bindGeneration;
            request = images.load(entry, false, bitmap -> {
                if (token != bindGeneration || !entry.id.equals(bound)) return;
                if (bitmap == null) { badge.setText("!"); badge.setContentDescription("图片无法读取"); badge.setVisibility(VISIBLE); }
                else { BitmapDrawable drawable = new BitmapDrawable(getResources(), bitmap); drawable.setFilterBitmap(false); image.setImageDrawable(drawable); }
            });
        }
        @Override protected void onMeasure(int width, int height) {
            super.onMeasure(width, MeasureSpec.makeMeasureSpec(MeasureSpec.getSize(width), MeasureSpec.EXACTLY));
        }
        @Override protected void onDetachedFromWindow() { cancel(); super.onDetachedFromWindow(); }
        @Override protected void onAttachedToWindow() {
            super.onAttachedToWindow();
            if (request == null && currentEntry != null) bind(currentEntry);
        }
    }
}
