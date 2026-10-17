import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";
import { mergePublishedItems } from "../lib/salon-profile-published.ts";

test("newly published posts appear immediately without dropping existing posts", () => {
  const result = mergePublishedItems([{ id: "new", caption: "Just published" }], [{ id: "older" }]);
  assert.deepEqual(result.map((post) => post.id), ["new", "older"]);
});
test("later server data deduplicates the new post and keeps updated counters", () => {
  const result = mergePublishedItems([{ id: "new", commentCount: 0 }], [{ id: "new", commentCount: 2 }, { id: "older" }]);
  assert.equal(result.length, 2);
  assert.equal(result[0].commentCount, 2);
});
test("publishing updates local UI without reloading the document", () => {
  const view = readFileSync("app/salon-profile/salon-profile-view.tsx", "utf8");
  const composer = view.slice(view.indexOf("function ComposerModal("), view.indexOf("function Avatar("));
  assert.doesNotMatch(composer, /router\.refresh|window\.location|location\.reload/);
  assert.match(composer, /onPosted\(result\)/);
});

function publishAction(dependencies) {
  const source = readFileSync("app/salon-profile/actions.ts", "utf8");
  const ast = ts.createSourceFile("actions.ts", source, ts.ScriptTarget.Latest, true);
  const node = ast.statements.find((item) => ts.isFunctionDeclaration(item) && item.name?.text === "createSalonProfileSocialPostAction");
  assert.ok(node, "The real publish server action must be present");
  const code = ts.transpileModule(source.slice(node.getStart(ast), node.end), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  vm.runInNewContext(code, { exports, ...dependencies });
  return exports.createSalonProfileSocialPostAction;
}

test("successful publication preserves the targeted Salon cache update and returns the new post", async () => {
  const invalidations = [];
  const post = { id: "new", caption: "Fresh manicure" };
  const look = { id: "new" };
  const action = publishAction({
    createCurrentSalonProfileSocialPost: async () => ({ post, look }),
    revalidatePath: (...args) => invalidations.push(args),
    deleteCurrentSalonProfileMedia: async () => assert.fail("Successful publication must keep its media"),
  });
  const result = await action({ salonId: "salon", caption: "Fresh manicure", imagePath: "owned/image.webp" });
  assert.equal(result.error, null);
  assert.equal(result.post, post);
  assert.equal(result.look, look);
  assert.ok(invalidations.some(([path]) => path === "/salon-profile"), "Keep the mutation signal used to refresh retained Salon pages");
  assert.ok(invalidations.every(([path, type]) => path !== "/" && type !== "layout"), "Publication must not invalidate the root or a whole layout");
});

test("failed publication keeps the failure recoverable and does not invalidate successful page data", async () => {
  const invalidations = [];
  const cleanup = [];
  const action = publishAction({
    createCurrentSalonProfileSocialPost: async () => { throw new Error("Please retry publication."); },
    revalidatePath: (...args) => invalidations.push(args),
    deleteCurrentSalonProfileMedia: async (path) => cleanup.push(path),
    Error,
  });
  const result = await action({ salonId: "salon", caption: "Fresh manicure", imagePath: "owned/image.webp" });
  assert.equal(result.error, "Please retry publication.");
  assert.deepEqual(invalidations, []);
  assert.deepEqual(cleanup, ["owned/image.webp"]);
});
