package org.viprpg.archive;

import android.content.Context;
import android.content.res.ColorStateList;
import android.graphics.Color;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.view.ViewConfiguration;
import android.widget.FrameLayout;
import androidx.core.view.ViewCompat;
import androidx.core.view.accessibility.AccessibilityNodeInfoCompat;
import com.google.android.material.button.MaterialButton;
import java.util.function.Consumer;

/** Horizontal reveal only: the existing confirmation still owns deletion. */
final class SwipeGameRow extends FrameLayout {
    private final View content;
    private final MaterialButton delete;
    private final Consumer<SwipeGameRow> onReveal;
    private final int revealWidth, slop;
    private float downX, downY, start;
    private boolean dragging, vertical, open;

    SwipeGameRow(Context context, View content, String title, Runnable remove,
                 Consumer<SwipeGameRow> onReveal) {
        super(context);
        setClickable(true);
        this.content = content; this.onReveal = onReveal;
        revealWidth = NativeControls.dp(context, 80);
        slop = ViewConfiguration.get(context).getScaledTouchSlop();
        delete = NativeControls.icon(context, GalleryIcons.DELETE, Color.WHITE, remove);
        delete.setCornerRadius(0);
        delete.setTooltipText("删除 " + title);
        delete.setMinWidth(0); delete.setMinimumWidth(0);
        delete.setPadding(0, 0, 0, 0);
        delete.setTextColor(Color.WHITE);
        delete.setBackgroundTintList(ColorStateList.valueOf(0xffad4037));
        delete.setContentDescription("删除 " + title);
        delete.setVisibility(INVISIBLE);
        addView(delete, new FrameLayout.LayoutParams(revealWidth, -1, Gravity.RIGHT));
        content.setBackgroundColor(context.getColor(R.color.native_background));
        addView(content, new FrameLayout.LayoutParams(-1, -2));
        // Screen-reader users can reveal the same action without a swipe.
        ViewCompat.setImportantForAccessibility(content, ViewCompat.IMPORTANT_FOR_ACCESSIBILITY_YES);
        ViewCompat.addAccessibilityAction(content, "显示删除操作", (view, args) -> { settle(true); return true; });
        ViewCompat.replaceAccessibilityAction(content, AccessibilityNodeInfoCompat.AccessibilityActionCompat.ACTION_DISMISS,
            "收起删除操作", (view, args) -> { close(); return true; });
    }

    boolean isOpen() { return open; }
    void close() { settle(false); }

    @Override public boolean dispatchTouchEvent(MotionEvent event) {
        if (event.getActionMasked() == MotionEvent.ACTION_DOWN) {
            // Decide direction here before ScrollView or SwipeRefreshLayout can steal the gesture.
            downX = event.getX(); downY = event.getY();
            vertical = false;
            getParent().requestDisallowInterceptTouchEvent(true);
        } else if (event.getActionMasked() == MotionEvent.ACTION_MOVE && !dragging && !vertical) {
            float dx = event.getX() - downX, dy = event.getY() - downY;
            if (Math.abs(dy) > slop && Math.abs(dy) >= Math.abs(dx)) {
                vertical = true;
                getParent().requestDisallowInterceptTouchEvent(false);
            }
        }
        boolean handled = super.dispatchTouchEvent(event);
        if (event.getActionMasked() == MotionEvent.ACTION_UP || event.getActionMasked() == MotionEvent.ACTION_CANCEL)
            getParent().requestDisallowInterceptTouchEvent(false);
        return handled;
    }

    @Override public boolean onInterceptTouchEvent(MotionEvent event) {
        if (dragging) return true;
        switch (event.getActionMasked()) {
            case MotionEvent.ACTION_DOWN:
                content.animate().cancel();
                downX = event.getX(); downY = event.getY(); start = content.getTranslationX();
                dragging = false; vertical = false;
                break;
            case MotionEvent.ACTION_MOVE:
                float dx = event.getX() - downX, dy = event.getY() - downY;
                if (!dragging && Math.abs(dy) > slop && Math.abs(dy) >= Math.abs(dx)) vertical = true;
                if (!vertical && Math.abs(dx) > slop && Math.abs(dx) > Math.abs(dy)
                        && (dx < 0 || start < 0)) {
                    dragging = true;
                    getParent().requestDisallowInterceptTouchEvent(true);
                    onReveal.accept(this);
                    delete.setVisibility(VISIBLE);
                    return true;
                }
                break;
        }
        return false;
    }

    @Override public boolean onTouchEvent(MotionEvent event) {
        if (!dragging) {
            if (event.getActionMasked() == MotionEvent.ACTION_UP && open) close();
            return super.onTouchEvent(event);
        }
        switch (event.getActionMasked()) {
            case MotionEvent.ACTION_MOVE:
                content.setTranslationX(Math.max(-revealWidth, Math.min(0, start + event.getX() - downX)));
                return true;
            case MotionEvent.ACTION_UP:
            case MotionEvent.ACTION_CANCEL:
                boolean reveal = event.getActionMasked() != MotionEvent.ACTION_CANCEL
                    && content.getTranslationX() < -revealWidth / 2f;
                dragging = false;
                getParent().requestDisallowInterceptTouchEvent(false);
                settle(reveal);
                return true;
            default: return true;
        }
    }

    private void settle(boolean reveal) {
        open = reveal;
        if (reveal) { onReveal.accept(this); delete.setVisibility(VISIBLE); }
        content.animate().translationX(reveal ? -revealWidth : 0).setDuration(160)
            .withEndAction(() -> { if (!open) delete.setVisibility(INVISIBLE); }).start();
    }
}
