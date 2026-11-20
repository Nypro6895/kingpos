import XCTest
import Foundation
@testable import Reylumi

private actor CampaignReadHTTP: ReylumiLocalHTTPClient {
    private var last: URLRequest?
    func captured() -> URLRequest? { last }
    func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        guard request.url?.path == "/api/app-local/read" else { throw URLError(.unsupportedURL) }
        last = request
        let object: [String: Any] = ["schemaVersion":1,"status":200,"scope":AppLocalTestFixture.scope,"updatedAt":Date().timeIntervalSince1970 * 1000,"data":["status":200,"headers":["content-type":"application/json"],"body":"[]"]]
        return (try JSONSerialization.data(withJSONObject:object), HTTPURLResponse(url:request.url!,statusCode:200,httpVersion:nil,headerFields:["Content-Type":"application/json"])!)
    }
}

@MainActor
final class CampaignReadTransportTests: XCTestCase {
    func testCampaignCoordinatesUsePrivateReadBodyAndNeverEnterURLOrReadCache() async throws {
        let (_,directory) = try AppLocalTestFixture.bundle()
        defer { try? FileManager.default.removeItem(at:directory) }
        let file = directory.appendingPathComponent("manifest.json")
        var value = try XCTUnwrap(JSONSerialization.jsonObject(with:Data(contentsOf:file)) as? [String:Any])
        var reads = try XCTUnwrap(value["reads"] as? [[String:Any]])
        reads.append(["name":"http.shell.campaigns","path":"/api/app-local/read","argumentKeys":["location","latitude","longitude","batch"],"access":"public","cacheable":false])
        value["reads"] = reads
        try JSONSerialization.data(withJSONObject:value).write(to:file)
        let bundle = try ReylumiLocalBundle(directory:directory), origin = URL(string:"https://reylumi.com")!
        let id = "reylumi.tests.campaign-read." + UUID().uuidString, http = CampaignReadHTTP()
        let store = ReylumiLocalReadStore(origin:origin,directory:directory,service:id)
        let transport = ReylumiLocalAppTransport(origin:origin,manifest:bundle.manifest,store:store,client:http,defaults:UserDefaults(suiteName:id)!)
        let args: [String:Any] = ["location":"Milwaukee, WI, US","latitude":"43.1","longitude":"-87.98","batch":"1"]
        _ = try await transport.read(name:"http.shell.campaigns",args:args,etag:nil,requestedScope:AppLocalTestFixture.scope)
        let captured = await http.captured(), request = try XCTUnwrap(captured)
        XCTAssertEqual(request.httpMethod,"POST")
        XCTAssertNil(request.url?.query)
        XCTAssertEqual(request.value(forHTTPHeaderField:"Origin"),"https://reylumi.com")
        let body = try XCTUnwrap(JSONSerialization.jsonObject(with:try XCTUnwrap(request.httpBody)) as? [String:Any])
        XCTAssertEqual(body["name"] as? String,"http.shell.campaigns")
        XCTAssertEqual((body["args"] as? [String:String])?["latitude"],"43.1")
        let cached = try await transport.cached(name:"http.shell.campaigns",args:args,requestedScope:AppLocalTestFixture.scope)
        XCTAssertNil(cached)
        await transport.reset()
    }
}
