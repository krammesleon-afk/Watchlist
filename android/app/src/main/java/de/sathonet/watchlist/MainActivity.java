package de.sathonet.watchlist;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.app.Dialog;
import android.app.DownloadManager;
import android.content.ActivityNotFoundException;
import android.content.ContentValues;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.res.ColorStateList;
import android.graphics.Color;
import android.graphics.Insets;
import android.graphics.Typeface;
import android.graphics.drawable.ColorDrawable;
import android.graphics.drawable.GradientDrawable;
import android.graphics.drawable.RippleDrawable;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
import android.provider.Settings;
import android.util.Base64;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.WindowManager;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.URLUtil;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;

import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Die App ist ein WebView, der die Satho-Net-Seite lädt, mit einer eigenen
 * Leiste unten (Start, Watchlist, Games, Freunde, Mehr). Die Webseite bleibt
 * unverändert: Für das Handy-Layout spielt die App app-mobile.css in jede
 * Seite ein (siehe app-style.js).
 * Dazu kommt, was ein WebView nicht von selbst kann: Datei-Auswahl,
 * Downloads, Kamera/Mikrofon, Vollbild-Videos und externe Links.
 */
public class MainActivity extends Activity {

    private static final int REQUEST_FILE = 1;
    private static final int REQUEST_MEDIA_PERMISSION = 2;
    private static final int REQUEST_NOTIFICATIONS = 3;
    private static final long UPDATE_CHECK_INTERVAL = 24 * 3600 * 1000L;

    private final String appUrl = BuildConfig.APP_URL;
    private final String appHost = Uri.parse(BuildConfig.APP_URL).getHost();

    // Farben passend zur Webseite
    private static final int COLOR_BG = 0xFF0F0E0D;
    private static final int COLOR_BAR = 0xFF171513;
    private static final int COLOR_LINE = 0x1FF4EDE4;
    private static final int COLOR_TEXT = 0xFFF4EDE4;
    private static final int COLOR_MUTED = 0xFF9A8F84;
    private static final int COLOR_ACCENT = 0xFFF6A24C;
    private static final int COLOR_DANGER = 0xFFEF6B6B;

    /** Reiter der unteren Leiste. path == null: öffnet das Mehr-Menü. */
    private static final String[][] TABS = {
            {"Start", "/"},
            {"Watchlist", "/index.html"},
            {"Games", "/games.html"},
            {"Freunde", "/friends.html"},
            {"Mehr", null},
    };
    private static final int[] TAB_ICONS = {
            R.drawable.ic_home, R.drawable.ic_tv, R.drawable.ic_gamepad, R.drawable.ic_users, R.drawable.ic_more,
    };
    private static final int TAB_MORE = 4;

    private FrameLayout root;
    private LinearLayout appLayout;
    private LinearLayout bottomBar;
    private ProgressBar progressBar;
    private final List<View> tabViews = new ArrayList<>();
    private int activeTab = -1;
    private int navBarInset;
    private WebView webView;
    private AppChromeClient chromeClient;
    private ValueCallback<Uri[]> fileCallback;
    private PermissionRequest pendingPermission;
    private View customView;
    private WebChromeClient.CustomViewCallback customViewCallback;
    private String bridgeScript;
    private String styleScript;
    private boolean styleAtDocumentStart;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        root = new FrameLayout(this);
        root.setBackgroundColor(COLOR_BG);

        appLayout = new LinearLayout(this);
        appLayout.setOrientation(LinearLayout.VERTICAL);
        root.addView(appLayout, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        FrameLayout content = new FrameLayout(this);
        appLayout.addView(content, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));

        webView = new WebView(this);
        webView.setBackgroundColor(COLOR_BG);
        content.addView(webView, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        progressBar = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        progressBar.setMax(100);
        progressBar.setProgressTintList(ColorStateList.valueOf(COLOR_ACCENT));
        progressBar.setProgressBackgroundTintList(ColorStateList.valueOf(Color.TRANSPARENT));
        progressBar.setVisibility(View.GONE);
        FrameLayout.LayoutParams pbParams = new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(3));
        pbParams.gravity = Gravity.TOP;
        content.addView(progressBar, pbParams);

        bottomBar = buildBottomBar();
        appLayout.addView(bottomBar, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        setContentView(root);
        setupEdgeToEdge();

        bridgeScript = readAsset("app-bridge.js");
        String css = readAsset("app-mobile.css");
        String style = readAsset("app-style.js");
        if (css != null && style != null) {
            styleScript = "var __snCss = " + JSONObject.quote(css) + ";\n" + style;
        }
        setupWebView();

        String start = urlFromIntent(getIntent());
        if (start != null) {
            webView.loadUrl(start);
        } else if (savedInstanceState != null) {
            webView.restoreState(savedInstanceState);
        } else {
            webView.loadUrl(appUrl);
        }
        if (savedInstanceState == null) checkForUpdate(false);
        Notifier.schedule(this);
    }

