import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

async function flag(define = {}) {
  const result = await build({ entryPoints: ["lib/services-catalog-native-flag.ts"], bundle: true, write: false, format: "cjs", platform: "node", define, logLevel: "silent" });
  const output = { exports: {} };
  new Function("module", "exports", result.outputFiles[0].text)(output, output.exports);
  return output.exports.servicesCatalogNativePilotEnabled();
}

test("native Services pilot is disabled when the compile-time flag is absent", async () => {
  assert.equal(await flag(), false);
});
test("native Services pilot is disabled in ordinary explicitly false bundles", async () => {
  assert.equal(await flag({ __REYLUMI_SERVICES_CATALOG_QA__: "false" }), false);
});
test("native Services pilot requires the exact compile-time boolean true", async () => {
  assert.equal(await flag({ __REYLUMI_SERVICES_CATALOG_QA__: "true" }), true);
  assert.equal(await flag({ __REYLUMI_SERVICES_CATALOG_QA__: '"true"' }), false);
  assert.equal(await flag({ __REYLUMI_SERVICES_CATALOG_QA__: "1" }), false);
});

const guardedFiles = ["ios/Reylumi/LocalAppBundle/app.js", "ios/Reylumi/LocalAppBundle/app.css", "ios/Reylumi/LocalAppBundle/manifest.json", "lib/app-local-commands-server.generated.ts", "lib/app-local-command-trace-names.generated.json"];
const hashes = () => guardedFiles.map(file => createHash("sha256").update(readFileSync(file)).digest("hex"));
for (const [name, args, env] of [
  ["activated bundle", ["--services-catalog-pilot-qa", "--activate"], { VERCEL_ENV: "preview" }],
  ["production target", ["--services-catalog-pilot-qa"], { VERCEL_ENV: "production" }],
]) {
  test(`builder rejects the QA pilot for an ${name} before writing product assets`, () => {
    const before = hashes();
    const result = spawnSync(process.execPath, ["scripts/build-app-local-bundle.mjs", ...args], { encoding: "utf8", env: { ...process.env, ...env }, timeout: 20_000 });
    assert.equal(result.error, undefined);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Services catalog pilot is available only in a non-activated QA bundle/);
    assert.deepEqual(hashes(), before);
  });
}
