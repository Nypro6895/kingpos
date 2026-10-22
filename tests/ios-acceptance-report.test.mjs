import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { acceptanceBindingSha256, createAcceptanceReport } from "../scripts/ios/acceptance-report.mjs";

const H = "a".repeat(64), BUILD = "b".repeat(64);
function fixture(scenario = "cold") {
  const roles = scenario === "role-a-b-a" ? ["staff", "owner", "staff"] : scenario === "warm" ? ["staff", "staff", "staff"] : ["staff"];
  const metadata = { sourceCommit: "1".repeat(40), bundleBuildId: BUILD, buildArtifactSha256: "c".repeat(64),
    principalAlias: "principal-a", deviceAlias: "device-a", deviceKind: "simulator", networkProfile: "simulator-unconditioned", scenario, roles };
  const bindingSha256 = acceptanceBindingSha256(metadata);
  const proof = { bindingSha256, proofSha256: H };
  const starts = roles.map((_, leg) => 100 + leg * 1000);
  const witnesses = roles.flatMap((role, leg) => [
    { ...proof, kind: "correct-usable", leg, role, at: { clock: "qa", ms: starts[leg] + 200 }, currentAuthorityVerified: true, scopeGenerationVerified: true, bodyVerified: true, noBlockingError: true, firstCorrectVerified: true },
    { ...proof, kind: "fresh-data-ready", leg, role, at: { clock: "qa", ms: starts[leg] + 600 }, currentAuthorityVerified: true, scopeGenerationVerified: true, bodyVerified: true, noBlockingError: true, namedDataVerified: true, freshness: "fresh-200" },
  ]);
  const native = [
    { sequence: 1, elapsedMs: 100, event: "httpStart", category: "read" },
    { sequence: 2, elapsedMs: 200, event: "serverTiming", category: "read", stage: "auth", durationMs: 60 },
    { sequence: 3, elapsedMs: 200, event: "httpEnd", category: "read", status: 200, durationMs: 100 },
  ];
  const javascript = [
    { sequence: 1, atMs: 50, event: "boot.ready" },
    { sequence: 2, atMs: 100, event: "cache.read.start" },
    { sequence: 3, atMs: 110, event: "cache.restore.end", durationMs: 30 },
    { sequence: 4, atMs: 130, event: "context.read.start" },
    { sequence: 5, atMs: 160, event: "data.visible", phase: "full" },
    { sequence: 6, atMs: 200, event: "context.accept", contextReason: "lease-valid", offline: false },
  ];
  return { schemaVersion: 1, metadata, window: { ...proof, start: { clock: "qa", ms: 100 }, end: { clock: "qa", ms: starts.at(-1) + 900 } },
    legs: starts.map(ms => ({ start: { clock: "qa", ms } })), witnesses,
    environmentWitness: { ...proof, deviceKind: "simulator", networkProfile: "simulator-unconditioned", actualDeviceVerified: true, networkProfileVerified: true },
    executionWitness: { ...proof, integratedCandidateVerified: true, realBackendTransportVerified: true, actualAuthenticatedSessionVerified: true },
    diagnostics: { schemaVersion: 1, bundleBuild: BUILD, native, javascript },
    http: { requests: [{ requestSequence: 1, kind: "staff.my-work", forwarded: true, outcome: "http-response", status: 200,
      serverTimingNumeric: { auth: { dur: 60 }, load: { dur: 100 }, backend_rest: { dur: 180, calls: 2 } } }] },
    coverage: { native: { ...proof, windowProofSha256: H, complete: true, afterSequence: 0, throughSequence: 3 }, javascript: { ...proof, windowProofSha256: H, complete: true, afterSequence: 0, throughSequence: 6 }, responses: { ...proof, windowProofSha256: H, complete: true, afterSequence: 0, throughSequence: 1 } } };
}

