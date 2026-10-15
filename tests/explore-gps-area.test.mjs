import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";

const built = await build({
  entryPoints: ["lib/location/explore-gps-area.ts", "lib/location/explore-gps-area-data.ts"],
  bundle: true, write: false, outdir: "fixture", platform: "node", format: "esm",
  plugins: [{ name: "server-only-test", setup(builder) {
    builder.onResolve({ filter: /^server-only$/ }, () => ({ path: "server-only", namespace: "stub" }));
    builder.onLoad({ filter: /.*/, namespace: "stub" }, () => ({ contents: "", loader: "js" }));
  } }],
});
const modules = await Promise.all(built.outputFiles.map(file => import("data:text/javascript;base64," + Buffer.from(file.text).toString("base64"))));
const { createExploreGpsAreaResolver } = modules.find(module => module.createExploreGpsAreaResolver);
const { parseCensusGpsArea, parseMapTilerGpsArea, normalizeExploreGpsPoint } = modules.find(module => module.parseCensusGpsArea);
const point = { latitude: 43.0389, longitude: -87.9065 };
const census = {
  result: { geographies: {
    States: [{ STUSAB: "WI", NAME: "Wisconsin", STATE: "55", CENTLAT: "+44.6", CENTLON: "-89.7" }],
    "Incorporated Places": [{ BASENAME: "Milwaukee", NAME: "Milwaukee city", STATE: "55" }],
  } },
};
const json = value => new Response(JSON.stringify(value), { headers: { "content-type": "application/json" } });
const options = extra => ({ getMapTilerKey: () => "", ...extra });

test("Census membership uses containing city/state and never turns a centroid into a salon or ZIP", () => {
  const area = parseCensusGpsArea(census);
  assert.equal(area.label, "Milwaukee, WI");
  assert.equal(area.precision, "city");
  assert.equal(area.provider, "us_census");
  assert.equal(area.postalCode, null);
  assert.equal("latitude" in area, false);
  assert.equal("longitude" in area, false);
  assert.equal("distanceMiles" in area, false);
  const rural = structuredClone(census); delete rural.result.geographies["Incorporated Places"];
  rural.result.geographies.Counties = [{ BASENAME: "Milwaukee", STATE: "55" }];
  assert.equal(parseCensusGpsArea(rural).label, "WI", "a county must not masquerade as a city");
  assert.equal(parseCensusGpsArea(rural).precision, "state");
  rural.result.geographies["Census Designated Places"] = [{ BASENAME: "Honest CDP", STATE: "55" }];
  assert.equal(parseCensusGpsArea(rural).label, "Honest CDP, WI");
});

test("unsupported, ambiguous and cross-state Census data stay unresolved", () => {
  assert.equal(parseCensusGpsArea({ result: { geographies: {} } }), null);
  const border = structuredClone(census); border.result.geographies.States.push({ STUSAB: "IL", STATE: "17" });
  assert.equal(parseCensusGpsArea(border), null);
  const ambiguous = structuredClone(census); ambiguous.result.geographies["Incorporated Places"].push({ BASENAME: "Other", STATE: "55" });
  assert.equal(parseCensusGpsArea(ambiguous), null);
  const wrong = structuredClone(census); wrong.result.geographies["Incorporated Places"][0].STATE = "17";
  assert.equal(parseCensusGpsArea(wrong).city, null);
});

test("MapTiler current and legacy context fields normalize known regions without nearest-feature guessing", () => {
  const payload = { features: [{ id: "municipality.123", text: "Milwaukee", properties: { country_code: "us" }, context: [
    { id: "region.55", text: "Wisconsin" }, { id: "country.1", short_code: "us" }, { id: "postal_code.53202", text: "53202" },
  ] }] };
  const area = parseMapTilerGpsArea(payload);
  assert.equal(area.label, "Milwaukee, WI");assert.equal(area.postalCode, "53202");
  assert.equal(area.precision, "city");
  payload.features[0].context[0] = { id: "region.55", short_code: "US-WI" };
  assert.equal(parseMapTilerGpsArea(payload).state, "WI");
  const abroad = structuredClone(payload);abroad.features[0].properties.country_code = "ca";
  assert.equal(parseMapTilerGpsArea(abroad), null);
  const many = structuredClone(payload);many.features.push({ id: "municipality.456", text: "Wauwatosa", properties: { country_code: "us" } });
  assert.equal(parseMapTilerGpsArea(many), null);
});

test("invalid GPS types/ranges never call a provider; no string or null coercion", async () => {
  let calls = 0; const resolve = createExploreGpsAreaResolver(options({ fetcher: async () => { calls++;return json(census); } }));
  for (const value of [null, [], {}, { latitude: "43", longitude: -87 }, { latitude: null, longitude: -87 },
    { latitude: NaN, longitude: -87 }, { latitude: 91, longitude: 0 }, { latitude: 0, longitude: -181 }]) {
    assert.equal(normalizeExploreGpsPoint(value), null);
    assert.equal((await resolve(value)).errorKind, "invalid");
  }
  assert.equal(calls, 0);
});

