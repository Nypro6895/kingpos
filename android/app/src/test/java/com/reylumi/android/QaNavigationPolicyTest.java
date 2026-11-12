package com.reylumi.android;

import org.junit.Test;
import static org.junit.Assert.*;

public class QaNavigationPolicyTest {
    @Test public void qaRequestsUseOnlyTheExactLocalPorts() {
        assertTrue(NavigationPolicy.qaResourceAllowed("http://localhost:3117/api/qa/environment"));
        assertTrue(NavigationPolicy.qaResourceAllowed("http://127.0.0.1:55421/auth/v1/token"));
        for (String value : new String[]{"https://reylumi.com", "https://localhost:3117", "http://localhost", "http://localhost:3118",
            "http://127.0.0.1:3117", "http://localhost:55421", "http://127.0.0.1:55422", "http://localhost.evil.test:3117",
            "http://user@localhost:3117", "http://[::1]:3117", "file:///data/local", "javascript:alert(1)", ""})
            assertFalse(value, NavigationPolicy.qaResourceAllowed(value));
    }

    @Test public void qaPermissionsRequireTheAppOriginNotBackend() {
        assertTrue(NavigationPolicy.qaTrustedOrigin("http://localhost:3117"));
        assertTrue(NavigationPolicy.qaTrustedOrigin("http://localhost:3117/"));
        for (String value : new String[]{"http://127.0.0.1:55421", "http://localhost:3117/path", "http://localhost:3117?token=x",
            "http://localhost:3117#x", "http://user@localhost:3117", "https://reylumi.com"})
            assertFalse(value, NavigationPolicy.qaTrustedOrigin(value));
    }

    @Test public void qaNavigationNeverOpensExternalBrowsersOrBackendPages() {
        for (String path : new String[]{"/explore", "/staff/today", "/settings", "/market", "/gift-cards", "/qa/checkout/cs_test_qa_aabb"})
            assertEquals(path, NavigationPolicy.Decision.INTERNAL, NavigationPolicy.decideQa("http://localhost:3117" + path));
        for (String value : new String[]{"https://reylumi.com", "https://stripe.com", "https://checkout.stripe.com/qa/id",
            "tel:123", "mailto:qa@example.invalid", "intent://scan", "http://127.0.0.1:55421/rest/v1/",
            "http://localhost:3117/admin", "http://localhost:3117/%61dmin", "http://localhost:3117/x/../api/admin"})
            assertEquals(value, NavigationPolicy.Decision.BLOCKED, NavigationPolicy.decideQa(value));
    }

    @Test public void onlySyntheticCheckoutIdsMapToTheLocalScreen() {
        String id = "cs_test_qa_1234567890abcdef1234567890abcdef";
        assertEquals("http://localhost:3117/qa/checkout/" + id, NavigationPolicy.qaCheckoutUrl("https://checkout.stripe.com/qa/" + id));
        assertEquals("http://localhost:3117/qa/checkout/" + id, NavigationPolicy.qaCheckoutUrl("https://checkout.stripe.com:443/qa/" + id));
        for (String value : new String[]{"http://checkout.stripe.com/qa/" + id, "https://checkout.stripe.com:444/qa/" + id,
            "https://checkout.stripe.com.evil.test/qa/" + id, "https://user@checkout.stripe.com/qa/" + id,
            "https://checkout.stripe.com/qa/" + id + "?x=y", "https://checkout.stripe.com/qa/" + id + "#x",
            "https://checkout.stripe.com/qa/cs_live_123", "https://checkout.stripe.com/qa/cs_test_qa_1234",
            "https://checkout.stripe.com/qa/" + id + "/", "https://checkout.stripe.com/%71a/" + id})
            assertNull(value, NavigationPolicy.qaCheckoutUrl(value));
    }

    @Test public void activeVariantSelectsOnlyItsOwnOriginAndDropsSavedCredentials() {
        if (BuildConfig.QA_LOCAL) {
            assertEquals("com.reylumi.android.qa", BuildConfig.APPLICATION_ID);
            assertEquals("http://localhost:3117/login", NavigationPolicy.initialUrl());
            assertTrue(NavigationPolicy.trustedOrigin("http://localhost:3117"));
            assertFalse(NavigationPolicy.trustedOrigin("https://reylumi.com"));
            assertEquals("http://localhost:3117/settings", NavigationPolicy.resumeUrl("http://localhost:3117/settings?secret=x#private"));
            assertNull(NavigationPolicy.resumeUrl("https://reylumi.com/settings"));
        } else {
            assertEquals("com.reylumi.android", BuildConfig.APPLICATION_ID);
            assertEquals("https://reylumi.com/explore", NavigationPolicy.initialUrl());
            assertFalse(NavigationPolicy.trustedOrigin("http://localhost:3117"));
            assertEquals(NavigationPolicy.Decision.BLOCKED, NavigationPolicy.decide("http://localhost:3117/settings"));
        }
    }
}
