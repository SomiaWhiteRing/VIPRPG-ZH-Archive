package org.viprpg.archive;

import android.app.AlertDialog;
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
import android.widget.CheckBox;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.Spinner;
import android.widget.ArrayAdapter;
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

/** Native library UI backed by the existing same-origin IndexedDB and OPFS WebView session. */
final class NativeLibrary extends LinearLayout {
    interface Actions {
        void refresh();
        void play(String key);
        void delete(List<String> keys);
        void retry(long archiveVersionId);
    }

    private static final int PAPER = 0xfff5f4ef, INK = 0xff17212b, MUTED = 0xff68737d;
    private static final int TEAL = 0xff2f9f92, BORDER = 0xffd9ddd9;
    private final Actions actions;
    private final List<Entry> entries = new ArrayList<>();
    private final Map<String, Bitmap> covers = new HashMap<>();
    private final Map<String, ImageView> visibleCovers = new HashMap<>();
    private final Map<String, TextView> coverPlaceholders = new HashMap<>();
    private final Set<String> selected = new HashSet<>();
    private final LinearLayout items, filters, management;
    private final TextView summary, message, selectAll, deleteSelected;
    private final ImageView searchButton, manageButton;
    private final SwipeRefreshLayout refreshLayout;
    private final Spinner sorting;
    private final TextView[] filterButtons = new TextView[3];
    private String filter = "all", error, searchQuery = "";
    private boolean managing, loading = true;
    private long usage = -1;

