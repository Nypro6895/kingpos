import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
const output = await build({ entryPoints: ["lib/market-commerce.ts"], bundle: true, write: false, platform: "node", format: "esm" });
const { marketQuote, decimalUnits } = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString("base64")}`);
test("quotes round tax once and apply transaction fees to the tax-inclusive amount", () => {
  assert.deepEqual(marketQuote(590, 800, 200, 30), { baseCents: 590, taxCents: 47, feeCents: 43, totalCents: 680 });
  assert.equal(marketQuote(99, 0, 0, 0).totalCents, 99);
});
test("invalid money and rates cannot enter a quote", () => {
  for (const value of [-1, NaN, Infinity, 1.5, 100000001]) assert.throws(() => marketQuote(value, 0, 0, 0));
  for (const value of [-1, 10001, 0.5, NaN]) assert.throws(() => marketQuote(100, value, 0, 0));
  assert.throws(() => marketQuote(100, 0, 0, -1));
});
test("decimal input keeps cents exact and rejects malformed or missing settings", () => {
  assert.equal(decimalUnits("3.99", "price"), 399);
  assert.equal(decimalUnits("0.01", "rate"), 1);
  assert.equal(decimalUnits(" 8.5 ", "rate"), 850);
  for (const value of [null, "", "-1", "1e3", "1.001", "NaN", "1,50"]) assert.throws(() => decimalUnits(value, "price"));
});