test("separate QA witnesses measure correct usable and later fresh data without adding overlapping spans", () => {
  const report = createAcceptanceReport(fixture());
  assert.equal(report.functionalEvidence, "RECORDED_REQUIRES_EXTERNAL_REVIEW");
  assert.equal(report.legs[0].correctUsable.elapsedMs, 200);
  assert.equal(report.legs[0].freshDataReady.elapsedMs, 600);
  assert.equal(report.spans.combinedTotal.status, "UNMEASURED");
  assert.equal(report.spans.render.status, "UNMEASURED");
  assert.equal(report.performanceAcceptance.status, "UNMEASURED");
});

test("boot ready/data visible/HTTP200/latest JS accept cannot manufacture either witness", () => {
  const input = fixture(); input.witnesses = [];
  const report = createAcceptanceReport(input);
  assert.equal(report.functionalEvidence, "UNMEASURED");
  assert.equal(report.legs[0].correctUsable.reason, "MISSING_QA_WITNESS");
  assert.equal(report.legs[0].freshDataReady.reason, "MISSING_QA_WITNESS");
});

test("warm authorized retained body can be usable while fresh data remains unmeasured", () => {
  const input = fixture("warm");
  input.witnesses = input.witnesses.filter(row => row.kind === "correct-usable");
  const report = createAcceptanceReport(input);
  assert.ok(report.legs.every(leg => leg.correctUsable.status === "MEASURED"));
  assert.ok(report.legs.every(leg => leg.freshDataReady.status === "UNMEASURED"));
  assert.equal(report.functionalEvidence, "UNMEASURED");
});

test("retained-only freshness is not accepted as fresh data;304 validation is labeled rather than new commit", () => {
  const input = fixture(); input.witnesses[1].freshness = "retained-authorized";
  assert.equal(createAcceptanceReport(input).legs[0].freshDataReady.reason, "FRESH_DATA_NOT_VERIFIED");
  input.witnesses[1].freshness = "revalidated-304";
  assert.equal(createAcceptanceReport(input).legs[0].freshDataReady.reason, "RETAINED_BODY_VALIDATION_UNPROVEN");
  input.witnesses[1].retainedBodyValidationVerified = true;
  assert.equal(createAcceptanceReport(input).legs[0].freshDataReady.freshness, "revalidated-304");
});

test("wrong authority is NOT_MET; missing current tuple proof stays UNMEASURED", () => {
  const input = fixture(); input.witnesses[0].role = "owner";
  assert.equal(createAcceptanceReport(input).functionalEvidence, "NOT_MET");
  input.witnesses[0].role = "staff"; delete input.witnesses[0].scopeGenerationVerified;
  assert.equal(createAcceptanceReport(input).legs[0].correctUsable.reason, "AUTHORITY_WITNESS_INCOMPLETE");
  input.witnesses[0].scopeGenerationVerified = false;
  assert.equal(createAcceptanceReport(input).legs[0].correctUsable.status, "NOT_MET");
});

test("a witness from another fixed source/build/account/device/network binding cannot be borrowed", () => {
  for (const key of ["sourceCommit", "bundleBuildId", "buildArtifactSha256", "principalAlias", "deviceAlias", "networkProfile"]) {
    const input = fixture();
    const replacements = { sourceCommit: "2".repeat(40), bundleBuildId: "d".repeat(64), buildArtifactSha256: "e".repeat(64), principalAlias: "principal-b", deviceAlias: "device-b", networkProfile: "nlc-3g" };
    input.metadata[key] = replacements[key];
    assert.equal(createAcceptanceReport(input).legs[0].correctUsable.reason, "WITNESS_BINDING_OR_PROOF_MISSING", key);
  }
});

test("native/JS witness timestamps need explicit bound clock alignment; no cross-clock subtraction", () => {
  const input = fixture(); input.witnesses[0].at = { clock: "native", ms: 200 };
  assert.equal(createAcceptanceReport(input).legs[0].correctUsable.reason, "CLOCK_ALIGNMENT_OR_TIMESTAMP_MISSING");
  input.clockAlignment = { native: { bindingSha256: acceptanceBindingSha256(input.metadata), proofSha256: H, offsetToQaMs: 100 } };
  assert.equal(createAcceptanceReport(input).legs[0].correctUsable.elapsedMs, 200);
  input.clockAlignment.native.bindingSha256 = "f".repeat(64);
  assert.equal(createAcceptanceReport(input).legs[0].correctUsable.status, "UNMEASURED");
});

