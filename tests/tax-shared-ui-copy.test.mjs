import test from "node:test";
import assert from "node:assert/strict";
import { copyOccurrences, loadDictionary } from "../scripts/workspace-copy-catalog.mjs";

test("new shared Tax sheet, item settings and loading copy has Vietnamese coverage", () => {
  const dictionary = loadDictionary();
  const files = ["app/tax/tax-figures-sheet.tsx", "app/tax/tax-report-loading.tsx", "app/payroll/payroll-tax-item-fields.tsx"];
  const missing = files.flatMap(copyOccurrences).filter(row => !dictionary[row.text]);
  assert.deepEqual(missing, []);
});
