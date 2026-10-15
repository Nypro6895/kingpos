import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
const built = await build({ entryPoints: ["app/api/explore/area/route.ts"], bundle: true, write: false, platform: "node", format: "esm",
  plugins: [{ name: "route-contract", setup(builder) {
    builder.onResolve({ filter: /^(next\/server|@\/lib\/location\/explore-gps-area)$/ }, args => ({ path: args.path, namespace: "stub" }));
    builder.onLoad({ filter: /.*/, namespace: "stub" }, args => ({ loader: "js", contents: args.path === "next/server"
      ? `export class NextResponse extends Response { static json(value,init){return new NextResponse(JSON.stringify(value),{...init,headers:{'Content-Type':'application/json',...init?.headers}})} }`
      : `export async function resolveExploreGpsArea(value,signal){globalThis.areaApiInput=value;return globalThis.areaApiResult;}` }));
  } }] });
const { POST } = await import("data:text/javascript;base64," + Buffer.from(built.outputFiles[0].text).toString("base64"));

test("area route validates JSON/size, excludes GPS from responses, and never caches a viewer request", async () => {
  for (const body of ["not json", "x".repeat(1025)]) {
    const response = await POST(new Request("https://reylumi.com/api/explore/area", { method: "POST", body }));
    assert.equal(response.status, 400);assert.equal((await response.json()).errorKind, "invalid");
    assert.equal(response.headers.get("Cache-Control"), "private, no-store");
  }
  globalThis.areaApiResult = { area: { label: "Milwaukee, WI" }, error: null, errorKind: null };
  const response = await POST(new Request("https://reylumi.com/api/explore/area", { method: "POST", body: JSON.stringify({ latitude: 43, longitude: -87 }) }));
  assert.equal(response.status, 200);assert.equal((await response.json()).area.label, "Milwaukee, WI");
  assert.equal(response.headers.get("Cache-Control"), "private, no-store");
  assert.deepEqual(globalThis.areaApiInput, { latitude: 43, longitude: -87 });
  for (const [errorKind, status] of [["invalid", 400], ["rate_limited", 429], ["cancelled", 499], ["timeout", 200], ["unsupported", 200]]) {
    globalThis.areaApiResult = { area: null, error: "Choose an area", errorKind };
    const request = new Request("https://reylumi.com/api/explore/area", { method: "POST", body: "{}" });
    assert.equal((await POST(request)).status, status);
  }
});
