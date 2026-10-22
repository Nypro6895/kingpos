#!/usr/bin/env node
// Offline only. No app/device/network access; raw fields never enter the report.
import { createHash } from "node:crypto";
import { openSync, fstatSync, readSync, closeSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const HEX = /^[a-f0-9]{64}$/;
const ROLES = new Set(["guest", "personal", "staff", "owner"]);
const SCENARIOS = new Set(["cold", "warm", "role-a-b-a", "background", "restart"]);
const PROFILES = new Set(["wifi", "nlc-3g", "nlc-4g", "simulator-unconditioned", "unknown"]);
const CATEGORIES = new Set(["view", "context", "read", "command", "cache", "launch", "today", "shell", "owner", "staff", "publicContent", "other"]);
const STAGES = new Set(["auth", "validate", "lease", "load", "serialize", "total", "proxy_refresh", "workspace", "handler", "backend_auth", "backend_rest", "backend_rpc", "today_full", "today_shell", "today_staff", "today_bookings", "today_waiting", "today_financials", "today_extras", "clock", "hours", "staff_board", "staff_activity", "bookings", "waiting", "financial_report", "financial_compare", "extras", "staff_identity", "staff_assigned", "staff_attendance", "staff_timezone", "staff_greeting", "staff_pay_tab", "auth_user", "auth_status", "auth_session", "auth_tombstone", "staff_resolve", "staff_revalidate"]);
const NATIVE_EVENTS = new Set(["controllerCreate", "webViewCreateStart", "webViewCreateEnd", "bundleLoad", "documentCommit", "documentFinish", "surfaceReady", "foreground", "processTermination", "navigationFailure", "contextRequest", "contextJoin", "contextCacheHit", "contextCacheMiss", "contextEnvelope", "contextDelivered", "contextFailure", "contextBarrierStart", "contextBarrierEnd", "scopeReset", "authorityRotate", "pageInvalidate", "displayRevoke", "portableLock", "readCacheHit", "readCacheMiss", "readDelivered", "httpStart", "httpEnd", "httpFailure", "serverTiming", "cookieCapture", "cookieCommit", "cookieStale", "cookieMismatch", "commandStart", "commandPreflight", "commandEnd", "commandFailure"]);
const JS_EVENTS = new Set(["boot.start", "boot.ready", "data.visible", "route.reveal", "auth.start", "auth.end", "auth.join", "auth.skip", "auth.abort", "auth.reject", "context.read.start", "context.read.end", "context.accept", "context.reject", "context.abort", "gate.hide", "gate.show", "timer.schedule", "timer.fire", "timer.cancel", "cache.reset", "cache.invalidate", "cache.hit", "cache.miss", "cache.join", "cache.restore.start", "cache.restore.end", "cache.read.start", "cache.read.end", "cache.refresh", "lifecycle.focus", "lifecycle.visible", "lifecycle.foreground", "lifecycle.online", "document.reload.request", "document.pagehide", "document.pageshow"]);
const META_KEYS = ["sourceCommit", "bundleBuildId", "buildArtifactSha256", "principalAlias", "deviceAlias", "deviceKind", "networkProfile", "scenario", "roles"];
JS_EVENTS.add("cache.accept");
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const READ_KINDS = new Set(["context", "read"]);
const uuid = value => typeof value === "string" && UUID.test(value) ? value.toLowerCase() : null;
const hex = value => typeof value === "string" && HEX.test(value);
const bounded = (value, max = 604800000) => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= max;
const integer = value => Number.isSafeInteger(value) && value >= 0;
const object = value => value !== null && typeof value === "object" && !Array.isArray(value);
const digest = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const unmeasured = reason => ({ status: "UNMEASURED", reason });
function requireInput(condition, code) { if (!condition) throw new Error(code); }

function metadata(value) {
  requireInput(object(value) && Object.keys(value).every(key => META_KEYS.includes(key)), "INVALID_METADATA");
  requireInput(typeof value.sourceCommit === "string" && /^[a-f0-9]{40}$/.test(value.sourceCommit) && hex(value.bundleBuildId) && hex(value.buildArtifactSha256), "INVALID_BUILD_BINDING");
  requireInput(typeof value.principalAlias === "string" && typeof value.deviceAlias === "string" && /^(?:principal-[a-z]|guest)$/.test(value.principalAlias) && /^device-[a-z]$/.test(value.deviceAlias), "INVALID_NONPERSONAL_ALIAS");
  requireInput(["simulator", "physical"].includes(value.deviceKind) && PROFILES.has(value.networkProfile) && SCENARIOS.has(value.scenario), "INVALID_SCENARIO_ENVIRONMENT");
  requireInput(Array.isArray(value.roles) && value.roles.length >= 1 && value.roles.length <= 3 && value.roles.every(role => ROLES.has(role)), "INVALID_ROLES");
  const validSequence = value.scenario === "role-a-b-a"
    ? value.roles.length === 3 && value.roles[0] === value.roles[2] && value.roles[0] !== value.roles[1]
    : value.scenario === "warm" ? value.roles.length === 3 && value.roles.every(role => role === value.roles[0]) : value.roles.length === 1;
  requireInput(validSequence && (value.principalAlias !== "guest" || value.roles.every(role => role === "guest")), "INVALID_ROLE_SEQUENCE");
  requireInput(value.deviceKind === "simulator" || value.networkProfile !== "simulator-unconditioned", "INVALID_PHYSICAL_PROFILE");
  return Object.fromEntries(META_KEYS.map(key => [key, value[key]]));
}

export function acceptanceBindingSha256(value) { return digest(metadata(value)); }

function proof(value, binding) { return object(value) && hex(value.proofSha256) && value.bindingSha256 === binding; }
function qaTime(value, clocks, binding) {
  if (!object(value) || !bounded(value.ms)) return null;
  if (value.clock === "qa") return value.ms;
  if (!["native", "javascript"].includes(value.clock)) return null;
  const alignment = clocks?.[value.clock];
  if (!proof(alignment, binding) || !Number.isFinite(alignment.offsetToQaMs)) return null;
  const time = value.ms + alignment.offsetToQaMs;
  return bounded(time) ? time : null;
}

function witnessed(kind, leg, input, binding) {
  const rows = input.witnesses ?? [];
  const candidates = rows.filter(row => object(row) && row.kind === kind && row.leg === leg);
  if (candidates.length !== 1) return unmeasured(candidates.length ? "AMBIGUOUS_QA_WITNESS" : "MISSING_QA_WITNESS");
  const row = candidates[0];
  if (!proof(row, binding)) return unmeasured("WITNESS_BINDING_OR_PROOF_MISSING");
  if (row.role !== input.metadata.roles[leg] || row.currentAuthorityVerified === false || row.scopeGenerationVerified === false) return { status: "NOT_MET", reason: "WRONG_OR_REJECTED_AUTHORITY" };
  if (row.currentAuthorityVerified !== true || row.scopeGenerationVerified !== true) return unmeasured("AUTHORITY_WITNESS_INCOMPLETE");
  if (row.bodyVerified === false || row.noBlockingError === false) return { status: "NOT_MET", reason: "BODY_OR_SAFETY_NOT_CONFIRMED" };
  if (row.bodyVerified !== true || row.noBlockingError !== true) return unmeasured("BODY_OR_SAFETY_WITNESS_INCOMPLETE");
  if (kind === "correct-usable" && row.firstCorrectVerified !== true) return unmeasured("FIRST_CORRECT_WITNESS_NOT_VERIFIED");
  if (kind === "fresh-data-ready" && (row.namedDataVerified !== true || !["fresh-200", "revalidated-304"].includes(row.freshness))) return unmeasured("FRESH_DATA_NOT_VERIFIED");
  if (kind === "fresh-data-ready" && row.freshness === "revalidated-304" && row.retainedBodyValidationVerified !== true) return unmeasured("RETAINED_BODY_VALIDATION_UNPROVEN");
  if (!proof(input.window, binding)) return unmeasured("WINDOW_PROOF_MISSING");
  const at = qaTime(row.at, input.clockAlignment, binding);
  const began = qaTime(input.legs?.[leg]?.start, input.clockAlignment, binding);
  const ended = qaTime(input.window?.end, input.clockAlignment, binding);
  const windowStart = qaTime(input.window?.start, input.clockAlignment, binding);
  if (at === null || began === null || ended === null) return unmeasured("CLOCK_ALIGNMENT_OR_TIMESTAMP_MISSING");
  const nextStart = input.legs?.[leg + 1]?.start;
  const legEnd = nextStart ? qaTime(nextStart, input.clockAlignment, binding) : ended;
  if (windowStart === null || legEnd === null) return unmeasured("CLOCK_ALIGNMENT_OR_TIMESTAMP_MISSING");
  if (began < windowStart || began > legEnd || legEnd > ended || at < began || at > legEnd) return { status: "NOT_MET", reason: "WITNESS_OUTSIDE_LEG_WINDOW" };
  return { status: "MEASURED", qaAtMs: at, elapsedMs: at - began, proofSha256: row.proofSha256,
    ...(kind === "fresh-data-ready" ? { freshness: row.freshness } : {}) };
}

// A caller must retain a separately proven same-process window. Dense sequences
// validate that a capped ring did not silently omit rows in that window.
function windowRows(rows, coverage, binding, window, sequenceKey = "sequence", events) {
  if (!proof(coverage, binding) || coverage.complete !== true) return { ...unmeasured("COUNT_COVERAGE_UNPROVEN"), rows: [] };
  if (!proof(window, binding) || coverage.windowProofSha256 !== window.proofSha256) return { ...unmeasured("COUNT_WINDOW_BINDING_UNPROVEN"), rows: [] };
  if (!Array.isArray(rows) || rows.length > 8192 || !integer(coverage.afterSequence) || !integer(coverage.throughSequence) || coverage.throughSequence < coverage.afterSequence || coverage.throughSequence - coverage.afterSequence > 8192) return { ...unmeasured("INVALID_COUNT_WINDOW"), rows: [] };
  const selected = rows.filter(row => object(row) && integer(row[sequenceKey]) && row[sequenceKey] > coverage.afterSequence && row[sequenceKey] <= coverage.throughSequence);
  selected.sort((a, b) => a[sequenceKey] - b[sequenceKey]);
  if (selected.length !== coverage.throughSequence - coverage.afterSequence || selected.some((row, index) => row[sequenceKey] !== coverage.afterSequence + index + 1)) return { ...unmeasured("SEQUENCE_GAP_OR_DUPLICATE"), rows: [] };
  if (events && selected.some(row => !events.has(row.event))) return { ...unmeasured("UNRECOGNIZED_TRACE_EVENT"), rows: [] };
  return { status: "MEASURED", rows: selected, afterSequence: coverage.afterSequence, throughSequence: coverage.throughSequence, proofSha256: coverage.proofSha256 };
}

function nativeCounts(window) {
  if (window.status !== "MEASURED") return unmeasured(window.reason);
  const rows = window.rows;
  return { status: "MEASURED", definition: "Recorded native HTTP start/end/failure events; not deduplicated logical operations", started: rows.filter(row => row.event === "httpStart").length,
    completed: rows.filter(row => row.event === "httpEnd").length, failed: rows.filter(row => row.event === "httpFailure").length,
    categories: [...CATEGORIES].flatMap(category => {
      const count = rows.filter(row => row.event === "httpStart" && row.category === category).length;
      return count ? [{ category, started: count }] : [];
    }), proofSha256: window.proofSha256 };
}

function clientCounts(window) {
  if (window.status !== "MEASURED") return unmeasured(window.reason);
  const count = event => window.rows.filter(row => row.event === event).length;
  return { status: "MEASURED", definition: "Recorded JS starts; auth checks, context reads and resource reads are separate and may nest/join", contextReadsStarted: count("context.read.start"), resourceReadsStarted: count("cache.read.start"), authChecksStarted: count("auth.start"), cacheJoins: count("cache.join"), proofSha256: window.proofSha256 };
}

function backendCounts(window, nativeWindow) {
  const perResponse = [];
  for (const row of window.rows) {
    if (row.forwarded !== true || row.outcome !== "http-response") continue;
    const counters = {};
    for (const name of ["backend_auth", "backend_rest", "backend_rpc"]) {
      const value = row.serverTimingNumeric?.[name]?.calls;
      if (integer(value) && value <= 1_000_000_000) counters[name] = value;
    }
    if (Object.keys(counters).length) perResponse.push({ responseOrdinal: row.requestSequence, counters });
  }
  const nativeSamples = [];
  for (const row of nativeWindow.rows) {
    if (row.event !== "serverTiming" || !["backend_auth", "backend_rest", "backend_rpc"].includes(row.stage) || !integer(row.backendCalls) || row.backendCalls > 1_000_000_000) continue;
    const sample = { sequence: row.sequence, stage: row.stage, calls: row.backendCalls };
    for (const field of ["responseBytes", "sizedResponses"]) if (integer(row[field]) && row[field] <= 1_000_000_000) sample[field] = row[field];
    nativeSamples.push(sample);
  }
  return perResponse.length || nativeSamples.length ? { status: "MEASURED", definition: "Same-response caller-wrapper counters; native and QA views can repeat one exchange; no sum, dedupe or database-query claim", perResponse, nativeSamples,
    responseCoverage: window.status === "MEASURED" ? "PROVEN" : "UNMEASURED", nativeCoverage: nativeWindow.status === "MEASURED" ? "PROVEN" : "UNMEASURED", globalTotal: unmeasured("NO_GLOBAL_BACKEND_COUNT_EVIDENCE") } : unmeasured(window.status !== "MEASURED" && nativeWindow.status !== "MEASURED" ? "BACKEND_COUNTER_COVERAGE_UNPROVEN" : "BACKEND_COUNTERS_NOT_EXPORTED");
}

// UUID equality is optional evidence of one HTTP exchange, never identity,
// authority, clock alignment or equivalence of logical operations.
function correlation(nativeWindow, jsWindow, responseWindow) {
  if (nativeWindow.status !== "MEASURED" || jsWindow.status !== "MEASURED") return unmeasured("CORRELATION_TRACE_COVERAGE_UNPROVEN");
  const deliveries = new Map();
  for (const row of nativeWindow.rows) {
    const id = uuid(row.requestId);
    if (!id || !READ_KINDS.has(row.readKind) || !["contextDelivered", "readDelivered", "serverTiming"].includes(row.event)) continue;
    if (row.event === "contextDelivered" && row.readKind !== "context" || row.event === "readDelivered" && row.readKind !== "read") continue;
    const key = `${row.readKind}:${id}`;
    const value = deliveries.get(key) ?? { id, readKind: row.readKind, nativeSequences: [] };
    value.nativeSequences.push(row.sequence); deliveries.set(key, value);
  }
  const samples = [];
  const jsEvents = new Set(["context.read.end", "context.accept", "context.reject", "context.abort", "auth.reject", "cache.read.end", "cache.accept"]);
  const javascriptByRequest = new Map(), responsesByRequest = new Map();
  for (const row of jsWindow.rows) {
    const id = uuid(row.requestId);
    if (!id || !READ_KINDS.has(row.readKind) || !jsEvents.has(row.event) || !["network", "joined"].includes(row.readSource)) continue;
    if (row.event.startsWith("context.") && row.readKind !== "context" || row.event.startsWith("cache.") && row.readKind !== "read") continue;
    const key = `${row.readKind}:${id}`, values = javascriptByRequest.get(key) ?? [];
    values.push(row.sequence); javascriptByRequest.set(key, values);
  }
  if (responseWindow.status === "MEASURED") for (const row of responseWindow.rows) {
    const id = uuid(row.sentRequestId);
    if (!id || uuid(row.echoedRequestId) !== id || !READ_KINDS.has(row.readKind) || row.forwarded !== true || row.outcome !== "http-response") continue;
    const key = `${row.readKind}:${id}`, values = responsesByRequest.get(key) ?? [];
    values.push(row.requestSequence); responsesByRequest.set(key, values);
  }
  for (const [key, value] of deliveries) {
    const javascriptSequences = javascriptByRequest.get(key) ?? [];
    if (!javascriptSequences.length) continue;
    const responses = responsesByRequest.get(key) ?? [];
    samples.push({ readKind: value.readKind, nativeSequences: value.nativeSequences, javascriptSequences,
      sameResponse: responses.length === 1 ? { status: "MEASURED", responseOrdinal: responses[0] } : unmeasured(responses.length ? "AMBIGUOUS_SAME_RESPONSE_ECHO" : "SAME_RESPONSE_ECHO_UNPROVEN") });
  }
  return samples.length ? { status: "MEASURED", definition: "Matching echoed request UUIDs; no clock, authority, identity or cross-layer count inference", samples } : unmeasured("NO_ECHOED_NATIVE_JS_REQUEST_MATCH");
}

function spans(nativeWindow, jsWindow, responseWindow) {
  const native = nativeWindow.rows.flatMap(row => CATEGORIES.has(row.category) && bounded(row.durationMs, 3600000) && ["httpEnd", "httpFailure", "serverTiming"].includes(row.event)
    && (row.event !== "serverTiming" || STAGES.has(row.stage))
    ? [{ clock: "native", sequence: row.sequence, category: row.category, kind: row.event, durationMs: row.durationMs, ...(row.event === "serverTiming" ? { stage: row.stage } : {}) }] : []);
  const jsKinds = new Map([["auth.end", "auth"], ["context.read.end", "context"], ["cache.read.end", "fetch"], ["cache.restore.end", "resource-hydration"]]);
  const javascript = jsWindow.rows.flatMap(row => jsKinds.has(row.event) && bounded(row.durationMs)
    ? [{ clock: "javascript", sequence: row.sequence, kind: jsKinds.get(row.event), durationMs: row.durationMs }] : []);
  const sameResponse = responseWindow.rows.flatMap(row => {
    if (row.forwarded !== true || row.outcome !== "http-response") return [];
    const numeric = {};
    for (const stage of STAGES) {
      const duration = row.serverTimingNumeric?.[stage]?.dur;
      if (bounded(duration, 3600000)) numeric[stage] = duration;
    }
    return Object.keys(numeric).length ? [{ responseOrdinal: row.requestSequence, durationsMs: numeric }] : [];
  });
  const sampled = (window, samples) => window.status !== "MEASURED" ? unmeasured(window.reason) : samples.length ? { status: "MEASURED", samples } : unmeasured("TIMING_SAMPLES_NOT_EXPORTED");
  return { native: sampled(nativeWindow, native), javascript: sampled(jsWindow, javascript), sameResponse: sampled(responseWindow, sameResponse),
    render: unmeasured("BOOT_ROUTE_GATE_AND_DATA_VISIBLE_ARE_NOT_CORRECT_USABLE_RENDER_WITNESSES"),
    combinedTotal: unmeasured("SPANS_OVERLAP_AND_CLOCKS_ARE_NOT_ADDITIVE") };
}

export function createAcceptanceReport(input) {
  requireInput(object(input) && input.schemaVersion === 1, "INVALID_SCHEMA");
  const meta = metadata(input.metadata), binding = acceptanceBindingSha256(meta);
  requireInput(!input.witnesses || Array.isArray(input.witnesses) && input.witnesses.length <= 24, "INVALID_WITNESS_ARRAY");
  const normalized = { ...input, metadata: meta };
  const legs = meta.roles.map((role, index) => ({ leg: index, role,
    correctUsable: witnessed("correct-usable", index, normalized, binding),
    freshDataReady: witnessed("fresh-data-ready", index, normalized, binding) }));
  const matchingDiagnosticBuild = input.diagnostics?.schemaVersion === 1 && input.diagnostics?.bundleBuild === meta.bundleBuildId;
  const rejectedTrace = { ...unmeasured("DIAGNOSTIC_BUILD_UNCONFIRMED"), rows: [] };
  const nativeWindow = matchingDiagnosticBuild ? windowRows(input.diagnostics?.native, input.coverage?.native, binding, input.window, "sequence", NATIVE_EVENTS) : rejectedTrace;
  const jsWindow = matchingDiagnosticBuild ? windowRows(input.diagnostics?.javascript, input.coverage?.javascript, binding, input.window, "sequence", JS_EVENTS) : rejectedTrace;
  const responseWindow = matchingDiagnosticBuild ? windowRows(input.http?.requests, input.coverage?.responses, binding, input.window, "requestSequence") : rejectedTrace;
  const environment = input.environmentWitness;
  const verifiedEnvironment = proof(environment, binding) && environment.deviceKind === meta.deviceKind && environment.networkProfile === meta.networkProfile && environment.actualDeviceVerified === true && environment.networkProfileVerified === true && meta.networkProfile !== "unknown";
  const values = legs.flatMap(leg => [leg.correctUsable.status, leg.freshDataReady.status]);
  const execution = input.executionWitness;
  const verifiedExecution = proof(execution, binding) && execution.integratedCandidateVerified === true && execution.realBackendTransportVerified === true &&
    (meta.roles.every(role => role === "guest") ? execution.originalGuestFlowVerified === true : execution.actualAuthenticatedSessionVerified === true);
  return { schemaVersion: 1, metadata: meta, bindingSha256: binding, inputSha256: digest(input),
    environment: verifiedEnvironment ? { status: "MEASURED", declaredDeviceKind: meta.deviceKind, profile: meta.networkProfile, proofSha256: environment.proofSha256 } : { ...unmeasured("DEVICE_OR_NETWORK_PROFILE_NOT_INDEPENDENTLY_VERIFIED"), declaredDeviceKind: meta.deviceKind, profile: meta.networkProfile },
    functionalEvidence: values.includes("NOT_MET") ? "NOT_MET" : verifiedEnvironment && verifiedExecution && values.every(value => value === "MEASURED") ? "RECORDED_REQUIRES_EXTERNAL_REVIEW" : "UNMEASURED",
    execution: verifiedExecution ? { status: "MEASURED", sessionKind: meta.roles.every(role => role === "guest") ? "guest" : "authenticated", proofSha256: execution.proofSha256 } : unmeasured("INTEGRATED_CANDIDATE_REAL_SESSION_OR_BACKEND_UNVERIFIED"),
    acceptancePolicy: { requiredBeforeDeploy: "AUTHENTICATED_SIMULATOR_INTEGRATED_CANDIDATE", physicalIPhone: "OPTIONAL_AFTER_DEPLOY_NOT_A_RELEASE_BLOCKER", deploymentAuthorized: false,
      runPopulation: meta.deviceKind === "simulator" ? "SIMULATOR" : "OPTIONAL_PHYSICAL_FOLLOW_UP",
      releaseGate: unmeasured("SCENARIO_MATRIX_AND_EXTERNAL_REVIEW_REQUIRED") },
    performanceAcceptance: unmeasured("NO_PERFORMANCE_SLO_OR_REPEATED_SAMPLE_PROOF_SUPPLIED"), legs,
    requestCounts: { nativeHttp: nativeCounts(nativeWindow), clientLogical: clientCounts(jsWindow), backendLogical: backendCounts(responseWindow, nativeWindow), totalAcrossLayers: unmeasured("NESTED_LAYERS_MUST_NOT_BE_ADDED") },
    correlation: correlation(nativeWindow, jsWindow, responseWindow),
    spans: spans(nativeWindow, jsWindow, responseWindow),
    limits: ["Offline report, never an access grant, test execution, publication or device measurement",
      "Witnesses are independently supplied evidence, not inferred from trace events or HTTP200",
      "Missing clock alignment, coverage or authority stays UNMEASURED or NOT_MET, never zero/pass",
      "Native and JS clocks are separate; resource hydration is not React hydration or paint",
      "304 can validate retained data; it does not prove a new DTO commit or avoided backend work",
      "Simulator, Debug QA, physical WiFi and conditioned profiles are separate populations",
      "No raw identifiers, URLs, labels, DTOs, error text, cookies or credentials are exported"] };
}

function main(args) {
  requireInput(args.length === 4 && args[0] === "--input" && args[2] === "--output", "USAGE_INPUT_OUTPUT_REQUIRED");
  const fd = openSync(args[1], "r"), maxBytes = 16 * 1024 * 1024;
  let bytes;
  try {
    requireInput(fstatSync(fd).isFile(), "INPUT_REGULAR_FILE_REQUIRED");
    requireInput(fstatSync(fd).size <= maxBytes, "INPUT_TOO_LARGE");
    const buffer = Buffer.alloc(maxBytes + 1);
    let length = 0, count;
    while (length < buffer.length && (count = readSync(fd, buffer, length, buffer.length - length, null)) !== 0) length += count;
    requireInput(length <= maxBytes, "INPUT_TOO_LARGE");
    bytes = buffer.subarray(0, length);
  } finally { closeSync(fd); }
  let input;
  try { input = JSON.parse(bytes); } catch { throw new Error("INVALID_JSON"); }
  const report = createAcceptanceReport(input);
  writeFileSync(args[3], JSON.stringify(report, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  console.log(JSON.stringify({ reportSha256: digest(report), functionalEvidence: report.functionalEvidence }));
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { main(process.argv.slice(2)); } catch (error) {
    // No native/JSON/file-system errors or source paths may echo private input.
    console.error(JSON.stringify({ error: /^[A-Z_]+$/.test(error?.message) ? error.message : "REPORT_FAILED" }));
    process.exitCode = 1;
  }
}