test("missing window evidence and witnesses outside their leg are not successful timings", () => {
  const input = fixture(); delete input.window.proofSha256;
  assert.equal(createAcceptanceReport(input).legs[0].correctUsable.reason, "WINDOW_PROOF_MISSING");
  const journey = fixture("role-a-b-a"); journey.witnesses[0].at.ms = 1200;
  assert.equal(createAcceptanceReport(journey).legs[0].correctUsable.reason, "WITNESS_OUTSIDE_LEG_WINDOW");
});

test("A-B-A requires independently witnessed correct and fresh bodies for every actual leg", () => {
  const input = fixture("role-a-b-a");
  assert.equal(createAcceptanceReport(input).legs.length, 3);
  assert.equal(createAcceptanceReport(input).functionalEvidence, "RECORDED_REQUIRES_EXTERNAL_REVIEW");
  input.witnesses = input.witnesses.filter(row => row.leg !== 1);
  assert.equal(createAcceptanceReport(input).functionalEvidence, "UNMEASURED");
});

test("native HTTP, JS logical starts and backend caller counters are separate without addition/deduplication", () => {
  const report = createAcceptanceReport(fixture());
  assert.equal(report.requestCounts.nativeHttp.started, 1);
  assert.equal(report.requestCounts.nativeHttp.completed, 1);
  assert.equal(report.requestCounts.clientLogical.contextReadsStarted, 1);
  assert.equal(report.requestCounts.clientLogical.resourceReadsStarted, 1);
  assert.deepEqual(report.requestCounts.backendLogical.perResponse[0].counters, { backend_rest: 2 });
  assert.equal(report.requestCounts.backendLogical.globalTotal.status, "UNMEASURED");
  assert.equal(report.requestCounts.totalAcrossLayers.status, "UNMEASURED");
});

test("missing count coverage never becomes zero; proven empty windows can record zero", () => {
  const input = fixture(); delete input.coverage;
  const missing = createAcceptanceReport(input);
  assert.equal(missing.requestCounts.nativeHttp.status, "UNMEASURED");
  assert.equal(Object.hasOwn(missing.requestCounts.nativeHttp, "started"), false);
  input.coverage = { native: { bindingSha256: acceptanceBindingSha256(input.metadata), proofSha256: H, windowProofSha256: H, complete: true, afterSequence: 3, throughSequence: 3 } };
  assert.equal(createAcceptanceReport(input).requestCounts.nativeHttp.started, 0);
});

test("capped rings, duplicate sequences, incomplete windows and wrong bundle are explicit unmeasured counts", () => {
  for (const mutate of [input => input.diagnostics.native.shift(), input => input.diagnostics.native.push(input.diagnostics.native[0]), input => input.coverage.native.complete = false, input => input.diagnostics.bundleBuild = "d".repeat(64)]) {
    const input = fixture(); mutate(input);
    assert.equal(createAcceptanceReport(input).requestCounts.nativeHttp.status, "UNMEASURED");
  }
});

test("backend counters absent from actual response are unmeasured, not zero calls", () => {
  const input = fixture(); delete input.http.requests[0].serverTimingNumeric.backend_rest;
  assert.equal(createAcceptanceReport(input).requestCounts.backendLogical.reason, "BACKEND_COUNTERS_NOT_EXPORTED");
  input.http.requests[0].serverTimingNumeric.backend_rest = { calls: 1_000_000_001 };
  assert.equal(createAcceptanceReport(input).requestCounts.backendLogical.reason, "BACKEND_COUNTERS_NOT_EXPORTED");
});