    /**
     * Adresse aus einem Intent: App-Links auf die eigene Seite (z. B.
     * Watch-Party-Einladungen), Benachrichtigungen und die Verknüpfungen
     * beim langen Drücken aufs App-Icon (sathonet:///pfad, siehe shortcuts.xml).
     */
    private String urlFromIntent(Intent intent) {
        Uri uri = intent == null ? null : intent.getData();
        if (uri == null) return null;
        String scheme = uri.getScheme();
        if (("https".equals(scheme) || "http".equals(scheme)) && isOwnPage(uri)) return uri.toString();
        if ("sathonet".equals(scheme)) {
            String path = uri.getPath() == null || uri.getPath().isEmpty() ? "/" : uri.getPath();
            return appUrl + path + (uri.getQuery() != null ? "?" + uri.getQuery() : "");
        }
        return null;
    }

    private void setupWebView() {
        WebSettings s = webView.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        s.setAllowFileAccess(false);
        s.setUserAgentString(s.getUserAgentString() + " SathoNetApp/" + BuildConfig.VERSION_NAME);

        CookieManager cookies = CookieManager.getInstance();
        cookies.setAcceptCookie(true);
        cookies.setAcceptThirdPartyCookies(webView, true);

        // Handy-Stylesheet vor dem ersten Zeichnen einspielen, damit nichts
        // aufblitzt. Ältere WebViews bekommen es, sobald die Seite sichtbar wird.
        if (styleScript != null && WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
            Uri u = Uri.parse(appUrl);
            String origin = u.getScheme() + "://" + u.getHost() + (u.getPort() != -1 ? ":" + u.getPort() : "");
            WebViewCompat.addDocumentStartJavaScript(webView, styleScript, Collections.singleton(origin));
            styleAtDocumentStart = true;
        }

        webView.addJavascriptInterface(new Bridge(), "SathoNetApp");
        webView.setWebViewClient(new AppWebViewClient());
        chromeClient = new AppChromeClient();
        webView.setWebChromeClient(chromeClient);
        webView.setDownloadListener((url, userAgent, contentDisposition, mimeType, length) ->
                download(url, userAgent, contentDisposition, mimeType));
    }

    private boolean isOwnPage(Uri uri) {
        return appHost != null && appHost.equalsIgnoreCase(uri.getHost());
    }

    private void openExternal(Uri uri) {
        try {
            Intent intent = "intent".equals(uri.getScheme())
                    ? Intent.parseUri(uri.toString(), Intent.URI_INTENT_SCHEME)
                    : new Intent(Intent.ACTION_VIEW, uri);
            intent.addCategory(Intent.CATEGORY_BROWSABLE);
            intent.setComponent(null);
            startActivity(intent);
        } catch (Exception e) {
            Toast.makeText(this, "Link kann nicht geöffnet werden", Toast.LENGTH_SHORT).show();
        }
    }

    private class AppWebViewClient extends WebViewClient {
        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            Uri uri = request.getUrl();
            String scheme = uri.getScheme();
            if (("https".equals(scheme) || "http".equals(scheme)) && isOwnPage(uri)) {
                return false;
            }
            openExternal(uri);
            return true;
        }

        @Override
        public void doUpdateVisitedHistory(WebView view, String url, boolean isReload) {
            updateActiveTab(url);
        }

        @Override
        public void onPageCommitVisible(WebView view, String url) {
            injectStyle(view, url);
        }

        @Override
        public void onPageFinished(WebView view, String url) {
            injectStyle(view, url);
            if (bridgeScript != null) view.evaluateJavascript(bridgeScript, null);
            CookieManager.getInstance().flush();
        }

        private void injectStyle(WebView view, String url) {
            if (styleAtDocumentStart || styleScript == null || url == null) return;
            if (isOwnPage(Uri.parse(url))) view.evaluateJavascript(styleScript, null);
        }

