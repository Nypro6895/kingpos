import XCTest
import Foundation
@testable import Reylumi

private let preferenceSalon = "40000000-0000-4000-8000-000000000004"
private let preferenceSub = "10000000-0000-4000-8000-000000000001"
private let preferenceLogin = "70000000-0000-4000-8000-000000000007"
private func preferenceCookies(_ role: String, sub: String = preferenceSub, login: String = preferenceLogin, rotation: Int = 1) -> [HTTPCookie] {
    let bytes = try! JSONSerialization.data(withJSONObject: ["sub":sub,"session_id":preferenceLogin,"exp":2_000_000_000 + rotation])
    let encoded = bytes.base64EncodedString().replacingOccurrences(of:"+",with:"-").replacingOccurrences(of:"/",with:"_").replacingOccurrences(of:"=",with:"")
    return [("sb-access-token","synthetic.\(encoded).signature\(rotation)"),("kingpos-login-session-id",login),("kingpos-selected-workspace","\(role)%3A\(preferenceSalon)")].map { name,value in
        HTTPCookie(properties:[.name:name,.value:value,.domain:"reylumi.com",.path:"/",.secure:"TRUE",.expires:Date().addingTimeInterval(3600)])!
    }
}
private actor PreferenceJar {
    var values: [HTTPCookie]
    init(_ values:[HTTPCookie]) { self.values=values }
    func all() -> [HTTPCookie] { values }
    func put(_ cookie:HTTPCookie) { values.removeAll{$0.name==cookie.name&&$0.path==cookie.path};values.append(cookie) }
}
private actor PreferenceHTTP: ReylumiLocalHTTPClient {
    var denied = false
    private(set) var sawManage = false
    func deny() { denied=true }
    func send(_ request:URLRequest) async throws -> (Data,HTTPURLResponse) {
        let url=try XCTUnwrap(request.url)
        sawManage=(request.value(forHTTPHeaderField:"Cookie") ?? "").contains("kingpos-selected-workspace=manage%3A")
        let generation=try XCTUnwrap(URLComponents(url:url,resolvingAgainstBaseURL:false)?.queryItems?.first{$0.name=="generation"}?.value)
        let value = denied ? ["error":"Synthetic revoked session"] : AppLocalTestFixture.context(generation:generation,scope:"v3:"+String(repeating:"a",count:64),kind:"owner")
        return (try JSONSerialization.data(withJSONObject:value),HTTPURLResponse(url:url,statusCode:denied ? 401:200,httpVersion:nil,headerFields:["Content-Type":"application/json"])!)
    }
}

