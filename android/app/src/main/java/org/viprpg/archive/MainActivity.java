package org.viprpg.archive;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.ActivityInfo;
import android.content.res.Configuration;
import android.content.res.ColorStateList;
import android.graphics.Color;
import android.net.ConnectivityManager;
import android.net.NetworkCapabilities;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.ViewGroup;
import android.view.MotionEvent;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.Switch;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import androidx.webkit.WebViewAssetLoader;
import java.io.ByteArrayInputStream;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public final class MainActivity extends Activity {
    private static final int FILE_CHOOSER_REQUEST = 1001;
    private final String offlineUrl = BuildConfig.SITE_ORIGIN + "/_android/index.html";
    private final Uri origin = Uri.parse(BuildConfig.SITE_ORIGIN);
    private WebView browser;
    private LinearLayout bottomNavigation;
    private LinearLayout onlineTab;
    private LinearLayout libraryTab;
    private LinearLayout versionTab;
    private ScrollView versionPanel;
    private TextView installedVersion;
    private TextView updateStatus;
    private ImageView updateStatusIcon;
    private TextView updateDetail;
    private TextView releaseNotesHeading;
    private TextView releaseNotes;
    private Button checkUpdate;
    private Button downloadUpdate;
    private final ExecutorService updateExecutor = Executors.newSingleThreadExecutor();
    private UpdateChecker.Result currentUpdate;
    private boolean checkedUpdates;
    private boolean checkingUpdates;
    private static boolean startupChecked;
    private boolean pendingUpdatePrompt;
    private boolean resumed;
    private ProgressBar progress;
    private FrameLayout root;
    private WebChromeClient.CustomViewCallback fullscreenCallback;
    private View fullscreenView;
    private ValueCallback<Uri[]> fileChooser;
    private boolean playing;
    private boolean library;
    private boolean version;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_PORTRAIT);
        setContentView(R.layout.activity_main);
        root = findViewById(R.id.root);
        bottomNavigation = findViewById(R.id.bottom_navigation);
        onlineTab = findViewById(R.id.online_tab);
        libraryTab = findViewById(R.id.library_tab);
        versionTab = findViewById(R.id.version_tab);
        versionPanel = findViewById(R.id.version_panel);
        installedVersion = findViewById(R.id.installed_version);
        updateStatus = findViewById(R.id.update_status);
        updateStatusIcon = findViewById(R.id.update_status_icon);
        updateDetail = findViewById(R.id.update_detail);
        releaseNotesHeading = findViewById(R.id.release_notes_heading);
        releaseNotes = findViewById(R.id.release_notes);
        checkUpdate = findViewById(R.id.check_update);
        downloadUpdate = findViewById(R.id.download_update);
        progress = findViewById(R.id.progress);
        browser = findViewById(R.id.browser);
        installedVersion.setText("版本 " + BuildConfig.VERSION_NAME);
        checkUpdate.setOnClickListener(view -> checkForUpdate());
        Switch autoCheck = findViewById(R.id.auto_check_updates);
        autoCheck.setChecked(getPreferences(MODE_PRIVATE).getBoolean("autoCheckUpdates", true));
        autoCheck.setOnCheckedChangeListener((button, enabled) ->
            getPreferences(MODE_PRIVATE).edit().putBoolean("autoCheckUpdates", enabled).apply());
        downloadUpdate.setOnClickListener(view -> {
            if (currentUpdate != null && currentUpdate.download != null) openExternal(currentUpdate.download);
        });
        clearFocusAfterTouch(onlineTab, libraryTab, versionTab, checkUpdate, downloadUpdate);

        WebSettings settings = browser.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setSupportMultipleWindows(false);
        settings.setSafeBrowsingEnabled(true);
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG);
        browser.addJavascriptInterface(new LibraryBridge(), "VIPRPGAndroid");

        WebViewAssetLoader.AssetsPathHandler packagedAssets = new WebViewAssetLoader.AssetsPathHandler(this);
        WebViewAssetLoader assets = new WebViewAssetLoader.Builder()
            .setDomain(origin.getHost())
            .addPathHandler("/_android/", path -> packagedAssets.handle("offline/" + path))
            .addPathHandler("/play/", path -> packagedAssets.handle("play/" + path))
            .build();
        browser.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                Uri url = request.getUrl();
                if (!sameOrigin(url)) return null;
                String path = url.getPath();
                if (path == null || !(path.startsWith("/_android/") || path.equals("/play/player.html")
                    || path.startsWith("/play/runtime/easyrpg/" + BuildConfig.RUNTIME_VERSION + "/"))) return null;
                WebResourceResponse response = assets.shouldInterceptRequest(url);
                if (response == null) {
                    WebResourceResponse missing = new WebResourceResponse("text/plain", "UTF-8", new ByteArrayInputStream(new byte[0]));
                    missing.setStatusCodeAndReasonPhrase(404, "Not Found");
                    return missing;
                }
                if (path.endsWith(".wasm")) response.setMimeType("application/wasm");
                return response;
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                if (!request.isForMainFrame()) return false;
                Uri url = request.getUrl();
                if (sameOrigin(url)) return false;
                openExternal(url);
                return true;
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                library = isOffline(Uri.parse(url));
                if (!library) setPlaying(false);
                updateNavigation();
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame() && !isOffline(request.getUrl()) && !library && !version) {
                    Toast.makeText(MainActivity.this, "网络不可用，已打开本地游戏", Toast.LENGTH_SHORT).show();
                    showLibrary();
                }
            }

            @Override
            public void onReceivedHttpError(WebView view, WebResourceRequest request, WebResourceResponse response) {
                if (request.isForMainFrame() && !isOffline(request.getUrl()) && !version && response.getStatusCode() >= 500) {
                    showLibrary();
                }
            }

            @Override
            public boolean onRenderProcessGone(WebView view, android.webkit.RenderProcessGoneDetail detail) {
                ((ViewGroup) view.getParent()).removeView(view);
                view.destroy();
                recreate();
                return true;
            }
        });
        browser.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onProgressChanged(WebView view, int percent) {
                progress.setProgress(percent);
                progress.setVisibility(percent < 100 && !playing ? View.VISIBLE : View.GONE);
            }

            @Override
            public void onShowCustomView(View view, CustomViewCallback callback) {
                if (fullscreenView != null) { callback.onCustomViewHidden(); return; }
                fullscreenView = view;
                fullscreenCallback = callback;
                root.addView(view, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
                setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED);
                updateNavigation();
            }

            @Override
            public void onHideCustomView() {
                if (fullscreenView == null) return;
                root.removeView(fullscreenView);
                fullscreenView = null;
                fullscreenCallback.onCustomViewHidden();
                fullscreenCallback = null;
                if (!playing) setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_PORTRAIT);
                updateNavigation();
            }

            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (fileChooser != null) fileChooser.onReceiveValue(null);
                fileChooser = callback;
                try {
                    startActivityForResult(params.createIntent(), FILE_CHOOSER_REQUEST);
                    return true;
                } catch (ActivityNotFoundException error) {
                    fileChooser = null;
                    callback.onReceiveValue(null);
                    return false;
                }
            }
        });
        browser.setDownloadListener((url, userAgent, contentDisposition, mimeType, length) -> openExternal(Uri.parse(url)));

        onlineTab.setOnClickListener(view -> showOnline());
        libraryTab.setOnClickListener(view -> showLibrary());
        versionTab.setOnClickListener(view -> showVersion());
        if (savedInstanceState == null || browser.restoreState(savedInstanceState) == null) {
            showOnline();
        } else {
            library = isOffline(Uri.parse(browser.getUrl()));
            if (savedInstanceState.getBoolean("version")) showVersion();
            updateNavigation();
        }
        if (!startupChecked) {
            startupChecked = true;
            if (autoCheck.isChecked()) checkForUpdate(true);
        }
    }

    private boolean sameOrigin(Uri url) {
        return "https".equals(url.getScheme()) && origin.getHost().equalsIgnoreCase(url.getHost())
            && (url.getPort() == -1 || url.getPort() == 443) && url.getUserInfo() == null;
    }

    private boolean isOffline(Uri url) {
        return sameOrigin(url) && url.getPath() != null && url.getPath().startsWith("/_android/");
    }

    private void showOnline() {
        if (playing) return;
        boolean fromVersion = version;
        version = false;
        versionPanel.setVisibility(View.GONE);
        browser.setVisibility(View.VISIBLE);
        setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_PORTRAIT);
        if (fromVersion && !library) { updateNavigation(); return; }
        library = false;
        browser.loadUrl(BuildConfig.SITE_ORIGIN + "/");
        updateNavigation();
    }

    private void showLibrary() {
        if (playing) return;
        boolean fromVersion = version;
        version = false;
        versionPanel.setVisibility(View.GONE);
        browser.setVisibility(View.VISIBLE);
        setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_PORTRAIT);
        if (fromVersion && library) { updateNavigation(); return; }
        library = true;
        browser.loadUrl(offlineUrl);
        updateNavigation();
    }

    private void setPlaying(boolean value) {
        playing = value;
        setRequestedOrientation(value ? ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE : ActivityInfo.SCREEN_ORIENTATION_PORTRAIT);
        updateNavigation();
        if (!value) showPendingUpdate();
    }

    private void showVersion() {
        if (playing) return;
        version = true;
        setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_PORTRAIT);
        browser.setVisibility(View.GONE);
        progress.setVisibility(View.GONE);
        versionPanel.setVisibility(View.VISIBLE);
        updateNavigation();
        if (!checkedUpdates) checkForUpdate();
    }

    private String buildId() {
        return BuildConfig.APPLICATION_ID + ":" + BuildConfig.VERSION_CODE;
    }

    private void checkForUpdate() {
        checkForUpdate(false);
    }

    private void checkForUpdate(boolean automatic) {
        if (checkingUpdates) return;
        checkingUpdates = true;
        checkedUpdates = true;
        checkUpdate.setEnabled(false);
        checkUpdate.setText("检查中…");
        setCheckButtonSecondary(false);
        updateStatus.setText("正在检查更新");
        updateStatusIcon.setImageResource(R.drawable.ic_version);
        updateDetail.setVisibility(View.VISIBLE);
        updateDetail.setText("请稍候…");
        releaseNotesHeading.setVisibility(View.GONE);
        releaseNotes.setVisibility(View.GONE);
        downloadUpdate.setVisibility(View.GONE);
        currentUpdate = null;
        updateExecutor.execute(() -> {
            UpdateChecker.Result result = null;
            String error = null;
            try {
                result = UpdateChecker.check(BuildConfig.SITE_ORIGIN, buildId());
            } catch (Exception failure) {
                error = failure.getMessage();
            }
            UpdateChecker.Result update = result;
            String failureMessage = error;
            runOnUiThread(() -> {
                if (isFinishing() || isDestroyed()) return;
                checkingUpdates = false;
                checkUpdate.setEnabled(true);
                checkUpdate.setText(R.string.check_again);
                if (failureMessage != null) {
                    updateStatus.setText("暂时无法检查更新");
                    updateDetail.setText("请稍后再试。");
                } else if (update != null) {
                    showUpdateResult(update);
                    if (automatic && update.isNewer()) {
                        pendingUpdatePrompt = true;
                        showPendingUpdate();
                    }
                }
            });
        });
    }

    private void showUpdateResult(UpdateChecker.Result result) {
        currentUpdate = result;
        if ("unconfigured".equals(result.status)) {
            updateStatus.setText("暂未提供应用更新");
            updateDetail.setText("你可以稍后重新检查。");
            return;
        }
        if ("paused".equals(result.status)) {
            updateStatus.setText("暂无推荐更新");
            updateDetail.setText("你可以稍后重新检查。");
            return;
        }
        if (result.versionCode <= BuildConfig.VERSION_CODE) {
            showUpToDate();
            return;
        } else if (result.installedSequence < 0) {
            updateStatus.setText("有可下载的版本");
            updateDetail.setText("推荐版本 " + result.version + "，无法确认是否已安装。");
            downloadUpdate.setText("下载此版本");
        } else if (result.isNewer()) {
            updateStatus.setText("发现新版本");
            updateDetail.setText("版本 " + result.version + "，下载后按照系统提示安装。");
            downloadUpdate.setText(R.string.download_update);
        } else {
            showUpToDate();
            return;
        }
        if (result.notes != null && !result.notes.trim().isEmpty()) {
            releaseNotes.setText(result.notes);
            releaseNotesHeading.setVisibility(View.VISIBLE);
            releaseNotes.setVisibility(View.VISIBLE);
        }
        downloadUpdate.setVisibility(View.VISIBLE);
        setCheckButtonSecondary(true);
    }

    private void showUpToDate() {
        updateStatus.setText(R.string.up_to_date);
        updateStatusIcon.setImageResource(R.drawable.ic_check_circle);
        updateDetail.setText("");
        updateDetail.setVisibility(View.GONE);
    }

    private void showPendingUpdate() {
        if (!pendingUpdatePrompt || !resumed || playing || fullscreenView != null || isFinishing() || isDestroyed()) return;
        pendingUpdatePrompt = false;
        if (version || currentUpdate == null || !getPreferences(MODE_PRIVATE).getBoolean("autoCheckUpdates", true)) return;
        UpdateChecker.Result update = currentUpdate;
        new AlertDialog.Builder(this)
            .setTitle("发现新版本 " + update.version)
            .setMessage((update.notes == null || update.notes.trim().isEmpty() ? "" : update.notes + "\n\n") + "下载后按照 Android 系统提示安装，已有游戏和存档会保留。")
            .setPositiveButton("下载更新", (dialog, which) -> openExternal(update.download))
            .setNegativeButton("稍后", null)
            .show();
    }

    private void setCheckButtonSecondary(boolean secondary) {
        checkUpdate.setBackgroundTintList(ColorStateList.valueOf(secondary ? 0xffeaf4f2 : 0xff1f6f67));
        checkUpdate.setTextColor(secondary ? 0xff1f6f67 : Color.WHITE);
    }

    private void clearFocusAfterTouch(View... controls) {
        for (View control : controls) {
            control.setOnTouchListener((view, event) -> {
                if (event.getActionMasked() == MotionEvent.ACTION_UP) {
                    view.post(view::clearFocus);
                }
                return false;
            });
        }
    }

    private void updateNavigation() {
        boolean immersive = playing || fullscreenView != null;
        bottomNavigation.setVisibility(immersive ? View.GONE : View.VISIBLE);
        tintTab(onlineTab, R.id.online_icon, R.id.online_label, !version && !library);
        tintTab(libraryTab, R.id.library_icon, R.id.library_label, !version && library);
        tintTab(versionTab, R.id.version_icon, R.id.version_label, version);
        if (Build.VERSION.SDK_INT >= 30) {
            WindowInsetsController controller = getWindow().getInsetsController();
            if (controller != null) {
                if (immersive) {
                    controller.setSystemBarsBehavior(WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
                    controller.hide(WindowInsets.Type.statusBars() | WindowInsets.Type.navigationBars());
                } else {
                    controller.show(WindowInsets.Type.statusBars() | WindowInsets.Type.navigationBars());
                }
            }
        } else {
            getWindow().getDecorView().setSystemUiVisibility(immersive
                ? View.SYSTEM_UI_FLAG_FULLSCREEN | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                : View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR | View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR);
        }
    }

    private void tintTab(LinearLayout tab, int iconId, int labelId, boolean active) {
        int color = active ? Color.rgb(31, 111, 103) : Color.rgb(104, 115, 125);
        tab.setSelected(active);
        tab.setEnabled(!active);
        ((ImageView) tab.findViewById(iconId)).setColorFilter(color);
        ((TextView) tab.findViewById(labelId)).setTextColor(color);
    }

    private boolean hasNetwork() {
        ConnectivityManager manager = getSystemService(ConnectivityManager.class);
        NetworkCapabilities caps = manager.getNetworkCapabilities(manager.getActiveNetwork());
        return caps != null && caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET);
    }

    private void openExternal(Uri url) {
        String scheme = url.getScheme();
        if (!"http".equals(scheme) && !"https".equals(scheme) && !"mailto".equals(scheme)) return;
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, url).addCategory(Intent.CATEGORY_BROWSABLE));
        } catch (ActivityNotFoundException ignored) {
            Toast.makeText(this, "没有可打开此链接的应用", Toast.LENGTH_SHORT).show();
        }
    }

    @Override
    @Deprecated
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == FILE_CHOOSER_REQUEST && fileChooser != null) {
            fileChooser.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(resultCode, data));
            fileChooser = null;
        }
    }

    @Override
    @Deprecated
    public void onBackPressed() {
        if (fullscreenView != null) {
            browser.evaluateJavascript("document.exitFullscreen()", null);
        } else if (playing) {
            browser.evaluateJavascript("window.dispatchEvent(new Event('viprpg:back'))", null);
        } else if (version) {
            if (library) showLibrary(); else showOnline();
        } else if (library) {
            if (hasNetwork()) showOnline(); else super.onBackPressed();
        } else if (browser.canGoBack()) {
            browser.goBack();
        } else {
            showLibrary();
        }
    }

    @Override
    public void onConfigurationChanged(Configuration configuration) {
        super.onConfigurationChanged(configuration);
        browser.requestLayout();
    }

    @Override
    protected void onPause() {
        resumed = false;
        browser.onPause();
        super.onPause();
    }

    @Override
    protected void onResume() {
        super.onResume();
        browser.onResume();
        resumed = true;
        showPendingUpdate();
    }

    @Override
    protected void onDestroy() {
        if (fileChooser != null) fileChooser.onReceiveValue(null);
        updateExecutor.shutdownNow();
        browser.destroy();
        super.onDestroy();
    }

    @Override
    protected void onSaveInstanceState(Bundle state) {
        state.putBoolean("version", version);
        browser.saveState(state);
        super.onSaveInstanceState(state);
    }

    private final class LibraryBridge {
        @JavascriptInterface
        public void setPlaying(boolean value) {
            runOnUiThread(() -> {
                if (isOffline(Uri.parse(browser.getUrl()))) MainActivity.this.setPlaying(value);
            });
        }

        @JavascriptInterface
        public void setOrientation(String direction) {
            runOnUiThread(() -> {
                if (!isOffline(Uri.parse(browser.getUrl())) || (!playing && !"unspecified".equals(direction))) return;
                int requested = "landscape".equals(direction) ? ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE
                    : ActivityInfo.SCREEN_ORIENTATION_PORTRAIT;
                setRequestedOrientation(requested);
            });
        }
    }
}
