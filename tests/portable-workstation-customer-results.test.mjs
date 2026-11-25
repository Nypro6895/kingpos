import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

function requestFixture(status, result) {
  const exports = {};
  const compiled = ts.transpileModule(fs.readFileSync("lib/portable-workstation-client.ts", "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(compiled, {
    exports, require: name => name.endsWith("app-local-host") ? { getAppLocalHost: () => ({ isNative: false }) } : {},
    fetch: async () => Response.json(result, { status }), AbortSignal, Response,
  });
  return exports.workstationRequest;
}

test("successful customer responses preserve required profile and identity selection steps", async () => {
  for (const code of ["profile_required", "identity_choice_required"]) {
    const result = { ok: false, code, error: "Choose the next check-in step.", candidates: [{ id: "customer-one", name: "Linh" }] };
    const request = requestFixture(200, result);
    assert.deepEqual(await request({ action: "customerAction", command: "phone", input: { phone: "4145550101" } }), result);
  }
});

test("HTTP enrollment and connection failures remain rejected with their status", async () => {
  for (const status of [401, 403, 409, 503]) {
    const request = requestFixture(status, { error: "Connection requires attention." });
    await assert.rejects(request({ action: "customerAction", command: "phone" }), error => error.status === status && error.message === "Connection requires attention.");
  }
});
