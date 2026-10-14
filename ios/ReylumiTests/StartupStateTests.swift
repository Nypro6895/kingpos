import XCTest
@testable import Reylumi

final class StartupStateTests: XCTestCase {
    private let origin = URL(string: "https://reylumi.com")!

    private func request(_ path: String = "/explore", method: String = "GET") -> URLRequest {
        var request = URLRequest(url: URL(string: path, relativeTo: origin)!.absoluteURL)
        request.httpMethod = method
        return request
    }

    func testReadyRequiresCommittedDocumentAndMatchingNonceAndGeneration() {
        var state = ReylumiStartupState()
        state.begin(request())
        let nonce = state.nonce, generation = state.generation
        XCTAssertFalse(state.ready(nonce: nonce, generation: generation))
        state.commit()
        XCTAssertFalse(state.ready(nonce: "old", generation: generation))
        XCTAssertFalse(state.ready(nonce: nonce, generation: generation - 1))
        XCTAssertTrue(state.ready(nonce: nonce, generation: generation))
        XCTAssertTrue(state.hasUsablePage)
        XCTAssertFalse(state.isWaiting)
    }

    func testOldReadinessCannotHideTheNextNavigation() {
        var state = ReylumiStartupState()
        state.begin(request())
        let oldNonce = state.nonce, oldGeneration = state.generation
        state.commit()
        state.begin(request("/market"))
        state.commit()
        XCTAssertFalse(state.ready(nonce: oldNonce, generation: oldGeneration))
        XCTAssertTrue(state.isWaiting)
        XCTAssertFalse(state.hasUsablePage)
    }

    func testProvisionalFailurePreservesTheWorkingDocumentButCommittedFailureDoesNot() {
        var state = ReylumiStartupState()
        state.begin(request())
        state.commit()
        state.finish()
        state.begin(request("/market"))
        state.fail()
        XCTAssertTrue(state.hasUsablePage)
        state.begin(request("/market"))
        state.commit()
        state.fail()
        XCTAssertFalse(state.hasUsablePage)
        XCTAssertFalse(state.isWaiting)
    }

    func testHTTPErrorCannotBeMarkedReadyByLateBridgeOrDidFinish() {
        var state = ReylumiStartupState()
        state.begin(request())
        state.commit()
        state.fail(rejectCompletion: true)
        XCTAssertFalse(state.ready(nonce: state.nonce, generation: state.generation))
        XCTAssertFalse(state.finish())
        XCTAssertFalse(state.hasUsablePage)
    }

    func testLateReadinessAfterSoftFailureCanRecoverTheSameDocument() {
        var state = ReylumiStartupState()
        state.begin(request())
        state.commit()
        state.fail()
        XCTAssertTrue(state.ready(nonce: state.nonce, generation: state.generation))
    }

    func testRetryConstructsAFreshBoundedGetAndNeverReplaysMutationBodies() {
        var state = ReylumiStartupState()
        var get = request("/explore?q=Hair")
        get.setValue("private-header", forHTTPHeaderField: "Authorization")
        state.begin(get)
        let retry = state.retryRequest(origin: origin)
        XCTAssertEqual(retry?.httpMethod, "GET")
        XCTAssertEqual(retry?.timeoutInterval, 15)
        XCTAssertNil(retry?.value(forHTTPHeaderField: "Authorization"))
        for method in ["POST", "PATCH", "PUT", "DELETE"] {
            state.begin(request("/market", method: method))
            XCTAssertNil(state.retryRequest(origin: origin), method)
        }
        get.httpBody = Data("unsafe".utf8)
        state.begin(get)
        XCTAssertNil(state.retryRequest(origin: origin))
    }

    func testRetryRejectsExternalAdminAndOneUseAuthenticationOrPaymentUrls() {
        var state = ReylumiStartupState()
        for path in ["https://other.test/explore", "/admin", "/api/auth/callback?code=one-use", "/explore?token=secret", "/market?bookingStripe=received", "/market?session_id=checkout", "/booking/manage/secret", "/booking-payment/secret"] {
            state.begin(request(path))
            XCTAssertNil(state.retryRequest(origin: origin), path)
        }
    }

    func testProcessTerminationClearsReadinessAndBoundsAutomaticRecovery() {
        var state = ReylumiStartupState()
        state.begin(request())
        state.commit()
        state.finish()
        let nonce = state.nonce, generation = state.generation
        state.processTerminated()
        XCTAssertFalse(state.hasUsablePage)
        XCTAssertFalse(state.ready(nonce: nonce, generation: generation))
        let now = Date(timeIntervalSince1970: 1000)
        XCTAssertTrue(state.allowProcessRecovery(at: now))
        XCTAssertFalse(state.allowProcessRecovery(at: now.addingTimeInterval(1)))
        XCTAssertFalse(state.allowProcessRecovery(at: now.addingTimeInterval(59)))
        XCTAssertTrue(state.allowProcessRecovery(at: now.addingTimeInterval(60)))
    }
}
