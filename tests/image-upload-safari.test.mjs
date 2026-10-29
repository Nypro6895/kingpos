import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { createRequire } from "node:module";
import sharp from "sharp";

const built = await build({ entryPoints: ["lib/image-upload-client.ts"], bundle: true, write: false, platform: "node", format: "cjs" });
const module = { exports: {} };
new Function("module", "exports", built.outputFiles[0].text)(module, module.exports);
const { compressImageCanvas } = module.exports;

test("Safari PNG canvas fallback returns genuine WebP and server dimensions; native WebP stays local", async () => {
  const oldDocument = globalThis.document, oldFetch = globalThis.fetch;
  let mime = "image/png", calls = 0;
  globalThis.document = { createElement: () => ({ width: 0, height: 0,
    getContext: () => ({ drawImage() {} }),
    toBlob: callback => callback(new Blob(["pixels"], { type: mime })),
  }) };
  globalThis.fetch = async (url, options) => {
    calls++;
    assert.equal(url, "/api/images/normalize");
    assert.equal(options.body.type, "image/png");
    return new Response(new Blob(["webp"], { type: "image/webp" }), { headers: { "X-Image-Width": "80", "X-Image-Height": "40" } });
  };
  try {
    const result = await compressImageCanvas({ width: 100, height: 50 });
    assert.equal(result.blob.type, "image/webp");
    assert.equal(result.width, 80); assert.equal(result.height, 40); assert.equal(calls, 1);
    mime = "image/webp";
    assert.equal((await compressImageCanvas({ width: 100, height: 50 })).width, 100);
    assert.equal(calls, 1);
    mime = "image/png";
    globalThis.fetch = async () => new Response("unauthorized", { status: 401 });
    await assert.rejects(compressImageCanvas({ width: 100, height: 50 }), /try again/);
    globalThis.fetch = async () => new Response(new Blob(["png"], { type: "image/png" }));
    await assert.rejects(compressImageCanvas({ width: 100, height: 50 }), /try again/);
  } finally { globalThis.document = oldDocument; globalThis.fetch = oldFetch; }
});

test("conversion endpoint authenticates, bounds streamed input, rejects invalid bytes and returns WebP", async () => {
  const bundle = await build({ entryPoints: ["app/api/images/normalize/route.ts"], bundle: true, write: false, platform: "node", format: "cjs", packages: "external",
    plugins: [{ name: "auth-stub", setup(b) {
      b.onResolve({ filter: /supabase\/server$/ }, () => ({ path: "auth", namespace: "stub" }));
      b.onResolve({ filter: /^server-only$/ }, () => ({ path: "empty", namespace: "stub" }));
      b.onLoad({ filter: /.*/, namespace: "stub" }, args => ({ contents: args.path === "auth" ? "export const getSupabaseAuthUser = () => globalThis.imageTestUser;" : "" }));
    } }] });
  const route = { exports: {} };
  new Function("require", "module", "exports", bundle.outputFiles[0].text)(createRequire(import.meta.url), route, route.exports);
  const request = (body, headers = {}) => new Request("https://reylumi.com/api/images/normalize", { method: "POST", body, headers: { "Content-Type": "image/png", ...headers } });
  try {
    globalThis.imageTestUser = null;
    assert.equal((await route.exports.POST(request("pixels"))).status, 401);
    globalThis.imageTestUser = { id: "staff" };
    assert.equal((await route.exports.POST(request("pixels", { origin: "https://other.test" }))).status, 403);
    assert.equal((await route.exports.POST(request("pixels", { "Content-Type": "image/svg+xml" }))).status, 415);
    assert.equal((await route.exports.POST(request("invalid pixels"))).status, 400);
    assert.equal((await route.exports.POST(request(new Uint8Array(10 * 1024 * 1024 + 1)))).status, 413);
    const png = await sharp({ create: { width: 100, height: 50, channels: 4, background: "transparent" } }).png().toBuffer();
    const response = await route.exports.POST(request(png));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("Content-Type"), "image/webp");
    assert.equal(response.headers.get("X-Image-Width"), "100");
    assert.equal(response.headers.get("X-Image-Height"), "50");
    assert.equal(response.headers.get("Cache-Control"), "private, no-store");
    const metadata = await sharp(Buffer.from(await response.arrayBuffer())).metadata();
    assert.equal(metadata.format, "webp"); assert.equal(metadata.hasAlpha, true);
  } finally { delete globalThis.imageTestUser; }
});
