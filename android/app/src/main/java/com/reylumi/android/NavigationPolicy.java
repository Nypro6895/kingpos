package com.reylumi.android;

import java.net.URI;
import java.util.Locale;

final class NavigationPolicy {
    enum Decision { INTERNAL, EXTERNAL, BLOCKED }

    static Decision decide(String value) {
        try {
            URI url = new URI(value);
            if (url.getUserInfo() != null) return Decision.BLOCKED;
            String scheme = url.getScheme() == null ? "" : url.getScheme().toLowerCase(Locale.ROOT);
            if (scheme.equals("https")) {
                if ("reylumi.com".equalsIgnoreCase(url.getHost()) && (url.getPort() == -1 || url.getPort() == 443)) {
                    String path = url.getPath() == null ? "/" : url.getPath();
                    path = path.replace('\\', '/').toLowerCase(Locale.ROOT);
                    // Fail closed until Android billing and financial provider flows are reviewed.
                    for (String prefix : new String[]{"/admin", "/api", "/market", "/settings/recovery-back-office"}) {
                        if (path.equals(prefix) || path.startsWith(prefix + "/")) return Decision.BLOCKED;
                    }
                    return Decision.INTERNAL;
                }
                return url.getHost() == null ? Decision.BLOCKED : Decision.EXTERNAL;
            }
            return scheme.equals("tel") || scheme.equals("mailto") || scheme.equals("sms")
                ? Decision.EXTERNAL : Decision.BLOCKED;
        } catch (Exception ignored) { return Decision.BLOCKED; }
    }
}
