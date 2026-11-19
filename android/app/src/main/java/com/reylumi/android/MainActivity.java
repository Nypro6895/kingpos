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
    private String portableScript = "";
    private PortableStore portableStore;
    private PortableTransport portableTransport;
    private PortableDeviceBridge portableBridge;
    private PortableOfflineShell portableShell;
    private androidx.webkit.ScriptHandler portableStartScript;
    private ReceiptPrintController receiptPrinter;
    private final java.util.concurrent.ExecutorService portableWorker = java.util.concurrent.Executors.newSingleThreadExecutor();
    private final java.util.concurrent.ExecutorService shellWorker = java.util.concurrent.Executors.newSingleThreadExecutor();
    private final java.util.concurrent.atomic.AtomicBoolean shellPreparing = new java.util.concurrent.atomic.AtomicBoolean();
    private volatile long shellLastAttempt = -90000;
    private final java.util.concurrent.atomic.AtomicBoolean receiptRefreshRunning = new java.util.concurrent.atomic.AtomicBoolean();
    private final java.util.concurrent.atomic.AtomicBoolean receiptRefreshRequested = new java.util.concurrent.atomic.AtomicBoolean();
    private volatile String receiptRefreshScope;
    private final android.os.Handler shellTimer = new android.os.Handler(android.os.Looper.getMainLooper());
    private final Runnable refreshOfflineShell = new Runnable() {
        @Override public void run() {
            if (!isDestroyed() && portableTransport != null && web != null && connectivity != null
                && connectivity.getActiveNetwork() != null) {
                PortableTransport.Admission admitted = portableTransport.admitted();
                if (admitted != null) queueOfflineShell(admitted.scope, web.getUrl(), portableBridge.documentGeneration());
            }
            shellTimer.postDelayed(this, 60000);
        }
    };
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
            if (!BuildConfig.QA_LOCAL && !BuildConfig.PORTABLE_POS && connectivity.getActiveNetwork() == null) return;
            error.setVisibility(View.GONE); web.setVisibility(View.VISIBLE);
            if (web.getUrl() == null) web.loadUrl(startUrl());
            else web.reload();
        });
        error.addView(retry, new LinearLayout.LayoutParams(dp(180), dp(52)));
        error.setVisibility(View.GONE); root.addView(error, new LinearLayout.LayoutParams(-1, 0, 1));
        web = new WebView(this); root.addView(web, new LinearLayout.LayoutParams(-1, 0, 1));
        deviceAccess = new DeviceAccess(this, web);
        receiptPrinter = new ReceiptPrintController(this);
        if (BuildConfig.PORTABLE_POS) {
            try {
                portableStore = new PortableStore(this, NavigationPolicy.appOrigin());
                portableTransport = new PortableTransport(portableStore, NavigationPolicy.appOrigin());
                portableBridge = new PortableDeviceBridge(portableStore, portableTransport, NavigationPolicy.appOrigin());
                portableShell = new PortableOfflineShell(portableStore, portableTransport, NavigationPolicy.appOrigin(), () -> runOnUiThread(() -> {
                    if (!isDestroyed() && web != null && portableTransport.requiresOnline())
                        web.evaluateJavascript("window.dispatchEvent(new Event('kingpos:native-portable-lock'))", null);
                }));
                portableBridge.setOfflineShellReady(portableShell::ready);
                try (java.io.InputStream script = getAssets().open("PortableDeviceBridge.js")) {
                    java.io.ByteArrayOutputStream bytes = new java.io.ByteArrayOutputStream();
                    byte[] buffer = new byte[8192]; int count;
                    while ((count = script.read(buffer)) != -1) bytes.write(buffer, 0, count);
                    portableScript = new String(bytes.toByteArray(), StandardCharsets.UTF_8);
                }
            } catch (Exception unavailable) {
                // Dedicated POS UA makes the shared storage boundary fail closed.
                portableBridge = null;
            }
        }
        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true); settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false); settings.setAllowContentAccess(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setGeolocationEnabled(true);
        settings.setUserAgentString(settings.getUserAgentString() + " ReylumiAndroid/1.0" + (BuildConfig.PORTABLE_POS ? " ReylumiAndroidPOS/1.0" : "") + (BuildConfig.QA_LOCAL ? " ReylumiLocalQA/1.0" : ""));
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
                    String qaGuard = new String(bytes.toByteArray(), StandardCharsets.UTF_8).replace(
                        "const qaAppPort = '3117';", "const qaAppPort = '" + BuildConfig.QA_APP_PORT + "';").replace(
                        "const qaBackendPort = '55421';", "const qaBackendPort = '" + BuildConfig.QA_BACKEND_PORT + "';");
                    bridgeScript = qaGuard + "\n" + bridgeScript;
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
                        } else if ("print-receipt".equals(payload.optString("action"))) {
                            JSONObject job = payload.optJSONObject("job");
                            long generation = portableBridge == null ? -1 : portableBridge.documentGeneration();
                            receiptPrinter.print(job, candidate -> portableBridge != null
                                && portableBridge.documentGeneration() == generation
                                && portableBridge.validateProvisional(candidate.optString("scope"), candidate.optString("operationId")) == null,
                                result -> {
                                    if (!isDestroyed() && NavigationPolicy.decide(web.getUrl()) == NavigationPolicy.Decision.INTERNAL
                                        && (portableBridge == null || portableBridge.documentGeneration() == generation))
                                        web.evaluateJavascript("window.__reylumiReceiptPrintResult?.(" + result + ")", null);
                                });
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
            if (portableBridge != null) {
                WebViewCompat.addWebMessageListener(web, "reylumiPortable", Collections.singleton(NavigationPolicy.appOrigin()),
                    (view, portableMessage, origin, mainFrame, reply) -> {
                        if (!mainFrame || !NavigationPolicy.trustedOrigin(origin.toString())
                            || portableMessage.getType() != androidx.webkit.WebMessageCompat.TYPE_STRING || portableMessage.getData() == null) return;
                        final String currentUrl = view.getUrl(), raw = portableMessage.getData();
                        final long generation = portableBridge.documentGeneration();
                        if (raw.length() > 8 * 1024 * 1024) return;
                        portableWorker.execute(() -> {
                            try {
                                PortableStore.validateWireJson(raw);
                                JSONObject body = new JSONObject(raw);
                                Object answer = portableBridge.request(body, currentUrl, true, generation);
                                JSONObject response = new JSONObject().put("id", body.optString("id")).put("reply", answer);
                                runOnUiThread(() -> {
                                    if (!isDestroyed() && portableBridge.documentGeneration() == generation && currentUrl != null && currentUrl.equals(web.getUrl()))
                                        reply.postMessage(response.toString());
                                });
                                if (answer instanceof JSONObject && ((JSONObject)answer).optBoolean("ok")
                                    && java.util.Arrays.asList("storage.prepare", "storage.status", "offline.status").contains(body.optString("action"))) {
                                    queueOfflineShell(((JSONObject)answer).optString("scope"), currentUrl, generation);
                                }
                                JSONObject operation = body.optJSONObject("operation");
                                if ("operations.save".equals(body.optString("action")) && answer instanceof JSONObject
                                    && ((JSONObject)answer).optBoolean("ok") && operation != null
                                    && "receipt".equals(operation.optString("kind")) && "synced".equals(operation.optString("state"))) {
                                    queueReceiptRefresh(operation.optString("scope"));
                                }
                            } catch (Exception invalid) { /* Invalid wire values never reach storage. */ }
                        });
                    });
                installPortableStartScript();
            }
        }
        if (BuildConfig.QA_LOCAL || BuildConfig.PORTABLE_POS) {
            ServiceWorkerController.getInstance().setServiceWorkerClient(new ServiceWorkerClient() {
                @Override public WebResourceResponse shouldInterceptRequest(WebResourceRequest request) {
                    WebResourceResponse blocked = BuildConfig.QA_LOCAL ? qaNetworkResponse(request.getUrl().toString()) : null;
                    return blocked != null ? blocked : portableShell == null ? null : portableShell.intercept(request);
                }
            });
        }
        web.setWebViewClient(new WebViewClient() {
            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                WebResourceResponse blocked = BuildConfig.QA_LOCAL ? qaNetworkResponse(request.getUrl().toString()) : null;
                return blocked != null ? blocked : portableShell == null ? null : portableShell.intercept(request);
            }
            @Override public void onPageStarted(WebView view, String url, android.graphics.Bitmap favicon) {
                deviceAccess.cancelPending();
                completeFileSelection(null);
                if (portableBridge != null) { portableBridge.documentWillNavigate(); installPortableStartScript(); }
            }
            @Override public void onPageCommitVisible(WebView view, String url) {
                if (NavigationPolicy.decide(url) == NavigationPolicy.Decision.INTERNAL) {
                    if (portableBridge != null) view.evaluateJavascript(portableBootstrap(), null);
                    error.setVisibility(View.GONE); web.setVisibility(View.VISIBLE);
                }
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
            @Override public boolean onJsPrompt(WebView view, String url, String message, String defaultValue, JsPromptResult result) {
                if (message != null && message.startsWith("__reylumiPortableDevice:")) {
                    String response = portableBridge == null ? null : portableBridge.prompt(message, url, view.getUrl());
                    result.confirm(response == null ? "{\"__portableError\":{\"code\":\"storage-locked\",\"error\":\"Unlock POS Portable before saving.\"}}" : response);
                    return true;
                }
                return super.onJsPrompt(view, url, message, defaultValue, result);
            }
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
                    if (!BuildConfig.QA_LOCAL && !BuildConfig.PORTABLE_POS && !isDestroyed() && connectivity.getActiveNetwork() == null) showError();
                });
            }
        };
        connectivity.registerDefaultNetworkCallback(networkCallback);
        boolean restored = state != null && web.restoreState(state) != null;
        if (!BuildConfig.QA_LOCAL && !BuildConfig.PORTABLE_POS && connectivity.getActiveNetwork() == null) showError();
        else if (!restored) web.loadUrl(startUrl());
    }

    private String portableBootstrap() {
        return "if(window.top===window&&location.origin===" + JSONObject.quote(NavigationPolicy.appOrigin()) + "){"
            + "window.__reylumiPortableHost={nonce:" + JSONObject.quote(portableBridge.nonce()) + ",documentGeneration:" + portableBridge.documentGeneration() + "};"
            + portableScript + ";window.__reylumiPortableBindHost?.(window.__reylumiPortableHost);}";
    }
    private void queueOfflineShell(String scope, String url, long generation) {
        long now = android.os.SystemClock.elapsedRealtime();
        if (portableShell == null || url == null || now - shellLastAttempt < 90000
            || portableShell.ready() && now - shellLastAttempt < 300000 || !shellPreparing.compareAndSet(false, true)) return;
        shellLastAttempt = now;
        shellWorker.execute(() -> {
            try {
                if (generation != portableBridge.documentGeneration()) return;
                Uri current = Uri.parse(url);
                PortableTransport.Admission admitted = portableTransport.admitted();
                if (admitted == null || !scope.equals(admitted.scope)) return;
                portableTransport.warm(admitted);
                portableShell.prepare(scope, current.getEncodedPath() + (current.getEncodedQuery() == null ? "" : "?" + current.getEncodedQuery()));
            } catch (Exception cacheUnavailable) {
                android.util.Log.w("ReylumiPOS", "Offline display preparation incomplete: " + cacheUnavailable.getClass().getSimpleName());
            }
            finally {
                shellPreparing.set(false);
                runOnUiThread(() -> { if (!isDestroyed() && generation == portableBridge.documentGeneration())
                    web.evaluateJavascript("window.dispatchEvent(new Event('kingpos:native-readiness'))", null); });
            }
        });
    }
    /** A server-confirmed receipt refreshes canonical read snapshots; the
     * financial ACK never waits for network or resets the open cart's writer. */
    private void queueReceiptRefresh(String scope) {
        if (!PortableStore.validScope(scope) || shellWorker.isShutdown()) return;
        receiptRefreshScope = scope; receiptRefreshRequested.set(true);
        if (!receiptRefreshRunning.compareAndSet(false, true)) return;
        shellWorker.execute(() -> {
            try {
                do {
                    receiptRefreshRequested.set(false);
                    PortableTransport.Admission admitted = portableTransport.admitted();
                    if (admitted != null && admitted.scope.equals(receiptRefreshScope)) portableTransport.refreshReceiptReads(admitted);
                } while (receiptRefreshRequested.get() && !shellWorker.isShutdown());
            } catch (Exception unavailable) { /* Keep the last verified cache and synced receipt reference. */ }
            finally {
                receiptRefreshRunning.set(false);
                runOnUiThread(() -> { if (!isDestroyed()) web.evaluateJavascript("window.dispatchEvent(new Event('kingpos:native-readiness'))", null); });
                if (receiptRefreshRequested.get() && !shellWorker.isShutdown()) queueReceiptRefresh(receiptRefreshScope);
            }
        });
    }
    private void installPortableStartScript() {
        if (portableStartScript != null) portableStartScript.remove();
        if (WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT))
            portableStartScript = WebViewCompat.addDocumentStartJavaScript(web, portableBootstrap(), Collections.singleton(NavigationPolicy.appOrigin()));
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
    @Override protected void onStart() { super.onStart(); if (web != null) web.onResume(); if (BuildConfig.PORTABLE_POS) shellTimer.postDelayed(refreshOfflineShell, 60000); }
    @Override protected void onStop() {
        shellTimer.removeCallbacks(refreshOfflineShell);
        if (deviceAccess != null) deviceAccess.cancelPending();
        if (web != null) {
            web.evaluateJavascript("document.querySelectorAll('video').forEach(v => v.srcObject?.getTracks?.().forEach(t => t.stop()))", null);
            web.onPause();
        }
        super.onStop();
    }
    @Override protected void onDestroy() {
        shellTimer.removeCallbacks(refreshOfflineShell);
        if (deviceAccess != null) deviceAccess.cancelPending();
        if (networkCallback != null) connectivity.unregisterNetworkCallback(networkCallback);
        if (fileCallback != null) fileCallback.onReceiveValue(null);
        pendingDownload = null;
        if (receiptPrinter != null) receiptPrinter.close();
        if (portableBridge != null) portableBridge.documentWillNavigate();
        portableWorker.shutdownNow();
        shellWorker.shutdownNow();
        if (portableStore != null) new Thread(() -> {
            try { if (portableWorker.awaitTermination(45, java.util.concurrent.TimeUnit.SECONDS)
                && shellWorker.awaitTermination(45, java.util.concurrent.TimeUnit.SECONDS)) portableStore.close(); }
            catch (Exception ignored) { }
        }, "Reylumi-POS-close").start();
        web.destroy(); super.onDestroy();
    }
}
