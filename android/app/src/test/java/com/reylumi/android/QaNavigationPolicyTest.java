package com.reylumi.android;

import org.junit.Test;
import static org.junit.Assert.*;

public class QaNavigationPolicyTest {
    private static final String APP = NavigationPolicy.QA_ORIGIN;
    private static final String BACKEND = "http://127.0.0.1:" + BuildConfig.QA_BACKEND_PORT;
    @Test public void qaRequestsUseOnlyTheExactLocalPorts() {
        assertTrue(NavigationPolicy.qaResourceAllowed(APP + "/api/qa/environment"));
        assertTrue(NavigationPolicy.qaResourceAllowed(BACKEND + "/auth/v1/token"));
        assertFalse(NavigationPolicy.qaResourceAllowed("http://127.0.0.1:" + (BuildConfig.QA_BACKEND_PORT == 55421 ? 55521 : 55421)));
        assertFalse(NavigationPolicy.qaResourceAllowed("http://localhost:" + (BuildConfig.QA_APP_PORT == 3117 ? 3119 : 3117)));
        for (String value : new String[]{"https://reylumi.com", "https://localhost:3117", "http://localhost", "http://localhost:3118",
            "http://127.0.0.1:3117", "http://localhost:55421", "http://127.0.0.1:55422", "http://localhost.evil.test:3117",
            "http://user@localhost:3117", "http://[::1]:3117", "file:///data/local", "javascript:alert(1)", ""})
            assertFalse(value, NavigationPolicy.qaResourceAllowed(value));
    }

    @Test public void qaPermissionsRequireTheAppOriginNotBackend() {
        assertTrue(NavigationPolicy.qaTrustedOrigin(APP));
        assertTrue(NavigationPolicy.qaTrustedOrigin(APP + "/"));
        for (String value : new String[]{BACKEND, APP + "/path", APP + "?token=x",
            APP + "#x", "http://user@localhost:" + BuildConfig.QA_APP_PORT, "https://reylumi.com"})
            assertFalse(value, NavigationPolicy.qaTrustedOrigin(value));
    }

    @Test public void qaNavigationNeverOpensExternalBrowsersOrBackendPages() {
        for (String path : new String[]{"/explore", "/staff/today", "/settings", "/market", "/gift-cards", "/qa/checkout/cs_test_qa_aabb"})
            assertEquals(path, NavigationPolicy.Decision.INTERNAL, NavigationPolicy.decideQa(APP + path));
        for (String value : new String[]{"https://reylumi.com", "https://stripe.com", "https://checkout.stripe.com/qa/id",
            "tel:123", "mailto:qa@example.invalid", "intent://scan", BACKEND + "/rest/v1/",
            APP + "/admin", APP + "/%61dmin", APP + "/x/../api/admin"})
            assertEquals(value, NavigationPolicy.Decision.BLOCKED, NavigationPolicy.decideQa(value));
    }

    @Test public void onlySyntheticCheckoutIdsMapToTheLocalScreen() {
        String id = "cs_test_qa_1234567890abcdef1234567890abcdef";
        assertEquals(APP + "/qa/checkout/" + id, NavigationPolicy.qaCheckoutUrl("https://checkout.stripe.com/qa/" + id));
        assertEquals(APP + "/qa/checkout/" + id, NavigationPolicy.qaCheckoutUrl("https://checkout.stripe.com:443/qa/" + id));
        for (String value : new String[]{"http://checkout.stripe.com/qa/" + id, "https://checkout.stripe.com:444/qa/" + id,
            "https://checkout.stripe.com.evil.test/qa/" + id, "https://user@checkout.stripe.com/qa/" + id,
            "https://checkout.stripe.com/qa/" + id + "?x=y", "https://checkout.stripe.com/qa/" + id + "#x",
            "https://checkout.stripe.com/qa/cs_live_123", "https://checkout.stripe.com/qa/cs_test_qa_1234",
            "https://checkout.stripe.com/qa/" + id + "/", "https://checkout.stripe.com/%71a/" + id})
            assertNull(value, NavigationPolicy.qaCheckoutUrl(value));
    }

    @Test public void activeVariantSelectsOnlyItsOwnOriginAndDropsSavedCredentials() {
        if (BuildConfig.QA_LOCAL) {
            assertEquals(BuildConfig.PORTABLE_POS ? "com.reylumi.android.pos.qa" : "com.reylumi.android.qa", BuildConfig.APPLICATION_ID);
            assertEquals(APP + (BuildConfig.PORTABLE_POS ? "/pos/portable" : "/login"), NavigationPolicy.initialUrl());
            assertTrue(NavigationPolicy.trustedOrigin(APP));
            assertFalse(NavigationPolicy.trustedOrigin("https://reylumi.com"));
            assertEquals(APP + "/settings", NavigationPolicy.resumeUrl(APP + "/settings?secret=x#private"));
            assertNull(NavigationPolicy.resumeUrl("https://reylumi.com/settings"));
        } else {
            assertTrue(BuildConfig.APPLICATION_ID.startsWith("com.reylumi.android"));
            assertEquals("https://reylumi.com" + (BuildConfig.PORTABLE_POS ? "/pos/portable" : "/explore"), NavigationPolicy.initialUrl());
            assertFalse(NavigationPolicy.trustedOrigin("http://localhost:3117"));
            assertEquals(NavigationPolicy.Decision.BLOCKED, NavigationPolicy.decide("http://localhost:3117/settings"));
        }
    }
}