test("native backend caller counters are reported as samples without summing a duplicate QA view", () => {
  const input = fixture(); Object.assign(input.diagnostics.native[1], { stage: "backend_rest", backendCalls: 2, responseBytes: 300, sizedResponses: 1 });
  const counts = createAcceptanceReport(input).requestCounts.backendLogical;
  assert.equal(counts.status, "MEASURED");
  assert.deepEqual(counts.nativeSamples, [{ sequence: 2, stage: "backend_rest", calls: 2, responseBytes: 300, sizedResponses: 1 }]);
  assert.deepEqual(counts.perResponse[0].counters, { backend_rest: 2 });
  assert.equal(counts.globalTotal.status, "UNMEASURED");
  delete input.coverage.responses;
  const nativeOnly = createAcceptanceReport(input).requestCounts.backendLogical;
  assert.equal(nativeOnly.status, "MEASURED");
  assert.equal(nativeOnly.responseCoverage, "UNMEASURED");
  assert.equal(nativeOnly.nativeCoverage, "PROVEN");
});

test("native backend counters require fixed stage/window and bounded integers; bytes alone are not calls", () => {
  for (const fields of [{ stage: "auth", backendCalls: 2 }, { stage: "backend_rest", backendCalls: true },
    { stage: "backend_rest", backendCalls: 1_000_000_001 }, { stage: "backend_rest", responseBytes: 300 }]) {
    const input = fixture(); delete input.http.requests[0].serverTimingNumeric.backend_rest;
    Object.assign(input.diagnostics.native[1], fields);
    assert.equal(createAcceptanceReport(input).requestCounts.backendLogical.status, "UNMEASURED");
  }
  const input = fixture(); delete input.http.requests[0].serverTimingNumeric.backend_rest;
  Object.assign(input.diagnostics.native[1], { stage: "backend_rpc", backendCalls: 0, responseBytes: Infinity, sizedResponses: -1 });
  assert.deepEqual(createAcceptanceReport(input).requestCounts.backendLogical.nativeSamples, [{ sequence: 2, stage: "backend_rpc", calls: 0 }]);
  delete input.coverage.native;
  assert.equal(createAcceptanceReport(input).requestCounts.backendLogical.status, "UNMEASURED");
});

test("physical or conditioned declarations alone never certify a physical/network measurement", () => {
  const input = fixture(); delete input.environmentWitness;
  input.metadata.deviceKind = "physical"; input.metadata.networkProfile = "nlc-4g";
  const report = createAcceptanceReport(input);
  assert.equal(report.environment.status, "UNMEASURED");
  assert.equal(report.environment.declaredDeviceKind, "physical");
  assert.equal(report.functionalEvidence, "UNMEASURED");
});

test("cold/background/restart use distinct metadata bindings; none implies Remember retention or an app action", () => {
  const bindings = new Set();
  for (const scenario of ["cold", "background", "restart"]) {
    const input = fixture(scenario); bindings.add(acceptanceBindingSha256(input.metadata));
    const report = createAcceptanceReport(input);
    assert.equal(report.metadata.scenario, scenario);
    assert.equal(Object.hasOwn(report, "rememberMe"), false);
    assert.match(report.limits[0], /never.*test execution/);
  }
  assert.equal(bindings.size, 3);
});

test("duplicate witnesses are ambiguous rather than choosing an arbitrary favorable record", () => {
  const input = fixture(); input.witnesses.push({ ...input.witnesses[0] });
  assert.equal(createAcceptanceReport(input).legs[0].correctUsable.reason, "AMBIGUOUS_QA_WITNESS");
});

test("unknown metadata/PII aliases are rejected while raw diagnostic/DTO/header fields never escape", () => {
  const input = fixture();
  input.diagnostics.native[0].viewerId = "PRIVATE_PERSON";
  input.diagnostics.native[0].requestId = "PRIVATE_REQUEST";
  input.diagnostics.javascript[0].label = "PRIVATE_EMAIL@example.invalid";
  input.http.requests[0].url = "https://example.invalid/PRIVATE_QUERY";
  input.http.requests[0].headers = { cookie: "PRIVATE_COOKIE" };
  input.http.requests[0].data = { password: "PRIVATE_PASSWORD" };
  input.http.requests[0].serverTimingNumeric["PRIVATE_STAGE"] = { dur: 11 };
  input.witnesses[0].rawLabel = "PRIVATE_LABEL";
  const text = JSON.stringify(createAcceptanceReport(input));
  assert.doesNotMatch(text, /PRIVATE_|example\.invalid|"requestId"|"cookie"|"password"|"rawLabel"/);
  input.metadata.userId = "PRIVATE_PERSON";
  assert.throws(() => createAcceptanceReport(input), /^Error: INVALID_METADATA$/);
});

