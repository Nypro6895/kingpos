package com.reylumi.android;

import android.app.Activity;
import android.os.Bundle;
import android.os.CancellationSignal;
import android.os.ParcelFileDescriptor;
import android.print.*;
import android.webkit.*;
import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;
import java.util.UUID;
import java.util.function.Consumer;
import java.util.function.Predicate;
import org.json.JSONObject;

/** Prints a dedicated inert document. Presentation is not confirmation of physical printing. */
final class ReceiptPrintController {
    private final Activity activity;
    private WebView document;
    ReceiptPrintController(Activity activity) { this.activity = activity; }

    static String validate(JSONObject job) {
        if (job == null || job.optInt("version") != 1 || !uuid(job.optString("jobId"))) return "invalid-job";
        String kind = job.optString("kind");
        if (!kind.equals("receipt") && !kind.equals("test") && !kind.equals("provisional")) return "invalid-kind";
        if (kind.equals("receipt") && !uuid(job.optString("receiptId"))) return "invalid-receipt";
        if (kind.equals("provisional") && (!uuid(job.optString("operationId")) || job.has("receiptId")
            || !job.optString("scope").matches("[0-9a-fA-F-]{36}:[0-9a-fA-F-]{36}"))) return "invalid-operation";
        if (!java.util.Arrays.asList("58mm", "80mm", "a4").contains(job.optString("paper"))) return "invalid-paper";
        String title = job.optString("title"), html = job.optString("html");
        if (title.trim().isEmpty() || title.length() > 120 || html.trim().isEmpty()
            || html.getBytes(StandardCharsets.UTF_8).length > 1024 * 1024) return "invalid-document";
        return null;
    }
    private static boolean uuid(String value) {
        try { return UUID.fromString(value).toString().equalsIgnoreCase(value); }
        catch (IllegalArgumentException ignored) { return false; }
    }
    void print(JSONObject job, Predicate<JSONObject> provisionalAllowed, Consumer<JSONObject> completed) {
        String failure = validate(job);
        if (failure == null && "provisional".equals(job.optString("kind")) && !provisionalAllowed.test(job)) failure = "offline-admission-required";
        if (failure == null && document != null) failure = "print-busy";
        if (failure != null) { completed.accept(result(job, "failed", failure)); return; }
        WebView renderer = new WebView(activity); document = renderer;
        WebSettings settings = renderer.getSettings();
        settings.setJavaScriptEnabled(false); settings.setDomStorageEnabled(false);
        settings.setAllowContentAccess(false); settings.setAllowFileAccess(false);
        settings.setBlockNetworkLoads(true); settings.setGeolocationEnabled(false);
        renderer.setWebViewClient(new WebViewClient() {
            private boolean presented;
            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                return new WebResourceResponse("text/plain", "UTF-8", new ByteArrayInputStream(new byte[0]));
            }
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) { return true; }
            @Override public void onPageFinished(WebView view, String url) {
                if (presented || document != renderer || activity.isDestroyed()) return;
                presented = true;
                try {
                    PrintDocumentAdapter source = renderer.createPrintDocumentAdapter(job.optString("title"));
                    PrintDocumentAdapter adapter = new PrintDocumentAdapter() {
                        @Override public void onStart() { source.onStart(); }
                        @Override public void onLayout(PrintAttributes oldAttrs, PrintAttributes newAttrs, CancellationSignal signal,
                            LayoutResultCallback callback, Bundle extras) { source.onLayout(oldAttrs, newAttrs, signal, callback, extras); }
                        @Override public void onWrite(PageRange[] pages, ParcelFileDescriptor output, CancellationSignal signal,
                            WriteResultCallback callback) { source.onWrite(pages, output, signal, callback); }
                        @Override public void onFinish() { source.onFinish(); release(renderer); }
                    };
                    String paper = job.optString("paper");
                    PrintAttributes.MediaSize media = paper.equals("a4") ? PrintAttributes.MediaSize.ISO_A4
                        : new PrintAttributes.MediaSize("REYLUMI_" + paper, paper + " receipt", paper.equals("58mm") ? 2283 : 3150, 11000);
                    PrintAttributes attrs = new PrintAttributes.Builder().setMediaSize(media)
                        .setMinMargins(PrintAttributes.Margins.NO_MARGINS)
                        .setResolution(new PrintAttributes.Resolution("receipt", "Receipt", 203, 203)).build();
                    PrintManager manager = activity.getSystemService(PrintManager.class);
                    PrintJob print = manager == null ? null : manager.print(job.optString("title"), adapter, attrs);
                    if (print == null) { release(renderer); completed.accept(result(job, "failed", "print-unavailable")); }
                    else completed.accept(result(job, "presented", null));
                } catch (RuntimeException unavailable) {
                    release(renderer); completed.accept(result(job, "failed", "print-unavailable"));
                }
            }
        });
        String csp = "<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src 'none'; base-uri 'none'; form-action 'none'\">";
        String html = job.optString("html");
        int head = html.toLowerCase(java.util.Locale.ROOT).indexOf("<head>");
        html = head >= 0 ? html.substring(0, head + 6) + csp + html.substring(head + 6) : csp + html;
        renderer.loadDataWithBaseURL("https://receipt.invalid/", html, "text/html", "UTF-8", null);
    }
    private static JSONObject result(JSONObject job, String status, String error) {
        JSONObject result = new JSONObject();
        try { result.put("jobId", job == null ? "" : job.optString("jobId")); result.put("status", status);
            if (error != null) result.put("error", error); } catch (org.json.JSONException impossible) { throw new IllegalStateException(impossible); }
        return result;
    }
    private void release(WebView renderer) { if (document == renderer) document = null; renderer.destroy(); }
    void close() { if (document != null) { WebView renderer = document; document = null; renderer.destroy(); } }
}
