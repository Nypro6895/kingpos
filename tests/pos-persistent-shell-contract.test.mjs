import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const layout = fs.readFileSync(
  "app/(app)/pos/portable/layout.tsx",
  "utf8",
);
const tabs = fs.readFileSync(
  "app/pos/portable/portable-workspace-tabs.tsx",
  "utf8",
);

test("portable POS uses a persistent responsive workspace shell", () => {
  assert.match(layout, /data-pos-persistent-workspace/);
  assert.match(layout, /PortableWorkspaceTabs/);
  assert.doesNotMatch(layout, /PortableFloatingNav/);
  assert.match(layout, /label: "Ticket"/);
  assert.match(layout, /link\.id === "book"/);
  assert.match(layout, /link\.id === "checkIn"/);
  assert.match(layout, /link\.id === "report"/);
});

test("workspace tabs prefetch sibling views for app-like switching", () => {
  assert.match(tabs, /router\.prefetch\(item\.href\)/);
  assert.match(tabs, /requestIdleCallback/);
  assert.match(tabs, /prefetch/);
  assert.match(tabs, /grid-cols-4/);
  assert.match(tabs, /aria-current/);
});

test("workspace shell keeps capability enforcement in the server layout", () => {
  assert.match(layout, /PORTABLE_POS_CAPABILITIES\.posUse/);
  assert.match(layout, /PORTABLE_POS_CAPABILITIES\.bookView/);
  assert.match(layout, /PORTABLE_POS_CAPABILITIES\.checkInUse/);
  assert.match(layout, /PORTABLE_POS_CAPABILITIES\.reportView/);
});
