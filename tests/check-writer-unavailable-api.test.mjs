import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";

// Negative release-gate tests only. The throwing fences cannot authenticate,
// query storage, render a PDF, or simulate successful provider acceptance.
const calls = [];
globalThis.__checkWriterUnavailableCalls = calls;
const fail = (name) => `function forbidden(){globalThis.__checkWriterUnavailableCalls.push(${JSON.stringify(name)});throw Error('Unexpected side effect: ${name}');}`;

async function load(entry, { actualContext = false } = {}) {
  const fences = {
    "server-only": "",
    "@supabase/supabase-js": `${fail("auth/client")} export const createClient=forbidden;`,
    "next/headers": `${fail("cookies")} export const cookies=forbidden;`,
    "next/cache": `${fail("cache/revalidate")} export const revalidatePath=forbidden;`,
    "@/lib/tax-activation": `${fail("tax/activation")} export const taxActivationHref=forbidden;`,
    "@/lib/market-plugins": `${fail("workspace/context")} export const marketPluginContext=forbidden;`,
    "@/lib/market-payments": `${fail("provider/storage")} export const marketServiceClient=forbidden;`,
    "@/lib/current-context": `${fail("business/context")} export const getCurrentBusinessContext=forbidden;`,
    "@/lib/salon-business-clock": `${fail("business/date")} export const getContextBusinessDate=forbidden;`,
    "@/lib/payroll": `${fail("payroll/read")} export const getPayrollPageData=forbidden;`,
    "@/lib/supabase/server": "export const ACCESS_TOKEN_COOKIE='unused-test-cookie';",
    "@/lib/check-writer-crypto": `${fail("bank/crypto")} export const encryptBank=forbidden,unlockToken=forbidden,validUnlock=forbidden,checkWriterCryptoReady=forbidden;`,
    "./check-writer-crypto": `${fail("bank/crypto")} export const checkWriterCryptoReady=forbidden;`,
  };
  if (!actualContext) {
    fences["@/lib/check-writer-server"] = `${fail("check/context")} export const checkWriterContext=forbidden,checkWriterState=forbidden;export const UNLOCK_COOKIE='unused-test-cookie';`;
  }
  const result = await build({
    entryPoints: [entry], bundle: true, platform: "node", format: "esm",
    packages: "external", write: false, metafile: true,
    plugins: [{
      name: "unavailable-negative-fences",
      setup(builder) {
        builder.onResolve({ filter: /.*/ }, (args) => Object.hasOwn(fences, args.path)
          ? { path: args.path, namespace: "unavailable-fence" } : null);
        builder.onLoad({ filter: /.*/, namespace: "unavailable-fence" }, (args) => ({ contents: fences[args.path] }));
      },
    }],
  });
  const module = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);
  return { module, inputs: Object.keys(result.metafile.inputs) };
}

function request(path, body, origin = "https://reylumi.test") {
  return new Request(`https://reylumi.test${path}`, {
    method: "POST", headers: { "content-type": "application/json", origin },
    body: JSON.stringify(body),
  });
}

