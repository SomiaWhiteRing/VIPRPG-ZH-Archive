package org.viprpg.archive;

import androidx.appcompat.app.AlertDialog;
import com.google.android.material.appbar.MaterialToolbar;
import android.graphics.drawable.RippleDrawable;
import androidx.appcompat.widget.PopupMenu;
import com.google.android.material.chip.Chip;
import com.google.android.material.chip.ChipGroup;
import android.widget.HorizontalScrollView;
import android.content.res.ColorStateList;
import com.google.android.material.button.MaterialButton;
import com.google.android.material.checkbox.MaterialCheckBox;
import com.google.android.material.textfield.TextInputEditText;
import com.google.android.material.textfield.TextInputLayout;
import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.util.Base64;
import android.view.Gravity;
import android.view.View;
import android.view.WindowManager;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import androidx.swiperefreshlayout.widget.SwipeRefreshLayout;
import org.json.JSONArray;
import org.json.JSONObject;
import java.time.Instant;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

/** Native library UI backed by the persistent native installation queue. */
final class NativeLibrary extends LinearLayout {
    interface Actions {
        void refresh();
        void play(String key);
        void delete(List<String> keys);
        void retry(long archiveVersionId);
        void toggleDownload(String key);
        void details(long workId);
    }

    private static final int PAPER = 0xfff5f4ef, INK = 0xff17212b, MUTED = 0xff68737d;
    private static final int TEAL = 0xff1f6f67, BORDER = 0xffd9ddd9;
    private final Actions actions;
    private final List<Entry> entries = new ArrayList<>();
    private final Map<String, Bitmap> covers = new HashMap<>();
    private final Map<String, ImageView> visibleCovers = new HashMap<>();
    private final Map<String, TextView> coverPlaceholders = new HashMap<>();
    private final Set<String> selected = new HashSet<>();
    private final LinearLayout items;
    private final ArchivePageHeader header;
    private final MaterialToolbar selectionToolbar;
    private final Map<String, MaterialCheckBox> selectionChecks = new HashMap<>();
    private final Map<String, View> selectionRows = new HashMap<>();
    private final ChipGroup filters;
    private SwipeGameRow openRow;
    private String renderedRows = "";
    private final Map<String, DownloadViews> downloads = new HashMap<>();
    private static final class DownloadViews {
        TextView progress, speed;
        com.google.android.material.progressindicator.LinearProgressIndicator bar;
        MaterialButton toggle;
    }
    private final TextView summary, message;
    private final MaterialButton searchButton, manageButton;
    private final SwipeRefreshLayout refreshLayout;
    private final MaterialButton sorting;
    private int sortOrder;
    private static final String[] SORT_NAMES = {"最近游玩", "名称", "大小"};
    private final Chip[] filterButtons = new Chip[3];
    private String filter = "all", error, searchQuery = "";
    private boolean managing, loading = true;
    private long usage = -1;