test("invalid aliases, role sequences, booleans masquerading as timestamps and nonfinite spans fail closed", () => {
  const input = fixture(); input.metadata.principalAlias = "real-person-name";
  assert.throws(() => createAcceptanceReport(input), /INVALID_NONPERSONAL_ALIAS/);
  const wrong = fixture("role-a-b-a"); wrong.metadata.roles = ["staff", "owner", "owner"];
  assert.throws(() => createAcceptanceReport(wrong), /INVALID_ROLE_SEQUENCE/);
  const numbers = fixture(); numbers.witnesses[0].at.ms = true; numbers.diagnostics.native[2].durationMs = Infinity;
  const report = createAcceptanceReport(numbers);
  assert.equal(report.legs[0].correctUsable.status, "UNMEASURED");
  assert.equal(report.spans.native.samples.some(row => row.durationMs === Infinity), false);
});

test("missing environment verification, timing samples and unknown trace events never produce measured zero/pass", () => {
  const input = fixture(); delete input.environmentWitness;
  assert.equal(createAcceptanceReport(input).functionalEvidence, "UNMEASURED");
  for (const row of input.diagnostics.native) delete row.durationMs;
  assert.equal(createAcceptanceReport(input).spans.native.reason, "TIMING_SAMPLES_NOT_EXPORTED");
  input.diagnostics.native[0].event = "unrecognized-future-request";
  assert.equal(createAcceptanceReport(input).requestCounts.nativeHttp.reason, "UNRECOGNIZED_TRACE_EVENT");
});

test("hashes and aliases require strings rather than coercible arrays", () => {
  const input = fixture(); input.witnesses[0].proofSha256 = [H];
  assert.equal(createAcceptanceReport(input).legs[0].correctUsable.reason, "WITNESS_BINDING_OR_PROOF_MISSING");
  input.metadata.sourceCommit = [input.metadata.sourceCommit];
  assert.throws(() => createAcceptanceReport(input), /INVALID_BUILD_BINDING/);
  const alias = fixture(); alias.metadata.deviceAlias = ["device-a"];
  assert.throws(() => createAcceptanceReport(alias), /INVALID_NONPERSONAL_ALIAS/);
});

test("first correct usable requires a first-event witness rather than any later body sample", () => {
  const input = fixture(); delete input.witnesses[0].firstCorrectVerified;
  assert.equal(createAcceptanceReport(input).legs[0].correctUsable.reason, "FIRST_CORRECT_WITNESS_NOT_VERIFIED");
  input.witnesses[0].firstCorrectVerified = false;
  assert.equal(createAcceptanceReport(input).functionalEvidence, "UNMEASURED");
});

test("recorded functional evidence requires the real session/backend and exact integrated candidate witness", () => {
  for (const field of ["actualAuthenticatedSessionVerified", "realBackendTransportVerified", "integratedCandidateVerified"]) {
    const input = fixture(); delete input.executionWitness[field];
    const report = createAcceptanceReport(input);
    assert.equal(report.functionalEvidence, "UNMEASURED", field);
    assert.equal(report.execution.reason, "INTEGRATED_CANDIDATE_REAL_SESSION_OR_BACKEND_UNVERIFIED", field);
  }
  const input = fixture(); delete input.executionWitness;
  assert.equal(createAcceptanceReport(input).execution.status, "UNMEASURED");
});

