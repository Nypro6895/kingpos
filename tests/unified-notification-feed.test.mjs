import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
const source = readFileSync("lib/notification-feed-items.ts", "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText;
const module = { exports: {} };
new Function("require", "module", "exports", compiled)(
  () => ({
    getManageWorkspaceId: (id) => "manage:" + id,
    getStaffWorkspaceId: (id) => "staff:" + id,
  }),
  module,
  module.exports,
);
const { appNotificationToFeedItem } = module.exports;
const base = {
  id: "notice",
  booking_id: "booking",
  salon_id: "salon",
  recipient_kind: "owner_manager",
  notification_type: "public_booking_created",
  title: "New booking",
  body: "Old text",
  appointment_summary: "Appointment 09:00 AM Jun 08 - Fullset - Customer Mary",
  booking_updated_at: "2026-10-06T10:00:00Z",
  booking_actionable: true,
  created_at: "2026-10-06T10:00:00Z",
  read_at: null,
  href: "/bookings",
};
test("booking feed preserves appointment context and uses the salon workspace from personal", () => {
  const item = appNotificationToFeedItem(base);
  assert.equal(item.body, base.appointment_summary);
  assert.equal(item.action.workspaceId, "manage:salon");
  assert.equal(item.booking.actionable, true);
  assert.equal(item.booking.updatedAt, base.booking_updated_at);
});
test("staff appointment opens assigned workspace and customer keeps personal booking destination", () => {
  assert.equal(
    appNotificationToFeedItem({
      ...base,
      recipient_kind: "staff",
      href: "/staff/appointments",
    }).action.workspaceId,
    "staff:salon",
  );
  const customer = appNotificationToFeedItem({
    ...base,
    recipient_kind: "customer",
    booking_actionable: false,
  });
  assert.equal(customer.action.href, "/my-bookings/booking");
  assert.equal(customer.action.workspaceId, null);
  assert.equal(customer.booking.actionable, false);
});
test("post thumbnail is retained and unrelated notifications do not offer booking actions", () => {
  const item = appNotificationToFeedItem({
    ...base,
    booking_id: null,
    thumbnail_url: "https://example.invalid/post.jpg",
  });
  assert.equal(item.thumbnailUrl, "https://example.invalid/post.jpg");
  assert.equal(item.booking, undefined);
});
