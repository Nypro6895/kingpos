import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const posTickets = readFileSync("lib/pos-tickets.ts", "utf8");
const posTicketTypes = readFileSync("types/pos-ticket.ts", "utf8");

test("POS ticket adjustment user lookup filters invalid created_by values", () => {
  assert.match(posTickets, /const UUID_PATTERN =/);
  assert.match(posTickets, /function normalizeUuid/);
  assert.match(posTickets, /created_by: string \| null/);
  assert.match(
    posTickets,
    /\.map\(\(adjustment\) => normalizeUuid\(adjustment\.created_by\)\)\s*\.filter\(\(userId\): userId is string => Boolean\(userId\)\)/s,
  );
  assert.match(posTickets, /const createdByUserId = normalizeUuid\(adjustment\.created_by\)/);
  assert.match(posTickets, /created_by_user: createdByUserId/);
});

test("POS ticket relation type allows adjustment created_by to be missing", () => {
  assert.match(posTicketTypes, /created_by: string \| null/);
});
