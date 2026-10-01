package org.viprpg.archive;

import android.content.Context;
import android.graphics.BitmapFactory;
import android.graphics.Color;
import android.graphics.Typeface;
import android.view.Gravity;
import android.view.View;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.TextView;
import java.io.IOException;
import java.io.InputStream;

/** Native counterpart of the offline library header: app icon, brand, title and actions. */
final class ArchivePageHeader extends LinearLayout {
    static final int CONTENT_HEIGHT_DP = 64;
    static final int DIVIDER_HEIGHT_DP = 1;
    private final TextView title;
    private final TextView brand;
    private final ImageView logo;
    private final LinearLayout labels;
    private final LinearLayout leading, actions;

    ArchivePageHeader(Context context, String heading) {
        super(context);
        setOrientation(VERTICAL);
        LinearLayout line = new LinearLayout(context);
        line.setGravity(Gravity.CENTER_VERTICAL);
        line.setPadding(dp(16), dp(8), dp(8), dp(8));
        leading = new LinearLayout(context); leading.setGravity(Gravity.CENTER_VERTICAL); line.addView(leading);
        logo = new ImageView(context);
        logo.setImageResource(R.drawable.ic_app);
        if (logo.getDrawable() instanceof android.graphics.drawable.BitmapDrawable)
            ((android.graphics.drawable.BitmapDrawable) logo.getDrawable()).setFilterBitmap(false);
        logo.setContentDescription(null);
        logo.setScaleType(ImageView.ScaleType.FIT_CENTER);
        line.addView(logo, new LayoutParams(dp(48), dp(48)));
        labels = new LinearLayout(context); labels.setOrientation(VERTICAL);
        labels.setPadding(dp(12), 0, 0, 0);
        labels.setTranslationY(-dp(1));
        brand = new TextView(context); brand.setText(R.string.app_name);
        brand.setTextSize(12); NativeControls.textColor(brand, R.color.native_accent); brand.setTypeface(null, Typeface.BOLD);
        brand.setTextScaleX(1.05f);
        labels.addView(brand);
        title = new TextView(context); title.setText(heading); title.setTextSize(20);
        title.setSingleLine(true); title.setEllipsize(android.text.TextUtils.TruncateAt.END);
        NativeControls.textColor(title, R.color.native_ink); title.setTypeface(null, Typeface.BOLD);
        labels.addView(title);
        line.addView(labels, new LayoutParams(0, LayoutParams.WRAP_CONTENT, 1));
        actions = new LinearLayout(context); actions.setGravity(Gravity.CENTER_VERTICAL); line.addView(actions);
        // Keep the title baseline fixed regardless of the page's action controls.
        addView(line, new LayoutParams(LayoutParams.MATCH_PARENT, dp(CONTENT_HEIGHT_DP)));
        View divider = new View(context); NativeControls.bindTheme(divider, () -> divider.setBackgroundColor(context.getColor(R.color.native_border)));
        LayoutParams dividerLayout = new LayoutParams(LayoutParams.MATCH_PARENT, dp(DIVIDER_HEIGHT_DP));
        dividerLayout.setMargins(dp(16), 0, dp(16), 0);
        addView(divider, dividerLayout);
    }

    LinearLayout leading() { return leading; }
    LinearLayout actions() { return actions; }
    void setTitle(String heading) {
        logo.setVisibility(VISIBLE);
        brand.setVisibility(VISIBLE);
        labels.setPadding(dp(12), 0, 0, 0);
        labels.setTranslationY(-dp(1));
        title.setText(heading);
    }

    void setFolderTitle(String heading) {
        logo.setVisibility(GONE);
        brand.setVisibility(GONE);
        labels.setPadding(0, 0, 0, 0);
        labels.setTranslationY(0);
        title.setText(heading);
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }
}
