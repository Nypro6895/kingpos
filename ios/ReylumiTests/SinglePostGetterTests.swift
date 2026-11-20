import XCTest
import Foundation
@testable import Reylumi

private actor GetterAdmissionHTTP: ReylumiLocalHTTPClient {
    private var advertise = true, timeout = false, hold = false
    private var status = 200
    private var held: CheckedContinuation<(Data, HTTPURLResponse), Error>?
    private var heldRequest: URLRequest?
    private(set) var contexts = 0, commands = 0
    func configure(advertise: Bool = true, status: Int = 200, timeout: Bool = false, hold: Bool = false) {
        self.advertise = advertise; self.status = status; self.timeout = timeout; self.hold = hold
    }
    func isHeld() -> Bool { held != nil }
    private func reply(_ request: URLRequest, value: [String:Any], status: Int = 200) throws -> (Data, HTTPURLResponse) {
        (try JSONSerialization.data(withJSONObject:value), HTTPURLResponse(url:request.url!,statusCode:status,httpVersion:nil,headerFields:["Content-Type":"application/json"])!)
    }
    func release() throws {
        guard let continuation = held, let request = heldRequest else { return }
        held = nil; heldRequest = nil
        continuation.resume(returning:try reply(request,value:["ok":true,"data":["value":["sameSettings":true]]]))
    }
    func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        if request.url?.path == "/api/app-local/context" {
            contexts += 1
            let query = URLComponents(url:request.url!,resolvingAgainstBaseURL:false)?.queryItems ?? []
            let generation = try XCTUnwrap(query.first { $0.name == "generation" }?.value)
            var value = AppLocalTestFixture.context(generation:generation)
            if advertise { value["getterAdmissionVersion"] = 1 }
            return try reply(request,value:value)
        }
        guard request.url?.path == "/api/app-local/command", request.httpMethod == "POST" else { throw URLError(.unsupportedURL) }
        commands += 1
        let body = try XCTUnwrap(JSONSerialization.jsonObject(with:request.httpBody ?? Data()) as? [String:Any])
        XCTAssertEqual(body["scope"] as? String,AppLocalTestFixture.scope)
        if timeout { throw URLError(.timedOut) }
        if hold { return try await withCheckedThrowingContinuation { held = $0; heldRequest = request } }
        return try reply(request,value:status == 200 ? ["ok":true,"data":["value":["sameSettings":true]]] : ["ok":false],status:status)
    }
}

@MainActor
final class SinglePostGetterTests: XCTestCase {
    private let getters = ["action.efc196d40c1355cb97795327","action.d14797e33bdffa7d9940f9f4","action.71559420db869529e30eabcb"]
    private struct Fixture {
        let transport: ReylumiLocalAppTransport
        let http: GetterAdmissionHTTP
        let directory: URL
    }
    private func fixture(advertise: Bool = true, admit: Bool = true) async throws -> Fixture {
        let bundle = try ReylumiLocalBundle.installed(), origin = URL(string:"https://reylumi.com")!
        let id = "reylumi.tests.single-getter." + UUID().uuidString
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(id,isDirectory:true)
        try FileManager.default.createDirectory(at:directory,withIntermediateDirectories:true)
        let http = GetterAdmissionHTTP(); await http.configure(advertise:advertise)
        let store = ReylumiLocalReadStore(origin:origin,directory:directory,service:id)
        let transport = ReylumiLocalAppTransport(origin:origin,manifest:bundle.manifest,store:store,client:http,defaults:UserDefaults(suiteName:id)!,cookies:{ [] },setCookie:{ _ in })
        if admit { _ = try await transport.freshContext(path:"/settings") }
        return Fixture(transport:transport,http:http,directory:directory)
    }
    private func read(_ f: Fixture, name: String, scope: String = AppLocalTestFixture.scope) async throws -> [String:Any] {
        try await f.transport.command(name:name,args:["values":[]],requestID:UUID().uuidString,path:"/settings",requestedScope:scope)
    }
    func testThreeAuditedGettersUseOnePOSTAfterNegotiatedAdmission() async throws {
        for name in getters {
            let f = try await fixture(); defer { try? FileManager.default.removeItem(at:f.directory) }
            let result = try await read(f,name:name); XCTAssertEqual(result["ok"] as? Bool,true)
            let contexts = await f.http.contexts, commands = await f.http.commands
            XCTAssertEqual(contexts,1); XCTAssertEqual(commands,1)
            await f.transport.reset()
        }
    }
    func testOldServerRetainsFreshPreflight() async throws {
        let f = try await fixture(advertise:false); defer { try? FileManager.default.removeItem(at:f.directory) }
        _ = try await read(f,name:getters[0])
        let contexts = await f.http.contexts; XCTAssertEqual(contexts,2)
        await f.transport.reset()
    }
    func testSaveStillPerformsFreshPreflight() async throws {
        let f = try await fixture(); defer { try? FileManager.default.removeItem(at:f.directory) }
        let bundle = try ReylumiLocalBundle.installed()
        let save = try XCTUnwrap(bundle.manifest.commands.first { $0.name == "action.c6936e7df92440098868ffc8" })
        _ = try await read(f,name:save.name)
        let contexts = await f.http.contexts; XCTAssertEqual(contexts,2)
        await f.transport.reset()
    }
    func testWrongDisplayedScopeCannotPost() async throws {
        let f = try await fixture(); defer { try? FileManager.default.removeItem(at:f.directory) }
        do { _ = try await read(f,name:getters[0],scope:"v3:"+String(repeating:"b",count:64)); XCTFail("Wrong scope returned data") }
        catch { XCTAssertEqual((error as NSError).code,409) }
        let commands = await f.http.commands; XCTAssertEqual(commands,0)
        await f.transport.reset()
    }
    func testFreshServerDenialNeverReturnsSettings() async throws {
        for status in [401,403,409] {
            let f = try await fixture(); defer { try? FileManager.default.removeItem(at:f.directory) }
            await f.http.configure(status:status)
            do { _ = try await read(f,name:getters[0]); XCTFail("Server denial returned data") }
            catch { XCTAssertEqual((error as NSError).code,status) }
            let commands = await f.http.commands; XCTAssertEqual(commands,1)
            await f.transport.reset()
        }
    }
    func testNetworkFailureIsNotRetried() async throws {
        let f = try await fixture(); defer { try? FileManager.default.removeItem(at:f.directory) }
        await f.http.configure(timeout:true)
        do { _ = try await read(f,name:getters[0]); XCTFail("Timeout returned data") } catch {}
        let commands = await f.http.commands; XCTAssertEqual(commands,1)
        await f.transport.reset()
    }
    func testResetDiscardsHeldReply() async throws {
        let f = try await fixture(); defer { try? FileManager.default.removeItem(at:f.directory) }
        await f.http.configure(hold:true)
        let pending = Task { @MainActor in try await self.read(f,name:self.getters[0]) }
        for _ in 0..<200 { if await f.http.isHeld() { break }; try await Task.sleep(nanoseconds:10_000_000) }
        let held = await f.http.isHeld(); XCTAssertTrue(held)
        await f.transport.reset(); try await f.http.release()
        do { _ = try await pending.value; XCTFail("Old account reply survived reset") } catch {}
    }
    func testWithoutOnlineNegotiationPreflightIsRequired() async throws {
        let f = try await fixture(admit:false); defer { try? FileManager.default.removeItem(at:f.directory) }
        _ = try await read(f,name:getters[0])
        let contexts = await f.http.contexts, commands = await f.http.commands
        XCTAssertEqual(contexts,1); XCTAssertEqual(commands,1)
        await f.transport.reset()
    }
}