test("guest evidence does not certify authenticated acceptance and physical runs remain optional follow-up", () => {
  const input = fixture(); input.metadata.roles = ["guest"]; input.metadata.principalAlias = "guest";
  const binding = acceptanceBindingSha256(input.metadata);
  for (const row of [input.window, input.environmentWitness, input.executionWitness, ...input.witnesses, ...Object.values(input.coverage)]) row.bindingSha256 = binding;
  for (const row of input.witnesses) row.role = "guest";
  assert.equal(createAcceptanceReport(input).execution.status, "UNMEASURED");
  input.executionWitness.originalGuestFlowVerified = true;
  const report = createAcceptanceReport(input);
  assert.equal(report.execution.sessionKind, "guest");
  assert.equal(report.acceptancePolicy.requiredBeforeDeploy, "AUTHENTICATED_SIMULATOR_INTEGRATED_CANDIDATE");
  assert.equal(report.acceptancePolicy.physicalIPhone, "OPTIONAL_AFTER_DEPLOY_NOT_A_RELEASE_BLOCKER");
  assert.equal(report.acceptancePolicy.deploymentAuthorized, false);
  assert.equal(report.acceptancePolicy.releaseGate.status, "UNMEASURED");
  input.metadata.deviceKind = "physical"; input.metadata.networkProfile = "wifi";
  assert.equal(createAcceptanceReport(input).acceptancePolicy.runPopulation, "OPTIONAL_PHYSICAL_FOLLOW_UP");
});

test("dense counts need coverage bound to the same proven scenario window", () => {
  const input = fixture(); delete input.coverage.native.windowProofSha256;
  assert.equal(createAcceptanceReport(input).requestCounts.nativeHttp.reason, "COUNT_WINDOW_BINDING_UNPROVEN");
  input.coverage.native.windowProofSha256 = "f".repeat(64);
  assert.equal(createAcceptanceReport(input).requestCounts.nativeHttp.status, "UNMEASURED");
  input.coverage.native.windowProofSha256 = H; delete input.window.proofSha256;
  assert.equal(createAcceptanceReport(input).requestCounts.nativeHttp.status, "UNMEASURED");
});

function correlatedFixture() {
  const input = fixture(), id = "12345678-1234-1234-1234-123456789abc";
  Object.assign(input.diagnostics.native[0], { requestId: id, readKind: "read" });
  Object.assign(input.diagnostics.native[1], { requestId: id, readKind: "read" });
  Object.assign(input.diagnostics.native[2], { requestId: id, readKind: "read" });
  Object.assign(input.diagnostics.javascript[1], { event: "cache.read.end", requestId: id.toUpperCase(), readKind: "read", readSource: "network" });
  Object.assign(input.http.requests[0], { sentRequestId: id, echoedRequestId: id.toUpperCase(), readKind: "read" });
  return input;
}

test("UUID echo joins native/JS/same-response without exposing UUIDs or borrowing clocks or authority", () => {
  const report = createAcceptanceReport(correlatedFixture());
  assert.equal(report.correlation.status, "MEASURED");
  assert.deepEqual(report.correlation.samples[0], { readKind: "read", nativeSequences: [2], javascriptSequences: [2], sameResponse: { status: "MEASURED", responseOrdinal: 1 } });
  assert.doesNotMatch(JSON.stringify(report), /12345678|requestId|echoedRequestId|sentRequestId/);
  assert.equal(report.spans.combinedTotal.status, "UNMEASURED");
  assert.equal(report.acceptancePolicy.releaseGate.status, "UNMEASURED");
});

test("local sent UUID/httpEnd or timestamps alone do not prove native matching server echo", () => {
  const input = correlatedFixture(); delete input.diagnostics.native[1].requestId;
  const report = createAcceptanceReport(input);
  assert.equal(report.correlation.reason, "NO_ECHOED_NATIVE_JS_REQUEST_MATCH");
  assert.equal(report.requestCounts.nativeHttp.started, 1);
});

