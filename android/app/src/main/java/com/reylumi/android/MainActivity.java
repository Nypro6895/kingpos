package com.reylumi.android;

import android.annotation.SuppressLint;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import android.net.ConnectivityManager;
import android.net.Network;
import android.os.Bundle;
import android.print.PrintManager;
import android.view.View;
import android.webkit.*;
import android.widget.*;
import androidx.activity.ComponentActivity;
import androidx.activity.OnBackPressedCallback;
import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;
import java.nio.charset.StandardCharsets;
import java.util.Collections;
import org.json.JSONObject;

public final class MainActivity extends ComponentActivity {
    private WebView web;
    private ProgressBar progress;
    private LinearLayout error;
    private ValueCallback<Uri[]> fileCallback;
    private ConnectivityManager connectivity;
    private ConnectivityManager.NetworkCallback networkCallback;
    private String bridgeScript = "";
    private byte[] pendingDownload;
    private DeviceAccess deviceAccess;
    private Uri capturedPhoto;
    private final ActivityResultLauncher<Intent> photo = registerForActivityResult(
        new ActivityResultContracts.StartActivityForResult(), result -> {
            Uri image = capturedPhoto; capturedPhoto = null;
            completeFileSelection(result.getResultCode() == RESULT_OK && image != null ? new Uri[]{image} : null);
        });
    private final ActivityResultLauncher<Intent> saver = registerForActivityResult(
        new ActivityResultContracts.StartActivityForResult(), result -> {
            byte[] bytes = pendingDownload;
            pendingDownload = null;
            if (result.getResultCode() != RESULT_OK || result.getData() == null || bytes == null) return;
            Uri destination = result.getData().getData();
            if (destination == null) return;
            new Thread(() -> {
                int outcome = R.string.download_saved;
                try (java.io.OutputStream stream = getContentResolver().openOutputStream(destination)) {
                    if (stream == null) throw new java.io.IOException("No document output");
                    stream.write(bytes);
                } catch (java.io.IOException | SecurityException failure) { outcome = R.string.download_failed; }
                int message = outcome;
                runOnUiThread(() -> { if (!isDestroyed()) Toast.makeText(this, message, Toast.LENGTH_LONG).show(); });
            }, "Reylumi-document-save").start();
        });
    private final ActivityResultLauncher<Intent> picker = registerForActivityResult(
        new ActivityResultContracts.StartActivityForResult(), result -> {
            if (fileCallback != null) {
                fileCallback.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(result.getResultCode(), result.getData()));
                fileCallback = null;
            }
        });

    @SuppressLint("SetJavaScriptEnabled")
    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        setContentView(root);
        ViewCompat.setOnApplyWindowInsetsListener(root, (view, insets) -> {
            Insets bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout() | WindowInsetsCompat.Type.ime());
            view.setPadding(bars.left, bars.top, bars.right, bars.bottom);
            return WindowInsetsCompat.CONSUMED;
        });
        progress = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        progress.setProgressTintList(android.content.res.ColorStateList.valueOf(android.graphics.Color.rgb(22, 128, 127)));
        root.addView(progress, new LinearLayout.LayoutParams(-1, dp(2)));
        error = new LinearLayout(this); error.setOrientation(LinearLayout.VERTICAL);
        error.setGravity(android.view.Gravity.CENTER);
        error.setPadding(dp(24), dp(24), dp(24), dp(24));
        ImageView brand = new ImageView(this); brand.setImageResource(R.drawable.reylumi_brand);
        brand.setContentDescription(null);
        error.addView(brand, new LinearLayout.LayoutParams(dp(72), dp(72)));
        TextView brandName = new TextView(this); brandName.setText(R.string.app_name); brandName.setTextSize(24);
        brandName.setTypeface(null, android.graphics.Typeface.BOLD);
        brandName.setTextColor(android.graphics.Color.rgb(22, 128, 127));
        LinearLayout.LayoutParams brandLayout = new LinearLayout.LayoutParams(-2, -2); brandLayout.topMargin = dp(16);
        error.addView(brandName, brandLayout);
        TextView message = new TextView(this); message.setText(R.string.connection_error);
        message.setTextSize(16); message.setGravity(android.view.Gravity.CENTER);
        message.setTextColor(android.graphics.Color.rgb(90, 94, 98));
        LinearLayout.LayoutParams messageLayout = new LinearLayout.LayoutParams(-1, -2);
        messageLayout.topMargin = dp(16); messageLayout.bottomMargin = dp(24);
        error.addView(message, messageLayout);
        Button retry = new Button(this); retry.setText(R.string.retry);
        retry.setAllCaps(false); retry.setTextColor(android.graphics.Color.WHITE); retry.setMinHeight(dp(48));
        android.graphics.drawable.GradientDrawable retryBackground = new android.graphics.drawable.GradientDrawable();
        retryBackground.setColor(android.graphics.Color.rgb(22, 128, 127)); retryBackground.setCornerRadius(dp(14));
        retry.setBackground(new android.graphics.drawable.RippleDrawable(
            android.content.res.ColorStateList.valueOf(0x33FFFFFF), retryBackground, null));
        retry.setOnClickListener(v -> {
            if (!BuildConfig.QA_LOCAL && connectivity.getActiveNetwork() == null) return;
            error.setVisibility(View.GONE); web.setVisibility(View.VISIBLE);
            if (web.getUrl() == null) web.loadUrl(startUrl());
            else web.reload();
        });
        error.addView(retry, new LinearLayout.LayoutParams(dp(180), dp(52)));
        error.setVisibility(View.GONE); root.addView(error, new LinearLayout.LayoutParams(-1, 0, 1));
        web = new WebView(this); root.addView(web, new LinearLayout.LayoutParams(-1, 0, 1));
        deviceAccess = new DeviceAccess(this, web);
        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true); settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false); settings.setAllowContentAccess(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setGeolocationEnabled(true);
        settings.setUserAgentString(settings.getUserAgentString() + " ReylumiAndroid/1.0" + (BuildConfig.QA_LOCAL ? " ReylumiLocalQA/1.0" : ""));
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, false);
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG);
        if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            try (java.io.InputStream script = getAssets().open("NativeBridge.js")) {
                java.io.ByteArrayOutputStream bytes = new java.io.ByteArrayOutputStream();
                byte[] buffer = new byte[4096];
                int count;
                while ((count = script.read(buffer)) != -1) bytes.write(buffer, 0, count);
                bridgeScript = new String(bytes.toByteArray(), StandardCharsets.UTF_8);
                if (BuildConfig.QA_LOCAL) bridgeScript = bridgeScript.replace(
                    "const trustedOrigin = 'https://reylumi.com';", "const trustedOrigin = '" + NavigationPolicy.QA_ORIGIN + "';");
            } catch (java.io.IOException failure) { throw new IllegalStateException("Missing native bridge", failure); }
            if (BuildConfig.QA_LOCAL) {
                try (java.io.InputStream script = getAssets().open("QaNetworkGuard.js")) {
                    java.io.ByteArrayOutputStream bytes = new java.io.ByteArrayOutputStream();
                    byte[] buffer = new byte[4096];
                    int count;
                    while ((count = script.read(buffer)) != -1) bytes.write(buffer, 0, count);
                    bridgeScript = new String(bytes.toByteArray(), StandardCharsets.UTF_8) + "\n" + bridgeScript;
                } catch (java.io.IOException failure) { throw new IllegalStateException("Missing QA guard", failure); }
            }
            WebViewCompat.addWebMessageListener(web, "reylumiAndroid", Collections.singleton(NavigationPolicy.appOrigin()),
                (view, webMessage, origin, mainFrame, reply) -> {
                    if (!mainFrame || !NavigationPolicy.trustedOrigin(origin.toString())
                        || NavigationPolicy.decide(view.getUrl()) != NavigationPolicy.Decision.INTERNAL) return;
                    if (webMessage.getType() != androidx.webkit.WebMessageCompat.TYPE_STRING || webMessage.getData() == null) return;
                    if (webMessage.getData().length() > 14 * 1024 * 1024) return;
                    try {
                        JSONObject payload = new JSONObject(webMessage.getData());
                        if ("share".equals(payload.optString("action"))) {
                            String text = payload.optString("text");
                            if (text.trim().isEmpty() || text.length() > 16000) return;
                            startActivity(Intent.createChooser(new Intent(Intent.ACTION_SEND).setType("text/plain")
                                .putExtra(Intent.EXTRA_TEXT, text), getString(R.string.share_title)));
                        } else if ("print".equals(payload.optString("action"))) {
                            getSystemService(PrintManager.class).print("Reylumi", web.createPrintDocumentAdapter("Reylumi"), null);
                        } else if ("save-file".equals(payload.optString("action"))) {
                            if (pendingDownload != null) return;
                            byte[] bytes = android.util.Base64.decode(payload.optString("base64"), android.util.Base64.DEFAULT);
                            if (bytes.length > 10 * 1024 * 1024) return;
                            String filename = payload.optString("filename", "Reylumi-export").replaceAll("[\\\\/:*?\"<>|\\p{Cntrl}]", "_");
                            if (filename.isEmpty()) filename = "Reylumi-export";
                            if (filename.length() > 160) filename = filename.substring(0, 160);
                            String mime = payload.optString("mime", "application/octet-stream");
                            if (!mime.matches("[a-zA-Z0-9.+-]+/[a-zA-Z0-9.+-]+")) mime = "application/octet-stream";
                            pendingDownload = bytes;
                            saver.launch(new Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE)
                                .setType(mime).putExtra(Intent.EXTRA_TITLE, filename));
                        } else if ("download-failed".equals(payload.optString("action"))) {
                            Toast.makeText(this, R.string.download_failed, Toast.LENGTH_LONG).show();
                        }
                    } catch (org.json.JSONException | ActivityNotFoundException | IllegalArgumentException ignored) {
                        pendingDownload = null;
                        Toast.makeText(this, R.string.no_handler, Toast.LENGTH_SHORT).show();
                    }
                });
            if (WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
                WebViewCompat.addDocumentStartJavaScript(web, bridgeScript, Collections.singleton(NavigationPolicy.appOrigin()));
            }
        }
        if (BuildConfig.QA_LOCAL) {
            ServiceWorkerController.getInstance().setServiceWorkerClient(new ServiceWorkerClient() {
                @Override public WebResourceResponse shouldInterceptRequest(WebResourceRequest request) {
                    return qaNetworkResponse(request.getUrl().toString());
                }
            });
        }
        web.setWebViewClient(new WebViewClient() {
            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                return BuildConfig.QA_LOCAL ? qaNetworkResponse(request.getUrl().toString()) : null;
            }
            @Override public void onPageStarted(WebView view, String url, android.graphics.Bitmap favicon) {
                deviceAccess.cancelPending();
                completeFileSelection(null);
            }
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                if (!request.isForMainFrame()) return false;
                return navigate(request.getUrl().toString());
            }
            @Override public void onPageFinished(WebView view, String url) {
                CookieManager.getInstance().flush();
                if (NavigationPolicy.decide(url) == NavigationPolicy.Decision.INTERNAL && !bridgeScript.isEmpty())
                    view.evaluateJavascript(bridgeScript, null);
            }
            @Override public void doUpdateVisitedHistory(WebView view, String url, boolean reload) {
                String resume = NavigationPolicy.resumeUrl(url);
                if (resume != null) getPreferences(MODE_PRIVATE).edit().putString("resumeUrl", resume).apply();
            }
            @Override public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError failure) {
                if (request.isForMainFrame()) showError();
            }
            @Override public void onReceivedHttpError(WebView view, WebResourceRequest request, WebResourceResponse response) {
                if (request.isForMainFrame() && response.getStatusCode() >= 500) showError();
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override public void onPermissionRequest(PermissionRequest request) { deviceAccess.camera(request); }
            @Override public void onPermissionRequestCanceled(PermissionRequest request) { deviceAccess.cameraCancelled(request); }
            @Override public void onGeolocationPermissionsShowPrompt(String origin, GeolocationPermissions.Callback callback) {
                deviceAccess.location(origin, callback);
            }
            @Override public void onGeolocationPermissionsHidePrompt() { deviceAccess.locationCancelled(); }
            @Override public void onProgressChanged(WebView view, int value) {
                progress.setProgress(value); progress.setVisibility(value == 100 ? View.GONE : View.VISIBLE);
            }
            @Override public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (fileCallback != null || NavigationPolicy.decide(view.getUrl()) != NavigationPolicy.Decision.INTERNAL) {
                    callback.onReceiveValue(null); return true;
                }
                fileCallback = callback;
                boolean imageCapture = params.isCaptureEnabled() && java.util.Arrays.stream(params.getAcceptTypes())
                    .anyMatch(type -> type != null && type.startsWith("image/"));
                if (imageCapture) {
                    deviceAccess.photo(allowed -> { if (allowed && fileCallback != null) capturePhoto(); else completeFileSelection(null); });
                    return true;
                }
                try { picker.launch(params.createIntent()); }
                catch (ActivityNotFoundException e) { fileCallback.onReceiveValue(null); fileCallback = null; }
                return true;
            }
        });
        web.setDownloadListener((url, agent, disposition, mime, length) -> {
            if (bridgeScript.isEmpty() || NavigationPolicy.decide(web.getUrl()) != NavigationPolicy.Decision.INTERNAL) {
                Toast.makeText(this, R.string.download_failed, Toast.LENGTH_LONG).show();
                return;
            }
            String filename = URLUtil.guessFileName(url, disposition, mime);
            web.evaluateJavascript("window.__reylumiAndroidDownload && window.__reylumiAndroidDownload("
                + JSONObject.quote(url) + "," + JSONObject.quote(filename) + ")", null);
        });
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override public void handleOnBackPressed() { goBack(); }
        });
        connectivity = getSystemService(ConnectivityManager.class);
        networkCallback = new ConnectivityManager.NetworkCallback() {
            @Override public void onLost(Network network) {
                runOnUiThread(() -> {
                    if (!BuildConfig.QA_LOCAL && !isDestroyed() && connectivity.getActiveNetwork() == null) showError();
                });
            }
        };
        connectivity.registerDefaultNetworkCallback(networkCallback);
        boolean restored = state != null && web.restoreState(state) != null;
        if (!BuildConfig.QA_LOCAL && connectivity.getActiveNetwork() == null) showError();
        else if (!restored) web.loadUrl(startUrl());
    }

    private static WebResourceResponse qaNetworkResponse(String url) {
        if (NavigationPolicy.qaResourceAllowed(url)) return null;
        String scheme = Uri.parse(url).getScheme();
        if ("data".equalsIgnoreCase(scheme) || "blob".equalsIgnoreCase(scheme) || "about".equalsIgnoreCase(scheme)) return null;
        java.util.Map<String, String> headers = new java.util.HashMap<>();
        headers.put("Cache-Control", "no-store");
        headers.put("Access-Control-Allow-Origin", "*");
        return new WebResourceResponse("text/plain", "UTF-8", 403, "QA network blocked",
            headers, new java.io.ByteArrayInputStream(
                "Local QA blocks external network requests.".getBytes(StandardCharsets.UTF_8)));
    }

    private boolean navigate(String url) {
        if (BuildConfig.QA_LOCAL) {
            String checkout = NavigationPolicy.qaCheckoutUrl(url);
            if (checkout != null) { web.loadUrl(checkout); return true; }
        }
        switch (NavigationPolicy.decide(url)) {
            case INTERNAL: return false;
            case EXTERNAL:
                try { startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)).addCategory(Intent.CATEGORY_BROWSABLE)); }
                catch (ActivityNotFoundException ignored) { Toast.makeText(this, R.string.no_handler, Toast.LENGTH_SHORT).show(); }
                return true;
            default:
                Toast.makeText(this, R.string.unavailable, Toast.LENGTH_LONG).show();
                return true;
        }
    }
    private void completeFileSelection(Uri[] selection) {
        ValueCallback<Uri[]> callback = fileCallback; fileCallback = null;
        if (callback != null) callback.onReceiveValue(selection);
    }
    private void capturePhoto() {
        try {
            java.io.File directory = new java.io.File(getCacheDir(), "camera");
            if (!directory.isDirectory() && !directory.mkdirs()) throw new java.io.IOException("Camera cache unavailable");
            java.io.File image = java.io.File.createTempFile("capture-", ".jpg", directory);
            capturedPhoto = androidx.core.content.FileProvider.getUriForFile(this, BuildConfig.APPLICATION_ID + ".files", image);
            Intent intent = new Intent(android.provider.MediaStore.ACTION_IMAGE_CAPTURE)
                .putExtra(android.provider.MediaStore.EXTRA_OUTPUT, capturedPhoto)
                .addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_READ_URI_PERMISSION);
            intent.setClipData(android.content.ClipData.newRawUri("Camera output", capturedPhoto));
            photo.launch(intent);
        } catch (java.io.IOException | ActivityNotFoundException | SecurityException failure) {
            capturedPhoto = null; completeFileSelection(null);
            Toast.makeText(this, R.string.no_handler, Toast.LENGTH_LONG).show();
        }
    }
    private String startUrl() {
        String saved = getPreferences(MODE_PRIVATE).getString("resumeUrl", null);
        if (saved == null) return NavigationPolicy.initialUrl();
        String safe = NavigationPolicy.resumeUrl(saved);
        return safe == null ? NavigationPolicy.initialUrl() : safe;
    }
    private int dp(int value) { return Math.round(value * getResources().getDisplayMetrics().density); }
    private void goBack() {
        WindowInsetsCompat insets = ViewCompat.getRootWindowInsets(web);
        if (insets != null && insets.isVisible(WindowInsetsCompat.Type.ime())) {
            androidx.core.view.WindowInsetsControllerCompat controller = ViewCompat.getWindowInsetsController(web);
            if (controller != null) controller.hide(WindowInsetsCompat.Type.ime());
            return;
        }
        web.evaluateJavascript("Boolean(window.__reylumiAndroidBack && window.__reylumiAndroidBack())", handled -> {
            if (isDestroyed() || "true".equals(handled)) return;
            if (web.canGoBack()) web.goBack(); else finish();
        });
    }
    private void showError() { progress.setVisibility(View.GONE); web.setVisibility(View.GONE); error.setVisibility(View.VISIBLE); }
    @Override protected void onSaveInstanceState(Bundle out) { super.onSaveInstanceState(out); web.saveState(out); }
    @Override protected void onStart() { super.onStart(); if (web != null) web.onResume(); }
    @Override protected void onStop() {
        if (deviceAccess != null) deviceAccess.cancelPending();
        if (web != null) {
            web.evaluateJavascript("document.querySelectorAll('video').forEach(v => v.srcObject?.getTracks?.().forEach(t => t.stop()))", null);
            web.onPause();
        }
        super.onStop();
    }
    @Override protected void onDestroy() {
        if (deviceAccess != null) deviceAccess.cancelPending();
        if (networkCallback != null) connectivity.unregisterNetworkCallback(networkCallback);
        if (fileCallback != null) fileCallback.onReceiveValue(null);
        pendingDownload = null;
        web.destroy(); super.onDestroy();
    }
}
