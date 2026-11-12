package com.reylumi.android;

import java.net.URI;
import java.util.Locale;
import java.util.ArrayDeque;

final class NavigationPolicy {
    enum Decision { INTERNAL, EXTERNAL, BLOCKED }
    static final String QA_ORIGIN = "http://localhost:3117";

    static String appOrigin() { return BuildConfig.QA_LOCAL ? QA_ORIGIN : "https://reylumi.com"; }
    static String initialUrl() { return appOrigin() + (BuildConfig.QA_LOCAL ? "/login" : "/explore"); }

    /** Map only synthetic fixture checkout IDs. No real Stripe URL is loaded. */
    static String qaCheckoutUrl(String value) {
        try {
            URI url = new URI(value);
            if (!"https".equalsIgnoreCase(url.getScheme()) || !"checkout.stripe.com".equalsIgnoreCase(url.getHost())
                || (url.getPort() != -1 && url.getPort() != 443) || url.getUserInfo() != null
                || url.getQuery() != null || url.getFragment() != null) return null;
            String path = url.getRawPath();
            if (path == null || !path.matches("/qa/cs_test_qa_[0-9a-f]{32}")) return null;
            return QA_ORIGIN + "/qa/checkout/" + path.substring(4);
        } catch (Exception ignored) { return null; }
    }

    /** QA uses two exact local HTTP endpoints; never forward another host or port. */
    static boolean qaResourceAllowed(String value) {
        try {
            URI url = new URI(value);
            if (url.getUserInfo() != null || !"http".equalsIgnoreCase(url.getScheme())) return false;
            return ("localhost".equalsIgnoreCase(url.getHost()) && url.getPort() == 3117)
                || ("127.0.0.1".equals(url.getHost()) && url.getPort() == 55421);
        } catch (Exception ignored) { return false; }
    }

    static boolean qaTrustedOrigin(String value) {
        try {
            URI url = new URI(value);
            String path = url.getPath();
            return qaResourceAllowed(value) && "localhost".equalsIgnoreCase(url.getHost()) && url.getPort() == 3117
                && (path == null || path.isEmpty() || path.equals("/"))
                && url.getQuery() == null && url.getFragment() == null;
        } catch (Exception ignored) { return false; }
    }

    static Decision decideQa(String value) {
        try {
            URI url = new URI(value);
            if (!qaResourceAllowed(value) || !"localhost".equalsIgnoreCase(url.getHost()) || url.getPort() != 3117)
                return Decision.BLOCKED;
            return blockedPath(url.getPath(), true) ? Decision.BLOCKED : Decision.INTERNAL;
        } catch (Exception ignored) { return Decision.BLOCKED; }
    }

    private static boolean blockedPath(String path, boolean qa) {
        path = path == null ? "/" : path.replace('\\', '/').toLowerCase(Locale.ROOT);
        ArrayDeque<String> segments = new ArrayDeque<>();
        for (String segment : path.split("/+")) {
            if (segment.equals("..")) { if (!segments.isEmpty()) segments.removeLast(); }
            else if (!segment.isEmpty() && !segment.equals(".")) segments.addLast(segment);
        }
        path = "/" + String.join("/", segments);
        for (String prefix : qa ? new String[]{"/admin", "/api", "/settings/recovery-back-office"}
            : new String[]{"/admin", "/api", "/market", "/settings/recovery-back-office"}) {
            if (path.equals(prefix) || path.startsWith(prefix + "/")) return true;
        }
        return false;
    }

    static boolean trustedOrigin(String value) {
        if (BuildConfig.QA_LOCAL) return qaTrustedOrigin(value);
        return productionTrustedOrigin(value);
    }

    static boolean productionTrustedOrigin(String value) {
        try {
            URI origin = new URI(value);
            String path = origin.getPath();
            return "https".equalsIgnoreCase(origin.getScheme()) && "reylumi.com".equalsIgnoreCase(origin.getHost())
                && (origin.getPort() == -1 || origin.getPort() == 443) && origin.getUserInfo() == null
                && (path == null || path.isEmpty() || path.equals("/"))
                && origin.getQuery() == null && origin.getFragment() == null;
        } catch (Exception ignored) { return false; }
    }

    static String resumeUrl(String value) {
        if (decide(value) != Decision.INTERNAL) return null;
        return resumeUrl(value, appOrigin());
    }
    static String productionResumeUrl(String value) {
        return decideProduction(value) == Decision.INTERNAL ? resumeUrl(value, "https://reylumi.com") : null;
    }
    private static String resumeUrl(String value, String origin) {
        try {
            URI url = new URI(value);
            String path = url.getPath() == null ? "/" : url.getPath();
            String lower = path.toLowerCase(Locale.ROOT);
            for (String prefix : new String[]{"/login", "/logout", "/auth", "/signup", "/reset-password", "/forgot-password"}) {
                if (lower.equals(prefix) || lower.startsWith(prefix + "/")) return origin + "/explore";
            }
            // Store only the route, never authentication/query/fragment credentials.
            URI base = new URI(origin);
            return new URI(base.getScheme(), null, base.getHost(), base.getPort(), path, null, null).toASCIIString();
        } catch (Exception ignored) { return null; }
    }

    static Decision decide(String value) {
        return BuildConfig.QA_LOCAL ? decideQa(value) : decideProduction(value);
    }
    static Decision decideProduction(String value) {
        try {
            URI url = new URI(value);
            if (url.getUserInfo() != null) return Decision.BLOCKED;
            String scheme = url.getScheme() == null ? "" : url.getScheme().toLowerCase(Locale.ROOT);
            if (scheme.equals("https")) {
                if ("reylumi.com".equalsIgnoreCase(url.getHost()) && (url.getPort() == -1 || url.getPort() == 443)) {
                    // Fail closed until Android billing and financial provider flows are reviewed.
                    if (blockedPath(url.getPath(), false)) return Decision.BLOCKED;
                    return Decision.INTERNAL;
                }
                return url.getHost() == null ? Decision.BLOCKED : Decision.EXTERNAL;
            }
            return scheme.equals("tel") || scheme.equals("mailto") || scheme.equals("sms")
                ? Decision.EXTERNAL : Decision.BLOCKED;
        } catch (Exception ignored) { return Decision.BLOCKED; }
    }
}
