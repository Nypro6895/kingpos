import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
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
test("publishing updates local UI without refreshing the root layout or route", () => {
  const view = readFileSync("app/salon-profile/salon-profile-view.tsx", "utf8");
  const composer = view.slice(view.indexOf("function ComposerModal("), view.indexOf("function Avatar("));
  assert.doesNotMatch(composer, /router\.refresh|window\.location|location\.reload/);
  assert.match(composer, /onPosted\(result\)/);
  const actions = readFileSync("app/salon-profile/actions.ts", "utf8");
  const publish = actions.slice(actions.indexOf("export async function createSalonProfileSocialPostAction("), actions.indexOf("export async function setSalonProfilePublicationAction("));
  assert.doesNotMatch(publish, /revalidateSalonProfile|revalidatePath|redirect\(/);
  assert.match(publish, /error: null, \.\.\.result/);
});
