import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
const built = await build({
  entryPoints: ["lib/market-platform/published-contract.ts"],
  bundle: true,
  write: false,
  platform: "node",
  format: "esm",
});
const { parsePublicPrice, publicPriceInput } = await import(
  "data:text/javascript;base64," +
    Buffer.from(built.outputFiles[0].text).toString("base64")
);
test("Owner price input converts major units exactly without rounding extra decimals", () => {
  assert.equal(parsePublicPrice("25.50", "USD"), 2550);
  assert.equal(parsePublicPrice("0", "USD"), 0);
  assert.equal(parsePublicPrice("2500", "JPY"), 2500);
  assert.equal(parsePublicPrice("1.234", "KWD"), 1234);
  for (const x of ["1.234", "1e3", "-1", "", "99999999.99"])
    assert.equal(parsePublicPrice(x, "USD"), null);
  assert.equal(parsePublicPrice("1.0", "JPY"), null);
  assert.equal(publicPriceInput(2550, "USD"), "25.50");
  assert.equal(publicPriceInput(null, "USD"), "");
});
