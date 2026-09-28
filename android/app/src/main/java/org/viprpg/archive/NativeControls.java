package org.viprpg.archive;

import android.content.Context;
import android.content.res.ColorStateList;
import android.graphics.Color;
import android.graphics.drawable.GradientDrawable;
import com.google.android.material.button.MaterialButton;
import com.google.android.material.dialog.MaterialAlertDialogBuilder;

/** Shared controls for the library, gallery and version page, based on the gallery UI. */
final class NativeControls {
    static final int TEAL = 0xff1f6f67;
    private NativeControls() {}
    static int dp(Context context, int value) {
        return Math.round(value * context.getResources().getDisplayMetrics().density);
    }
    static MaterialButton button(Context context, String label, Runnable action) {
        MaterialButton button = new MaterialButton(context, null, com.google.android.material.R.attr.borderlessButtonStyle);
        button.setText(label); button.setAllCaps(false); button.setTextSize(14);
        button.setTextColor(TEAL); button.setIconTint(ColorStateList.valueOf(TEAL));
        button.setIconSize(dp(context, 20)); button.setCornerRadius(dp(context, 12));
        button.setIconGravity(MaterialButton.ICON_GRAVITY_TEXT_START);
        button.setMinHeight(dp(context, 48)); button.setMinimumHeight(dp(context, 48));
        button.setInsetTop(0); button.setInsetBottom(0);
        button.setOnClickListener(view -> action.run());
        return button;
    }
    static MaterialButton icon(Context context, String path, int color, Runnable action) {
        MaterialButton button = button(context, "", action);
        button.setIcon(new GalleryIcons(path, color)); button.setIconTint(ColorStateList.valueOf(color));
        button.setIconPadding(0); button.setPadding(dp(context, 12), 0, dp(context, 12), 0);
        button.setMinWidth(0); button.setMinimumWidth(0);
        return button;
    }
    static MaterialAlertDialogBuilder dialog(Context context) {
        GradientDrawable background = new GradientDrawable();
        background.setColor(Color.WHITE); background.setCornerRadius(dp(context, 20));
        return new MaterialAlertDialogBuilder(context).setBackground(background);
    }
}
