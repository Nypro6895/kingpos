import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { createRequire } from "node:module";
import { randomBytes } from "node:crypto";
import sharp from "sharp";
const require = createRequire(import.meta.url);
async function load(file) {
  const built = await build({ entryPoints: [file], bundle: true, write: false, platform: "node", format: "cjs", packages: "external",
    plugins: [{ name: "server-only", setup(b) { b.onResolve({ filter: /^server-only$/ }, () => ({ path: "server-only", namespace: "stub" })); b.onLoad({ filter: /.*/, namespace: "stub" }, () => ({ contents: "" })); } }] });
  const module = { exports: {} }; new Function("require", "module", "exports", built.outputFiles[0].text)(require, module, module.exports); return module.exports;
}
const { normalizeImage } = await load("lib/normalize-image.ts");
const { isPublicImageAddress, downloadPublicImage } = await load("lib/public-image-download.ts");
const { normalizeStoredImage } = await load("lib/normalize-stored-image.ts");

test("photo noise respects output size/dimensions, auto-orients and strips metadata", async () => {
  const input = await sharp(randomBytes(2400 * 1800 * 3), { raw: { width: 2400, height: 1800, channels: 3 } }).jpeg().withMetadata({ orientation: 6 }).toBuffer();
  const output = await normalizeImage(input);
  const metadata = await sharp(output.data).metadata();
  assert.ok(output.bytes <= 500 * 1024); assert.ok(output.width <= 1600); assert.ok(output.height <= 1600);
  assert.ok(output.height > output.width, "EXIF rotation must be applied");
  assert.equal(metadata.format, "webp"); assert.equal(metadata.exif, undefined); assert.equal(metadata.icc, undefined);
});
test("small transparent images are not enlarged or cropped; malformed/oversize images fail", async () => {
  const input = await sharp({ create: { width: 48, height: 32, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer();
  const output = await normalizeImage(input);
  assert.equal(output.width, 48); assert.equal(output.height, 32);
  assert.equal((await sharp(output.data).metadata()).hasAlpha, true);
  await assert.rejects(normalizeImage(Buffer.from("not an image")));
  await assert.rejects(normalizeImage(Buffer.alloc(10 * 1024 * 1024 + 1)), /10 MB/);
  const svg = Buffer.from('<svg width="100" height="100"><rect width="100" height="100"/></svg>');
  await assert.rejects(normalizeImage(svg));
});
test("animated GIF stays animated and retains frame timing within the same byte ceiling", async () => {
  const frame = color => sharp({ create: { width: 24, height: 16, channels: 4, background: color } }).png().toBuffer();
  const input = await sharp([await frame("red"), await frame("blue")], { join: { animated: true } }).gif({ delay: [120, 180], loop: 0 }).toBuffer();
  const image = await normalizeImage(input); const metadata = await sharp(image.data, { animated: true }).metadata();
  assert.equal(metadata.pages, 2); assert.deepEqual(metadata.delay, [120, 180]);
  assert.equal(image.height, 16); assert.ok(image.bytes <= 500 * 1024);
});
test("server publication uses immutable normalized keys and reserves staff assets before upload", async () => {
  const original = await sharp({ create: { width: 2200, height: 1800, channels: 3, background: "orange" } }).jpeg().toBuffer();
  const objects = new Map([["owner/beauty/image/original.webp", original]]); const calls = [];
  const client = { storage: { from: () => ({ download: async path => ({ data: new Blob([objects.get(path)]), error: null }),
    upload: async (path, bytes, opts) => { calls.push("upload"); assert.equal(opts.upsert, false); objects.set(path, bytes); return { error: null }; } }) } };
  const result = await normalizeStoredImage(client, "bucket", "owner/beauty/image/original.webp", async () => { calls.push("reserve"); });
  assert.deepEqual(calls, ["reserve", "upload"]); assert.match(result.path, /\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.webp$/);
  assert.equal(objects.get("owner/beauty/image/original.webp"), original);
  const again = await normalizeStoredImage(client, "bucket", result.path);
  assert.deepEqual(again, result); assert.equal(calls.length, 2, "retries must not recompress an optimized object");
});
test("remote image importer rejects internal, link-local, multicast and credentialed URLs", async () => {
  for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "224.0.0.1", "::1", "::ffff:127.0.0.1"]) assert.equal(isPublicImageAddress(ip), false, ip);
  assert.equal(isPublicImageAddress("8.8.8.8"), true);
  for (const url of ["http://example.com/a.png", "https://user:pass@example.com/a.png", "https://127.0.0.1/a.png", "https://example.com:8080/a.png"]) await assert.rejects(downloadPublicImage(url));
});
