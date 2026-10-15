import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

function load(file, dependencies = {}, globals = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(readFileSync(file, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, {
    exports, URL, URLSearchParams, Error,
    require(name) { assert.ok(name in dependencies, name); return dependencies[name]; },
    ...globals,
  });
  return exports;
}

test("workspace switches navigate the document without mutating the current page session", () => {
  const documents = [];
  const api = load("lib/workspace-navigation.ts", {}, {
    window: { location: { assign: href => documents.push(new URL(href, "https://app.test")) } },
    fetch() { assert.fail("Workspace identity must not change through a background request"); },
  });
  api.navigateToWorkspace("personal");
  api.navigateToWorkspace("manage:a&workspace_id=foreign", "/salon-profile?tab=photos&from=my-place#gallery");
  assert.equal(documents[0].pathname, "/workspace/open");
  assert.equal(documents[0].searchParams.get("workspace_id"), "personal");
  assert.equal(documents[0].searchParams.has("destination"), false);
  assert.equal(documents[1].searchParams.getAll("workspace_id").length, 1);
  assert.equal(documents[1].searchParams.get("workspace_id"), "manage:a&workspace_id=foreign");
  assert.equal(documents[1].searchParams.get("destination"), "/salon-profile?tab=photos&from=my-place#gallery");
});

function fixture({ signedIn = true, removed = false, writeFailure = false } = {}) {
  const writes = [], invalidations = [];
  const options = [
    { id: "personal", home: "/explore", allowed: ["/explore", "/my-place"] },
    { id: "manage:salon", home: "/pos", allowed: ["/pos", "/salon-profile"] },
    { id: "staff:salon", home: "/staff/today", allowed: ["/staff/today"] },
  ].filter(w => !removed || w.id === "personal");
  const route = load("app/(app)/workspace/open/route.ts", {
    "@/lib/auth-routing": { loginHrefForReturnPath: p => "/login?next=" + encodeURIComponent(p) },
    "@/lib/current-context": {
      getCurrentBusinessContext: async () => ({ user: signedIn ? { id: "viewer" } : null, workspaceOptions: options }),
      getWorkspaceLandingHref: w => w.home,
      isWorkspaceDestinationAllowed: (w, href) => w.allowed.includes(href),
      setNormalizedWorkspaceContext: async w => { if (writeFailure) throw Error("Session changed"); writes.push(w.id); },
    },
    "next/cache": { revalidatePath: (...args) => invalidations.push(args) },
    "next/server": { NextResponse: { redirect: url => Response.redirect(url, 307) } },
  });
  return { writes, invalidations, open: params => route.GET(new Request("https://app.test/workspace/open?" + new URLSearchParams(params))) };
}

test("personal, owner and staff handoffs select only the authorized workspace then redirect to its canonical home", async () => {
  for (const [id, home] of [["personal", "/explore"], ["manage:salon", "/pos"], ["staff:salon", "/staff/today"]]) {
    const f = fixture();
    const response = await f.open({ workspace_id: id });
    assert.equal(response.headers.get("location"), "https://app.test" + home);
    assert.deepEqual(f.writes, [id]);
    assert.deepEqual(f.invalidations, [["/", "layout"]]);
  }
});

test("explicit shortcuts retain their allowed query and fragment", async () => {
  const f = fixture();
  const response = await f.open({ workspace_id: "manage:salon", destination: "/salon-profile?tab=photos#gallery" });
  assert.equal(response.headers.get("location"), "https://app.test/salon-profile?tab=photos#gallery");
  assert.deepEqual(f.writes, ["manage:salon"]);
});

test("missing or removed membership and forbidden or external destinations never change workspace", async () => {
  for (const [options, params] of [
    [{}, {}], [{}, { workspace_id: "manage:foreign" }], [{ removed: true }, { workspace_id: "manage:salon" }],
    ...["/salon-profile", "/pos", "/admin"].map(destination => [{}, { workspace_id: "personal", destination }]),
    ...["https://outside.invalid", "//outside.invalid", "/\\outside.invalid", "/pos/../../admin", "/workspace/open"].map(destination => [{}, { workspace_id: "manage:salon", destination }]),
  ]) {
    const f = fixture(options), response = await f.open(params);
    assert.match(response.headers.get("location"), /^https:\/\/app.test\/my-place\?error=/);
    assert.deepEqual(f.writes, []);
    assert.deepEqual(f.invalidations, []);
  }
});

test("expired login preserves the handoff as its return path; session write failure does not open a protected page", async () => {
  const f = fixture({ signedIn: false });
  const response = await f.open({ workspace_id: "staff:salon" });
  const login = new URL(response.headers.get("location"));
  assert.equal(login.pathname, "/login");
  assert.equal(login.searchParams.get("next"), "/workspace/open?workspace_id=staff%3Asalon");
  assert.deepEqual(f.writes, []);
  const failed = fixture({ writeFailure: true });
  assert.match((await failed.open({ workspace_id: "manage:salon" })).headers.get("location"), /\/my-place\?error=Session/);
  assert.deepEqual(failed.invalidations, []);
});
