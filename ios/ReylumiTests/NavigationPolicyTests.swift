import XCTest
@testable import Reylumi

final class NavigationPolicyTests: XCTestCase {
    let policy = NavigationPolicy(origin: URL(string: "https://reylumi.com")!)
    func testWorkspacesRemainAvailable() {
        for path in ["/explore", "/beauty", "/my-bookings", "/bookings", "/staff/my-work", "/pos", "/settings", "/reports", "/payroll", "/support"] {
            let url = URL(string: "https://reylumi.com" + path)!
            XCTAssertTrue(policy.isInternal(url))
            XCTAssertFalse(policy.isExcluded(url))
        }
    }
    func testAdministrationCannotBeNavigatedTo() {
        for path in ["/admin", "/admin/users", "/ADMIN/users", "/%61dmin/users", "/api/admin/export", "/settings/recovery-back-office", "/api/pos/windows-download"] {
            XCTAssertTrue(policy.isExcluded(URL(string: "https://reylumi.com" + path)!))
        }
        XCTAssertFalse(policy.isExcluded(URL(string: "https://reylumi.com/administrator")!))
    }
    func testUntrustedOriginsAndSchemes() {
        for url in ["http://reylumi.com", "https://reylumi.com.evil.test", "https://reylumi.com:8443", "https://user@reylumi.com"] {
            XCTAssertFalse(policy.isInternal(URL(string: url)!))
        }
        XCTAssertFalse(policy.isExternalAllowed(URL(string: "javascript:alert(1)")!))
        XCTAssertTrue(policy.isExternalAllowed(URL(string: "tel:123456789")!))
    }
    func testPaymentsOpenOnlyTrustedHostedOrigins() {
        for value in ["https://checkout.stripe.com/c/pay/cs_example", "https://billing.stripe.com/p/session/example"] {
            XCTAssertTrue(policy.isSafariPayment(URL(string: value)!))
        }
        for value in ["http://checkout.stripe.com/c/pay/test", "https://checkout.stripe.com.evil.test/c/pay/test", "https://user@checkout.stripe.com", "https://checkout.stripe.com:8443", "https://reylumi.com"] {
            XCTAssertFalse(policy.isSafariPayment(URL(string: value)!))
        }
    }
    func testMarketReturnIsNavigationOnly() {
        XCTAssertTrue(NavigationPolicy.isMarketReturn(URL(string: "reylumi://market")!))
        for value in ["reylumi://market?paid=true", "reylumi://market/admin", "reylumi://admin", "reylumi://user@market", "reylumi://market#token", "https://market"] {
            XCTAssertFalse(NavigationPolicy.isMarketReturn(URL(string: value)!))
        }
    }

    private func challengeResponse(_ url: String = "https://reylumi.com/security-check", status: Int = 429, headers: [String: String] = [:]) -> HTTPURLResponse {
        var fields = ["Content-Type": "text/html; charset=utf-8", "x-vercel-mitigated": "challenge"]
        headers.forEach { fields[$0.key] = $0.value }
        return HTTPURLResponse(url: URL(string: url)!, statusCode: status, httpVersion: "HTTP/1.1", headerFields: fields)!
    }

    func testOnlyRecognizedSecurityChallengeDocumentsAreAllowed() {
        for status in [403, 429] {
            XCTAssertTrue(policy.isSecurityChallengeResponse(challengeResponse(status: status), isMainFrame: true, canShowMIMEType: true))
        }
        XCTAssertTrue(policy.isSecurityChallengeResponse(challengeResponse(headers: ["x-vercel-mitigated": " Challenge "]), isMainFrame: true, canShowMIMEType: true))
        XCTAssertFalse(policy.isSecurityChallengeResponse(challengeResponse(), isMainFrame: false, canShowMIMEType: true))
        XCTAssertFalse(policy.isSecurityChallengeResponse(challengeResponse(), isMainFrame: true, canShowMIMEType: false))
        for status in [200, 401, 404, 500, 503] {
            XCTAssertFalse(policy.isSecurityChallengeResponse(challengeResponse(status: status), isMainFrame: true, canShowMIMEType: true), "status \(status)")
        }
        for headers in [
            ["x-vercel-mitigated": ""], ["x-vercel-mitigated": "deny"],
            ["x-vercel-mitigated": "challenge, deny"], ["Content-Type": "application/json"],
            ["Content-Disposition": "attachment; filename=check.html"],
        ] {
            XCTAssertFalse(policy.isSecurityChallengeResponse(challengeResponse(headers: headers), isMainFrame: true, canShowMIMEType: true), "\(headers)")
        }
        let ordinaryError = HTTPURLResponse(url: URL(string: "https://reylumi.com/security-check")!, statusCode: 429, httpVersion: nil, headerFields: ["Content-Type": "text/html"])!
        XCTAssertFalse(policy.isSecurityChallengeResponse(ordinaryError, isMainFrame: true, canShowMIMEType: true))
    }

    func testChallengeExceptionCannotExpandToOtherOriginsOrRoutes() {
        for url in [
            "http://reylumi.com/security-check", "https://reylumi.com.evil.test/security-check",
            "https://reylumi.com:8443/security-check", "https://user@reylumi.com/security-check",
            "https://reylumi.com/admin", "https://reylumi.com/api/auth/signup",
            "https://reylumi.com/signup", "https://reylumi.com/security-check/other",
        ] {
            XCTAssertFalse(policy.isSecurityChallengeResponse(challengeResponse(url), isMainFrame: true, canShowMIMEType: true), url)
        }
    }
}
