import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { transformSync } from "esbuild";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const compiledModule = { exports: {} };
new Function("module", transformSync(read("lib/pos-portable-capabilities.ts"), {
  loader: "ts", format: "cjs",
}).code)(compiledModule);
const message = compiledModule.exports.PORTABLE_TURN_ADJUST_DISABLED_MESSAGE;
const client = read("app/pos/pos-desk-client.tsx");
const open = client.slice(client.indexOf("  function openTurnAdjustment("), client.indexOf("  function handleStaffPointerDown("));

for (const allowed of [false, true]) {
  test(`opening turn adjustment with permission ${allowed}`, () => {
    const errors = [], opened = [];
    const run = new Function(
      "canAdjustStaffTurn", "PORTABLE_TURN_ADJUST_DISABLED_MESSAGE", "showError", "setTurnAdjustStaff",
      `const adjustStaffTurnAction = () => {}; const isPortableSurface = true;
       const clearStaffTurnHold = () => {};
       const setTurnAdjustDelta = () => {}, setTurnAdjustReason = () => {},
         setTurnAdjustOperatorPasscode = () => {}, setTurnAdjustOperatorStaffId = () => {},
         setTurnAdjustError = () => {}; const sortedStaff = [];
       ${transformSync(open, {loader: "ts"}).code}
       openTurnAdjustment({id: 'staff-1'});`,
    );
    run(allowed, message, (value) => errors.push(value), (value) => opened.push(value));
    assert.equal(opened.length, allowed ? 1 : 0);
    assert.deepEqual(errors, allowed ? [] : [message]);
  });
}

test("permission guidance remains actionable and translated", () => {
  assert.match(message, /admin/);
  assert.match(message, /POS Settings > Portable POS access/);
  assert.match(message, /Turn adjust/);
  assert.match(JSON.parse(read("lib/vietnamese-workspace-copy.json"))[message], /chưa được bật quyền chỉnh lượt/);
});

test("server keeps turn adjustment gated and uses the same guidance", () => {
  const actions = read("app/pos/portable/actions.ts");
  assert.match(actions, /if \(!hasPortableCapability\(context.portableSession, capability\)\) \{\s*if \(capability === PORTABLE_POS_CAPABILITIES.turnAdjust\) \{\s*throw new Error\(PORTABLE_TURN_ADJUST_DISABLED_MESSAGE\)/);
  assert.match(actions, /canAdjustStaffTurn: hasPortableCapability\(portableSession, PORTABLE_POS_CAPABILITIES.turnAdjust\)/);
  assert.match(read("app/(app)/pos/portable/page.tsx"), /canAdjustStaffTurn=\{data.canAdjustStaffTurn\}/);
});
