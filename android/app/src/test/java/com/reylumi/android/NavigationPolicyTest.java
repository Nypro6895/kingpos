package com.reylumi.android;
import org.junit.Test;
import static org.junit.Assert.*;

public class NavigationPolicyTest {
    @Test public void devicePermissionsRequireAnExactSecureOrigin() {
        assertTrue(NavigationPolicy.productionTrustedOrigin("https://reylumi.com"));
        assertTrue(NavigationPolicy.productionTrustedOrigin("https://reylumi.com/"));
        assertTrue(NavigationPolicy.productionTrustedOrigin("https://reylumi.com:443"));
        for (String value : new String[]{"http://reylumi.com", "https://reylumi.com.evil.test", "https://evil.test", "https://user@reylumi.com", "https://reylumi.com:444", "https://reylumi.com/path", "https://reylumi.com?token=x", "null", ""})
            assertFalse(value, NavigationPolicy.productionTrustedOrigin(value));
    }
    @Test public void resumeKeepsOnlyTrustedRoutesWithoutCredentials() {
        assertEquals("https://reylumi.com/staff/today", NavigationPolicy.productionResumeUrl("https://reylumi.com/staff/today?token=secret#private"));
        assertEquals("https://reylumi.com/explore", NavigationPolicy.productionResumeUrl("https://reylumi.com/auth/callback?code=secret"));
        assertEquals("https://reylumi.com/explore", NavigationPolicy.productionResumeUrl("https://reylumi.com/login"));
        assertNull(NavigationPolicy.productionResumeUrl("https://evil.test/staff/today"));
        assertNull(NavigationPolicy.productionResumeUrl("https://reylumi.com/market"));
    }
    @Test public void confinesTrustedOrigin() {
        assertEquals(NavigationPolicy.Decision.INTERNAL, NavigationPolicy.decideProduction("https://reylumi.com/explore"));
        assertEquals(NavigationPolicy.Decision.EXTERNAL, NavigationPolicy.decideProduction("https://reylumi.com.evil.test/"));
        assertEquals(NavigationPolicy.Decision.BLOCKED, NavigationPolicy.decideProduction("https://user@reylumi.com/"));
        assertEquals(NavigationPolicy.Decision.BLOCKED, NavigationPolicy.decideProduction("http://reylumi.com/"));
        assertEquals(NavigationPolicy.Decision.BLOCKED, NavigationPolicy.decideProduction("javascript:alert(1)"));
        assertEquals(NavigationPolicy.Decision.BLOCKED, NavigationPolicy.decideProduction("intent://scan"));
    }
    @Test public void excludesAdminAndUnreviewedBilling() {
        for (String path : new String[]{"/admin", "/ADMIN/users", "/%61dmin", "/api/admin", "/market", "/market/checkout", "/settings/recovery-back-office", "/explore/../market", "/explore/%2e%2e/admin", "//market"})
            assertEquals(path, NavigationPolicy.Decision.BLOCKED, NavigationPolicy.decideProduction("https://reylumi.com" + path));
        assertEquals(NavigationPolicy.Decision.INTERNAL, NavigationPolicy.decideProduction("https://reylumi.com/booking"));
    }
}