    NativeLibrary(Context context, Actions actions) {
        super(context);
        this.actions = actions;
        setOrientation(VERTICAL);
        setBackgroundColor(PAPER);
        ArchivePageHeader header = new ArchivePageHeader(context, "本地游戏");
        searchButton = icon(GalleryIcons.SEARCH, INK, this::showSearch);
        searchButton.setPadding(dp(16), dp(16), dp(16), dp(16));
        searchButton.setContentDescription("搜索作品");
        header.actions().addView(searchButton, new LayoutParams(dp(56), dp(56)));
        manageButton = icon(GalleryIcons.SELECT, INK, () -> { managing = !managing; selected.clear(); render(); });
        manageButton.setPadding(dp(16), dp(16), dp(16), dp(16));
        manageButton.setContentDescription("批量管理");
        header.actions().addView(manageButton, new LayoutParams(dp(56), dp(56)));
        addView(header);

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
        filters = row();
        String[] names = {"全部", "已安装", "未完成"};
        String[] values = {"all", "ready", "incomplete"};
        for (int i = 0; i < 3; i++) {
            final String value = values[i];
            filterButtons[i] = label(names[i], 13, MUTED, false);
            filterButtons[i].setGravity(Gravity.CENTER);
            filterButtons[i].setOnClickListener(view -> { filter = value; render(); });
            filters.addView(filterButtons[i], new LayoutParams(-2, dp(36)));
        }
        filterRow.addView(filters);
        sorting = new Spinner(context);
        sorting.setAdapter(new ArrayAdapter<>(context, android.R.layout.simple_spinner_dropdown_item,
            new String[] {"最近游玩", "名称", "大小"}));
        sorting.setOnItemSelectedListener(new android.widget.AdapterView.OnItemSelectedListener() {
            @Override public void onItemSelected(android.widget.AdapterView<?> parent, View view, int position, long id) { render(); }
            @Override public void onNothingSelected(android.widget.AdapterView<?> parent) {}
        });
        LayoutParams sortParams = new LayoutParams(0, dp(42), 1);
        sortParams.leftMargin = dp(8);
        filterRow.addView(sorting, sortParams);
        LayoutParams filtersParams = new LayoutParams(-1, -2);
        filtersParams.topMargin = dp(12);
        content.addView(filterRow, filtersParams);

        management = row();
        management.setGravity(Gravity.CENTER_VERTICAL);
        selectAll = label("全选当前结果", 13, INK, false);
        selectAll.setPadding(dp(5), 0, 0, 0);
        selectAll.setGravity(Gravity.CENTER_VERTICAL);
        selectAll.setOnClickListener(view -> toggleAll());
        management.addView(selectAll, new LayoutParams(0, dp(44), 1));
        deleteSelected = label("删除", 13, Color.WHITE, true);
        deleteSelected.setGravity(Gravity.CENTER);
        deleteSelected.setPadding(dp(12), 0, dp(12), 0);
        deleteSelected.setBackground(box(0xffad4037, dp(7), 0xffad4037));
        deleteSelected.setOnClickListener(view -> confirmDelete(new ArrayList<>(selected)));
        management.addView(deleteSelected, new LayoutParams(-2, dp(36)));
        content.addView(management);

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

    private void showSearch() {
        EditText input = new EditText(getContext());
        input.setSingleLine(true); input.setTextSize(16); input.setHint("搜索作品");
        input.setText(searchQuery); input.setSelectAllOnFocus(true);
        FrameLayout container = new FrameLayout(getContext());
        container.setPadding(dp(24), dp(8), dp(24), 0);
        container.addView(input, new FrameLayout.LayoutParams(-1, dp(48)));
        AlertDialog dialog = new AlertDialog.Builder(getContext()).setTitle("搜索作品").setView(container)
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
        if (!managing) return false;
        managing = false; selected.clear(); render(); return true;
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
        switch (sorting.getSelectedItemPosition()) {
            case 1: result.sort(Comparator.comparing(item -> item.title, java.text.Collator.getInstance(Locale.CHINA))); break;
            case 2: result.sort((a, b) -> Long.compare(b.bytes, a.bytes)); break;
            default: result.sort((a, b) -> b.recent.compareTo(a.recent));
        }
        return result;
    }

    private void render() {
        if (items == null || summary == null || sorting == null) return;
        int ready = 0; for (Entry item : entries) if (item.ready) ready++;
        summary.setText(ready + " 款已安装" + (usage < 0 ? "" : "  ·  本站已用 " + bytes(usage))
            + (searchQuery.isEmpty() ? "" : "\n搜索：" + searchQuery));
        searchButton.setColorFilter(searchQuery.isEmpty() ? INK : TEAL);
        manageButton.setColorFilter(managing ? TEAL : INK);
        refreshLayout.setEnabled(!loading && !managing);
        String[] values = {"all", "ready", "incomplete"};
        for (int i = 0; i < 3; i++) {
            boolean active = filter.equals(values[i]);
            filterButtons[i].setPadding(dp(9), 0, dp(9), 0);
            filterButtons[i].setTextColor(active ? Color.WHITE : MUTED);
            filterButtons[i].setBackground(box(active ? TEAL : PAPER, dp(7), active ? TEAL : BORDER));
        }
        List<Entry> shown = visible();
        management.setVisibility(managing ? VISIBLE : GONE);
        deleteSelected.setText("删除 " + selected.size() + " 项");
        deleteSelected.setEnabled(!selected.isEmpty());
        deleteSelected.setAlpha(selected.isEmpty() ? 0.5f : 1f);
        selectAll.setText(shown.size() > 0 && shown.stream().allMatch(item -> selected.contains(item.key)) ? "取消全选" : "全选当前结果");
        message.setText(error != null ? error : loading ? "读取本地游戏…"
            : entries.isEmpty() ? "还没有本地作品\n联网后在在线游玩页安装，游戏会自动出现在这里。"
            : shown.isEmpty() ? "没有符合条件的作品" : "");
        message.setVisibility(error != null || loading || shown.isEmpty() ? VISIBLE : GONE);
        items.removeAllViews();
        visibleCovers.clear(); coverPlaceholders.clear();
        if (loading) return;
        for (Entry entry : shown) addEntry(entry);
    }

    private void addEntry(Entry entry) {
        LinearLayout line = row(); line.setGravity(Gravity.CENTER_VERTICAL);
        line.setPadding(0, dp(10), 0, dp(10));
        if (managing) {
            CheckBox check = new CheckBox(getContext());
            check.setChecked(selected.contains(entry.key));
            check.setContentDescription("选择 " + entry.title);
            check.setOnCheckedChangeListener((button, value) -> { if (value) selected.add(entry.key); else selected.remove(entry.key); render(); });
            line.addView(check, new LayoutParams(dp(40), dp(48)));
        }
        FrameLayout coverFrame = new FrameLayout(getContext());
        ImageView cover = new ImageView(getContext());
        cover.setScaleType(ImageView.ScaleType.CENTER_CROP);
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
        line.addView(coverFrame, new LayoutParams(dp(64), dp(80)));
        LinearLayout details = column(); details.setPadding(dp(12), 0, dp(4), 0);
        TextView title = label(entry.title, 14, INK, true); title.setSingleLine(true);
        title.setEllipsize(android.text.TextUtils.TruncateAt.END); details.addView(title);
        String detailsText = entry.ready ? bytes(entry.bytes) : "未完成安装";
        if (!entry.lastPlayed.isEmpty()) detailsText += "  ·  " + date(entry.lastPlayed);
        TextView subtitle = label(detailsText, 12, MUTED, false);
        subtitle.setPadding(0, dp(5), 0, 0); details.addView(subtitle);
        line.addView(details, new LayoutParams(0, -2, 1));
        if (!managing) {
            View play;
            if (entry.ready) play = icon(GalleryIcons.PLAY, TEAL, () -> { if (entry.workId != 0) actions.play(entry.key); });
            else {
                TextView retry = label("安装", 13, TEAL, true);
                retry.setGravity(Gravity.CENTER);
                retry.setOnClickListener(view -> actions.retry(entry.archiveVersionId));
                play = retry;
            }
            play.setContentDescription((entry.ready ? "游玩 " : "重新安装 ") + entry.title);
            line.addView(play, new LayoutParams(dp(48), dp(48)));
            ImageView delete = icon(GalleryIcons.DELETE, MUTED,
                () -> confirmDelete(java.util.Collections.singletonList(entry.key)));
            delete.setContentDescription("删除 " + entry.title);
            line.addView(delete, new LayoutParams(dp(42), dp(48)));
        }
        items.addView(line, new LayoutParams(-1, -2));
        View rule = new View(getContext()); rule.setBackgroundColor(BORDER);
        items.addView(rule, new LayoutParams(-1, dp(1)));
    }

    private void toggleAll() {
        List<Entry> shown = visible();
        boolean all = !shown.isEmpty() && shown.stream().allMatch(item -> selected.contains(item.key));
        for (Entry item : shown) { if (all) selected.remove(item.key); else selected.add(item.key); }
        render();
    }

    private void confirmDelete(List<String> keys) {
        if (keys.isEmpty()) return;
        new AlertDialog.Builder(getContext()).setTitle("删除 " + keys.size() + " 项本地作品？")
            .setMessage("删除已安装的游戏文件；存档和截图不会删除。")
            .setNegativeButton("取消", null)
            .setPositiveButton("删除", (dialog, which) -> { loading = true; render(); actions.delete(keys); selected.clear(); managing = false; })
            .show();
    }

    private ImageView icon(String path, int color, Runnable click) {
        ImageView view = new ImageView(getContext());
        view.setImageDrawable(new GalleryIcons(path, color));
        view.setPadding(dp(12), dp(12), dp(12), dp(12));
        view.setOnClickListener(item -> click.run());
        return view;
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
        final String key, title, lastPlayed, recent;
        final long workId, archiveVersionId, bytes;
        final boolean ready;
        Entry(JSONObject row) {
            key = row.optString("playKey"); title = row.optString("title");
            workId = row.optLong("workId"); archiveVersionId = row.optLong("archiveVersionId");
            bytes = row.optLong("installedBytes"); ready = "ready".equals(row.optString("status"));
            String played = row.optString("lastPlayedAt", "");
            lastPlayed = "null".equals(played) ? "" : played;
            recent = lastPlayed.isEmpty() ? row.optString("readyAt", row.optString("updatedAt")) : lastPlayed;
        }
    }
}
