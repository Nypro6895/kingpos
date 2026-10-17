import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
const built = await build({ entryPoints: ["lib/advertising-client.ts"], bundle: true, write: false, platform: "browser", format: "esm" });
const { adRequest, prepareAdImage } = await import("data:text/javascript;base64," + Buffer.from(built.outputFiles[0].text).toString("base64"));
test("ad network deadline aborts a stalled response without retrying a possible committed view", async () => {
  const original = globalThis.fetch; let calls = 0;
  globalThis.fetch = async (_url, init) => { calls++; return new Promise((_resolve, reject) => init.signal.addEventListener("abort", () => reject(new Error("Aborted")))); };
  try { await assert.rejects(adRequest("/ads", { method: "POST" }, 20), /Aborted/); assert.equal(calls, 1); }
  finally { globalThis.fetch = original; }
});
test("navigation abort propagates through an in-flight ad response", async () => {
  const original = globalThis.fetch; const controller = new AbortController();
  globalThis.fetch = async (_url, init) => new Promise((_resolve, reject) => init.signal.addEventListener("abort", () => reject(new Error("Navigation cancelled"))));
  try { const pending = adRequest("/ads", { signal: controller.signal }); controller.abort(); await assert.rejects(pending, /cancelled/); }
  finally { globalThis.fetch = original; }
});
test("image prepare deadline and navigation cancellation do not report readiness", async () => {
  const original = globalThis.Image;
  globalThis.Image = class { set src(value) { this.value = value; } };
  try {
    assert.equal(await prepareAdImage("/image", new AbortController().signal, 20), false);
    const controller = new AbortController(); const pending = prepareAdImage("/image", controller.signal); controller.abort();
    assert.equal(await pending, false);
  } finally { globalThis.Image = original; }
});
