import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  "supabase/migrations/202608150004_customer_visits_waiting_list.sql",
  "utf8",
);
const grantHardeningMigration = readFileSync(
  "supabase/migrations/202608150005_tighten_customer_visit_helper_grants.sql",
  "utf8",
);
const liveDraftResetMigration = readFileSync(
  "supabase/migrations/202608150006_fix_customer_visit_live_draft_reset_ambiguity.sql",
  "utf8",
);
const canonicalWaitingMigration = readFileSync(
  "supabase/migrations/202608150007_canonical_waiting_queue_identity.sql",
  "utf8",
);
const requestedServicesMigration = readFileSync(
  "supabase/migrations/202608150008_customer_visit_requested_services.sql",
  "utf8",
);
const customerVisitsService = readFileSync("lib/customer-visits.ts", "utf8");
const posActions = readFileSync("app/pos/actions.ts", "utf8");
const posClient = readFileSync("app/pos/pos-desk-client.tsx", "utf8");
const posStaffTurnTone = readFileSync("lib/pos-staff-turn-tone.ts", "utf8");
const portableActions = readFileSync("app/pos/portable/actions.ts", "utf8");
const portablePage = readFileSync("app/pos/portable/page.tsx", "utf8");
const posStaffRealtime = readFileSync("lib/pos-staff-realtime.ts", "utf8");
const customerDisplayClient = readFileSync(
  "app/pos/customer-display/customer-display-client.tsx",
  "utf8",
);
const todayDashboard = readFileSync("lib/today-dashboard.ts", "utf8");
const todayPage = readFileSync("app/staff/today/page.tsx", "utf8");
const posDeskData = readFileSync("lib/pos-desk.ts", "utf8");

function functionBlock(name, nextMarker) {
  const start = migration.indexOf(`create or replace function public.${name}`);

  assert.ok(start >= 0, `${name} function is present`);

  const end = nextMarker ? migration.indexOf(nextMarker, start + 1) : -1;

  assert.ok(end > start, `${name} function has a readable boundary`);

  return migration.slice(start, end);
}

function functionBlockIn(source, name, nextMarker) {
  const start = source.indexOf(`create or replace function public.${name}`);

  assert.ok(start >= 0, `${name} function is present`);

  const end = nextMarker ? source.indexOf(nextMarker, start + 1) : -1;

  assert.ok(end > start, `${name} function has a readable boundary`);

  return source.slice(start, end);
}

test("customer visits are modeled as a dedicated visit table", () => {
  assert.match(migration, /create table if not exists public\.customer_visits/);
  assert.match(migration, /source in \('appointment', 'walk_in', 'customer_screen'\)/);
  assert.match(
    migration,
    /status in \('waiting', 'in_service', 'checkout', 'completed', 'cancelled'\)/,
  );
  assert.match(migration, /customer_visits_one_active_customer_uidx/);
  assert.match(migration, /where status in \('waiting', 'in_service', 'checkout'\)/);
  assert.doesNotMatch(migration, /alter table public\.customers/i);
});

test("customer visit RLS keeps public access behind explicit RPCs", () => {
  assert.match(migration, /alter table public\.customer_visits enable row level security/);
  assert.match(migration, /revoke all on table public\.customer_visits from anon/);
  assert.match(
    migration,
    /grant execute on function public\.resolve_customer_display_submission\(text, text, text, text\) to anon, authenticated/,
  );
  assert.match(
    functionBlock(
      "resolve_customer_display_submission",
      "create or replace function public.get_customer_visit_queue",
    ),
    /security definer/,
  );
});

