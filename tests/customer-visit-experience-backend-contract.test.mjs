import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  "supabase/migrations/202608300003_customer_visit_experience_backend.sql",
  "utf8",
);
const activityAction = readFileSync("app/activity/actions.ts", "utf8");
const customerActivity = readFileSync("lib/customer-activity.ts", "utf8");
const salonProfile = readFileSync("lib/salon-profile.ts", "utf8");

test("customer visit experiences have storage, permissions, and public reputation readers", () => {
  assert.match(migration, /create table if not exists public\.customer_visit_experiences/);
  assert.match(migration, /customer_visit_experiences_ticket_author_uidx/);
  assert.match(migration, /alter table public\.customer_visit_experiences enable row level security/);
  assert.match(migration, /customers_manage_own_visit_experiences/);
  assert.match(migration, /salon_members_read_visit_experiences/);
  assert.match(migration, /create or replace function public\.get_public_salon_profile_reputation_summary/);
  assert.match(migration, /create or replace function public\.get_public_salon_profile_experiences/);
  assert.match(migration, /grant execute on function public\.get_public_salon_profile_reputation_summary\(uuid\) to anon, authenticated/);
  assert.match(migration, /grant execute on function public\.get_public_salon_profile_experiences\(uuid\) to anon, authenticated/);
});

test("post visit experience RPC records verified feedback and returns UI payload fields", () => {
  assert.match(activityAction, /record_customer_visit_experience/);
  assert.match(migration, /create or replace function public\.record_customer_visit_experience/);
  assert.match(migration, /customers\.customer_user_id = actor_user_id/);
  assert.match(migration, /tickets\.status = 'closed'/);
  assert.match(migration, /counts_toward_reputation/);
  assert.match(migration, /on conflict \(ticket_id, author_user_id\) do update/);
  assert.match(migration, /'countsTowardReputation'/);
  assert.match(migration, /'windowDays'/);
});

test("activity readers include verified visit payloads for list and receipt prompts", () => {
  assert.match(customerActivity, /parseVerifiedVisit/);
  assert.match(migration, /customer_visit_verified_visit_payload\(tickets, customers\)/);
  assert.match(migration, /'verifiedVisit'/);
  assert.match(salonProfile, /get_public_salon_profile_reputation_summary/);
  assert.match(salonProfile, /get_public_salon_profile_experiences/);
});
