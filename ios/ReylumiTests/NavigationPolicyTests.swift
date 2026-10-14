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
}