test("customer visit helper RPCs are not directly executable by client roles", () => {
  for (const helperSignature of [
    "customer_visit_first_name\\(text\\)",
    "customer_visit_public_payload\\(public\\.customer_visits, public\\.customers\\)",
    "customer_visit_normalize_booking_status\\(text\\)",
    "find_customer_visit_arrival_appointment\\(uuid, uuid\\)",
    "sync_customer_visit_booking_checked_in\\(uuid\\)",
    "create_or_reuse_customer_visit\\(uuid, uuid, text, uuid, jsonb\\)",
  ]) {
    assert.match(
      grantHardeningMigration,
      new RegExp(`revoke all on function public\\.${helperSignature} from public`),
    );
    assert.match(
      grantHardeningMigration,
      new RegExp(`revoke all on function public\\.${helperSignature} from anon`),
    );
    assert.match(
      grantHardeningMigration,
      new RegExp(`revoke all on function public\\.${helperSignature} from authenticated`),
    );
  }

  assert.match(
    grantHardeningMigration,
    /grant execute on function public\.resolve_customer_display_submission\(text, text, text, text\) to anon, authenticated/,
  );
  assert.match(
    grantHardeningMigration,
    /grant execute on function public\.get_customer_visit_queue\(uuid, integer\) to authenticated/,
  );
  assert.match(
    grantHardeningMigration,
    /grant execute on function public\.select_customer_visit_for_live_draft\(uuid, text\) to authenticated/,
  );
  assert.match(
    grantHardeningMigration,
    /grant execute on function public\.cancel_customer_visit\(uuid, text\) to authenticated/,
  );
  assert.match(
    grantHardeningMigration,
    /grant execute on function public\.complete_customer_visit_for_ticket\(uuid, uuid, uuid, uuid\) to authenticated/,
  );
});

test("customer screen phone submission branches on explicit POS handoff marker", () => {
  const resolverBlock = functionBlock(
    "resolve_customer_display_submission",
    "create or replace function public.get_customer_visit_queue",
  );

  assert.match(migration, /customer_handoff_started_at timestamptz/);
  assert.match(resolverBlock, /public\.normalize_customer_claim_phone\(p_phone\)/);
  assert.match(resolverBlock, /draft_row\.customer_handoff_started_at is not null/);
  assert.match(resolverBlock, /'mode', 'checkout'/);
  assert.match(resolverBlock, /'mode', 'check_in'/);
  assert.match(resolverBlock, /'code', 'profile_required'/);
  assert.match(resolverBlock, /'code', 'ambiguous_appointment'/);
});

test("live draft reset keeps the customer handoff marker and version update unambiguous", () => {
  assert.match(
    liveDraftResetMigration,
    /create or replace function public\.get_pos_live_draft_by_token/,
  );
  assert.match(liveDraftResetMigration, /update public\.pos_live_drafts as drafts/);
  assert.match(liveDraftResetMigration, /customer_handoff_started_at = null/);
  assert.match(liveDraftResetMigration, /version = drafts\.version \+ 1/);
  assert.match(liveDraftResetMigration, /returning drafts\.\* into draft_row/);
});

test("appointment-backed check-in is linked without direct public table access", () => {
  assert.match(migration, /create or replace function public\.find_customer_visit_arrival_appointment/);
  assert.match(migration, /public\.customer_visit_normalize_booking_status\(bookings\.status\)/);
  assert.match(migration, /create or replace function public\.sync_customer_visit_booking_checked_in/);
  assert.match(migration, /insert into public\.booking_status_events/);
  assert.match(migration, /actor_source[\s\S]*'customer'/);
  assert.match(migration, /set pos_ticket_id = p_ticket_id/);
});

test("POS waiting list selects and removes visits without touching staff turns", () => {
  assert.match(migration, /create or replace function public\.select_customer_visit_for_live_draft/);
  assert.match(migration, /create or replace function public\.cancel_customer_visit/);
  assert.match(posClient, /data-pos-waiting-launcher/);
  assert.match(posClient, /data-pos-waiting-drawer/);
  assert.match(posClient, /selectWaitingVisitForPos/);
  assert.match(posClient, /cancelWaitingVisitForPos/);
  assert.match(posClient, /customerVisitId/);
  assert.doesNotMatch(migration, /increment_staff_queue_turns/);
  assert.doesNotMatch(migration, /pos_ticket_item_turn_parts/);
  assert.doesNotMatch(migration, /staff_workdays/);
});

test("active waiting visits are canonical by phone identity before customer id", () => {
  assert.match(canonicalWaitingMigration, /ranked_active_visits/);
  assert.match(
    canonicalWaitingMigration,
    /partition by visits\.salon_id, public\.normalize_customer_claim_phone\(customers\.phone\)/,
  );
  assert.match(
    canonicalWaitingMigration,
    /create or replace function public\.create_or_reuse_customer_visit/,
  );
  assert.match(
    canonicalWaitingMigration,
    /public\.normalize_customer_claim_phone\(customers\.phone\) = normalized_phone/,
  );
  assert.match(
    canonicalWaitingMigration,
    /create or replace function public\.resolve_customer_display_submission/,
  );
  assert.match(
    canonicalWaitingMigration,
    /state', 'already_checked_in'[\s\S]*customer_visit_public_payload\(visit_row, customer_row\)/,
  );
  assert.match(
    canonicalWaitingMigration,
    /create or replace function public\.complete_customer_visit_for_ticket_core/,
  );
});

