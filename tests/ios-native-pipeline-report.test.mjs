import test from "node:test";
import assert from "node:assert/strict";
import { acceptanceBindingSha256, createAcceptanceReport } from "../scripts/ios/acceptance-report.mjs";

function input(native) {
  const metadata = { sourceCommit: "a".repeat(40), bundleBuildId: "b".repeat(64), buildArtifactSha256: "c".repeat(64), principalAlias: "principal-a", deviceAlias: "device-a", deviceKind: "simulator", networkProfile: "simulator-unconditioned", scenario: "cold", roles: ["owner"] };
  const bindingSha256 = acceptanceBindingSha256(metadata), proofSha256 = "d".repeat(64);
  return {
    schemaVersion: 1, metadata,
    window: { bindingSha256, proofSha256, start: { clock: "qa", ms: 0 }, end: { clock: "qa", ms: 1000 } },
    legs: [{ start: { clock: "qa", ms: 0 } }],
    diagnostics: { schemaVersion: 1, bundleBuild: metadata.bundleBuildId, native, javascript: [] },
    coverage: { native: { bindingSha256, proofSha256, windowProofSha256: proofSha256, complete: true, afterSequence: 0, throughSequence: native.length } },
  };
}

test("native cookie and persistence waits remain separate from HTTP and cannot certify rendering", () => {
  const names = ["cookieCapture", "httpStart", "httpEnd", "cookieReconcile", "cachePersist", "readDelivered"];
  const native = names.map((event, index) => ({ sequence: index + 1, event, category: "read", durationMs: index + 1, cookie: "private-secret", scope: "private-secret", requestId: "private-secret" }));
  const report = createAcceptanceReport(input(native));
  assert.equal(report.requestCounts.nativeHttp.status, "MEASURED");
  assert.equal(report.requestCounts.nativeHttp.started, 1);
  assert.equal(report.requestCounts.nativeHttp.completed, 1);
  assert.deepEqual(report.spans.native.samples.map(row => row.kind), ["cookieCapture", "httpEnd", "cookieReconcile", "cachePersist"]);
  assert.equal(report.spans.combinedTotal.status, "UNMEASURED");
  assert.equal(report.spans.render.status, "UNMEASURED");
  assert.equal(report.functionalEvidence, "UNMEASURED");
  assert.equal(report.performanceAcceptance.status, "UNMEASURED");
  assert.equal(JSON.stringify(report).includes("private-secret"), false);
});

test("new native stages still require coverage and bounded durations", () => {
  const native = [
    { sequence: 1, event: "cookieCapture", category: "read", durationMs: Infinity },
    { sequence: 2, event: "cookieReconcile", category: "read", durationMs: -1 },
    { sequence: 3, event: "cachePersist", category: "private-secret", durationMs: 1 },
  ];
  let value = input(native), report = createAcceptanceReport(value);
  assert.equal(report.requestCounts.nativeHttp.status, "MEASURED");
  assert.equal(report.spans.native.status, "UNMEASURED");
  value = input([{ sequence: 1, event: "cookieReconcile", category: "read", durationMs: 1 }]);
  value.coverage.native.complete = false;
  report = createAcceptanceReport(value);
  assert.equal(report.spans.native.status, "UNMEASURED");
  assert.equal(report.requestCounts.nativeHttp.status, "UNMEASURED");
});
