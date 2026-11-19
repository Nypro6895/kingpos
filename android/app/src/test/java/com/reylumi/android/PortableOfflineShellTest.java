package com.reylumi.android;
import org.json.JSONObject;
import org.junit.Test;
import static org.junit.Assert.*;

public class PortableOfflineShellTest {
    @Test public void dynamicRouteChunkUrlsMapToTheirManifestFile() {
        String path = "/_next/static/chunks/app/(app)/ticket/[ticketId]/page-abcd.js";
        assertEquals(path, PortableOfflineShell.assetKey(path));
        assertEquals(path, PortableOfflineShell.assetKey(path.replace("[", "%5B").replace("]", "%5D")));
        for (String invalid : new String[]{"/_next/static/../secret", "/_next/static/%2e%2e/secret", "/_next/static/%252e%252e/secret",
            "/_next/static/a%2fb.js", "/_next/static/a%5cb.js", "/_next/static/a.js?url=https://evil.test", "/_next/static/a.js.map", "https://evil.test/a.js"})
            assertNull(invalid, PortableOfflineShell.assetKey(invalid));
    }
    @Test public void freshAdmissionCannotRenewAnOldHtmlSnapshot() throws Exception {
        long now = System.currentTimeMillis();
        assertTrue(PortableOfflineShell.validSnapshot(new JSONObject().put("capturedAt", now - 1000).put("expiresAt", now + 1000)));
        assertFalse(PortableOfflineShell.validSnapshot(new JSONObject().put("capturedAt", now - 86400001).put("expiresAt", now + 1000)));
        assertFalse(PortableOfflineShell.validSnapshot(new JSONObject().put("capturedAt", now).put("issuedAt", now).put("expiresAt", now + 86400001)));
        assertFalse(PortableOfflineShell.validSnapshot(new JSONObject().put("capturedAt", now - 2000).put("expiresAt", now - 1000)));
    }
    @Test public void serverLeaseAllowsAnAdmittedDeviceClockSkewWithoutExtendingExpiry() throws Exception {
        long device = System.currentTimeMillis(), server = device + 1000;
        assertTrue(PortableOfflineShell.validSnapshot(new JSONObject().put("capturedAt", device).put("issuedAt", server).put("expiresAt", server + 86400000)));
        assertFalse(PortableOfflineShell.validSnapshot(new JSONObject().put("capturedAt", device).put("issuedAt", server).put("expiresAt", server + 86400001)));
        assertFalse(PortableOfflineShell.validSnapshot(new JSONObject().put("capturedAt", device - 86400001).put("issuedAt", device - 86400001).put("expiresAt", device + 1000)));
        assertTrue(PortableOfflineShell.validSnapshot(new JSONObject().put("capturedAt", device).put("expiresAt", server + 86400000)));
        assertFalse(PortableOfflineShell.validSnapshot(new JSONObject().put("capturedAt", device).put("expiresAt", device + 86400000 + 60001)));
    }
}
