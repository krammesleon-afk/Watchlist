package de.sathonet.watchlist;

import android.Manifest;
import android.app.Activity;
import android.app.DownloadManager;
import android.content.ActivityNotFoundException;
import android.content.ContentValues;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;
import android.view.View;
import android.view.ViewGroup;
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
import android.widget.Toast;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;

/**
 * Die ganze App ist ein Vollbild-WebView, der die Satho-Net-Seite lädt.
 * Dazu kommt nur, was ein WebView nicht von selbst kann: Datei-Auswahl,
 * Downloads, Kamera/Mikrofon, Vollbild-Videos und externe Links.
 */
public class MainActivity extends Activity {

    private static final int REQUEST_FILE = 1;
    private static final int REQUEST_MEDIA_PERMISSION = 2;

    private final String appUrl = BuildConfig.APP_URL;
    private final String appHost = Uri.parse(BuildConfig.APP_URL).getHost();

    private FrameLayout root;
    private WebView webView;
    private AppChromeClient chromeClient;
    private ValueCallback<Uri[]> fileCallback;
    private PermissionRequest pendingPermission;
    private View customView;
    private WebChromeClient.CustomViewCallback customViewCallback;
    private String bridgeScript;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        root = new FrameLayout(this);
        root.setBackgroundColor(Color.parseColor("#131110"));
        webView = new WebView(this);
        webView.setBackgroundColor(Color.parseColor("#131110"));
        root.addView(webView, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        setContentView(root);

        bridgeScript = readAsset("app-bridge.js");
        setupWebView();

        if (savedInstanceState != null) {
            webView.restoreState(savedInstanceState);
        } else {
            webView.loadUrl(appUrl);
        }
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
        public void onPageFinished(WebView view, String url) {
            if (bridgeScript != null) view.evaluateJavascript(bridgeScript, null);
            CookieManager.getInstance().flush();
        }

        @Override
        public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
            if (!request.isForMainFrame()) return;
            String html = "<!doctype html><html><head><meta name='viewport' content='width=device-width,initial-scale=1'>"
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
            webView.setVisibility(View.GONE);
            getWindow().addFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN);
        }

        @Override
        public void onHideCustomView() {
            if (customView == null) return;
            root.removeView(customView);
            customView = null;
            webView.setVisibility(View.VISIBLE);
            getWindow().clearFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN);
            if (customViewCallback != null) customViewCallback.onCustomViewHidden();
            customViewCallback = null;
        }
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
        Uri uri = intent.getData();
        if (uri != null && isOwnPage(uri)) webView.loadUrl(uri.toString());
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
    }

    @Override
    protected void onDestroy() {
        webView.destroy();
        super.onDestroy();
    }
}