        @Override
        public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
            if (!request.isForMainFrame()) return;
            String html = "<!doctype html><html><head><meta name='viewport' content='width=device-width,initial-scale=1'>"
                    + "<meta name='sn-offline' content='1'>"
                    + "<style>body{background:#131110;color:#eee;font-family:sans-serif;display:flex;flex-direction:column;"
                    + "align-items:center;justify-content:center;height:100vh;margin:0;text-align:center;padding:0 24px}"
                    + "button{margin-top:20px;padding:12px 28px;border:0;border-radius:10px;background:#E0A458;color:#131110;font-size:16px}"
                    + "</style></head><body><h2>Keine Verbindung</h2><p>Satho-Net ist gerade nicht erreichbar. "
                    + "Prüfe deine Internetverbindung.</p><button onclick=\"location.href='"
                    + request.getUrl() + "'\">Erneut versuchen</button></body></html>";
            view.loadDataWithBaseURL(appUrl, html, "text/html", "utf-8", request.getUrl().toString());
        }
    }

    private class AppChromeClient extends WebChromeClient {
        @Override
        public void onProgressChanged(WebView view, int newProgress) {
            progressBar.setProgress(newProgress);
            progressBar.setVisibility(newProgress >= 100 ? View.GONE : View.VISIBLE);
        }

        @Override
        public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
            if (fileCallback != null) fileCallback.onReceiveValue(null);
            fileCallback = callback;
            Intent intent = params.createIntent();
            if (params.getMode() == FileChooserParams.MODE_OPEN_MULTIPLE) {
                intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
            }
            try {
                startActivityForResult(intent, REQUEST_FILE);
            } catch (ActivityNotFoundException e) {
                fileCallback = null;
                return false;
            }
            return true;
        }

        @Override
        public void onPermissionRequest(PermissionRequest request) {
            if (!isOwnPage(request.getOrigin())) {
                request.deny();
                return;
            }
            List<String> needed = new ArrayList<>();
            for (String res : request.getResources()) {
                if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(res)
                        && checkSelfPermission(Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
                    needed.add(Manifest.permission.CAMERA);
                }
                if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(res)
                        && checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
                    needed.add(Manifest.permission.RECORD_AUDIO);
                }
            }
            if (needed.isEmpty()) {
                request.grant(request.getResources());
            } else {
                pendingPermission = request;
                requestPermissions(needed.toArray(new String[0]), REQUEST_MEDIA_PERMISSION);
            }
        }

        @Override
        public void onShowCustomView(View view, CustomViewCallback callback) {
            if (customView != null) {
                callback.onCustomViewHidden();
                return;
            }
            customView = view;
            customViewCallback = callback;
            root.addView(view, new FrameLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
            appLayout.setVisibility(View.GONE);
            setSystemBarsHidden(true);
        }

        @Override
        public void onHideCustomView() {
            if (customView == null) return;
            root.removeView(customView);
            customView = null;
            appLayout.setVisibility(View.VISIBLE);
            setSystemBarsHidden(false);
            if (customViewCallback != null) customViewCallback.onCustomViewHidden();
            customViewCallback = null;
        }
    }

    // ===================== Ränder, Leiste unten, Mehr-Menü =====================

    private int dp(float v) {
        return Math.round(TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v, getResources().getDisplayMetrics()));
    }

    /**
     * Ab Android 11 zeichnet die App bis unter Status- und Navigationsleiste
     * (ab Android 15 ist das Pflicht). Die Ränder werden hier selbst
     * freigehalten, und die Tastatur schiebt die Seite nach oben.
     */
    private void setupEdgeToEdge() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) return;
        Window w = getWindow();
        w.setDecorFitsSystemWindows(false);
        w.setStatusBarColor(Color.TRANSPARENT);
        w.setNavigationBarColor(Color.TRANSPARENT);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) w.setNavigationBarContrastEnforced(false);
        appLayout.setOnApplyWindowInsetsListener((v, insets) -> {
            Insets bars = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
            boolean imeVisible = insets.isVisible(WindowInsets.Type.ime());
            int imeBottom = insets.getInsets(WindowInsets.Type.ime()).bottom;
            navBarInset = bars.bottom;
            v.setPadding(bars.left, bars.top, bars.right, imeVisible ? imeBottom : 0);
            bottomBar.setPadding(0, 0, 0, bars.bottom);
            bottomBar.setVisibility(imeVisible || isBarHiddenPage(webView.getUrl()) ? View.GONE : View.VISIBLE);
            return WindowInsets.CONSUMED;
        });
    }

    private void setSystemBarsHidden(boolean hidden) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            WindowInsetsController c = getWindow().getInsetsController();
            if (c == null) return;
            if (hidden) {
                c.setSystemBarsBehavior(WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
                c.hide(WindowInsets.Type.systemBars());
            } else {
                c.show(WindowInsets.Type.systemBars());
            }
        } else if (hidden) {
            getWindow().addFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN);
        } else {
            getWindow().clearFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN);
        }
    }

    private LinearLayout buildBottomBar() {
        LinearLayout bar = new LinearLayout(this);
        bar.setOrientation(LinearLayout.HORIZONTAL);
        GradientDrawable bg = new GradientDrawable();
        bg.setColor(COLOR_BAR);
        // Haarlinie oben
        android.graphics.drawable.LayerDrawable layered = new android.graphics.drawable.LayerDrawable(
                new android.graphics.drawable.Drawable[]{new ColorDrawable(COLOR_LINE), bg});
        layered.setLayerInset(1, 0, 1, 0, 0);
        bar.setBackground(layered);

        for (int i = 0; i < TABS.length; i++) {
            final int index = i;
            LinearLayout tab = new LinearLayout(this);
            tab.setOrientation(LinearLayout.VERTICAL);
            tab.setGravity(Gravity.CENTER);
            tab.setPadding(0, dp(8), 0, dp(8));
            tab.setContentDescription(TABS[i][0]);
            tab.setBackground(new RippleDrawable(ColorStateList.valueOf(0x22F6A24C), null, new ColorDrawable(Color.WHITE)));

            FrameLayout pill = new FrameLayout(this);
            ImageView icon = new ImageView(this);
            icon.setImageResource(TAB_ICONS[i]);
            FrameLayout.LayoutParams ip = new FrameLayout.LayoutParams(dp(22), dp(22));
            ip.gravity = Gravity.CENTER;
            pill.addView(icon, ip);
            tab.addView(pill, new LinearLayout.LayoutParams(dp(56), dp(30)));

            TextView label = new TextView(this);
            label.setText(TABS[i][0]);
            label.setTextSize(TypedValue.COMPLEX_UNIT_SP, 11.5f);
            label.setPadding(0, dp(3), 0, 0);
            label.setMaxLines(1);
            tab.addView(label, new LinearLayout.LayoutParams(
                    ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT));

            tab.setOnClickListener(v -> onTabClicked(index));
            bar.addView(tab, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
            tabViews.add(tab);
        }
        styleTabs();
        return bar;
    }

    private void styleTabs() {
        for (int i = 0; i < tabViews.size(); i++) {
            LinearLayout tab = (LinearLayout) tabViews.get(i);
            FrameLayout pill = (FrameLayout) tab.getChildAt(0);
            ImageView icon = (ImageView) pill.getChildAt(0);
            TextView label = (TextView) tab.getChildAt(1);
            boolean active = i == activeTab;
            icon.setImageTintList(ColorStateList.valueOf(active ? COLOR_ACCENT : COLOR_MUTED));
            label.setTextColor(active ? COLOR_TEXT : COLOR_MUTED);
            label.setTypeface(Typeface.create("sans-serif-medium", active ? Typeface.BOLD : Typeface.NORMAL));
            if (active) {
                GradientDrawable p = new GradientDrawable();
                p.setColor(0x2EF6A24C);
                p.setCornerRadius(dp(15));
                pill.setBackground(p);
            } else {
                pill.setBackground(null);
            }
            tab.setSelected(active);
        }
    }

    /** Welcher Reiter gehört zur gerade angezeigten Seite? */
    private void updateActiveTab(String url) {
        if (url == null) return;
        Uri uri = Uri.parse(url);
        if (!isOwnPage(uri)) return;
        String path = uri.getPath() == null ? "/" : uri.getPath();
        int tab;
        if (path.equals("/") || path.equals("/landing.html") || path.equals("/home.html")) tab = 0;
        else if (path.equals("/index.html")) tab = 1;
        else if (path.equals("/games.html")) tab = 2;
        else if (path.equals("/friends.html")) tab = 3;
        else tab = TAB_MORE;
        if (tab != activeTab) {
            activeTab = tab;
            styleTabs();
        }
        bottomBar.setVisibility(isBarHiddenPage(url) ? View.GONE : View.VISIBLE);
    }

    /** Registrieren und Passwort-Reset brauchen keine Leiste. */
    private boolean isBarHiddenPage(String url) {
        if (url == null) return false;
        String path = Uri.parse(url).getPath();
        return path != null && (path.equals("/register.html") || path.equals("/password-reset.html"));
    }

    private void onTabClicked(int index) {
        if (index == TAB_MORE) {
            showMoreSheet();
            return;
        }
        if (index == activeTab) {
            // Nochmal tippen: nach oben scrollen
            webView.evaluateJavascript("window.scrollTo({top:0,behavior:'smooth'})", null);
            return;
        }
        openPage(TABS[index][1]);
    }

    private void openPage(String path) {
        activeTab = -1;
        updateActiveTab(appUrl + path);
        webView.loadUrl(appUrl + path);
    }

    private void showMoreSheet() {
        final Dialog dialog = new Dialog(this);
        dialog.requestWindowFeature(Window.FEATURE_NO_TITLE);

        LinearLayout sheet = new LinearLayout(this);
        sheet.setOrientation(LinearLayout.VERTICAL);
        sheet.setPadding(dp(8), dp(10), dp(8), dp(12) + navBarInset);
        GradientDrawable bg = new GradientDrawable();
        bg.setColor(COLOR_BAR);
        float r = dp(24);
        bg.setCornerRadii(new float[]{r, r, r, r, 0, 0, 0, 0});
        sheet.setBackground(bg);

        View handle = new View(this);
        GradientDrawable hb = new GradientDrawable();
        hb.setColor(0x40F4EDE4);
        hb.setCornerRadius(dp(2));
        handle.setBackground(hb);
        LinearLayout.LayoutParams hp = new LinearLayout.LayoutParams(dp(36), dp(4));
        hp.gravity = Gravity.CENTER_HORIZONTAL;
        hp.bottomMargin = dp(10);
        sheet.addView(handle, hp);

        sheet.addView(sheetRow(R.drawable.ic_wrench, "Werkzeugkasten", "Nachschlagewerke und Werkzeuge", false,
                () -> { dialog.dismiss(); openPage("/tools.html"); }));
        sheet.addView(sheetRow(R.drawable.ic_upload, "Datei-Drop", "Dateien zwischen Geräten schicken", false,
                () -> { dialog.dismiss(); openPage("/drop.html"); }));
        sheet.addView(sheetRow(R.drawable.ic_play, "Watch-Party", "Videos gemeinsam und synchron schauen", false,
                () -> { dialog.dismiss(); openPage("/party.html"); }));
        sheet.addView(sheetRow(R.drawable.ic_shield, "Geheimlink", "Text teilen, der Link geht genau einmal", false,
                () -> { dialog.dismiss(); openPage("/secret.html"); }));
        sheet.addView(sheetRow(R.drawable.ic_bell, "Benachrichtigungen", "Verlauf, Geräte und was gemeldet wird", false,
                () -> { dialog.dismiss(); openPage("/push.html"); }));

        View line = new View(this);
        line.setBackgroundColor(COLOR_LINE);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 1);
        lp.setMargins(dp(16), dp(6), dp(16), dp(6));
        sheet.addView(line, lp);

        sheet.addView(sheetRow(R.drawable.ic_refresh, "Neu laden", null, false,
                () -> { dialog.dismiss(); webView.reload(); }));
        sheet.addView(sheetRow(R.drawable.ic_upload, "Nach Updates suchen", "Installiert: Version " + BuildConfig.VERSION_NAME, false,
                () -> { dialog.dismiss(); checkForUpdate(true); }));
        View logout = sheetRow(R.drawable.ic_logout, "Abmelden", null, false,
                () -> { dialog.dismiss(); confirmLogout(); });
        ((ImageView) ((LinearLayout) logout).getChildAt(0)).setImageTintList(ColorStateList.valueOf(COLOR_DANGER));
        ((TextView) ((LinearLayout) ((LinearLayout) logout).getChildAt(1)).getChildAt(0)).setTextColor(COLOR_DANGER);
        sheet.addView(logout);

        dialog.setContentView(sheet);
        Window w = dialog.getWindow();
        if (w != null) {
            w.setBackgroundDrawable(new ColorDrawable(Color.TRANSPARENT));
            w.setLayout(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
            w.setGravity(Gravity.BOTTOM);
            w.setWindowAnimations(android.R.style.Animation_InputMethod);
            w.setDimAmount(0.55f);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                w.setDecorFitsSystemWindows(false);
                w.setNavigationBarColor(Color.TRANSPARENT);
            }
        }
        dialog.show();
    }

    private View sheetRow(int iconRes, String title, String subtitle, boolean external, Runnable action) {
        LinearLayout row = new LinearLayout(this);
        row.setOrientation(LinearLayout.HORIZONTAL);
        row.setGravity(Gravity.CENTER_VERTICAL);
        row.setPadding(dp(16), dp(12), dp(16), dp(12));
        row.setMinimumHeight(dp(56));
        GradientDrawable mask = new GradientDrawable();
        mask.setColor(Color.WHITE);
        mask.setCornerRadius(dp(14));
        row.setBackground(new RippleDrawable(ColorStateList.valueOf(0x22F6A24C), null, mask));

        ImageView icon = new ImageView(this);
        icon.setImageResource(iconRes);
        icon.setImageTintList(ColorStateList.valueOf(COLOR_ACCENT));
        LinearLayout.LayoutParams ip = new LinearLayout.LayoutParams(dp(24), dp(24));
        ip.rightMargin = dp(18);
        row.addView(icon, ip);

        LinearLayout texts = new LinearLayout(this);
        texts.setOrientation(LinearLayout.VERTICAL);
        TextView t = new TextView(this);
        t.setText(title);
        t.setTextColor(COLOR_TEXT);
        t.setTextSize(TypedValue.COMPLEX_UNIT_SP, 16);
        texts.addView(t);
        if (subtitle != null) {
            TextView st = new TextView(this);
            st.setText(subtitle);
            st.setTextColor(COLOR_MUTED);
            st.setTextSize(TypedValue.COMPLEX_UNIT_SP, 13);
            texts.addView(st);
        }
        row.addView(texts, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));

        if (external) {
            ImageView ext = new ImageView(this);
            ext.setImageResource(R.drawable.ic_external);
            ext.setImageTintList(ColorStateList.valueOf(COLOR_MUTED));
            row.addView(ext, new LinearLayout.LayoutParams(dp(18), dp(18)));
        }
        row.setOnClickListener(v -> action.run());
        return row;
    }

    private void confirmLogout() {
        new AlertDialog.Builder(this, android.R.style.Theme_Material_Dialog_Alert)
                .setTitle("Abmelden?")
                .setMessage("Du kannst dich jederzeit wieder anmelden.")
                .setNegativeButton("Abbrechen", null)
                .setPositiveButton("Abmelden", (d, which) -> logout())
                .show();
    }

    /** Meldet ab wie die Webseite selbst (Token und Nutzer aus dem Speicher). */
    private void logout() {
        String js = "(function(){try{localStorage.removeItem('auth_token');localStorage.removeItem('sathonet_user');"
                + "sessionStorage.removeItem('auth_token');}catch(e){}"
                + "document.cookie='auth_token=;path=/;expires=Thu, 01 Jan 1970 00:00:00 GMT';})()";
        Notifier.clearDevice(this);
        webView.evaluateJavascript(js, v -> {
            CookieManager.getInstance().flush();
            openPage("/");
        });
    }

    /** Normale http(s)-Downloads übernimmt der Android-Downloadmanager. */
    private void download(String url, String userAgent, String contentDisposition, String mimeType) {
        if (!url.startsWith("http")) return; // blob:/data: erledigt app-bridge.js
        try {
            String name = URLUtil.guessFileName(url, contentDisposition, mimeType);
            DownloadManager.Request req = new DownloadManager.Request(Uri.parse(url));
            req.setMimeType(mimeType);
            req.addRequestHeader("User-Agent", userAgent);
            String cookie = CookieManager.getInstance().getCookie(url);
            if (cookie != null) req.addRequestHeader("Cookie", cookie);
            req.setTitle(name);
            req.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
            req.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, name);
            ((DownloadManager) getSystemService(DOWNLOAD_SERVICE)).enqueue(req);
            Toast.makeText(this, "Download gestartet: " + name, Toast.LENGTH_SHORT).show();
        } catch (Exception e) {
            Toast.makeText(this, "Download fehlgeschlagen", Toast.LENGTH_SHORT).show();
        }
    }

    /** Wird aus app-bridge.js aufgerufen. */
    private class Bridge {
        @JavascriptInterface
        public void saveFile(String name, String mimeType, String base64) {
            String safeName = name.replaceAll("[\\\\/:*?\"<>|]", "_");
            try {
                saveToDownloads(safeName, mimeType, Base64.decode(base64, Base64.DEFAULT));
                toast("In Downloads gespeichert: " + safeName);
            } catch (Exception e) {
                toast("Speichern fehlgeschlagen");
            }
        }

        @JavascriptInterface
        public void saveFailed(String message) {
            toast("Speichern fehlgeschlagen");
        }

        // ----- Benachrichtigungen (app-bridge.js, push.js) -----

        /** Für wen die App angemeldet ist, "" = gar nicht. */
        @JavascriptInterface
        public String deviceUser() {
            return Notifier.deviceUser(MainActivity.this);
        }

        @JavascriptInterface
        public String deviceLabel() {
            String model = Build.MODEL == null ? "" : Build.MODEL;
            return "App auf " + (model.isEmpty() ? "Android" : model);
        }

        @JavascriptInterface
        public void setDevice(String token, String user) {
            if (token == null || token.isEmpty()) return;
            Notifier.setDevice(MainActivity.this, token, user);
            runOnUiThread(() -> {
                // Einmal direkt nach dem ersten Login um Erlaubnis fragen
                if (Notifier.needsPermission(MainActivity.this) && !askedForNotifications()) {
                    requestNotificationPermission();
                }
                notifyPageStateChanged();
            });
        }

        @JavascriptInterface
        public void clearDevice() {
            Notifier.clearDevice(MainActivity.this);
        }

        @JavascriptInterface
        public String notificationState() {
            return notificationStateNow();
        }

        @JavascriptInterface
        public void enableNotifications() {
            runOnUiThread(() -> {
                if (Notifier.needsPermission(MainActivity.this) && "off".equals(notificationStateNow())) {
                    requestNotificationPermission();
                } else {
                    openNotificationSettings();
                }
            });
        }
    }

    private boolean askedForNotifications() {
        return Notifier.prefs(this).getBoolean("asked_notifications", false);
    }

    private String notificationStateNow() {
        boolean rationale = Build.VERSION.SDK_INT >= 33
                && shouldShowRequestPermissionRationale(Manifest.permission.POST_NOTIFICATIONS);
        return Notifier.state(this, askedForNotifications(), rationale);
    }

    private void requestNotificationPermission() {
        if (Build.VERSION.SDK_INT < 33) return;
        Notifier.prefs(this).edit().putBoolean("asked_notifications", true).apply();
        requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, REQUEST_NOTIFICATIONS);
    }

    private void openNotificationSettings() {
        Intent i;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            i = new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
                    .putExtra(Settings.EXTRA_APP_PACKAGE, getPackageName());
        } else {
            i = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + getPackageName()));
        }
        try {
            startActivity(i);
        } catch (ActivityNotFoundException e) {
            toast("Einstellungen lassen sich nicht öffnen");
        }
    }

    /** Lässt die Benachrichtigungs-Seite ihren Status neu anzeigen. */
    private void notifyPageStateChanged() {
        webView.evaluateJavascript("window.__snNotifyChanged && window.__snNotifyChanged()", null);
    }

    // ===================== Updates =====================

    /**
     * Schaut im GitHub-Release nach einer neueren APK. Automatisch höchstens
     * einmal am Tag, von Hand über "Mehr → Nach Updates suchen". Testbuilds
     * (Version 0.0.x-test) fragen nur von Hand.
     */
    private void checkForUpdate(boolean manual) {
        if (!manual) {
            if (BuildConfig.VERSION_NAME.contains("test")) return;
            long last = Notifier.prefs(this).getLong("update_check", 0);
            if (System.currentTimeMillis() - last < UPDATE_CHECK_INTERVAL) return;
        }
        Notifier.prefs(this).edit().putLong("update_check", System.currentTimeMillis()).apply();
        if (manual) toast("Suche nach Updates …");
        new Thread(() -> {
            try {
                HttpURLConnection con = (HttpURLConnection) new URL(
                        "https://api.github.com/repos/" + BuildConfig.UPDATE_REPO + "/releases/latest").openConnection();
                con.setConnectTimeout(15000);
                con.setReadTimeout(15000);
                con.setRequestProperty("Accept", "application/vnd.github+json");
                if (con.getResponseCode() != 200) throw new IOException("HTTP " + con.getResponseCode());
                JSONObject rel = new JSONObject(Notifier.readAll(con.getInputStream()));
                con.disconnect();
                String latest = rel.optString("tag_name", "").replaceFirst("^app-v", "");
                String download = rel.optString("html_url", "");
                JSONArray assets = rel.optJSONArray("assets");
                if (assets != null) {
                    for (int i = 0; i < assets.length(); i++) {
                        JSONObject a = assets.getJSONObject(i);
                        if (a.optString("name").endsWith(".apk")) download = a.optString("browser_download_url", download);
                    }
                }
                final String url = download;
                if (isNewer(latest, BuildConfig.VERSION_NAME)) {
                    runOnUiThread(() -> showUpdateDialog(latest, url));
                } else if (manual) {
                    toast("Du hast die neueste Version (" + BuildConfig.VERSION_NAME + ")");
                }
            } catch (Exception e) {
                if (manual) toast("Update-Suche fehlgeschlagen");
            }
        }).start();
    }

    /** Vergleicht Versionen wie 1.10 und 1.9 zahlenweise. */
    static boolean isNewer(String latest, String current) {
        if (latest == null || latest.isEmpty()) return false;
        String[] a = latest.split("[.-]");
        String[] b = current.split("[.-]");
        for (int i = 0; i < Math.max(a.length, b.length); i++) {
            int x = i < a.length ? parseIntOr(a[i], 0) : 0;
            int y = i < b.length ? parseIntOr(b[i], 0) : 0;
            if (x != y) return x > y;
        }
        return false;
    }

    private static int parseIntOr(String s, int fallback) {
        try {
            return Integer.parseInt(s);
        } catch (NumberFormatException e) {
            return fallback;
        }
    }

    private void showUpdateDialog(String version, String url) {
        if (isFinishing()) return;
        new AlertDialog.Builder(this, android.R.style.Theme_Material_Dialog_Alert)
                .setTitle("Update auf " + version)
                .setMessage("Installiert ist Version " + BuildConfig.VERSION_NAME + ". Die neue APK wird im Browser "
                        + "heruntergeladen – danach öffnen und über die alte App installieren. Deine Anmeldung bleibt erhalten.")
                .setNegativeButton("Später", null)
                .setPositiveButton("Herunterladen", (d, w) -> openExternal(Uri.parse(url)))
                .show();
    }

    private void saveToDownloads(String name, String mimeType, byte[] data) throws IOException {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            ContentValues values = new ContentValues();
            values.put(MediaStore.Downloads.DISPLAY_NAME, name);
            values.put(MediaStore.Downloads.MIME_TYPE, mimeType);
            Uri uri = getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
            if (uri == null) throw new IOException("Kein Speicherort");
            try (OutputStream out = getContentResolver().openOutputStream(uri)) {
                out.write(data);
            }
        } else {
            if (checkSelfPermission(Manifest.permission.WRITE_EXTERNAL_STORAGE) != PackageManager.PERMISSION_GRANTED) {
                runOnUiThread(() -> requestPermissions(
                        new String[]{Manifest.permission.WRITE_EXTERNAL_STORAGE}, 0));
                throw new IOException("Keine Berechtigung");
            }
            File dir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS);
            dir.mkdirs();
            try (OutputStream out = new FileOutputStream(new File(dir, name))) {
                out.write(data);
            }
        }
    }

    private void toast(String text) {
        runOnUiThread(() -> Toast.makeText(this, text, Toast.LENGTH_SHORT).show());
    }

    private String readAsset(String name) {
        try (InputStream in = getAssets().open(name)) {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[8192];
            int n;
            while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
            return out.toString(StandardCharsets.UTF_8.name());
        } catch (IOException e) {
            return null;
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == REQUEST_FILE && fileCallback != null) {
            Uri[] result = null;
            if (resultCode == RESULT_OK && data != null) {
                if (data.getClipData() != null) {
                    int count = data.getClipData().getItemCount();
                    result = new Uri[count];
                    for (int i = 0; i < count; i++) result[i] = data.getClipData().getItemAt(i).getUri();
                } else if (data.getData() != null) {
                    result = new Uri[]{data.getData()};
                }
            }
            fileCallback.onReceiveValue(result);
            fileCallback = null;
            return;
        }
        super.onActivityResult(requestCode, resultCode, data);
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] results) {
        if (requestCode == REQUEST_MEDIA_PERMISSION && pendingPermission != null) {
            boolean allGranted = true;
            for (int r : results) allGranted &= r == PackageManager.PERMISSION_GRANTED;
            if (allGranted) pendingPermission.grant(pendingPermission.getResources());
            else pendingPermission.deny();
            pendingPermission = null;
        } else if (requestCode == REQUEST_NOTIFICATIONS) {
            notifyPageStateChanged();
        }
    }

    @Override
    public void onBackPressed() {
        if (customView != null) {
            chromeClient.onHideCustomView();
        } else if (webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        String url = urlFromIntent(intent);
        if (url != null) webView.loadUrl(url);
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        webView.saveState(outState);
    }

    @Override
    protected void onPause() {
        super.onPause();
        webView.onPause();
        CookieManager.getInstance().flush();
    }

    @Override
    protected void onResume() {
        super.onResume();
        webView.onResume();
        // Beim Öffnen gleich nachsehen, statt auf den nächsten Hintergrund-Abruf zu warten
        if (Notifier.hasDevice(this)) new Thread(() -> Notifier.poll(getApplicationContext())).start();
        notifyPageStateChanged();
    }

    @Override
    protected void onDestroy() {
        webView.destroy();
        super.onDestroy();
    }
}
