import XCTest
@testable import Reylumi

@MainActor
final class ReylumiReceiptPrinterTests: XCTestCase {
    private func job() -> [String: Any] {
        ["version": 1, "jobId": UUID().uuidString, "kind": "receipt", "receiptId": UUID().uuidString,
         "title": "Receipt T1", "paper": "80mm", "html": "<html data-reylumi-receipt-document=\"1\"><head><meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'\"></head><body>Receipt</body></html>"]
    }
    func testTypedReceiptRequiresIdentityPaperAndNetworkFreeDocument() {
        XCTAssertTrue(ReylumiReceiptPrinter.valid(job()))
        for patch: [String: Any] in [["receiptId": ""], ["paper": "bluetooth"], ["version": 2], ["kind": "paid"], ["html": "<script>print()</script>"]] {
            var value = job(); value.merge(patch) { _, new in new }; XCTAssertFalse(ReylumiReceiptPrinter.valid(value))
        }
    }
    func testProvisionalUsesLocalOperationAndScopeWithoutInventingServerReceiptID() {
        var value = job(); value["kind"] = "provisional"; value.removeValue(forKey: "receiptId"); value["operationId"] = UUID().uuidString
        value["scope"] = UUID().uuidString + ":" + UUID().uuidString
        XCTAssertTrue(ReylumiReceiptPrinter.valid(value))
        value["receiptId"] = UUID().uuidString; XCTAssertFalse(ReylumiReceiptPrinter.valid(value))
        value.removeValue(forKey: "receiptId"); value["scope"] = "other"; XCTAssertFalse(ReylumiReceiptPrinter.valid(value))
    }
    func testUTF8LimitAndActiveDocumentElementsFailClosed() {
        var value = job(); value["html"] = String(repeating: "ề", count: 400_000); XCTAssertFalse(ReylumiReceiptPrinter.valid(value))
        value = job(); value["html"] = (value["html"] as! String).replacingOccurrences(of: "Receipt</body>", with: "<img src='data:image/png;base64,x' onerror='x()'></body>")
        XCTAssertFalse(ReylumiReceiptPrinter.valid(value))
    }
}
