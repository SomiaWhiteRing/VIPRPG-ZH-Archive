package org.viprpg.archive;

import android.app.Activity;
import com.google.android.material.dialog.MaterialAlertDialogBuilder;
import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.Intent;
import android.content.pm.ActivityInfo;
import android.content.res.Configuration;
import android.graphics.Color;
import android.graphics.drawable.ColorDrawable;
import android.net.ConnectivityManager;
import android.net.NetworkCapabilities;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.ViewGroup;
import android.view.MotionEvent;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import com.google.android.material.button.MaterialButton;
import com.google.android.material.materialswitch.MaterialSwitch;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;

import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import androidx.swiperefreshlayout.widget.SwipeRefreshLayout;
import androidx.webkit.WebViewAssetLoader;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;
import androidx.webkit.WebSettingsCompat;
import java.io.ByteArrayInputStream;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.json.JSONArray;
import org.json.JSONObject;

public final class MainActivity extends Activity {
    private static final int FILE_CHOOSER_REQUEST = 1001;
    // Run before page scripts/paint where supported; onPageFinished covers older WebViews.
    private static final String SYSTEM_THEME_SCRIPT = "(() => {"
        + "const apply = () => document.documentElement.setAttribute('data-system-theme', VIPRPGAndroid.getSystemTheme());"
        + "if (document.documentElement) apply();"
        + "else new MutationObserver((_, observer) => { if (document.documentElement) { apply(); observer.disconnect(); } })"
        + ".observe(document, {childList:true});"
        + "})()";
    private final String offlineUrl = BuildConfig.SITE_ORIGIN + "/_android/index.html";
    private final Uri origin = Uri.parse(BuildConfig.SITE_ORIGIN);
    private WebView browser;
    private SwipeRefreshLayout onlineRefresh;
    private WebView offlineBrowser;
    private LinearLayout bottomNavigation;
    private LinearLayout onlineTab;
    private LinearLayout libraryTab;
    private LinearLayout galleryTab;
    private LinearLayout versionTab;
    private ScreenshotController screenshots;
    private LocalGames localGames;
    private SaveTransfers saveTransfers;

    private final java.util.Set<String> loadedCovers = new java.util.HashSet<>();
    private final ExecutorService localIo = Executors.newSingleThreadExecutor();
    private final ExecutorService coverIo = Executors.newSingleThreadExecutor();