test("POS and portable waiting data share the canonical queue rows", () => {
  assert.match(
    canonicalWaitingMigration,
    /create or replace function public\.customer_visit_queue_rows/,
  );
  assert.match(
    canonicalWaitingMigration,
    /from public\.customer_visit_queue_rows\(p_salon_id, p_limit\)/,
  );
  assert.match(
    canonicalWaitingMigration,
    /'waitingVisits', waiting_visits_json/,
  );
  assert.match(
    canonicalWaitingMigration,
    /from public\.customer_visit_queue_rows\(target_salon_id, 25\) queue/,
  );
  assert.match(portableActions, /waitingVisits: normalizePortableWaitingVisits/);
  assert.match(portablePage, /waitingVisits=\{data\.waitingVisits\}/);
  assert.match(posDeskData, /getCustomerVisitQueueForSalonOrEmpty/);
  assert.match(todayDashboard, /getCustomerVisitQueueForSalonOrEmpty/);
});

test("portable waiting mutations use portable-authorized canonical RPC wrappers", () => {
  assert.match(
    canonicalWaitingMigration,
    /create or replace function public\.select_pos_portable_customer_visit_for_live_draft/,
  );
  assert.match(
    canonicalWaitingMigration,
    /return public\.apply_customer_visit_to_live_draft\(p_visit_id, p_token\)/,
  );
  assert.match(
    canonicalWaitingMigration,
    /create or replace function public\.cancel_pos_portable_customer_visit/,
  );
  assert.match(
    canonicalWaitingMigration,
    /return public\.cancel_customer_visit_core\(p_visit_id, p_reason\)/,
  );
  assert.match(portablePage, /selectWaitingVisitForPos: portableSelectWaitingVisitForPos/);
  assert.match(portablePage, /cancelWaitingVisitForPos: portableCancelWaitingVisitForPos/);
});

