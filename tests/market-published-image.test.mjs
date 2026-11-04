import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import sharp from "sharp";
const compiled = await build({
  entryPoints: ["lib/market-platform/published-image.ts"],
  bundle: true,
  write: false,
  platform: "node",
  format: "esm",
  external: ["sharp"],
});
// Import from an in-workspace temporary module so external sharp resolves normally.
const { writeFile, unlink } = await import("node:fs/promises");
const path = new URL(
  "../artifacts/market-published-data/image-test-compiled.mjs",
  import.meta.url,
);
await writeFile(path, compiled.outputFiles[0].text);
const { sanitizedPublicImage, boundedImageBody } = await import(path.href);
test.after(() => unlink(path));
test("actual image re-encoding strips EXIF and rejects oversized/non-image data", async () => {
  const input = await sharp({
    create: { width: 100, height: 80, channels: 3, background: "#a4c3b2" },
  })
    .jpeg()
    .withMetadata({ exif: { IFD0: { Artist: "Private original metadata" } } })
    .toBuffer();
  assert.ok((await sharp(input).metadata()).exif);
  const output = await sanitizedPublicImage(input);
  const info = await sharp(output).metadata();
  assert.equal(info.format, "webp");
  assert.equal(info.exif, undefined);
  assert.equal(info.xmp, undefined);
  await assert.rejects(sanitizedPublicImage(new Uint8Array(4194305)), /large/);
  await assert.rejects(sanitizedPublicImage(Buffer.from("not an image")));
});
test("bounded streaming rejects oversized input even with no content-length", async () => {
  const response = new Response(
    new ReadableStream({
      start(c) {
        c.enqueue(new Uint8Array(4194305));
        c.close();
      },
    }),
  );
  await assert.rejects(boundedImageBody(response), /large/);
});