@MainActor final class WorkspacePreferenceTests: XCTestCase {
    private func directory() throws -> URL {
        let url=FileManager.default.temporaryDirectory.appendingPathComponent("workspace-preference-"+UUID().uuidString)
        try FileManager.default.createDirectory(at:url,withIntermediateDirectories:true);return url
    }
    func testAcknowledgedChoiceSurvivesCookieRollbackWithoutStoringCredentials() throws {
        let dir=try directory();defer{try? FileManager.default.removeItem(at:dir)}
        let origin=URL(string:"https://reylumi.com")!, store=ReylumiWorkspacePreference(origin:origin,directory:dir)
        let current=preferenceCookies("manage");store.saveAcknowledgedChoice(cookies:current)
        let reopened=ReylumiWorkspacePreference(origin:origin,directory:dir)
        let restored = try XCTUnwrap(reopened.choiceToRestore(cookies:preferenceCookies("staff")))
        XCTAssertEqual(restored.value,"manage%3A"+preferenceSalon)
        XCTAssertTrue(restored.isHTTPOnly);XCTAssertTrue(restored.isSecure);XCTAssertEqual(restored.path,"/")
        XCTAssertNil(reopened.choiceToRestore(cookies:current))
        let file=try XCTUnwrap(FileManager.default.contentsOfDirectory(at:dir,includingPropertiesForKeys:nil).first)
        let raw=try String(contentsOf:file,encoding:.utf8)
        XCTAssertFalse(raw.contains(current[0].value));XCTAssertFalse(raw.contains(preferenceLogin));XCTAssertFalse(raw.contains(preferenceSub));XCTAssertFalse(raw.contains("sb-access-token"))
    }
    func testTokenRotationPreservesSelectionButDifferentViewerOrLoginCannotRestoreIt() throws {
        let dir=try directory();defer{try? FileManager.default.removeItem(at:dir)}
        let store=ReylumiWorkspacePreference(origin:URL(string:"https://reylumi.com")!,directory:dir)
        store.saveAcknowledgedChoice(cookies:preferenceCookies("manage"))
        XCTAssertNotNil(store.choiceToRestore(cookies:preferenceCookies("staff",rotation:2)))
        XCTAssertNil(store.choiceToRestore(cookies:preferenceCookies("staff",sub:"10000000-0000-4000-8000-000000000009")))
        store.saveAcknowledgedChoice(cookies:preferenceCookies("manage"))
        XCTAssertNil(store.choiceToRestore(cookies:preferenceCookies("staff",login:"70000000-0000-4000-8000-000000000009")))
    }
    func testMissingAmbiguousExpiredAndCorruptBindingsFailClosed() throws {
        let dir=try directory();defer{try? FileManager.default.removeItem(at:dir)}
        let store=ReylumiWorkspacePreference(origin:URL(string:"https://reylumi.com")!,directory:dir)
        let source=preferenceCookies("manage")
        for jar in [Array(source.dropFirst()),Array(source.dropLast(2)),source+preferenceCookies("staff",sub:"10000000-0000-4000-8000-000000000009")] {
            store.saveAcknowledgedChoice(cookies:source);XCTAssertNil(store.choiceToRestore(cookies:jar))
        }
        store.saveAcknowledgedChoice(cookies:source);XCTAssertNil(store.choiceToRestore(cookies:preferenceCookies("staff"),now:Date().addingTimeInterval(7200)))
        store.saveAcknowledgedChoice(cookies:source)
        let file=try XCTUnwrap(FileManager.default.contentsOfDirectory(at:dir,includingPropertiesForKeys:nil).first)
        try Data("corrupt".utf8).write(to:file);XCTAssertNil(store.choiceToRestore(cookies:preferenceCookies("staff")))
    }
    func testServerFallbackOrExplicitResetClearsSelectionAndNeverPersistsInvalidWorkspace() throws {
        let dir=try directory();defer{try? FileManager.default.removeItem(at:dir)}
        let store=ReylumiWorkspacePreference(origin:URL(string:"https://reylumi.com")!,directory:dir)
        store.saveAcknowledgedChoice(cookies:preferenceCookies("manage"));store.reconcileRoot(workspaceId:"staff:"+preferenceSalon)
        XCTAssertNil(store.choiceToRestore(cookies:preferenceCookies("staff")))
        store.saveAcknowledgedChoice(cookies:preferenceCookies("invalid"));XCTAssertNil(store.choiceToRestore(cookies:preferenceCookies("staff")))
        store.saveAcknowledgedChoice(cookies:preferenceCookies("manage"));store.clear();XCTAssertNil(store.choiceToRestore(cookies:preferenceCookies("staff")))
    }
    func testRestoreChangesOnlySelectorAndStillRequiresFreshHTTPSContext() async throws {
        let dir=try directory();defer{try? FileManager.default.removeItem(at:dir)}
        let origin=URL(string:"https://reylumi.com")!, bundle=try ReylumiLocalBundle.installed()
        let preference=ReylumiWorkspacePreference(origin:origin,directory:dir.appendingPathComponent("preference"))
        preference.saveAcknowledgedChoice(cookies:preferenceCookies("manage"))
        let old=preferenceCookies("staff"),jar=PreferenceJar(old),http=PreferenceHTTP()
        let store=ReylumiLocalReadStore(origin:origin,directory:dir.appendingPathComponent("reads"),service:UUID().uuidString)
        let transport=ReylumiLocalAppTransport(origin:origin,manifest:bundle.manifest,store:store,client:http,defaults:UserDefaults(suiteName:UUID().uuidString)!,cookies:{await jar.all()},setCookie:{await jar.put($0)},workspacePreference:preference)
        _=try await transport.freshContext(path:"/staff/today")
        let sawManage=await http.sawManage, now=await jar.all()
        XCTAssertTrue(sawManage);XCTAssertEqual(now.first{$0.name=="sb-access-token"}?.value,old.first{$0.name=="sb-access-token"}?.value)
        await transport.reset();XCTAssertNil(preference.choiceToRestore(cookies:old))
    }
    func testRestoredSelectionCannotBypassServerSessionDenial() async throws {
        let dir=try directory();defer{try? FileManager.default.removeItem(at:dir)}
        let origin=URL(string:"https://reylumi.com")!,bundle=try ReylumiLocalBundle.installed(),preference=ReylumiWorkspacePreference(origin:origin,directory:dir.appendingPathComponent("preference"))
        preference.saveAcknowledgedChoice(cookies:preferenceCookies("manage"))
        let jar=PreferenceJar(preferenceCookies("staff")),http=PreferenceHTTP();await http.deny()
        let store=ReylumiLocalReadStore(origin:origin,directory:dir.appendingPathComponent("reads"),service:UUID().uuidString)
        let transport=ReylumiLocalAppTransport(origin:origin,manifest:bundle.manifest,store:store,client:http,defaults:UserDefaults(suiteName:UUID().uuidString)!,cookies:{await jar.all()},setCookie:{await jar.put($0)},workspacePreference:preference)
        do{_=try await transport.freshContext(path:"/");XCTFail("A UI selection cannot grant authentication")}catch{XCTAssertEqual((error as NSError).code,401)}
        XCTAssertNil(preference.choiceToRestore(cookies:preferenceCookies("staff")))
        let lease=await store.session(generation:transport.generation);XCTAssertNil(lease)
    }
}