    private ScreenshotGallery galleryPanel;
    private NativeLibrary nativeLibrary;
    private FrameLayout libraryPanel;
    private LinearLayout versionPage;
    private TextView installedVersion;
    private TextView updateStatus;
    private ImageView updateStatusIcon;
    private TextView updateDetail;
    private TextView releaseNotesHeading;
    private TextView releaseNotes;
    private MaterialButton checkUpdate;
    private MaterialButton downloadUpdate;
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
    private int deviceNightMode;
    private boolean playing;
    private boolean onlinePlaying;
    private boolean onlineImmersive;
    private boolean library;
    private boolean version;
    private boolean gallery;
    private boolean onlineLoadFailed;
    private boolean onlineBrowserPaused;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_PORTRAIT);
        setContentView(R.layout.activity_main);
        root = findViewById(R.id.root);
        configureWindowInsets();
        bottomNavigation = findViewById(R.id.bottom_navigation);
        onlineTab = findViewById(R.id.online_tab);
        libraryTab = findViewById(R.id.library_tab);
        galleryTab = findViewById(R.id.gallery_tab);
        versionTab = findViewById(R.id.version_tab);
        versionPage = findViewById(R.id.version_page);
        ((FrameLayout) findViewById(R.id.version_header)).addView(new ArchivePageHeader(this, getString(R.string.native_version)));
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
        onlineRefresh = findViewById(R.id.online_refresh);
        onlineRefresh.setOnChildScrollUpCallback((parent, child) -> browser.canScrollVertically(-1));
        onlineRefresh.setOnRefreshListener(browser::reload);
        NativeControls.bindTheme(onlineRefresh, () -> {
            onlineRefresh.setColorSchemeColors(getColor(R.color.native_primary));
            onlineRefresh.setProgressBackgroundColorSchemeColor(getColor(R.color.native_surface));
        });
        offlineBrowser = findViewById(R.id.offline_browser);
        libraryPanel = findViewById(R.id.library_panel);
        nativeLibrary = new NativeLibrary(this, new NativeLibrary.Actions() {
            @Override public void refresh() { refreshLocalGames(); }
            @Override public void play(String key) { openLocalLibrary(key); }
            @Override public void delete(List<String> keys) {
                localIo.execute(() -> {
                    try { for (String key : keys) localGames.store.delete(key); }
                    catch (Exception e) { runOnUiThread(() -> nativeLibrary.setError(e.getMessage())); }
                    runOnUiThread(MainActivity.this::refreshLocalGames);
                });
            }
            @Override public void retry(long id) { openInstall(id); }
            @Override public void toggleDownload(String key) {
                localIo.execute(() -> {
                    try { localGames.store.toggleDownload(key); runOnUiThread(() -> InstallService.start(MainActivity.this)); }
                    catch (Exception e) { runOnUiThread(() -> Toast.makeText(MainActivity.this, e.getMessage(), Toast.LENGTH_LONG).show()); }
                });
            }
            @Override public void saves(String key) { saveTransfers.show(key); }
            @Override public void details(long id) {
                if (id > 0) showOnline(BuildConfig.SITE_ORIGIN + "/games/" + id);
            }
        });
        libraryPanel.addView(nativeLibrary);
        localGames = new LocalGames(this, browser, offlineBrowser);
        localGames.store.changed = () -> runOnUiThread(this::refreshLocalGames);
        screenshots = new ScreenshotController(this, browser, offlineBrowser);
        galleryPanel = new ScreenshotGallery(this, screenshots);
        ((FrameLayout) findViewById(R.id.gallery_panel)).addView(galleryPanel);
        installedVersion.setText("版本 " + BuildConfig.VERSION_NAME);
        checkUpdate.setOnClickListener(view -> checkForUpdate());
        MaterialSwitch autoCheck = findViewById(R.id.auto_check_updates);
        autoCheck.setChecked(getPreferences(MODE_PRIVATE).getBoolean("autoCheckUpdates", true));
        autoCheck.setOnCheckedChangeListener((button, enabled) ->
            getPreferences(MODE_PRIVATE).edit().putBoolean("autoCheckUpdates", enabled).apply());
        downloadUpdate.setOnClickListener(view -> {
            if (currentUpdate != null && currentUpdate.download != null) openExternal(currentUpdate.download);
        });
        clearFocusAfterTouch(onlineTab, libraryTab, galleryTab, versionTab, checkUpdate, downloadUpdate);

        for (WebView view : new WebView[]{browser, offlineBrowser}) {
            WebSettings settings = view.getSettings();
            settings.setJavaScriptEnabled(true);
            settings.setDomStorageEnabled(true);
            settings.setAllowFileAccess(false);
            settings.setAllowContentAccess(false);
            settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
            settings.setMediaPlaybackRequiresUserGesture(false);
            settings.setSupportMultipleWindows(false);
            settings.setSafeBrowsingEnabled(true);
            view.setForceDarkAllowed(false);
            if (WebViewFeature.isFeatureSupported(WebViewFeature.ALGORITHMIC_DARKENING)) {
                WebSettingsCompat.setAlgorithmicDarkeningAllowed(settings, false);
            }
        }
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG);
        browser.addJavascriptInterface(new OnlineBridge(), "VIPRPGAndroid");
        offlineBrowser.addJavascriptInterface(new LibraryBridge(), "VIPRPGAndroid");
        if (WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
            for (WebView view : new WebView[]{browser, offlineBrowser}) {
                WebViewCompat.addDocumentStartJavaScript(view, SYSTEM_THEME_SCRIPT,
                    java.util.Collections.singleton(BuildConfig.SITE_ORIGIN));
            }
        }
        bindVersionTheme();
        applyDeviceTheme();

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
                if (view == offlineBrowser && path != null && path.startsWith("/_native/read/")) return localGames.read(request);
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
                if ("intent".equals(url.getScheme())) {
                    if (view == browser && view.getUrl() != null && sameOrigin(Uri.parse(view.getUrl()))) openKaiImport(url);
                    return true;
                }
                if (sameOrigin(url)) {
                    String path = url.getPath();
                    if (view == browser && path != null && path.matches("/play/[0-9]+/?")) {
                        openInstall(Long.parseLong(path.split("/")[2])); return true;
                    }
                    return false;
                }
                openExternal(url);
                return true;
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                if (view == browser) onlineRefresh.setRefreshing(false);
                sendSystemTheme(view);
                updateNavigation();
            }

            @Override
            public void onPageStarted(WebView view, String url, android.graphics.Bitmap favicon) {
                if (view == offlineBrowser) setPlaying(false);
                else if (onlinePlaying || onlineImmersive) {
                    onlinePlaying = false;
                    onlineImmersive = false;
                    setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_PORTRAIT);
                    updateNavigation();
                }
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (view == browser && request.isForMainFrame()) onlineRefresh.setRefreshing(false);
                if (view == browser && request.isForMainFrame() && !isOffline(request.getUrl()) && !library && !version && !gallery) {
                    onlineLoadFailed = true;
                    Toast.makeText(MainActivity.this, "网络不可用，已打开本地游戏", Toast.LENGTH_SHORT).show();
                    showLibrary();
                }
            }

            @Override
            public void onReceivedHttpError(WebView view, WebResourceRequest request, WebResourceResponse response) {
                if (view == browser && request.isForMainFrame()) onlineRefresh.setRefreshing(false);
                if (view == browser && request.isForMainFrame() && !isOffline(request.getUrl()) && !library && !version && !gallery && response.getStatusCode() >= 500) {
                    onlineLoadFailed = true;
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
        offlineBrowser.setWebViewClient(browser.getWebViewClient());
        browser.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onProgressChanged(WebView view, int percent) {
                if (view != browser) return;
                progress.setProgress(percent);
                progress.setVisibility(percent < 100 && !playing && !library && !version && !gallery ? View.VISIBLE : View.GONE);
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
                if (!playing && !onlinePlaying) setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_PORTRAIT);
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
        offlineBrowser.setWebChromeClient(browser.getWebChromeClient());
        browser.setDownloadListener((url, userAgent, contentDisposition, mimeType, length) -> openExternal(Uri.parse(url)));

        onlineTab.setOnClickListener(view -> showOnline());
        libraryTab.setOnClickListener(view -> showLibrary());
        galleryTab.setOnClickListener(view -> showGallery());
        versionTab.setOnClickListener(view -> showVersion());
        if (savedInstanceState != null) {
            Bundle onlineState = savedInstanceState.getBundle("onlineState");
            Bundle offlineState = savedInstanceState.getBundle("offlineState");
            if (onlineState != null) browser.restoreState(onlineState);
            if (offlineState != null) offlineBrowser.restoreState(offlineState);
            library = savedInstanceState.getBoolean("library");
            if (savedInstanceState.getBoolean("gallery")) showGallery();
            else if (savedInstanceState.getBoolean("version")) showVersion();
            else if (library) showLibrary();
            else showOnline();
        } else showOnline();
        saveTransfers = new SaveTransfers(this, localGames.store);
        localIo.execute(() -> { try { localGames.store.reconcile(); runOnUiThread(this::refreshLocalGames); } catch (Exception ignored) { } });
        if (getIntent().getBooleanExtra("library", false)) showLibrary();
        if (!startupChecked) {
            startupChecked = true;
            if (autoCheck.isChecked()) checkForUpdate(true);
        }
    }

    private void configureWindowInsets() {
        // Own the safe area on every supported Android version, including SDK 35's enforced edge-to-edge.
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        getWindow().setStatusBarColor(Color.TRANSPARENT);
        getWindow().setNavigationBarColor(Color.TRANSPARENT);
        WindowManager.LayoutParams attributes = getWindow().getAttributes();
        attributes.layoutInDisplayCutoutMode = Build.VERSION.SDK_INT >= 30
            ? WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_ALWAYS
            : WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
        getWindow().setAttributes(attributes);
        ViewCompat.setOnApplyWindowInsetsListener(root, (view, windowInsets) -> {
            boolean immersive = isContentImmersive();
            int types = WindowInsetsCompat.Type.displayCutout();
            if (!immersive) types |= WindowInsetsCompat.Type.systemBars();
            Insets safe = windowInsets.getInsetsIgnoringVisibility(types);
            int bottom = immersive ? safe.bottom
                : Math.max(safe.bottom, windowInsets.getInsets(WindowInsetsCompat.Type.ime()).bottom);
            view.setPadding(safe.left, safe.top, safe.right, bottom);
            // The native viewport already avoids these areas; don't apply them again inside the WebViews.
            return WindowInsetsCompat.CONSUMED;
        });
    }

    private boolean sameOrigin(Uri url) {
        return url != null && "https".equals(url.getScheme()) && origin.getHost().equalsIgnoreCase(url.getHost())
            && (url.getPort() == -1 || url.getPort() == 443) && url.getUserInfo() == null;
    }

    private boolean isOffline(Uri url) {
        return sameOrigin(url) && url.getPath() != null && url.getPath().startsWith("/_android/");
    }

    private boolean isBrowserOffline() {
        String url = offlineBrowser.getUrl();
        return url != null && isOffline(Uri.parse(url));
    }

    boolean isScreenshotPage(WebView view) {
        if (view == null || view.getUrl() == null) return false;
        Uri url = Uri.parse(view.getUrl());
        return sameOrigin(url) && ("/_android/index.html".equals(url.getPath())
            || (url.getPath() != null && url.getPath().matches("/play/[0-9]+/?")));
    }

    void exportLocalSave(long workId, String title, String name, byte[] bytes, java.util.function.Consumer<String> opened) {
        if (isDestroyed() || saveTransfers == null) { opened.accept("存档导出暂不可用。"); return; }
        saveTransfers.exportSave(workId, title, name, bytes, opened);
    }

    void setOnlinePlaying(boolean value, boolean immersive) {
        if (!isScreenshotPage(browser) || isOffline(Uri.parse(browser.getUrl()))) return;
        onlinePlaying = value;
        onlineImmersive = immersive;
        if (!value && fullscreenView == null && !playing) setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_PORTRAIT);
        updateNavigation();
        if (!value) showPendingUpdate();
    }

    void onScreenshotDirectoryResult(String error) {
        if (gallery) galleryPanel.directoryResult(error);
        else if (error != null) Toast.makeText(this, error, Toast.LENGTH_LONG).show();
    }

    private void hideGallery() {
        gallery = false;
        findViewById(R.id.gallery_panel).setVisibility(View.GONE);
    }

    private void pauseOnlineBrowser() {
        if (onlineBrowserPaused) return;
        if (browser.getUrl() != null) browser.evaluateJavascript("window.dispatchEvent(new Event('blur'))", null);
        browser.clearFocus();
        browser.onPause();
        onlineBrowserPaused = true;
    }

    private void resumeOnlineBrowser() {
        if (!onlineBrowserPaused) return;
        browser.onResume();
        onlineBrowserPaused = false;
        if (browser.getUrl() != null) browser.evaluateJavascript("window.dispatchEvent(new Event('focus'))", null);
    }

    private void showGallery() {
        if (playing || onlineImmersive || fullscreenView != null || screenshots.isBusy()) return;
        pauseOnlineBrowser();
        version = false; gallery = true;
        versionPage.setVisibility(View.GONE);
        browser.setVisibility(View.GONE);
        offlineBrowser.setVisibility(View.GONE);
        libraryPanel.setVisibility(View.GONE);
        progress.setVisibility(View.GONE);
        findViewById(R.id.gallery_panel).setVisibility(View.VISIBLE);
        setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_PORTRAIT);
        updateNavigation();
        galleryPanel.open();
    }

    private void showOnline() { showOnline(null); }

    private void showOnline(String destination) {
        if (playing || onlineImmersive || fullscreenView != null || screenshots.isBusy()) return;
        hideGallery();
        version = false;
        versionPage.setVisibility(View.GONE);
        libraryPanel.setVisibility(View.GONE);
        offlineBrowser.setVisibility(View.GONE);
        browser.setVisibility(View.VISIBLE);
        if (resumed) resumeOnlineBrowser();
        setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_PORTRAIT);
        library = false;
        if (destination != null || browser.getUrl() == null || onlineLoadFailed) {
            onlineLoadFailed = false;
            browser.loadUrl(destination != null ? destination : BuildConfig.SITE_ORIGIN + "/");
        }
        updateNavigation();
    }

    private void showLibrary() {
        if (playing || onlineImmersive || fullscreenView != null || screenshots.isBusy()) return;
        pauseOnlineBrowser();
        hideGallery();
        version = false;
        versionPage.setVisibility(View.GONE);
        browser.setVisibility(View.GONE);
        offlineBrowser.setVisibility(playing ? View.VISIBLE : View.GONE);
        libraryPanel.setVisibility(playing ? View.GONE : View.VISIBLE);
        setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_PORTRAIT);
        library = true;
        if (!isBrowserOffline()) {
            nativeLibrary.loading();
            offlineBrowser.loadUrl(offlineUrl);
        }
        refreshLocalGames();
        updateNavigation();
    }

    private void sendLibraryCommand(String command, String detail) {
        if (!isBrowserOffline()) return;
        offlineBrowser.evaluateJavascript("window.dispatchEvent(new CustomEvent('viprpg:library-" + command
            + "',{detail:" + detail + "}))", null);
    }

    private void openInstall(long archiveVersionId) {
        localIo.execute(() -> {
            try { JSONObject task = localGames.store.enqueue(archiveVersionId); runOnUiThread(() -> installQueued(task)); }
            catch (Exception e) { runOnUiThread(() -> Toast.makeText(this, e.getMessage(), Toast.LENGTH_LONG).show()); }
        });
    }

    void installQueued(JSONObject task) {
        if (!"ready".equals(task.optString("status"))) {
            if (resumed && Build.VERSION.SDK_INT >= 33 && checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS) != android.content.pm.PackageManager.PERMISSION_GRANTED)
                requestPermissions(new String[]{android.Manifest.permission.POST_NOTIFICATIONS}, 1004);
            InstallService.start(this);
        }
        Toast.makeText(this, "ready".equals(task.optString("status")) ? "此版本已安装，可在本地游戏中游玩。" : "已加入本地游戏下载任务。", Toast.LENGTH_SHORT).show();
        refreshLocalGames();
    }
    volatile String pendingLocalPlay;
    void openLocalLibrary(String key) {
        pendingLocalPlay = key;
        showLibrary();
        if (key != null) sendLibraryCommand("play", JSONObject.quote(key));
    }
    private void refreshLocalGames() {
        if (isDestroyed() || localGames == null || nativeLibrary == null) return;
        try {
            JSONObject snapshot = new JSONObject(localGames.store.snapshot());
            nativeLibrary.setSnapshot(snapshot.toString());
            JSONArray items = snapshot.getJSONArray("items");
            java.util.Set<String> currentKeys = new java.util.HashSet<>();
            for (int i = 0; i < items.length(); i++) currentKeys.add(items.getJSONObject(i).getString("playKey"));
            loadedCovers.retainAll(currentKeys);
            for (int i = 0; i < items.length(); i++) {
                JSONObject item = items.getJSONObject(i); String key = item.getString("playKey");
                if (!item.optString("coverBlobSha256").matches("[a-f0-9]{64}") || !loadedCovers.add(key)) continue;
                coverIo.execute(() -> {
                    String cover = null; try { cover = localGames.store.cover(key); } catch (Exception ignored) { }
                    String image = cover;
                    runOnUiThread(() -> { if (image != null && loadedCovers.contains(key)) nativeLibrary.setCover(key, image); else loadedCovers.remove(key); });
                });
            }
        }
        catch (Exception e) { nativeLibrary.setError(e.getMessage()); }
        if (isBrowserOffline()) sendLibraryCommand("refresh", "null");
        if (browser.getUrl() != null) browser.evaluateJavascript("window.dispatchEvent(new Event('viprpg:local-change'))", null);
    }


    private void setPlaying(boolean value) {
        playing = value;
        if (!value && localGames != null) localGames.store.playingKey = null;
        if (library && !version && !gallery) {
            offlineBrowser.setVisibility(value ? View.VISIBLE : View.GONE);
            libraryPanel.setVisibility(value ? View.GONE : View.VISIBLE);
            if (!value) sendLibraryCommand("refresh", "null");
        }
        // Game orientation comes from the loaded controls preference, never a startup default.
        if (!value) setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_PORTRAIT);
        updateNavigation();
        if (value) restoreOfflinePlayerFocus();
        else showPendingUpdate();
    }

    private void showVersion() {
        if (playing || onlineImmersive || fullscreenView != null || screenshots.isBusy()) return;
        pauseOnlineBrowser();
        hideGallery();
        version = true;
        setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_PORTRAIT);
        browser.setVisibility(View.GONE);
        offlineBrowser.setVisibility(View.GONE);
        libraryPanel.setVisibility(View.GONE);
        progress.setVisibility(View.GONE);
        versionPage.setVisibility(View.VISIBLE);
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
                checkUpdate.setText(R.string.check_update);
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
            updateStatus.setText("发现新版本 " + result.version);
            updateDetail.setText("");
            updateDetail.setVisibility(View.GONE);
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
        checkUpdate.setVisibility(View.GONE);
    }

    private void showUpToDate() {
        updateStatus.setText(R.string.up_to_date);
        updateStatusIcon.setImageResource(R.drawable.ic_check_circle);
        updateDetail.setText("");
        updateDetail.setVisibility(View.GONE);
        checkUpdate.setVisibility(View.VISIBLE);
        checkUpdate.setText(R.string.check_update);
    }

    private void showPendingUpdate() {
        if (!pendingUpdatePrompt || !resumed || playing || onlinePlaying || gallery || screenshots.isBusy() || fullscreenView != null || isFinishing() || isDestroyed()) return;
        pendingUpdatePrompt = false;
        if (version || currentUpdate == null || !getPreferences(MODE_PRIVATE).getBoolean("autoCheckUpdates", true)) return;
        UpdateChecker.Result update = currentUpdate;
        MaterialAlertDialogBuilder dialog = NativeControls.dialog(this)
            .setTitle("发现新版本 " + update.version)
            .setPositiveButton("下载更新", (ignored, which) -> openExternal(update.download))
            .setNegativeButton("稍后", null);
        if (update.notes != null && !update.notes.trim().isEmpty()) {
            dialog.setMessage(update.notes);
        }
        dialog.show();
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

    private boolean isContentImmersive() {
        return fullscreenView != null || playing || (!library && !gallery && !version && onlineImmersive);
    }

    private boolean isDeviceDark() {
        return (getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK)
            == Configuration.UI_MODE_NIGHT_YES;
    }

    private void bindVersionTheme() {
        for (int id : new int[]{R.id.version_app_name, R.id.update_heading, R.id.update_status, R.id.release_notes_heading}) {
            NativeControls.textColor((TextView) findViewById(id), R.color.native_ink);
        }
        for (int id : new int[]{R.id.installed_version, R.id.update_detail, R.id.release_notes, R.id.auto_check_updates}) {
            NativeControls.textColor((TextView) findViewById(id), R.color.native_muted);
        }
        NativeControls.bindTheme(versionPage, () -> versionPage.setBackgroundColor(getColor(R.color.native_background)));
        View divider = findViewById(R.id.version_divider);
        NativeControls.bindTheme(divider, () -> divider.setBackgroundColor(getColor(R.color.native_border)));
        NativeControls.bindTheme(updateStatusIcon, () -> updateStatusIcon.setColorFilter(getColor(R.color.native_primary)));
        NativeControls.bindTheme(checkUpdate, () -> checkUpdate.setTextColor(getColor(R.color.native_primary)));
        NativeControls.bindTheme(downloadUpdate, () -> {
            downloadUpdate.setBackgroundTintList(getColorStateList(R.color.native_primary));
            downloadUpdate.setTextColor(getColor(R.color.native_on_primary));
        });
        MaterialSwitch autoCheck = findViewById(R.id.auto_check_updates);
        NativeControls.bindTheme(autoCheck, () -> {
            autoCheck.setTextColor(getColor(R.color.native_muted));
            // Resolve the public widget style again after rebasing the DayNight theme.
            android.content.res.TypedArray colors = autoCheck.getContext().obtainStyledAttributes(null,
                new int[]{androidx.appcompat.R.attr.thumbTint, androidx.appcompat.R.attr.trackTint,
                    com.google.android.material.R.attr.thumbIconTint, com.google.android.material.R.attr.trackDecorationTint},
                com.google.android.material.R.attr.materialSwitchStyle, 0);
            try {
                autoCheck.setThumbTintList(colors.getColorStateList(0));
                autoCheck.setTrackTintList(colors.getColorStateList(1));
                autoCheck.setThumbIconTintList(colors.getColorStateList(2));
                autoCheck.setTrackDecorationTintList(colors.getColorStateList(3));
            } finally {
                colors.recycle();
            }
        });
    }

    private void applyDeviceTheme() {
        deviceNightMode = getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK;
        getTheme().rebase();
        NativeControls.refreshTheme(root);
        bottomNavigation.setBackgroundColor(getColor(R.color.native_surface));
        for (WebView view : new WebView[]{browser, offlineBrowser}) {
            view.setBackgroundColor(getColor(R.color.native_background));
            sendSystemTheme(view);
        }
        updateNavigation();
    }

    private void sendSystemTheme(WebView view) {
        if (view.getUrl() != null && sameOrigin(Uri.parse(view.getUrl()))) {
            view.evaluateJavascript(SYSTEM_THEME_SCRIPT, null);
        }
    }

    private void updateNavigation() {
        boolean immersive = isContentImmersive();
        boolean online = !library && !gallery && !version;
        onlineRefresh.setVisibility(online ? View.VISIBLE : View.GONE);
        onlineRefresh.setEnabled(online && !immersive && !onlinePlaying);
        if (!onlineRefresh.isEnabled()) onlineRefresh.setRefreshing(false);
        getWindow().setBackgroundDrawable(new ColorDrawable(immersive ? Color.BLACK : getColor(R.color.native_background)));
        bottomNavigation.setVisibility(immersive ? View.GONE : View.VISIBLE);
        tintTab(onlineTab, R.id.online_icon, R.id.online_label, !version && !gallery && !library);
        tintTab(libraryTab, R.id.library_icon, R.id.library_label, !version && !gallery && library);
        tintTab(galleryTab, R.id.gallery_icon, R.id.gallery_label, gallery);
        tintTab(versionTab, R.id.version_icon, R.id.version_label, version);
        WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(getWindow(), root);
        controller.setAppearanceLightStatusBars(!immersive && !isDeviceDark());
        controller.setAppearanceLightNavigationBars(!immersive && !isDeviceDark());
        controller.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
        if (immersive) {
            controller.hide(WindowInsetsCompat.Type.systemBars());
        } else {
            controller.show(WindowInsetsCompat.Type.systemBars());
        }
        ViewCompat.requestApplyInsets(root);
    }

    private void tintTab(LinearLayout tab, int iconId, int labelId, boolean active) {
        int color = getColor(active ? R.color.native_primary : R.color.native_muted);
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

    private void openKaiImport(Uri url) {
        try {
            Intent parsed = Intent.parseUri(url.toString(), Intent.URI_INTENT_SCHEME);
            Uri data = parsed.getData();
            if (!"org.easyrpg.player.kai".equals(parsed.getPackage()) || data == null
                || !"easyrpg-kai".equals(data.getScheme()) || !"import".equals(data.getEncodedAuthority())
                || (data.getPath() != null && !data.getPath().isEmpty()) || data.getFragment() != null
                || data.getQueryParameters("manifest").size() != 1) return;
            Uri manifest = Uri.parse(data.getQueryParameter("manifest"));
            if (!sameOrigin(manifest) || manifest.getPath() == null
                || !manifest.getPath().matches("/api/archive-versions/[0-9]+/kai-import")
                || manifest.getQuery() != null || manifest.getFragment() != null) return;
            // Rebuild only the known import link; never forward Intent components, extras or grant flags.
            Uri link = new Uri.Builder().scheme("easyrpg-kai").authority("import")
                .appendQueryParameter("manifest", manifest.toString()).build();
            startActivity(new Intent(Intent.ACTION_VIEW, link).addCategory(Intent.CATEGORY_BROWSABLE)
                .setPackage("org.easyrpg.player.kai"));
        } catch (java.net.URISyntaxException | ActivityNotFoundException | SecurityException ignored) {
            // The page's existing launch timeout shows its install/update dialog without navigating away.
        }
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
        if (saveTransfers != null && saveTransfers.result(requestCode, resultCode, data)) return;
        if (requestCode == FILE_CHOOSER_REQUEST && fileChooser != null) {
            ValueCallback<Uri[]> callback = fileChooser;
            fileChooser = null;
            List<Uri> files = new ArrayList<>();
            if (resultCode == RESULT_OK && data != null) {
                // WebView's parseResult only reads getData(); multi-select pickers can return ClipData alone.
                ClipData clip = data.getClipData();
                if (clip != null) {
                    for (int i = 0; i < clip.getItemCount(); i++) {
                        Uri uri = clip.getItemAt(i).getUri();
                        if (uri != null) files.add(uri);
                    }
                }
                if (files.isEmpty() && data.getData() != null) files.add(data.getData());
            }
            callback.onReceiveValue(files.isEmpty() ? null : files.toArray(new Uri[0]));
        }
    }

    @Override
    @Deprecated
    public void onBackPressed() {
        if (fullscreenView != null) {
            (library ? offlineBrowser : browser).evaluateJavascript("document.exitFullscreen()", null);
        } else if (playing || (!library && !gallery && !version && onlinePlaying)) {
            (library ? offlineBrowser : browser).evaluateJavascript("window.dispatchEvent(new Event('viprpg:back'))", null);
        } else if (gallery) {
            if (!galleryPanel.onBack() && !screenshots.isBusy()) { if (library) showLibrary(); else showOnline(); }
        } else if (version) {
            if (library) showLibrary(); else showOnline();
        } else if (library) {
            if (!nativeLibrary.onBack()) {
                if (hasNetwork()) showOnline(); else super.onBackPressed();
            }
        } else if (browser.canGoBack()) {
            browser.goBack();
        } else {
            showLibrary();
        }
    }

    private void restoreOfflinePlayerFocus() {
        if (offlineBrowser == null) return;
        offlineBrowser.postOnAnimation(() -> {
            // Never steal focus from another tab, a system picker, or a paused activity.
            if (!resumed || !playing || !library || gallery || version || fullscreenView != null
                || !hasWindowFocus() || !offlineBrowser.isShown() || !isBrowserOffline()) return;
            offlineBrowser.requestFocus();
            offlineBrowser.evaluateJavascript(
                "window.dispatchEvent(new Event('viprpg:player-focus'))", null);
        });
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) restoreOfflinePlayerFocus();
    }

    @Override
    public void onConfigurationChanged(Configuration configuration) {
        super.onConfigurationChanged(configuration);
        if (deviceNightMode != (configuration.uiMode & Configuration.UI_MODE_NIGHT_MASK)) applyDeviceTheme();
        ViewCompat.requestApplyInsets(root);
        browser.requestLayout();
        offlineBrowser.requestLayout();
        restoreOfflinePlayerFocus();
    }

    @Override
    protected void onPause() {
        resumed = false;
        pauseOnlineBrowser();
        offlineBrowser.evaluateJavascript("window.dispatchEvent(new Event('blur'))", null);
        offlineBrowser.onPause();
        super.onPause();
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (deviceNightMode != (getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK)) applyDeviceTheme();
        if (!library && !gallery && !version) resumeOnlineBrowser();
        offlineBrowser.onResume();
        resumed = true;
        if (localGames.store.next() != null) InstallService.start(this);
        restoreOfflinePlayerFocus();
        if (gallery) galleryPanel.refreshOnResume();
        if (library && !playing && !gallery && !version) sendLibraryCommand("refresh", "null");
        showPendingUpdate();
    }

    @Override
    protected void onDestroy() {
        if (fileChooser != null) fileChooser.onReceiveValue(null);
        galleryPanel.close();
        screenshots.close();
        localGames.store.changed = null;
        localGames.close();
        localIo.shutdownNow();
        if (saveTransfers != null) saveTransfers.close();
        coverIo.shutdownNow();
        updateExecutor.shutdownNow();
        browser.destroy();
        offlineBrowser.destroy();
        super.onDestroy();
    }

    @Override
    protected void onSaveInstanceState(Bundle state) {
        state.putBoolean("version", version);
        state.putBoolean("gallery", gallery);
        state.putBoolean("library", library);
        Bundle onlineState = new Bundle();
        Bundle offlineState = new Bundle();
        browser.saveState(onlineState);
        offlineBrowser.saveState(offlineState);
        state.putBundle("onlineState", onlineState);
        state.putBundle("offlineState", offlineState);
        super.onSaveInstanceState(state);
    }

    private class DeviceBridge {
        @JavascriptInterface
        public String getSystemTheme() {
            return isDeviceDark() ? "dark" : "light";
        }
    }

    private final class OnlineBridge extends DeviceBridge {
        @JavascriptInterface
        public void setPlaying(boolean value) {
            runOnUiThread(() -> setOnlinePlaying(value, value));
        }

        @JavascriptInterface
        public void setOrientation(String direction) {
            runOnUiThread(() -> {
                if (!isScreenshotPage(browser) || !"landscape".equals(direction) && !"portrait".equals(direction)) return;
                setRequestedOrientation("landscape".equals(direction)
                    ? ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE : ActivityInfo.SCREEN_ORIENTATION_PORTRAIT);
            });
        }
    }

    private final class LibraryBridge extends DeviceBridge {
        @JavascriptInterface
        public void requestPlayerFocus() {
            runOnUiThread(() -> restoreOfflinePlayerFocus());
        }

        @JavascriptInterface
        public void setLibraryError(String error) {
            runOnUiThread(() -> { if (isBrowserOffline()) nativeLibrary.setError(error); });
        }

        @JavascriptInterface
        public void setPlaying(boolean value) {
            runOnUiThread(() -> {
                if (isBrowserOffline()) MainActivity.this.setPlaying(value);
            });
        }

        @JavascriptInterface
        public void setOrientation(String direction) {
            runOnUiThread(() -> {
                if (!isBrowserOffline() || (!playing && !"unspecified".equals(direction))) return;
                int requested = "landscape".equals(direction) ? ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE
                    : ActivityInfo.SCREEN_ORIENTATION_PORTRAIT;
                setRequestedOrientation(requested);
            });
        }
    }
}