test("waiting list uses a compact launcher and drawer instead of permanent rows", () => {
  assert.match(posClient, /data-pos-waiting-launcher/);
  assert.match(posClient, /data-pos-waiting-drawer/);
  assert.match(posClient, /data-pos-waiting-count/);
  assert.match(posClient, /visitQueue\.length/);
  assert.match(posClient, /visitQueue\.map\(\(visit\)/);
  assert.match(posClient, /Remove from waiting/);
  assert.doesNotMatch(posClient, /No clients waiting\./);
  assert.doesNotMatch(posClient, /data-pos-waiting-row[\s\S]{0,2500}>Remove</);
});

test("waiting refresh reuses the existing POS broadcast channel", () => {
  assert.match(posStaffRealtime, /"waiting"/);
  assert.match(posActions, /broadcastPosStaffChange\(snapshot\.salon_id, "waiting"\)/);
  assert.match(posActions, /broadcastWaitingChangeByLiveDraftToken\(input\.token\)/);
  assert.match(posActions, /broadcastPosStaffChange\(salon\.id, "waiting"\)/);
  assert.match(portableActions, /broadcastPosStaffChange\(portableSession\.salon_id, "waiting"\)/);
  assert.doesNotMatch(posClient, /!\s*isPortableSurface[\s\S]*POS_STAFF_BROADCAST_EVENT/);
});

test("ticket completion closes active visits and preserves payment math", () => {
  assert.match(migration, /create or replace function public\.complete_customer_visit_for_ticket/);
  assert.match(migration, /status = 'completed'/);
  assert.match(migration, /ticket_id = p_ticket_id/);
  assert.match(posActions, /completeCustomerVisitForTicket/);
  assert.match(posActions, /preferredVisitId: cleanOptional\(input\.customerVisitId\)/);
  assert.match(posActions, /const totals = calculateTicketTotals/);
  assert.doesNotMatch(posActions, /tipAmount\s*=\s*[^;]*customerVisitId/);
});

test("customer display uses the unified phone resolver for checkout and check-in", () => {
  assert.match(posActions, /export async function submitCustomerDisplayPhone/);
  assert.match(customerDisplayClient, /type DisplayMode =[\s\S]*"checkin"/);
  assert.match(customerDisplayClient, /"service_select"/);
  assert.match(customerDisplayClient, /CheckInShell/);
  assert.match(customerDisplayClient, /CheckInConfirmationPanel/);
  assert.match(customerDisplayClient, /ServiceSelectionPanel/);
  assert.match(customerDisplayClient, /submitCustomerDisplayPhone/);
  assert.match(customerDisplayClient, /showTipShortcut=\{hasCheckoutHandoff\}/);
  assert.match(customerDisplayClient, /customer_handoff_started_at/);
  assert.doesNotMatch(customerDisplayClient, /createCustomerDisplayLiveDraftCustomer/);
});

test("visit requested services are normalized and only mutable through validated RPCs", () => {
  assert.match(
    requestedServicesMigration,
    /create table if not exists public\.customer_visit_services/,
  );
  assert.match(requestedServicesMigration, /visit_id uuid not null references public\.customer_visits/);
  assert.match(requestedServicesMigration, /service_id uuid not null references public\.services/);
  assert.match(requestedServicesMigration, /unique \(visit_id, service_id\)/);
  assert.match(requestedServicesMigration, /alter table public\.customer_visit_services enable row level security/);
  assert.match(requestedServicesMigration, /revoke all on table public\.customer_visit_services from anon/);

  const updateBlock = functionBlockIn(
    requestedServicesMigration,
    "update_customer_visit_requested_services",
    "create or replace function public.get_customer_display_service_catalog",
  );

  assert.match(updateBlock, /where token = btrim\(coalesce\(p_token, ''\)\)/);
  assert.match(updateBlock, /and status = 'draft'/);
  assert.match(updateBlock, /and salon_id = draft_row\.salon_id/);
  assert.match(updateBlock, /requested_count > 8/);
  assert.match(updateBlock, /services\.salon_id = draft_row\.salon_id/);
  assert.match(updateBlock, /services\.is_active = true/);
  assert.match(updateBlock, /services\.online_booking_enabled = true/);
  assert.match(updateBlock, /group by service_id/);
  assert.match(updateBlock, /delete from public\.customer_visit_services/);
  assert.doesNotMatch(updateBlock, /pos_ticket_items|pos_ticket_item_turn_parts|increment_staff_queue_turns/);
  assert.match(
    requestedServicesMigration,
    /grant execute on function public\.update_customer_visit_requested_services\(text, uuid, uuid\[\]\) to anon, authenticated/,
  );
});

test("requested services flow through queue, live draft customer, portable POS, and Today without N+1 reads", () => {
  assert.match(requestedServicesMigration, /'requestedServices', public\.customer_visit_requested_services_json/);
  assert.match(requestedServicesMigration, /requested_services jsonb/);
  assert.match(requestedServicesMigration, /'requestedServices', queue\.requested_services/);
  assert.match(requestedServicesMigration, /from public\.customer_visit_queue_rows\(target_salon_id, 25\) queue/);
  assert.match(customerVisitsService, /requested_services: unknown/);
  assert.match(customerVisitsService, /requestedServices: readRequestedServices/);
  assert.match(portableActions, /requestedServices: normalizePortableRequestedServices/);
  assert.match(posActions, /updateCustomerVisitRequestedServices/);
  assert.match(posActions, /getCustomerDisplayServiceCatalog/);
  assert.match(posActions, /saveCustomerDisplayRequestedServices/);
  assert.match(todayDashboard, /serviceLabel: visit\.serviceLabel/);
});

test("POS layout keeps Waiting near Customer, exposes service tiles, and simplifies the right sidebar", () => {
  assert.match(posClient, /data-pos-waiting-launcher/);
  assert.match(posClient, /<label className="block text-sm font-medium">Customer<\/label>[\s\S]*\{waitingButton\}/);
  assert.match(posClient, /createPortal\(waitingDrawer, document\.body\)/);
  assert.match(posClient, /data-pos-waiting-portal-layer/);
  assert.match(posClient, /getWaitingDrawerPlacement/);
  assert.match(posClient, /className="fixed inset-0 z-\[45\] pointer-events-none"/);
  assert.match(posClient, /className="fixed z-10 pointer-events-auto flex min-w-0 flex-col overflow-hidden/);
  assert.match(posClient, /data-pos-waiting-drawer-scroll/);
  assert.match(posClient, /data-pos-waiting-row-select/);
  assert.doesNotMatch(posClient, />Select<\/button>/);
  assert.match(posClient, /data-pos-service-workspace/);
  assert.match(posClient, /data-pos-service-tiles/);
  assert.match(posClient, /data-pos-service-more/);
  assert.match(posClient, /VISIBLE_SERVICE_TILE_LIMIT = 10/);
  assert.doesNotMatch(posClient, /Manual amount/);
  assert.match(posClient, /getStaffCardToneClass/);
  assert.match(posClient, /getStaffTurnToneLevel/);
  assert.match(posClient, /data-pos-staff-tone/);
  assert.match(posClient, /large turns, \$\{member\.turns\.smallTurns\} small turns/);
  assert.doesNotMatch(posClient, /S \{member\.turns\.smallTurns\}/);
  assert.match(posStaffTurnTone, /STAFF_TURN_TONE_LEVEL_COUNT = 5/);
  assert.match(posStaffTurnTone, /new Set\(\[\.\.\.allLargeTurns, normalizedTurns\]/);
  assert.match(posClient, /data-pos-requested-services/);
  assert.match(posClient, /data-pos-amount-panel/);
  assert.match(posClient, /data-pos-current-input/);
  assert.match(posClient, /data-pos-toast/);
  assert.match(posClient, /data-pos-toast-close/);
  assert.match(posClient, /POS_TOAST_DISMISS_MS = 5000/);
  assert.match(posClient, /Ticket \$\{result\.ticketNumber\} submitted/);
  assert.doesNotMatch(posClient, /setMessage/);
  assert.doesNotMatch(posClient, /data-pos-amount-summary/);
  assert.doesNotMatch(posClient, /data-pos-entered-amount-row/);
  assert.doesNotMatch(posClient, /data-pos-amount-total/);
  assert.doesNotMatch(posClient, /Next entry/);
  assert.doesNotMatch(posClient, /data-pos-service-panel/);
  assert.doesNotMatch(posClient, /No catalog/);
});

test("POS amount entries remain separate canonical lines before finalization", () => {
  assert.match(posClient, /createNextStaffEntry\(staffId, activeLine\)/);
  assert.match(posClient, /activeLine && hasPositiveAmount\(activeLine\)[\s\S]*createStaffLine/);
  assert.match(posClient, /staffLines\.filter\(hasPositiveAmount\)/);
  assert.match(posClient, /positiveLines\.map\(\(line, index\) => \(\{/);
  assert.match(posActions, /for \(const line of input\.lines\)/);
  assert.match(posActions, /from\("pos_ticket_items"\)[\s\S]*unit_price: line\.total/);
  assert.match(posActions, /const totals = calculateTicketTotals\(\{[\s\S]*items: insertedItems/);
  assert.doesNotMatch(posActions, /reduce\([^)]*amountParts[^)]*\)\s*\+\s*line\.total/);
});

test("Customer Display hides receipt outside checkout and supports service selection plus touch reset", () => {
  assert.match(customerDisplayClient, /hasCheckoutHandoff/);
  assert.match(customerDisplayClient, /CheckInShell/);
  assert.match(customerDisplayClient, /data-customer-display-checkin-shell/);
  assert.match(customerDisplayClient, /data-customer-display-service-select/);
  assert.match(customerDisplayClient, /data-customer-display-service-grid/);
  assert.match(customerDisplayClient, /data-customer-display-service-card/);
  assert.match(customerDisplayClient, /md:grid-cols-3/);
  assert.match(customerDisplayClient, /min-h-\[76px\]/);
  assert.match(customerDisplayClient, /saveCustomerDisplayRequestedServices/);
  assert.match(customerDisplayClient, /resetCustomerDisplayCompletedDraft/);
  assert.match(customerDisplayClient, /onClick=\{onReset\}/);
  assert.match(customerDisplayClient, /Tap to continue/);
  assert.match(customerDisplayClient, /displayMode === "tip"[\s\S]*<CheckoutShell/);
  assert.doesNotMatch(
    customerDisplayClient,
    /displayMode === "phone"[\s\S]{0,800}<TransactionSummary/,
  );
});

test("Today and POS data loaders consume the customer visit queue", () => {
  assert.match(customerVisitsService, /getCustomerVisitQueueForSalon/);
  assert.match(posDeskData, /waitingVisits/);
  assert.match(posDeskData, /getCustomerVisitQueueForSalonOrEmpty/);
  assert.match(todayDashboard, /mapWaitingVisits/);
  assert.match(todayDashboard, /source: "appointment" \| "customer_screen" \| "walk_in"/);
  assert.match(todayDashboard, /area: "waiting"/);
  assert.match(todayPage, /Checked in from \{sourceLabel\}/);
});
