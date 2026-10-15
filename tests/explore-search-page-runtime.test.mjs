import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";

test("search continuation preserves manual location, GPS, filters and requested page", async () => {
  const calls = [];
  const exports = {};
  const result = { results: [], error: null, totalPages: 3 };
  const code = ts.transpileModule(readFileSync("app/explore/actions.ts", "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText;
  vm.runInNewContext(code, { exports, require: (name) => name === "@/lib/explore-search"
    ? { searchExploreSalons: async (input) => { calls.push(input); return result; } }
    : {} });
  const manual = { query: "Madison Nail", category: "Nails", location: "WI", page: 2, pageSize: 12 };
  assert.equal(await exports.loadExploreSearchPageAction(manual), result);
  assert.equal(calls[0], manual);
  const gps = { ...manual, location: "", latitude: 47.6, longitude: -122.3, page: 3 };
  assert.equal(await exports.loadExploreSearchPageAction(gps), result);
  assert.equal(calls[1], gps);
  const token = { id: "anchor", rank: 80 };
  await exports.searchExploreWithGpsAction({ ...gps, cursor: token });
  assert.equal(calls[2].cursor, token);
  assert.equal(calls[2].location, "");
  assert.equal(calls[2].latitude, 47.6);
});