    NativeLibrary(Context context, Actions actions) {
        super(context);
        this.actions = actions;
        setOrientation(VERTICAL);
        setBackgroundColor(PAPER);
        header = new ArchivePageHeader(context, "本地游戏");
        searchButton = icon(GalleryIcons.SEARCH, INK, this::showSearch);
        searchButton.setTooltipText("搜索作品");
        searchButton.setContentDescription("搜索作品");
        header.actions().addView(searchButton, new LayoutParams(dp(48), dp(48)));
        manageButton = icon(GalleryIcons.SELECT, INK, () -> enterSelection(null));
        manageButton.setTooltipText("批量管理");
        manageButton.setContentDescription("批量管理");
        header.actions().addView(manageButton, new LayoutParams(dp(48), dp(48)));
        addView(header);
        // Toolbar defaults buttonGravity to TOP, independently of title gravity.
        selectionToolbar = (MaterialToolbar) android.view.LayoutInflater.from(context)
            .inflate(R.layout.library_selection_toolbar, this, false);
        selectionToolbar.setBackgroundColor(0xffe0f0eb);
        selectionToolbar.setTitleTextColor(INK);
        selectionToolbar.setNavigationIcon(new GalleryIcons(GalleryIcons.CLOSE, INK, dp(24)));
        selectionToolbar.setNavigationContentDescription("退出选择");
        selectionToolbar.setNavigationOnClickListener(view -> exitSelection());
        selectionToolbar.getMenu().add(0, 1, 0, "删除")
            .setIcon(new GalleryIcons(GalleryIcons.DELETE, INK, dp(24)))
            .setShowAsAction(android.view.MenuItem.SHOW_AS_ACTION_ALWAYS);
        selectionToolbar.getMenu().add(0, 2, 1, "全选当前结果");
        selectionToolbar.setOnMenuItemClickListener(item -> {
            if (item.getItemId() == 1) confirmDelete(new ArrayList<>(selected));
            else toggleAll();
            return true;
        });
        addView(selectionToolbar, new LayoutParams(-1,
            dp(ArchivePageHeader.CONTENT_HEIGHT_DP) + dp(ArchivePageHeader.DIVIDER_HEIGHT_DP)));

        refreshLayout = new SwipeRefreshLayout(context);
        refreshLayout.setColorSchemeColors(TEAL);
        refreshLayout.setProgressBackgroundColorSchemeColor(Color.WHITE);
        refreshLayout.setOnRefreshListener(actions::refresh);
        addView(refreshLayout, new LayoutParams(-1, 0, 1));
        ScrollView scroll = new ScrollView(context);
        scroll.setFillViewport(true);
        refreshLayout.addView(scroll, new SwipeRefreshLayout.LayoutParams(-1, -1));
        refreshLayout.setOnChildScrollUpCallback((parent, child) -> scroll.canScrollVertically(-1));
        LinearLayout content = column();
        content.setPadding(dp(16), 0, dp(16), dp(24));
        scroll.addView(content);
        summary = label("", 12, MUTED, false);
        summary.setPadding(0, dp(13), 0, dp(12));
        content.addView(summary);

        LinearLayout filterRow = row();
        filterRow.setGravity(Gravity.CENTER_VERTICAL);
        filters = new ChipGroup(context);
        filters.setSingleLine(true); filters.setSingleSelection(true); filters.setSelectionRequired(true);
        filters.setChipSpacingHorizontal(dp(4));
        String[] names = {"全部", "已安装", "下载中"};
        String[] values = {"all", "ready", "incomplete"};
        for (int i = 0; i < 3; i++) {
            Chip chip = new Chip(context);
            chip.setId(View.generateViewId()); chip.setText(names[i]); chip.setTextSize(13);
            chip.setCheckable(true); chip.setCheckedIconVisible(false);
            chip.setChipCornerRadius(dp(24)); chip.setEnsureMinTouchTargetSize(true);
            chip.setChipStartPadding(dp(8)); chip.setChipEndPadding(dp(8));
            filterButtons[i] = chip;
            filters.addView(chip);
        }
        filters.check(filterButtons[0].getId());
        filters.setOnCheckedStateChangeListener((group, checked) -> {
            for (int i = 0; i < filterButtons.length; i++) {
                if (checked.contains(filterButtons[i].getId())) { filter = values[i]; render(); break; }
            }
        });
        // Keep both controls on one row, including with enlarged system fonts.
        HorizontalScrollView filterScroll = new HorizontalScrollView(context);
        filterScroll.setHorizontalScrollBarEnabled(false);
        filterScroll.addView(filters);
        filterRow.addView(filterScroll, new LayoutParams(0, -2, 1));
        sorting = icon(GalleryIcons.SORT, INK, this::showSorting);
        sorting.setTooltipText("排序");
        filterRow.addView(sorting, new LayoutParams(dp(48), dp(48)));
        content.addView(filterRow, new LayoutParams(-1, -2));

        View rule = new View(context); rule.setBackgroundColor(BORDER);
        content.addView(rule, new LayoutParams(-1, dp(1)));
        message = label("读取本地游戏…", 14, MUTED, false);
        message.setGravity(Gravity.CENTER);
        message.setPadding(dp(12), dp(64), dp(12), dp(40));
        content.addView(message);
        items = column();
        content.addView(items);
        render();
    }

    void loading() { loading = true; error = null; render(); }

    void setSnapshot(String json) {
        try {
            JSONObject snapshot = new JSONObject(json);
            JSONArray rows = snapshot.getJSONArray("items");
            entries.clear();
            Set<String> keys = new HashSet<>();
            for (int i = 0; i < rows.length(); i++) {
                JSONObject row = rows.getJSONObject(i);
                Entry entry = new Entry(row);
                entries.add(entry); keys.add(entry.key);
            }
            covers.keySet().retainAll(keys);
            selected.retainAll(keys);
            usage = snapshot.isNull("usage") ? -1 : snapshot.optLong("usage", -1);
            loading = false; error = null; refreshLayout.setRefreshing(false); render();
        } catch (Exception invalid) {
            setError("本地游戏列表无法读取");
        }
    }

