package com.reylumi.android;

import android.annotation.SuppressLint;
import android.app.AlertDialog;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
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

public final class MainActivity extends ComponentActivity {
    private WebView web;
    private ProgressBar progress;
    private LinearLayout error;
    private ValueCallback<Uri[]> fileCallback;
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
        LinearLayout toolbar = new LinearLayout(this);
        Button back = new Button(this); back.setText(R.string.back);
        back.setOnClickListener(v -> goBack()); toolbar.addView(back);
        TextView title = new TextView(this); title.setText(R.string.app_name); title.setTextSize(18);
        title.setGravity(android.view.Gravity.CENTER);
        toolbar.addView(title, new LinearLayout.LayoutParams(0, -1, 1));
        Button share = new Button(this); share.setText(R.string.share);
        share.setOnClickListener(v -> share()); toolbar.addView(share);
        root.addView(toolbar);
        progress = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        root.addView(progress, new LinearLayout.LayoutParams(-1, 4));
        error = new LinearLayout(this); error.setOrientation(LinearLayout.VERTICAL);
        TextView message = new TextView(this); message.setText(R.string.connection_error);
        error.addView(message);
        Button retry = new Button(this); retry.setText(R.string.retry);
        retry.setOnClickListener(v -> { error.setVisibility(View.GONE); web.setVisibility(View.VISIBLE); web.reload(); });
        error.addView(retry); error.setVisibility(View.GONE); root.addView(error);
        web = new WebView(this); root.addView(web, new LinearLayout.LayoutParams(-1, 0, 1));
        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true); settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false); settings.setAllowContentAccess(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setGeolocationEnabled(false);
        settings.setUserAgentString(settings.getUserAgentString() + " ReylumiAndroid/1.0");
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, false);
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG);
        web.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                if (!request.isForMainFrame()) return false;
                return navigate(request.getUrl().toString());
            }
            @Override public void onPageFinished(WebView view, String url) { CookieManager.getInstance().flush(); }
            @Override public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError failure) {
                if (request.isForMainFrame()) showError();
            }
            @Override public void onReceivedHttpError(WebView view, WebResourceRequest request, WebResourceResponse response) {
                if (request.isForMainFrame() && response.getStatusCode() >= 500) showError();
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override public void onProgressChanged(WebView view, int value) {
                progress.setProgress(value); progress.setVisibility(value == 100 ? View.GONE : View.VISIBLE);
            }
            @Override public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback = callback;
                try { picker.launch(params.createIntent()); }
                catch (ActivityNotFoundException e) { fileCallback.onReceiveValue(null); fileCallback = null; }
                return true;
            }
        });
        // Downloads need an authenticated implementation; never forward session cookies to another app.
        web.setDownloadListener((url, agent, disposition, mime, length) -> new AlertDialog.Builder(this)
            .setMessage(R.string.download_browser)
            .setPositiveButton(android.R.string.ok, null).show());
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override public void handleOnBackPressed() { goBack(); }
        });
        if (state == null || web.restoreState(state) == null) web.loadUrl("https://reylumi.com/explore");
    }

    private boolean navigate(String url) {
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
    private void goBack() { if (web.canGoBack()) web.goBack(); else finish(); }
    private void share() {
        String url = web.getUrl();
        if (url == null) return;
        Uri uri = Uri.parse(url);
        // Share only public pages, never auth callbacks, tokens, or private workspaces.
        if (NavigationPolicy.decide(url) != NavigationPolicy.Decision.INTERNAL || uri.getQuery() != null || uri.getFragment() != null
            || !(uri.getPath().startsWith("/explore") || uri.getPath().startsWith("/book/"))) {
            url = "https://reylumi.com";
        }
        startActivity(Intent.createChooser(new Intent(Intent.ACTION_SEND).setType("text/plain")
            .putExtra(Intent.EXTRA_TEXT, url), getString(R.string.share_title)));
    }
    private void showError() { progress.setVisibility(View.GONE); web.setVisibility(View.GONE); error.setVisibility(View.VISIBLE); }
    @Override protected void onSaveInstanceState(Bundle out) { super.onSaveInstanceState(out); web.saveState(out); }
    @Override protected void onDestroy() {
        if (fileCallback != null) fileCallback.onReceiveValue(null);
        web.destroy(); super.onDestroy();
    }
}
