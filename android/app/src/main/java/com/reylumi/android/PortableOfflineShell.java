package com.reylumi.android;

import android.webkit.CookieManager;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.*;
import java.util.concurrent.*;
import org.json.*;

/** Replaceable display cache, separate from durable financial writes. Every
 * private document restore rechecks the native cookie-bound scoped lease. */
final class PortableOfflineShell {
    private final PortableStore store;
    private final PortableTransport transport;
    private final String origin;
    private final Runnable revoked;
    private static final String PREFIX = "display:v1:";
    PortableOfflineShell(PortableStore store, PortableTransport transport, String origin, Runnable revoked) {
        this.store = store; this.transport = transport; this.origin = origin; this.revoked = revoked;
    }
    private static final class Resource {
        byte[] body; String mime, csp; int status;
        PortableTransport.ReadGuard guard;
        JSONObject packed() throws Exception { return new JSONObject().put("body", android.util.Base64.encodeToString(body, android.util.Base64.NO_WRAP))
            .put("mime", mime).put("csp", csp == null ? "" : csp); }
    }
    private Resource fetch(String path, int maximum, int timeout) throws Exception {
        String asset = assetKey(path);
        String relative = asset == null ? path : new URI(null, null, asset, null).getRawPath();
        URI target = new URI(origin + relative), base = new URI(origin);
        if (!target.getRawAuthority().equals(base.getRawAuthority()) || !target.getScheme().equals(base.getScheme())
            || target.getUserInfo() != null || target.getFragment() != null) throw new IOException("Invalid display resource");
        HttpURLConnection connection = (HttpURLConnection)target.toURL().openConnection();
        PortableTransport.ReadGuard guard = transport.captureReadGuard();
        connection.setInstanceFollowRedirects(false); connection.setConnectTimeout(timeout); connection.setReadTimeout(timeout);
        connection.setUseCaches(false); connection.setRequestProperty("User-Agent", "ReylumiAndroid/1.0 ReylumiAndroidPOS/1.0");
        connection.setRequestProperty("Accept", PortableTransport.portablePath(path) ? "text/html" : "*/*");
        String cookie = CookieManager.getInstance().getCookie(origin); if (cookie != null) connection.setRequestProperty("Cookie", cookie);
        try {
            Resource result = new Resource(); result.guard = guard; result.status = connection.getResponseCode();
            if (result.status == 401 || result.status == 403 || result.status == 409) {
                if (transport.rejectRead(guard)) revoked.run();
                throw new PortableTransport.Denied(result.status);
            }
            if (result.status != 200) return result;
            for (Map.Entry<String,List<String>> field : connection.getHeaderFields().entrySet())
                if (field.getKey() != null && field.getKey().equalsIgnoreCase("Set-Cookie"))
                    for (String value : field.getValue()) CookieManager.getInstance().setCookie(origin, value);
            result.mime = connection.getContentType(); if (result.mime == null) result.mime = "application/octet-stream";
            result.csp = connection.getHeaderField("Content-Security-Policy");
            try (InputStream input = connection.getInputStream(); ByteArrayOutputStream output = new ByteArrayOutputStream()) {
                byte[] buffer = new byte[8192]; int count;
                while ((count = input.read(buffer)) != -1) { if (output.size() + count > maximum) throw new IOException("Display resource exceeds budget"); output.write(buffer, 0, count); }
                result.body = output.toByteArray();
            }
            return result;
        } finally { connection.disconnect(); }
    }
    static String assetKey(String path) {
        try {
            if (path == null || path.length() >= 1024 || path.matches("(?is).*%(2f|5c|00|2e).*")) return null;
            String decoded = URLDecoder.decode(path.replace("+", "%2B"), "UTF-8");
            return decoded.startsWith("/_next/static/") && decoded.matches("[A-Za-z0-9_/().@\\[\\]+,=\\-]+")
                && !decoded.contains("..") && !decoded.endsWith(".map") ? decoded : null;
        } catch (Exception invalid) { return null; }
    }
    private static boolean assetPath(String path) { return assetKey(path) != null; }
    private static String hash(byte[] body) throws Exception {
        StringBuilder hex = new StringBuilder(); for (byte b : MessageDigest.getInstance("SHA-256").digest(body)) hex.append(String.format(Locale.ROOT, "%02x", b & 255)); return hex.toString();
    }
    private static boolean matchingHtml(Resource resource, String scope) {
        if (resource.status != 200 || resource.body == null || !resource.mime.toLowerCase(Locale.ROOT).startsWith("text/html")) return false;
        String html = new String(resource.body, StandardCharsets.UTF_8);
        return html.contains("data-portable-pos-shell") && html.contains("data-receipt-local-scope=\"" + scope + "\"")
            && html.contains("data-receipt-local-commands=\"true\"");
    }
    /** Called after native storage admission; no JS asset URL is accepted. */
    void prepare(String scope, String path) throws Exception {
        PortableTransport.Admission initial = transport.admitted();
        if (initial == null || !scope.equals(initial.scope) || !initial.offlineEnabled
            || !initial.path.equals(PortableTransport.canonicalPath(path))) return;
        Resource manifestResource = fetch("/experience-build-assets.json", 512 * 1024, 12000);
        if (manifestResource.status != 200) return;
        JSONObject manifest = new JSONObject(new String(manifestResource.body, StandardCharsets.UTF_8));
        String build = manifest.optString("version"); JSONArray files = manifest.optJSONArray("files");
        if (!build.matches("[a-f0-9]{64}") || files == null || files.length() < 1 || files.length() > 600) return;
        long total = 0; Set<String> unique = new HashSet<>();
        for (int i = 0; i < files.length(); i++) { JSONObject file = files.getJSONObject(i); String name = file.optString("path"); long size = file.optLong("bytes", -1);
            if (!name.equals(assetKey(name)) || !unique.add(name) || size < 1 || size > 2_900_000 || !file.optString("sha256").matches("[a-f0-9]{64}")) return;
            total += size; if (total > 48L * 1024 * 1024) return;
        }
        if (total != manifest.optLong("totalBytes", -1)) return;
        JSONObject previousPrepared = store.cacheGet(PREFIX + "prepared");
        boolean assetsAlreadyVerified = previousPrepared != null && build.equals(previousPrepared.optString("version")) && previousPrepared.optBoolean("assetsReady");
        ExecutorService workers = Executors.newFixedThreadPool(4); List<Future<?>> tasks = new ArrayList<>();
        try {
            for (int i = 0; !assetsAlreadyVerified && i < files.length(); i++) { final JSONObject file = files.getJSONObject(i);
                tasks.add(workers.submit(() -> { try {
                    if (!transport.valid(initial)) throw new IOException("Display admission changed");
                    String key = PREFIX + build + "|" + file.getString("path"); JSONObject cached = store.cacheGet(key);
                    if (cached != null && file.getString("sha256").equals(cached.optString("sha256"))) return;
                    Resource asset = fetch(file.getString("path"), 2_900_000, 12000);
                    if (asset.status != 200 || asset.body.length != file.getLong("bytes") || !hash(asset.body).equals(file.getString("sha256"))) throw new IOException("App asset verification failed");
                    if (!transport.valid(initial)) throw new IOException("Display admission changed");
                    store.cachePut(key, asset.packed().put("sha256", file.getString("sha256")));
                } catch (Exception error) { throw new RuntimeException(error); } }));
            }
            for (Future<?> task : tasks) task.get(75, TimeUnit.SECONDS);
        } finally { workers.shutdownNow(); }
        JSONArray paths = new JSONArray();
        Set<String> routes = new LinkedHashSet<>(Arrays.asList("/pos/portable", "/pos/portable/check-in", "/pos/portable/book", "/pos/portable/ticket", "/pos/portable/report"));
        routes.add(path);
        for (String route : routes) {
            if (!initial.capabilities.contains(PortableTransport.pathCapability(route))) continue;
            PortableTransport.Admission admitted = transport.warmDocumentAdmission(scope, route);
            if (!transport.valid(admitted)) throw new IOException("Display admission changed");
            Resource html = fetch(route, 2_900_000, 12000);
            if (!matchingHtml(html, scope) || !transport.valid(admitted)) throw new IOException("POS display could not be verified");
            store.cachePut(PREFIX + scope + "|" + route, html.packed().put("version", build).put("revision", admitted.revision)
                .put("capturedAt", System.currentTimeMillis()).put("issuedAt", admitted.context.getJSONObject("grant").getLong("issuedAt"))
                .put("expiresAt", admitted.expiresAt)); paths.put(route);
        }
        if (!transport.valid(initial)) return;
        store.cachePut(PREFIX + "prepared", new JSONObject().put("scope", scope).put("version", build).put("assetsReady", true).put("paths", paths));
        store.cachePruneDisplay(build, scope);
    }
    boolean ready() {
        try {
            JSONObject context = transport.admittedContext(); if (context == null) return false;
            String scope = context.getJSONObject("context").getString("scope");
            JSONObject prepared = store.cacheGet(PREFIX + "prepared");
            if (prepared == null || !scope.equals(prepared.optString("scope")) || !prepared.optBoolean("assetsReady") || !prepared.optString("version").matches("[a-f0-9]{64}")) return false;
            String revision = context.getJSONObject("grant").getString("grantRevision");
            JSONArray paths = prepared.optJSONArray("paths"); if (paths == null || paths.length() < 1) return false;
            for (int i = 0; i < paths.length(); i++) {
                JSONObject html = store.cacheGet(PREFIX + scope + "|" + paths.getString(i));
                if (html == null || !validSnapshot(html) || !revision.equals(html.optString("revision")) || !prepared.getString("version").equals(html.optString("version"))) return false;
            }
            return true;
        } catch (Exception failure) { return false; }
    }
    WebResourceResponse intercept(WebResourceRequest request) {
        try {
            URI url = new URI(request.getUrl().toString()), base = new URI(origin);
            if (!"GET".equals(request.getMethod()) || !base.getScheme().equals(url.getScheme()) || !base.getRawAuthority().equals(url.getRawAuthority()) || url.getUserInfo() != null) return null;
            String path = url.getRawPath();
            PortableHttpReadProjection.Request read = request.isForMainFrame() ? null : PortableHttpReadProjection.parse(path, url.getRawQuery());
            if (read != null) {
                PortableTransport.Admission admitted = transport.admitted();
                if (admitted == null || !admitted.capabilities.contains(read.capability)) return null;
                try {
                    Resource live = fetch(path + (url.getRawQuery() == null ? "" : "?" + url.getRawQuery()), 2_900_000, 4000);
                    if (live.status != 200 || transport.admitted() != admitted || !transport.valid(admitted)) return null;
                    JSONObject data = new JSONObject(new String(live.body, StandardCharsets.UTF_8));
                    if (!transport.cacheHttpRead(admitted, live.guard, read, data)) return null;
                    return response(live.packed());
                } catch (IOException unavailable) {
                    JSONObject data = read.project(transport::cachedResource, admitted.scope);
                    if (data == null || transport.admitted() != admitted || !transport.valid(admitted)) return null;
                    Map<String,String> headers = new HashMap<>(); headers.put("Cache-Control", "no-store"); headers.put("X-Reylumi-Offline", "cached");
                    return new WebResourceResponse("application/json", "UTF-8", 200, "OK", headers,
                        new ByteArrayInputStream(data.toString().getBytes(StandardCharsets.UTF_8)));
                }
            }
            if (assetPath(path)) {
                JSONObject prepared = store.cacheGet(PREFIX + "prepared");
                if (prepared == null) return null;
                JSONObject cached = store.cacheGet(PREFIX + prepared.optString("version") + "|" + assetKey(path));
                return cached == null ? null : response(cached);
            }
            path = path + (url.getRawQuery() == null ? "" : "?" + url.getRawQuery());
            if (!request.isForMainFrame() || !PortableTransport.portablePath(path)) return null;
            try {
                Resource live = fetch(path, 2_900_000, 4000);
                if (live.status != 200) return null; // WebView must handle redirects/auth online.
                return response(live.packed());
            } catch (IOException unavailable) {
                PortableTransport.Admission admission = transport.restoreDocumentAdmission(path);
                if (admission == null || !transport.valid(admission) || !admission.localCommands) return null;
                JSONObject cached = store.cacheGet(PREFIX + admission.scope + "|" + path);
                JSONObject prepared = store.cacheGet(PREFIX + "prepared");
                if (cached == null || !validSnapshot(cached) || prepared == null || !prepared.optBoolean("assetsReady") || !admission.scope.equals(prepared.optString("scope"))
                    || !admission.revision.equals(cached.optString("revision")) || !prepared.optString("version").equals(cached.optString("version"))) return null;
                return response(cached);
            }
        } catch (Exception denied) { return null; }
    }
    static boolean validSnapshot(JSONObject value) {
        long now = System.currentTimeMillis(), captured = value.optLong("capturedAt", -1), expires = value.optLong("expiresAt", -1);
        long issued = value.optLong("issuedAt", -1);
        // Lease timestamps share the server clock. Device capture time may be
        // slightly behind it, within the same 60s skew admitted by Transport.
        // Never renew the document's original server expiry on a later login.
        boolean lease = issued > 0 ? issued <= captured + 60000 && expires > issued && expires - issued <= 86400000
            : expires - captured <= 86400000 + 60000; // Existing native-only v1 display cache; expiry remains unchanged.
        return captured > 0 && captured <= now + 60000 && now - captured < 86400000 && expires > now && lease;
    }
    private static WebResourceResponse response(JSONObject cached) throws Exception {
        String type = cached.optString("mime", "application/octet-stream").split(";", 2)[0];
        Map<String,String> headers = new HashMap<>(); headers.put("Cache-Control", "no-store");
        if (!cached.optString("csp").isEmpty()) headers.put("Content-Security-Policy", cached.getString("csp"));
        return new WebResourceResponse(type, "UTF-8", 200, "OK", headers,
            new ByteArrayInputStream(android.util.Base64.decode(cached.getString("body"), android.util.Base64.NO_WRAP)));
    }
}