    void setError(String value) { loading = false; error = value; refreshLayout.setRefreshing(false); render(); }

    private void showSorting() {
        PopupMenu menu = new PopupMenu(getContext(), sorting);
        for (int i = 0; i < SORT_NAMES.length; i++) menu.getMenu().add(0, i, i, SORT_NAMES[i]);
        menu.getMenu().setGroupCheckable(0, true, true);
        menu.getMenu().findItem(sortOrder).setChecked(true);
        menu.setOnMenuItemClickListener(item -> { sortOrder = item.getItemId(); render(); return true; });
        menu.show();
    }

    private void showSearch() {
        TextInputLayout field = new TextInputLayout(getContext());
        field.setHint("搜索作品");
        field.setBoxBackgroundMode(TextInputLayout.BOX_BACKGROUND_OUTLINE);
        TextInputEditText input = new TextInputEditText(field.getContext());
        input.setSingleLine(true); input.setTextSize(16);
        input.setText(searchQuery); input.setSelectAllOnFocus(true);
        FrameLayout container = new FrameLayout(getContext());
        container.setPadding(dp(24), dp(8), dp(24), 0);
        field.addView(input, new LinearLayout.LayoutParams(-1, -2));
        container.addView(field, new FrameLayout.LayoutParams(-1, -2));
        AlertDialog dialog = NativeControls.dialog(getContext()).setTitle("搜索作品").setView(container)
            .setNegativeButton("取消", null)
            .setNeutralButton("清除搜索", (view, which) -> { searchQuery = ""; render(); })
            .setPositiveButton("搜索", (view, which) -> { searchQuery = input.getText().toString().trim(); render(); })
            .create();
        input.setImeOptions(android.view.inputmethod.EditorInfo.IME_ACTION_SEARCH);
        input.setOnEditorActionListener((view, action, event) -> {
            if (action != android.view.inputmethod.EditorInfo.IME_ACTION_SEARCH) return false;
            searchQuery = input.getText().toString().trim(); render(); dialog.dismiss(); return true;
        });
        dialog.setOnShowListener(view -> {
            input.requestFocus();
            dialog.getWindow().setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_STATE_ALWAYS_VISIBLE);
        });
        dialog.show();
    }

    boolean onBack() {
        if (openRow != null && openRow.isOpen()) { openRow.close(); openRow = null; return true; }
        if (!managing) return false;
        exitSelection(); return true;
    }

    void setCover(String key, String image) {
        try {
            int comma = image.indexOf(',');
            if (comma < 0 || image.length() > 200_000) return;
            byte[] bytes = Base64.decode(image.substring(comma + 1), Base64.DEFAULT);
            Bitmap bitmap = BitmapFactory.decodeByteArray(bytes, 0, bytes.length);
            if (bitmap != null) {
                covers.put(key, bitmap);
                ImageView cover = visibleCovers.get(key);
                TextView placeholder = coverPlaceholders.get(key);
                if (cover != null) { cover.setImageBitmap(bitmap); cover.setVisibility(VISIBLE); }
                if (placeholder != null) placeholder.setVisibility(GONE);
            }
        } catch (Exception ignored) { }
    }

    private List<Entry> visible() {
        String query = searchQuery.toLowerCase(Locale.ROOT);
        List<Entry> result = new ArrayList<>();
        for (Entry entry : entries) {
            if (!filter.equals("all") && (filter.equals("ready") != entry.ready)) continue;
            if (!entry.title.toLowerCase(Locale.ROOT).contains(query)) continue;
            result.add(entry);
        }
        switch (sortOrder) {
            case 1: result.sort(Comparator.comparing(item -> item.title, java.text.Collator.getInstance(Locale.CHINA))); break;
            case 2: result.sort((a, b) -> Long.compare(b.bytes, a.bytes)); break;
            default: result.sort((a, b) -> b.recent.compareTo(a.recent));
        }
        return result;
    }

    private void render() {
        if (items == null || summary == null || sorting == null) return;
        sorting.setTooltipText("排序：" + SORT_NAMES[sortOrder]);
        sorting.setContentDescription("排序：" + SORT_NAMES[sortOrder]);
        int ready = 0; for (Entry item : entries) if (item.ready) ready++;
        summary.setText(ready + " 款已安装" + (usage < 0 ? "" : "  ·  游戏文件 " + bytes(usage))
            + (searchQuery.isEmpty() ? "" : "\n搜索：" + searchQuery));
        searchButton.setIconTint(ColorStateList.valueOf(searchQuery.isEmpty() ? INK : TEAL));
        manageButton.setIconTint(ColorStateList.valueOf(managing ? TEAL : INK));
        manageButton.setIcon(new GalleryIcons(managing ? GalleryIcons.CLOSE : GalleryIcons.SELECT, INK));
        manageButton.setContentDescription(managing ? "完成管理" : "批量管理");
        manageButton.setTooltipText(managing ? "完成管理" : "批量管理");
        refreshLayout.setEnabled(!loading && !managing);
        List<Entry> shown = visible();
        updateSelection();
        message.setText(error != null ? error : loading ? "读取本地游戏…"
            : entries.isEmpty() ? "还没有本地游戏。\n在主站安装的游戏会显示在这里。"
            : shown.isEmpty() ? "没有符合条件的作品" : "");
        message.setVisibility(error != null || loading || shown.isEmpty() ? VISIBLE : GONE);
        StringBuilder structure = new StringBuilder().append(managing).append(loading);
        for (Entry entry : shown) structure.append('|').append(entry.key).append(':').append(entry.ready)
            .append(':').append(entry.title).append(':').append(entry.workId).append(':').append(entry.lastPlayed);
        String signature = structure.toString();
        if (!loading && signature.equals(renderedRows)) {
            for (Entry entry : shown) updateDownload(entry);
            return;
        }
        renderedRows = signature;
        openRow = null;
        downloads.clear();
        items.removeAllViews();
        visibleCovers.clear(); coverPlaceholders.clear();
        selectionChecks.clear(); selectionRows.clear();
        if (loading) return;
        for (Entry entry : shown) addEntry(entry);
        updateSelection();
    }

    private void addEntry(Entry entry) {
        LinearLayout line = row(); line.setGravity(Gravity.CENTER_VERTICAL);
        line.setPadding(0, dp(10), 0, dp(10));
        if (managing) {
            MaterialCheckBox check = new MaterialCheckBox(getContext());
            check.setButtonTintList(ColorStateList.valueOf(TEAL));
            check.setChecked(selected.contains(entry.key));
            check.setContentDescription("选择 " + entry.title);
            selectionChecks.put(entry.key, check);
            check.setOnClickListener(view -> toggleSelection(entry.key));
            line.addView(check, new LayoutParams(dp(48), dp(48)));
        }
        FrameLayout coverFrame = new FrameLayout(getContext());
        ImageView cover = new ImageView(getContext());
        cover.setScaleType(ImageView.ScaleType.FIT_CENTER);
        cover.setBackground(box(0xffe0f0eb, dp(5), 0xffe0f0eb));
        Bitmap bitmap = covers.get(entry.key);
        TextView placeholder = label(entry.title.isEmpty() ? "?" : entry.title.substring(0, 1), 20, TEAL, true);
        placeholder.setGravity(Gravity.CENTER);
        placeholder.setBackground(box(0xffe0f0eb, dp(5), 0xffe0f0eb));
        placeholder.setVisibility(bitmap == null ? VISIBLE : GONE);
        coverFrame.addView(placeholder, new FrameLayout.LayoutParams(-1, -1));
        if (bitmap != null) cover.setImageBitmap(bitmap);
        cover.setVisibility(bitmap == null ? GONE : VISIBLE);
        coverFrame.addView(cover, new FrameLayout.LayoutParams(-1, -1));
        visibleCovers.put(entry.key, cover); coverPlaceholders.put(entry.key, placeholder);
        if (!managing && entry.workId > 0) {
            coverFrame.setContentDescription("查看 " + entry.title + " 的详情");
            coverFrame.setForeground(new RippleDrawable(ColorStateList.valueOf(0x221f6f67), null,
                box(Color.WHITE, dp(5), Color.WHITE)));
            coverFrame.setOnClickListener(view -> actions.details(entry.workId));
            coverFrame.setOnLongClickListener(view -> { enterSelection(entry.key); return true; });
        }
        line.addView(coverFrame, new LayoutParams(dp(96), dp(72)));
        LinearLayout details = column(); details.setPadding(dp(12), 0, dp(4), 0);
        TextView title = label(entry.title, 14, INK, true); title.setSingleLine(true);
        title.setEllipsize(android.text.TextUtils.TruncateAt.END);
        if (entry.ready) {
            details.addView(title);
            String detailsText = bytes(entry.bytes);
            if (!entry.lastPlayed.isEmpty()) detailsText += "  ·  " + date(entry.lastPlayed);
            TextView subtitle = label(detailsText, 12, MUTED, false);
            subtitle.setPadding(0, dp(5), 0, 0); details.addView(subtitle);
            line.addView(details, new LayoutParams(0, -2, 1));
            if (!managing) {
                MaterialButton play = icon(GalleryIcons.PLAY, TEAL, () -> actions.play(entry.key));
                play.setContentDescription("游玩 " + entry.title);
                line.addView(play, new LayoutParams(dp(48), dp(48)));
            }
        } else {
            DownloadViews views = new DownloadViews();
            LinearLayout top = row(); top.setGravity(Gravity.CENTER_VERTICAL);
            top.addView(title, new LayoutParams(0, -2, 1));
            views.toggle = icon(GalleryIcons.PAUSE, TEAL, () -> actions.toggleDownload(entry.key));
            views.toggle.setVisibility(managing ? GONE : VISIBLE);
            top.addView(views.toggle, new LayoutParams(dp(48), dp(48)));
            details.addView(top, new LayoutParams(-1, dp(48)));
            LinearLayout numbers = row(); numbers.setGravity(Gravity.CENTER_VERTICAL);
            views.progress = label("", 11, MUTED, false); views.progress.setSingleLine(true);
            views.progress.setEllipsize(android.text.TextUtils.TruncateAt.END);
            views.speed = label("", 11, MUTED, false); views.speed.setGravity(Gravity.RIGHT); views.speed.setSingleLine(true);
            numbers.addView(views.progress, new LayoutParams(0, dp(20), 1));
            numbers.addView(views.speed, new LayoutParams(-2, dp(20)));
            details.addView(numbers, new LayoutParams(-1, dp(20)));
            views.bar = new com.google.android.material.progressindicator.LinearProgressIndicator(getContext());
            views.bar.setTrackThickness(dp(3)); views.bar.setTrackCornerRadius(dp(2));
            views.bar.setIndicatorColor(TEAL); views.bar.setTrackColor(BORDER); views.bar.setMax(1000);
            details.addView(views.bar, new LayoutParams(-1, dp(4)));
            line.addView(details, new LayoutParams(0, -2, 1));
            downloads.put(entry.key, views); updateDownload(entry);
        }
        if (managing) {
            selectionRows.put(entry.key, line);
            line.setOnClickListener(view -> toggleSelection(entry.key));
            items.addView(line, new LayoutParams(-1, -2));
        }
        else {
            line.setOnLongClickListener(view -> { enterSelection(entry.key); return true; });
            SwipeGameRow swipe = new SwipeGameRow(getContext(), line, entry.title,
                () -> confirmDelete(java.util.Collections.singletonList(entry.key)), row -> {
                    if (openRow != null && openRow != row) openRow.close();
                    openRow = row;
                });
            items.addView(swipe, new LayoutParams(-1, -2));
        }
        View rule = new View(getContext()); rule.setBackgroundColor(BORDER);
        items.addView(rule, new LayoutParams(-1, dp(1)));
    }

    private void updateDownload(Entry entry) {
        DownloadViews views = downloads.get(entry.key); if (views == null) return;
        views.progress.setText(entry.progress);
        views.speed.setText(entry.installing ? bytes(entry.speed) + "/s" : "");
        views.bar.setProgress(entry.total > 0 ? (int)Math.min(1000, entry.downloaded * 1000 / entry.total) : 0);
        views.toggle.setIcon(new GalleryIcons(entry.installing ? GalleryIcons.PAUSE : GalleryIcons.PLAY, TEAL));
        views.toggle.setContentDescription((entry.installing ? "暂停下载 " : "继续下载 ") + entry.title);
        views.toggle.setTooltipText(entry.installing ? "暂停" : "继续");
    }

    private void enterSelection(String key) {
        if (loading) return;
        managing = true; selected.clear();
        if (key != null) selected.add(key);
        render();
    }

    private void exitSelection() {
        if (loading) return;
        managing = false; selected.clear(); render();
    }

    private void toggleSelection(String key) {
        if (loading) return;
        if (!selected.remove(key)) selected.add(key);
        updateSelection();
    }

    private void updateSelection() {
        header.setVisibility(managing ? GONE : VISIBLE);
        selectionToolbar.setVisibility(managing ? VISIBLE : GONE);
        selectionToolbar.setTitle("已选择 " + selected.size() + " 项");
        selectionToolbar.getMenu().findItem(1).setEnabled(!loading && !selected.isEmpty());
        List<Entry> shown = visible();
        boolean all = !shown.isEmpty() && shown.stream().allMatch(item -> selected.contains(item.key));
        selectionToolbar.getMenu().findItem(2).setTitle(all ? "取消全选" : "全选当前结果");
        selectionToolbar.getMenu().findItem(2).setEnabled(!loading && !shown.isEmpty());
        for (Map.Entry<String, MaterialCheckBox> item : selectionChecks.entrySet()) {
            boolean checked = selected.contains(item.getKey());
            item.getValue().setChecked(checked);
            item.getValue().setEnabled(!loading);
            View row = selectionRows.get(item.getKey());
            row.setSelected(checked); row.setEnabled(!loading);
            row.setBackground(new RippleDrawable(ColorStateList.valueOf(0x221f6f67),
                box(checked ? 0xffe0f0eb : PAPER, dp(12), checked ? 0xffe0f0eb : PAPER), null));
        }
    }

    private void toggleAll() {
        List<Entry> shown = visible();
        boolean all = !shown.isEmpty() && shown.stream().allMatch(item -> selected.contains(item.key));
        for (Entry item : shown) { if (all) selected.remove(item.key); else selected.add(item.key); }
        updateSelection();
    }

    private void confirmDelete(List<String> keys) {
        if (keys.isEmpty() || loading) return;
        NativeControls.dialog(getContext()).setTitle("删除 " + keys.size() + " 项本地作品？")
            .setMessage("移除下载任务及游戏文件；存档和截图不会删除。")
            .setNegativeButton("取消", null)
            .setPositiveButton("删除", (dialog, which) -> { loading = true; selected.clear(); managing = false; render(); actions.delete(keys); })
            .show();
    }

    private MaterialButton icon(String path, int color, Runnable click) {
        return NativeControls.icon(getContext(), path, color, click);
    }
    private LinearLayout row() { LinearLayout row = new LinearLayout(getContext()); row.setOrientation(HORIZONTAL); return row; }
    private LinearLayout column() { LinearLayout col = new LinearLayout(getContext()); col.setOrientation(VERTICAL); return col; }
    private TextView label(String value, int size, int color, boolean bold) {
        TextView text = new TextView(getContext()); text.setText(value); text.setTextSize(size); text.setTextColor(color);
        if (bold) text.setTypeface(null, Typeface.BOLD);
        return text;
    }
    private GradientDrawable box(int fill, int radius, int stroke) {
        GradientDrawable box = new GradientDrawable(); box.setColor(fill); box.setCornerRadius(radius);
        if (stroke != fill) box.setStroke(dp(1), stroke);
        return box;
    }
    private int dp(int value) { return Math.round(value * getResources().getDisplayMetrics().density); }
    private static String bytes(long value) {
        if (value < 1024) return value + " B";
        String[] units = {"KB", "MB", "GB"}; double size = value;
        int unit = -1; do { size /= 1024; unit++; } while (size >= 1024 && unit < units.length - 1);
        return String.format(Locale.ROOT, "%.1f %s", size, units[unit]);
    }
    private static String date(String value) {
        try { return DateTimeFormatter.ofPattern("yyyy-MM-dd", Locale.CHINA)
            .format(Instant.parse(value).atZone(ZoneId.systemDefault())); }
        catch (Exception ignored) { return value.length() >= 10 ? value.substring(0, 10) : value; }
    }

    private static final class Entry {
        final String key, title, lastPlayed, recent, progress;
        final long workId, archiveVersionId, bytes, downloaded, total, speed;
        final boolean ready, installing;
        Entry(JSONObject row) {
            key = row.optString("playKey"); title = row.optString("title");
            workId = row.optLong("workId"); archiveVersionId = row.optLong("archiveVersionId");
            String status = row.optString("status");
            installing = "created".equals(status) || "installing".equals(status);
            downloaded = row.optLong("downloadedBytes"); total = row.optLong("downloadBytesTotal"); speed = row.optLong("bytesPerSecond");
            progress = "paused".equals(status) ? "已暂停 " + bytes(downloaded) + " / " + bytes(total) : "created".equals(status) ? "等待下载" : "installing".equals(status)
                ? bytes(downloaded) + " / " + bytes(total)
                : row.optString("error", "未完成安装");
            bytes = row.optLong("installedBytes"); ready = "ready".equals(row.optString("status"));
            String played = row.optString("lastPlayedAt", "");
            lastPlayed = "null".equals(played) ? "" : played;
            recent = lastPlayed.isEmpty() ? row.optString("readyAt", row.optString("updatedAt")) : lastPlayed;
        }
    }
}