test("missing/mismatched/ambiguous same-response echoes stay unmeasured without discarding valid native/JS correlation", () => {
  for (const mutate of [input => delete input.http.requests[0].echoedRequestId,
    input => input.http.requests[0].echoedRequestId = "22345678-1234-1234-1234-123456789abc",
    input => input.http.requests[0].readKind = "context",
    input => delete input.coverage.responses]) {
    const input = correlatedFixture(); mutate(input);
    const report = createAcceptanceReport(input);
    assert.equal(report.correlation.status, "MEASURED");
    assert.equal(report.correlation.samples[0].sameResponse.status, "UNMEASURED");
  }
  const input = correlatedFixture(); input.http.requests.push({ ...input.http.requests[0], requestSequence: 2 }); input.coverage.responses.throughSequence = 2;
  assert.equal(createAcceptanceReport(input).correlation.samples[0].sameResponse.reason, "AMBIGUOUS_SAME_RESPONSE_ECHO");
});

test("cached JS reads and mismatched read kinds cannot inherit UUID network correlation", () => {
  for (const mutate of [input => input.diagnostics.javascript[1].readSource = "cache",
    input => input.diagnostics.javascript[1].readKind = "context",
    input => input.diagnostics.javascript[1].event = "boot.ready",
    input => input.diagnostics.javascript[1].event = "context.accept",
    input => input.diagnostics.javascript[1].requestId = "PRIVATE_NOT_UUID",
    input => delete input.coverage.javascript]) {
    const input = correlatedFixture(); mutate(input);
    assert.equal(createAcceptanceReport(input).correlation.status, "UNMEASURED");
  }
});

test("readDelivered/cache.accept support new echo protocol and fixed nested stages without database labels", () => {
  const input = correlatedFixture(); input.diagnostics.native[1].event = "readDelivered";
  input.diagnostics.javascript[1].event = "cache.accept"; input.diagnostics.javascript[1].readSource = "joined";
  for (const stage of ["auth_user", "auth_status", "auth_session", "auth_tombstone", "staff_resolve", "staff_revalidate"]) {
    input.http.requests[0].serverTimingNumeric[stage] = { dur: 10 };
  }
  const report = createAcceptanceReport(input);
  assert.equal(report.correlation.status, "MEASURED");
  assert.equal(report.spans.sameResponse.samples[0].durationsMs.staff_revalidate, 10);
  assert.doesNotMatch(JSON.stringify(report.spans), /database|db_execution/i);
});

test("unbounded trace and witness arrays are not treated as complete measurements", () => {
  const input = fixture(); input.diagnostics.native = Array.from({ length: 8193 }, (_, sequence) => ({ sequence: sequence + 1, event: "httpStart" }));
  assert.equal(createAcceptanceReport(input).requestCounts.nativeHttp.reason, "INVALID_COUNT_WINDOW");
  input.witnesses = Array(25).fill(input.witnesses[0]);
  assert.throws(() => createAcceptanceReport(input), /^Error: INVALID_WITNESS_ARRAY$/);
});

test("CLI reads only explicit local input and creates a new report without overwrite or sensitive errors", () => {
  const directory = mkdtempSync(join(tmpdir(), "ios-acceptance-"));
  try {
    const input = join(directory, "input.json"), output = join(directory, "report.json");
    writeFileSync(input, JSON.stringify(fixture()));
    const script = resolve("scripts/ios/acceptance-report.mjs");
    const run = () => spawnSync(process.execPath, [script, "--input", input, "--output", output], { encoding: "utf8" });
    assert.equal(run().status, 0);
    const original = readFileSync(output);
    const second = run(); assert.equal(second.status, 1);
    assert.deepEqual(readFileSync(output), original);
    assert.deepEqual(JSON.parse(second.stderr), { error: "REPORT_FAILED" });
    writeFileSync(input, '{"PRIVATE_PASSWORD":');
    const invalid = run(); assert.equal(invalid.status, 1);
    assert.deepEqual(JSON.parse(invalid.stderr), { error: "INVALID_JSON" });
    assert.doesNotMatch(invalid.stderr, /PRIVATE_|input\.json|password/i);
    writeFileSync(input, Buffer.alloc(16 * 1024 * 1024 + 1));
    const oversized = run(); assert.equal(oversized.status, 1);
    assert.deepEqual(JSON.parse(oversized.stderr), { error: "INPUT_TOO_LARGE" });
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
