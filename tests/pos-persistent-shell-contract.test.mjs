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
const ownerPage = fs.readFileSync("app/(app)/pos/page.tsx", "utf8");
const portablePage = fs.readFileSync(
  "app/(app)/pos/portable/page.tsx",
  "utf8",
);
const ownerTabs = fs.readFileSync(
  "app/pos/pos-owner-workspace-tabs.tsx",
  "utf8",
);
const rapidBridge = fs.readFileSync(
  "app/pos/pos-rapid-mobile-bridge.tsx",
  "utf8",
);
const rapidStyles = fs.readFileSync(
  "app/pos/pos-rapid-mobile.module.css",
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
  assert.match(ownerTabs, /router\.prefetch\(tab\.href\)/);
  assert.match(ownerTabs, /Ticket/);
  assert.match(ownerTabs, /Book/);
  assert.match(ownerTabs, /Check In/);
  assert.match(ownerTabs, /Report/);
});

test("workspace shell keeps capability enforcement in the server layout", () => {
  assert.match(layout, /PORTABLE_POS_CAPABILITIES\.posUse/);
  assert.match(layout, /PORTABLE_POS_CAPABILITIES\.bookView/);
  assert.match(layout, /PORTABLE_POS_CAPABILITIES\.checkInUse/);
  assert.match(layout, /PORTABLE_POS_CAPABILITIES\.reportView/);
});

test("owner and portable ticket surfaces share the rapid mobile presentation layer", () => {
  for (const page of [ownerPage, portablePage]) {
    assert.match(page, /PosRapidMobileBridge/);
    assert.match(page, /data-pos-rapid-host/);
    assert.match(page, /data-pos-rapid-engine/);
    assert.match(page, /surface="portable"/);
  }
});

test("rapid mobile flow is service first and keeps the existing POS engine as source of truth", () => {
  assert.match(rapidBridge, /data-pos-service-tile/);
  assert.match(rapidBridge, /setStage\("staff"\)/);
  assert.match(rapidBridge, /chooseStaffForNewService/);
  assert.match(rapidBridge, /applyService\(pendingService\)/);
  assert.match(rapidBridge, /setStage\("amount"\)/);
  assert.match(rapidBridge, /data-pos-keypad-clear/);
  assert.match(rapidBridge, /data-pos-receipt-line-item/);
  assert.match(rapidBridge, /data-pos-receipt-line-remove/);
  assert.match(rapidBridge, /Checkout/);
  assert.doesNotMatch(rapidBridge, /calculateTicketTotals/);
  assert.doesNotMatch(rapidBridge, /supabase/);
});

test("mobile presentation hides engine panels and keeps services inside the viewport", () => {
  assert.match(rapidStyles, /max-width: 767px/);
  assert.match(rapidStyles, /data-pos-receipt-panel/);
  assert.match(rapidStyles, /data-pos-amount-panel/);
  assert.match(rapidStyles, /data-pos-service-workspace/);
  assert.match(rapidStyles, /overflow-y: auto/);
  assert.match(rapidStyles, /env\(safe-area-inset-bottom\)/);
});

test("mobile receipt exposes direct service, technician, amount, remove, and checkout actions", () => {
  assert.match(rapidBridge, /service-edit/);
  assert.match(rapidBridge, /staff-edit/);
  assert.match(rapidBridge, /focusReceiptLine/);
  assert.match(rapidBridge, /removeReceiptLine/);
  assert.match(rapidBridge, /submitReceipt/);
  assert.match(rapidBridge, /text-brand-orange/);
});