function unreadableBody(req) {
  return new Proxy(req, {
    get(target, key) {
      if (["body", "text", "json", "arrayBuffer", "formData"].includes(key)) {
        calls.push("request/body");
        throw Error("Request body must not be read");
      }
      const value = Reflect.get(target, key, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

function privateResponse(response, status) {
  assert.equal(response.status, status);
  assert.match(response.headers.get("cache-control"), /private/);
  assert.match(response.headers.get("cache-control"), /no-store/);
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
}

test("release gate rejects new and unknown operations; only existing safety names remain eligible", async () => {
  const { module: gate } = await load("lib/check-writer-availability.ts");
  assert.equal(gate.CHECK_WRITER_PRINTING_AVAILABLE, false);
  assert.throws(() => gate.assertCheckWriterPrintingAvailable(), { message: "Print Check is not available." });
  for (const action of ["settings", "alignment", "preview", "issue", "dispatch", "new_action", "toString", undefined, null, {}, 1]) {
    assert.equal(gate.checkWriterActionAvailable(action), false);
  }
  for (const action of ["lock", "unlock", "void", "recover_creation", "cancel_creation", "print_confirmed", "print_failed"]) {
    assert.equal(gate.checkWriterActionAvailable(action), true);
  }
});

test("sales and trial flags cannot reopen unavailable printing or invoke crypto", async () => {
  const saved = [process.env.CHECK_WRITER_SALES_ENABLED, process.env.CHECK_WRITER_TRIAL_ENABLED];
  calls.length = 0;
  try {
    process.env.CHECK_WRITER_SALES_ENABLED = "true";
    process.env.CHECK_WRITER_TRIAL_ENABLED = "true";
    const { module: readiness } = await load("lib/check-writer-readiness.ts");
    assert.equal(readiness.checkWriterSalesReady(), false);
    assert.equal(readiness.checkWriterTrialReady(), false);
    assert.deepEqual(calls, []);
  } finally {
    for (const [index, name] of ["CHECK_WRITER_SALES_ENABLED", "CHECK_WRITER_TRIAL_ENABLED"].entries()) {
      if (saved[index] === undefined) delete process.env[name]; else process.env[name] = saved[index];
    }
  }
});

test("new API operations return unavailable before context, provider, reservation, or crypto work", async () => {
  const { module: api } = await load("app/api/check-writer/route.ts");
  calls.length = 0;
  for (const action of ["settings", "alignment", "preview", "issue", "dispatch", "unknown", null, undefined]) {
    const response = await api.POST(request("/api/check-writer", { action }));
    privateResponse(response, 503);
    assert.deepEqual(await response.json(), { error: "Print Check is not available." });
  }
  assert.deepEqual(calls, []);
});

test("trial start fails before context while existing trial status still requires its original context", async () => {
  const { module: trial } = await load("app/market/trial-actions.ts");
  calls.length = 0;
  assert.deepEqual(await trial.marketTrialAction("print-check", true), { error: "Print Check is not available." });
  assert.deepEqual(calls, []);
  // A status read reaches a throwing authorization fence, not a fake success.
  assert.deepEqual(await trial.marketTrialAction("print-check", false, "unused"), { error: "Unexpected side effect: workspace/context" });
  assert.deepEqual(calls, ["workspace/context"]);
});

test("API same-origin rejection still precedes body and unavailable processing", async () => {
  const { module: api } = await load("app/api/check-writer/route.ts");
  calls.length = 0;
  const response = await api.POST(unreadableBody(request("/api/check-writer", { action: "issue" }, "https://foreign.test")));
  privateResponse(response, 403);
  assert.deepEqual(await response.json(), { error: "Invalid request origin." });
  assert.deepEqual(calls, []);
});

test("paid context defense rejects direct callers before workspace, auth, storage or payroll calls", async () => {
  const { module: server } = await load("lib/check-writer-server.ts", { actualContext: true });
  calls.length = 0;
  await assert.rejects(server.checkWriterContext(true, true), { message: "Print Check is not available." });
  assert.deepEqual(calls, []);
});

test("PDF route preserves origin guard and rejects even an unreadable body without financial dependencies", async () => {
  const { module: pdf, inputs } = await load("app/api/check-writer/pdf/route.ts");
  calls.length = 0;
  const response = await pdf.POST(unreadableBody(request("/api/check-writer/pdf", { ids: [] })));
  privateResponse(response, 503);
  assert.equal(response.headers.get("referrer-policy"), "no-referrer");
  assert.deepEqual(await response.json(), { error: "Print Check is not available." });
  const denied = await pdf.POST(unreadableBody(request("/api/check-writer/pdf", {}, "null")));
  privateResponse(denied, 403);
  assert.deepEqual(calls, []);
  assert.ok(inputs.every((file) => !/check-writer-(?:server|crypto|pdf|request)|fontkit|pdf-lib/.test(file)));
});

test("typed PDF stub rejects without inspecting records or importing a font, bank or PDF implementation", async () => {
  const { module: pdf, inputs } = await load("lib/check-writer-pdf.ts");
  calls.length = 0;
  const untouched = new Proxy({}, { get() { calls.push("pdf/argument"); throw Error("Do not inspect private inputs"); } });
  await assert.rejects(pdf.checkPdf(untouched, "unused", false, untouched), { message: "Print Check is not available." });
  assert.deepEqual(calls, []);
  assert.ok(inputs.every((file) => /lib[\\/]check-writer-(?:pdf|availability)\.ts$/.test(file)));
});
