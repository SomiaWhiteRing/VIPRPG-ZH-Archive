package org.viprpg.archive;

import android.content.Context;
import android.content.res.ColorStateList;
import android.graphics.Typeface;
import android.view.Gravity;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;

import com.google.android.material.button.MaterialButton;

import java.util.Locale;

final class PlayerUpdateDrawer extends LinearLayout {
    private final TextView title, detail, amount, speed;
    private final ProgressBar progress;
    private final MaterialButton action;
    private final LinearLayout meter;
    private boolean shown;
    private boolean failed;

    PlayerUpdateDrawer(Context context, Runnable toggle) {
        super(context);
        setOrientation(VERTICAL);
        setPadding(dp(16), dp(7), dp(16), dp(10));
        setVisibility(GONE);
        setClipChildren(true);

        LinearLayout header = new LinearLayout(context);
        header.setGravity(Gravity.CENTER_VERTICAL);
        addView(header, new LayoutParams(-1, -2));
        ImageView icon = new ImageView(context);
        NativeControls.bindTheme(icon, () -> icon.setImageDrawable(new GalleryIcons(
            "M12,3 V16 M7,11 L12,16 L17,11 M4,17 V21 H20 V17", context.getColor(R.color.native_primary), dp(20))));
        header.addView(icon, new LayoutParams(dp(20), dp(20)));
        LinearLayout copy = new LinearLayout(context);
        copy.setOrientation(VERTICAL);
        LayoutParams copyLayout = new LayoutParams(0, -2, 1);
        copyLayout.setMarginStart(dp(9));
        header.addView(copy, copyLayout);
        title = text(14);
        title.setTypeface(null, Typeface.BOLD);
        NativeControls.textColor(title, R.color.native_on_tint);
        copy.addView(title);
        detail = text(12);
        NativeControls.textColor(detail, R.color.native_ink);
        copy.addView(detail);
        action = NativeControls.button(context, "", toggle);
        action.setMinWidth(0);
        action.setMinimumWidth(0);
        action.setPadding(dp(10), 0, dp(10), 0);
        header.addView(action);

        meter = new LinearLayout(context);
        meter.setOrientation(VERTICAL);
        addView(meter, new LayoutParams(-1, -2));
        progress = new ProgressBar(context, null, android.R.attr.progressBarStyleHorizontal);
        progress.setMax(1000);
        progress.setContentDescription("Player 下载进度");
        meter.addView(progress, new LayoutParams(-1, dp(4)));
        LinearLayout numbers = new LinearLayout(context);
        numbers.setGravity(Gravity.CENTER_VERTICAL);
        LayoutParams numbersLayout = new LayoutParams(-1, -2);
        numbersLayout.topMargin = dp(4);
        meter.addView(numbers, numbersLayout);
        amount = text(11);
        speed = text(11);
        speed.setGravity(Gravity.END);
        NativeControls.textColor(amount, R.color.native_ink);
        numbers.addView(amount, new LayoutParams(0, -2, 1));
        numbers.addView(speed, new LayoutParams(-2, -2));
        NativeControls.bindTheme(this, () -> {
            setBackgroundColor(context.getColor(R.color.native_tint));
            progress.setProgressTintList(ColorStateList.valueOf(context.getColor(R.color.native_primary)));
            progress.setProgressBackgroundTintList(ColorStateList.valueOf(context.getColor(R.color.native_border)));
            speed.setTextColor(context.getColor(failed ? R.color.native_destructive : R.color.native_ink));
        });
    }

    void render(PlayerRuntime.State state, boolean visible) {
        PlayerRuntime.Phase phase = state.phase();
        boolean show = visible && phase != PlayerRuntime.Phase.HIDDEN;
        if (show) {
            title.setText(state.ready() ? "Player 有更新" : "首次下载 Player");
            detail.setText(state.ready() ? "建议更新后再游玩"
                : phase == PlayerRuntime.Phase.OFFLINE && state.total() == 0 ? "联网后可下载" : "下载完成后可游玩");
            meter.setVisibility(state.total() > 0 || phase == PlayerRuntime.Phase.FAILED ? VISIBLE : GONE);
            progress.setVisibility(state.total() > 0 ? VISIBLE : GONE);
            progress.setProgress(state.total() > 0 ? (int) Math.min(1000, state.downloaded() * 1000 / state.total()) : 0);
            amount.setText(state.total() > 0 ? bytes(state.downloaded()) + " / " + bytes(state.total()) : "");
            failed = phase == PlayerRuntime.Phase.FAILED;
            speed.setTextColor(getContext().getColor(failed ? R.color.native_destructive : R.color.native_ink));
            speed.setText(switch (phase) {
                case DOWNLOADING -> bytes(state.speed()) + "/s";
                case MOBILE -> "移动网络 · 已暂停";
                case PAUSED -> "已暂停";
                case OFFLINE -> "网络已断开";
                case FAILED -> "下载失败";
                case VERIFYING -> "正在校验…";
                case HIDDEN -> "";
            });
            String label = switch (phase) {
                case DOWNLOADING -> "暂停";
                case MOBILE, PAUSED -> "继续";
                case FAILED -> "重试";
                default -> "";
            };
            action.setText(label);
            action.setVisibility(label.isEmpty() ? GONE : VISIBLE);
        }
        if (shown == show) return;
        shown = show;
        animate().cancel();
        if (show) {
            setTranslationY(-dp(16));
            setVisibility(VISIBLE);
            animate().translationY(0).setDuration(200).start();
        } else if (visible) {
            animate().translationY(-dp(16)).setDuration(160).withEndAction(() -> {
                if (!shown) setVisibility(GONE);
            }).start();
        } else {
            setVisibility(GONE);
        }
    }

    private int dp(int value) { return NativeControls.dp(getContext(), value); }

    private TextView text(int size) {
        TextView label = new TextView(getContext());
        label.setTextSize(size);
        return label;
    }

    private static String bytes(long value) {
        if (value < 1024) return value + " B";
        if (value < 1024 * 1024) return String.format(Locale.ROOT, "%.1f KiB", value / 1024.0);
        return String.format(Locale.ROOT, "%.2f MiB", value / (1024.0 * 1024));
    }
}
