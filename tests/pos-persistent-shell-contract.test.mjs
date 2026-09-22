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
const portableRoutes = fs.readFileSync("lib/pos-portable-routes.ts", "utf8");
const ownerPage = fs.readFileSync("app/(app)/pos/page.tsx", "utf8");
const portablePage = fs.readFileSync(
  "app/(app)/pos/portable/page.tsx",
  "utf8",
);
const ownerTabs = fs.readFileSync(
  "app/pos/pos-owner-workspace-tabs.tsx",
  "utf8",
);
const posDeskClient = fs.readFileSync("app/pos/pos-desk-client.tsx", "utf8");
const workspaceRefresh = fs.readFileSync(
  "app/pos/pos-workspace-realtime-refresh.tsx",
  "utf8",
);
const bookingsPage = fs.readFileSync("app/(app)/bookings/page.tsx", "utf8");
const staffTodayPage = fs.readFileSync(
  "app/(app)/staff/today/page.tsx",
  "utf8",
);
const reportsPage = fs.readFileSync("app/(app)/reports/page.tsx", "utf8");
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
  assert.match(layout, /label: "Ticket"/);
  assert.match(layout, /PORTABLE_POS_ROUTE_LINKS\.filter/);
  assert.match(tabs, /items\.map/);
  assert.match(portableRoutes, /label: "Check In"/);
  assert.ok(
    portableRoutes.indexOf('id: "book"') <
      portableRoutes.indexOf('id: "checkIn"'),
    "Portable POS tabs should order Book before Check In.",
  );
});

test("workspace tabs prefetch sibling views for app-like switching", () => {
  assert.match(tabs, /router\.prefetch\(item\.href\)/);
  assert.match(tabs, /requestIdleCallback/);
  assert.match(tabs, /prefetch/);
  assert.match(tabs, /grid-cols-4/);
  assert.match(tabs, /aria-current/);
  assert.match(tabs, /PosWorkspaceRealtimeRefresh/);
  assert.match(tabs, /salonId/);
  assert.match(ownerTabs, /router\.prefetch\(tab\.href\)/);
  assert.match(ownerTabs, /PosWorkspaceRealtimeRefresh/);
  assert.match(ownerTabs, /salonId/);
  assert.match(ownerTabs, /Ticket/);
  assert.match(ownerTabs, /Book/);
  assert.match(ownerTabs, /Check In/);
  assert.match(ownerTabs, /Report/);
  assert.match(workspaceRefresh, /POS_STAFF_BROADCAST_EVENT/);
  assert.match(workspaceRefresh, /router\.refresh\(\)/);
});

test("owner workspace tabs are shared by ticket, booking, check-in, and report pages", () => {
  for (const page of [ownerPage, bookingsPage, staffTodayPage, reportsPage]) {
    assert.match(page, /PosOwnerWorkspaceTabs/);
    assert.match(page, /salonId=/);
  }
});

test("workspace shell keeps capability enforcement in the server layout", () => {
  assert.match(layout, /PORTABLE_POS_CAPABILITIES\.posUse/);
  assert.match(layout, /PORTABLE_POS_CAPABILITIES\.bookView/);
  assert.match(layout, /PORTABLE_POS_CAPABILITIES\.checkInUse/);
  assert.match(layout, /PORTABLE_POS_CAPABILITIES\.reportView/);
});

test("owner ticket restores desktop controls while keeping rapid mobile mounted", () => {
  assert.match(ownerPage, /PosRapidMobileBridge/);
  assert.match(ownerPage, /data-pos-owner-page/);
  assert.match(ownerPage, /data-pos-rapid-host/);
  assert.match(ownerPage, /data-pos-rapid-engine/);
  assert.match(ownerPage, /Owner POS tools/);
  assert.match(ownerPage, /Portable POS/);
  assert.match(ownerPage, /Customer POS/);
  assert.match(ownerPage, /POS Setting/);
  assert.match(ownerPage, /POS Tickets/);
  assert.match(ownerPage, /Customer Display/);
  assert.match(ownerPage, /PosOwnerWorkspaceTabs salonId=\{salonId\}/);
  assert.doesNotMatch(ownerPage, /surface="portable"/);
  assert.match(posDeskClient, /data-pos-desk-root/);
  assert.match(posDeskClient, /data-pos-desk-surface=\{surface\}/);
});

test("portable ticket surface keeps the rapid mobile presentation and portable surface", () => {
  assert.match(portablePage, /PosRapidMobileBridge/);
  assert.match(portablePage, /data-pos-rapid-host/);
  assert.match(portablePage, /data-pos-rapid-engine/);
  assert.match(portablePage, /surface="portable"/);
});

test("rapid mobile flow is service first and keeps the existing POS engine as source of truth", () => {
  assert.match(rapidBridge, /data-pos-service-tile/);
  assert.match(rapidBridge, /setStage\("staff"\)/);
  assert.match(rapidBridge, /chooseNewStaff/);
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
  const mobileMediaIndex = rapidStyles.indexOf("@media (max-width: 767px)");
  const headerSearchIndex = rapidStyles.indexOf(
    '[data-testid="customer-desktop-header"] form[role="search"]',
  );

  assert.match(rapidStyles, /max-width: 767px/);
  assert.ok(mobileMediaIndex >= 0, "mobile breakpoint is present");
  assert.ok(
    headerSearchIndex > mobileMediaIndex,
    "desktop header search override stays inside the mobile breakpoint",
  );
  assert.match(rapidStyles, /data-pos-desk-root/);
  assert.match(rapidStyles, /data-pos-receipt-panel/);
  assert.match(rapidStyles, /data-pos-amount-panel/);
  assert.match(rapidStyles, /data-pos-service-workspace/);
  assert.match(rapidStyles, /overflow-y: auto/);
  assert.match(rapidStyles, /env\(safe-area-inset-bottom\)/);
});

test("mobile receipt exposes direct service, technician, amount, remove, and checkout actions", () => {
  assert.match(rapidBridge, /service-edit/);
  assert.match(rapidBridge, /staff-edit/);
  assert.match(rapidBridge, /focusLine/);
  assert.match(rapidBridge, /removeLine/);
  assert.match(rapidBridge, /checkout/);
  assert.match(rapidBridge, /text-brand-orange/);
});