test("missing commercial key uses one Census request and repeated exact input reuses ephemeral cache", async () => {
  const calls = [];const resolve = createExploreGpsAreaResolver(options({ fetcher: async (url, init) => { calls.push({ url: new URL(url), init });return json(census); } }));
  const first = await resolve(point);first.area.label = "Caller modified";
  assert.equal((await resolve(point)).area.label, "Milwaukee, WI");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url.hostname, "geocoding.geo.census.gov");
  assert.equal(calls[0].url.searchParams.get("x"), "-87.9065");
  assert.equal(calls[0].url.searchParams.get("y"), "43.0389");
  assert.equal(calls[0].url.searchParams.get("layers"), "States,Incorporated Places,Census Designated Places");
  assert.equal(calls[0].init.cache, "no-store");
  await resolve({ ...point, latitude: point.latitude + 0.000001 });
  assert.equal(calls.length, 2, "nearby coordinates must not borrow a possibly cross-border area");
});

test("a configured MapTiler reverse lookup has no nearest-N limit and falls back on provider failure", async () => {
  const calls = [];
  const resolve = createExploreGpsAreaResolver({ getMapTilerKey: () => "fixture-secret", fetcher: async url => {
    const parsed = new URL(url);calls.push(parsed);
    return parsed.hostname === "api.maptiler.com" ? new Response("Denied", { status: 403 }) : json(census);
  } });
  assert.equal((await resolve(point)).area.provider, "us_census");
  assert.equal(calls.length, 2);
  assert.equal(calls[0].pathname, "/geocoding/-87.9065,43.0389.json");
  assert.equal(calls[0].searchParams.has("limit"), false);
  assert.equal(calls[0].searchParams.has("types"), false);
});

test("in-flight identical inputs coalesce; caller cancellation does not cancel another viewer", async () => {
  let release;let calls = 0;
  const resolve = createExploreGpsAreaResolver(options({ fetcher: async () => { calls++;return new Promise(done => { release = () => done(json(census)); }); } }));
  const controller = new AbortController();
  const a = resolve(point, controller.signal);const b = resolve(point);
  controller.abort();assert.equal((await a).errorKind, "cancelled");
  release();assert.equal((await b).area.label, "Milwaukee, WI");
  assert.equal(calls, 1);
  assert.equal((await resolve(point, AbortSignal.abort())).errorKind, "cancelled");
});

test("concurrency and rolling request budgets refuse extra distinct lookups without queuing", async () => {
  let release;let clock = 1000;let calls = 0;
  const resolve = createExploreGpsAreaResolver(options({ maxConcurrent: 1, maxRequestsPerMinute: 1, now: () => clock,
    fetcher: async () => { calls++;return new Promise(done => { release = () => done(json(census)); }); } }));
  const a = resolve(point);
  assert.equal((await resolve({ ...point, latitude: 44 })).errorKind, "rate_limited");
  release();await a;
  assert.equal((await resolve({ ...point, latitude: 44 })).errorKind, "rate_limited");
  assert.equal((await resolve(point)).errorKind, null, "cache hits do not consume the request budget");
  clock += 60_001;
  const b = resolve({ ...point, latitude: 44 });release();await b;assert.equal(calls, 2);
});

test("bounded cache eviction and TTL retry do not keep failed or stale areas forever", async () => {
  let clock = 1;let calls = 0;
  const resolve = createExploreGpsAreaResolver(options({ cacheSize: 1, successTtlMs: 10, failureTtlMs: 5, now: () => clock,
    fetcher: async () => { calls++;return calls === 1 ? json({ result: { geographies: {} } }) : json(census); } }));
  assert.equal((await resolve(point)).errorKind, "unsupported");
  assert.equal((await resolve(point)).errorKind, "unsupported");assert.equal(calls, 1);
  clock += 6;assert.ok((await resolve(point)).area);
  await resolve({ ...point, latitude: 44 });await resolve(point);assert.equal(calls, 4);
  clock += 11;await resolve(point);assert.equal(calls, 5);
});

test("timeout/network/rate failures and oversized payloads remain separate manual-selection outcomes", async () => {
  const timeout = createExploreGpsAreaResolver(options({ censusTimeoutMs: 5, fetcher: async (_url, init) => new Promise((_resolve, reject) => {
    init.signal.addEventListener("abort", () => reject(new Error("Contains private input")), { once: true });
  }) }));
  assert.equal((await timeout(point)).errorKind, "timeout");
  const network = createExploreGpsAreaResolver(options({ fetcher: async () => { throw new Error("fixture-secret https://provider.example/gps"); } }));
  const result = await network(point);assert.equal(result.errorKind, "network");assert.ok(!result.error.includes("fixture-secret"));
  const limited = createExploreGpsAreaResolver(options({ fetcher: async () => new Response("Busy", { status: 429 }) }));
  assert.equal((await limited(point)).errorKind, "rate_limited");
  const tooLarge = createExploreGpsAreaResolver(options({ fetcher: async () => new Response("x".repeat(128 * 1024 + 1)) }));
  assert.equal((await tooLarge(point)).errorKind, "unavailable");
});
