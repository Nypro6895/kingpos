import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("workspace profile permits booking only for a published salon that is not permanently closed", () => {
  const source = readFileSync("app/(app)/salon-profile/page.tsx", "utf8");
  const expression = source.match(/canBook: (.*),/)?.[1];
  assert.ok(expression);
  const canBook = new Function("publicData", "viewData", `return ${expression};`);
  for (const kind of ["open", "closed", "hours_not_set"]) {
    assert.equal(canBook({}, { profile: { operatingStatus: { kind } } }), true);
  }
  assert.equal(canBook(null, { profile: { operatingStatus: { kind: "open" } } }), false);
  assert.equal(canBook({}, { profile: { operatingStatus: { kind: "permanently_closed" } } }), false);
});
