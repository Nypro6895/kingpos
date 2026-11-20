import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { build } from "esbuild";

async function load(entry) {
  const result = await build({ entryPoints: [entry], bundle: true, platform: "node", format: "esm", write: false });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);
}
const { browserSecurityHeaders } = await load("lib/browser-security-headers.ts");
const { createCspReportBudget, readCspReportBody, summarizeCspReports, CSP_REPORT_MAX_BYTES } = await load("lib/csp-report.ts");
const reportRoute = await load("app/api/security/csp-report/route.ts");
const vendor = await load("app/(app)/api/vendor/maplibre-gl/[version]/route.ts");
const legacyVendor = await load("app/(app)/api/vendor/maplibre-gl/route.ts");
const { MAPLIBRE_ASSET_VERSION, MAPLIBRE_SCRIPT_URL } = await load("lib/maplibre-assets.ts");

test("security dependency migration keeps existing Cache Components navigation semantics", async () => {
  const require = createRequire(import.meta.url);
  const loadConfig = require("next/dist/server/config").default;
  const { PHASE_PRODUCTION_BUILD } = require("next/constants");
  const config = await loadConfig(PHASE_PRODUCTION_BUILD, process.cwd(), { silent: true });
  assert.equal(config.cacheComponents, true);
  assert.equal(config.partialPrefetching, false);
});

test("production headers preserve same-origin embedding and PPR; strict scripts are report-only", () => {
  const headers = new Headers(browserSecurityHeaders({ NODE_ENV: "production", NEXT_PUBLIC_SUPABASE_URL: "https://fixture.supabase.co/path?secret=hidden" }).map(({ key, value }) => [key, value]));
  assert.equal(headers.get("x-content-type-options"), "nosniff");
  assert.equal(headers.get("x-frame-options"), "SAMEORIGIN");
  assert.match(headers.get("content-security-policy"), /frame-ancestors 'self'/);
  assert.doesNotMatch(headers.get("content-security-policy"), /script-src|nonce|unsafe-inline|unsafe-eval/);
  const report = headers.get("content-security-policy-report-only");
  assert.match(report, /script-src 'self' https:\/\/js\.stripe\.com/);
  assert.match(report, /wss:\/\/fixture\.supabase\.co/);
  assert.match(report, /worker-src 'self' blob:/);
  assert.match(report, /frame-src 'self' https:\/\/www\.google\.com/);
  assert.match(report, /report-uri \/api\/security\/csp-report/);
  assert.doesNotMatch(report, /secret|report-sample|unsafe-eval|nonce-|https:;|\*;/);
  assert.equal(browserSecurityHeaders({ NODE_ENV: "development" }).some(h => h.key.endsWith("Report-Only")), false);
});

test("CSP telemetry discards tokens, identifiers, samples and attacker-controlled origins", () => {
  const secret = "private-card-token-123";
  const input = { "csp-report": { "document-uri": `https://reylumi.test/booking/manage/${secret}?email=secret#token`, "effective-directive": "script-src-elem", "blocked-uri": `https://${secret}.attacker.invalid/a?secret`, "source-file": secret, "script-sample": secret, referrer: secret } };
  assert.deepEqual(summarizeCspReports(input, "https://reylumi.test"), [{ directive: "script-src-elem", area: "booking", blocked: "external", disposition: "report" }]);
  const batch = Array.from({ length: 30 }, () => ({ type: "csp-violation", body: { documentURL: "https://reylumi.test/pos/private-id", effectiveDirective: "connect-src", blockedURL: "https://api.maptiler.com/a?key=secret", disposition: "enforce" } }));
  assert.equal(summarizeCspReports(batch, "https://reylumi.test").length, 10);
  assert.deepEqual(summarizeCspReports({ "csp-report": { "effective-directive": secret } }, "https://reylumi.test"), []);
});

test("CSP telemetry body and budget are bounded including streams without content-length", async () => {
  const admit = createCspReportBudget(2, 1000);
  assert.equal(admit(1000), true); assert.equal(admit(1001), true); assert.equal(admit(1002), false); assert.equal(admit(2000), true);
  const oversized = new Request("https://reylumi.test/api/security/csp-report", { method: "POST", body: " ".repeat(CSP_REPORT_MAX_BYTES + 1) });
  await assert.rejects(readCspReportBody(oversized), /Payload too large/);
  const stream = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(CSP_REPORT_MAX_BYTES + 1)); controller.close(); } });
  await assert.rejects(readCspReportBody(new Request("https://reylumi.test/", { method: "POST", body: stream, duplex: "half" })), /Payload too large/);
});

test("CSP route refuses cross-site/unsupported/oversized reports without persisting raw input", async () => {
  const make = (body, headers = {}) => new Request("https://reylumi.test/api/security/csp-report", { method: "POST", headers: { "content-type": "application/csp-report", ...headers }, body });
  assert.equal((await reportRoute.POST(make("{}", { origin: "https://evil.test" }))).status, 403);
  assert.equal((await reportRoute.POST(make("{}", { "content-type": "text/plain" }))).status, 415);
  assert.equal((await reportRoute.POST(make(" ".repeat(CSP_REPORT_MAX_BYTES + 1)))).status, 413);
  assert.equal((await reportRoute.POST(make("{invalid"))).status, 400);
  const response = await reportRoute.POST(make("{}"));
  assert.equal(response.status, 204); assert.equal(response.headers.get("cache-control"), "no-store");
});

test("versioned MapLibre serves exact patched bytes and old URL cannot acquire another immutable entry", async () => {
  const pkg = JSON.parse(readFileSync("node_modules/maplibre-gl/package.json", "utf8"));
  assert.equal(pkg.version, "5.24.1"); assert.equal(MAPLIBRE_ASSET_VERSION, pkg.version);
  assert.equal(MAPLIBRE_SCRIPT_URL, `/api/vendor/maplibre-gl/${pkg.version}.js`);
  const response = await vendor.GET(new Request(`http://localhost${MAPLIBRE_SCRIPT_URL}`), { params: Promise.resolve({ version: `${pkg.version}.js` }) });
  assert.equal(response.status, 200); assert.match(response.headers.get("cache-control"), /immutable/);
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(Buffer.compare(Buffer.from(await response.arrayBuffer()), readFileSync("node_modules/maplibre-gl/dist/maplibre-gl.js")), 0);
  assert.equal((await legacyVendor.GET()).headers.get("cache-control"), "no-store");
  assert.equal((await vendor.GET(new Request("http://localhost/"), { params: Promise.resolve({ version: "5.24.0" }) })).status, 404);
});
