package com.reylumi.android;
import org.junit.Test;
import static org.junit.Assert.*;

public class NavigationPolicyTest {
    @Test public void confinesTrustedOrigin() {
        assertEquals(NavigationPolicy.Decision.INTERNAL, NavigationPolicy.decide("https://reylumi.com/explore"));
        assertEquals(NavigationPolicy.Decision.EXTERNAL, NavigationPolicy.decide("https://reylumi.com.evil.test/"));
        assertEquals(NavigationPolicy.Decision.BLOCKED, NavigationPolicy.decide("https://user@reylumi.com/"));
        assertEquals(NavigationPolicy.Decision.BLOCKED, NavigationPolicy.decide("http://reylumi.com/"));
        assertEquals(NavigationPolicy.Decision.BLOCKED, NavigationPolicy.decide("javascript:alert(1)"));
        assertEquals(NavigationPolicy.Decision.BLOCKED, NavigationPolicy.decide("intent://scan"));
    }
    @Test public void excludesAdminAndUnreviewedBilling() {
        for (String path : new String[]{"/admin", "/ADMIN/users", "/%61dmin", "/api/admin", "/market", "/market/checkout", "/settings/recovery-back-office"})
            assertEquals(path, NavigationPolicy.Decision.BLOCKED, NavigationPolicy.decide("https://reylumi.com" + path));
        assertEquals(NavigationPolicy.Decision.INTERNAL, NavigationPolicy.decide("https://reylumi.com/booking"));
    }
}
