import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();

function read(path) {
  return readFileSync(join(root, path), "utf8");
}

const migration = read("supabase/migrations/202608280002_smart_search_foundation.sql");

test("smart search foundation normalizes text and adds trigram indexes", () => {
  assert.match(migration, /create extension if not exists unaccent/);
  assert.match(migration, /create or replace function public\.normalize_search_text/);
  assert.match(migration, /extensions\.unaccent/);
  assert.match(migration, /services_search_document_trgm_idx/);
  assert.match(migration, /customers_search_phone_digits_trgm_idx/);
  assert.match(migration, /users_search_phone_normalized_idx/);
  assert.doesNotMatch(
    migration.slice(
      migration.indexOf("create index if not exists locations_search_name_trgm_idx"),
      migration.indexOf("create or replace function public.search_salon_customers"),
    ),
    /normalize_search_text\(concat_ws/,
  );
});

test("Explore search uses fuzzy ranking and keeps fallback result groups alive", () => {
  const start = migration.indexOf("create or replace function public.search_public_explore_salons");
  const end = migration.indexOf("grant execute on function public.search_public_explore_salons", start);
  const block = migration.slice(start, end);

  assert.ok(start >= 0, "Explore search RPC is replaced by the smart search migration.");
  assert.match(block, /extensions\.word_similarity/);
  assert.match(block, /public\.search_text_has_all_tokens/);
  assert.match(block, /has_location_filter/);
  assert.match(block, /when scored\.has_best_match_filter and scored\.query_matches then 'best_match'/);
  assert.match(block, /when scored\.distance_miles is not null or scored\.has_location_filter then 'nearby'/);
  assert.doesNotMatch(block, /where scored\.query_matches/);
});

test("POS and customer management use the shared customer search RPC", () => {
  const posActions = read("app/pos/actions.ts");
  const customerService = read("lib/customers.ts");

  assert.match(migration, /create or replace function public\.search_salon_customers/);
  assert.match(migration, /public\.normalize_customer_claim_phone\(p_query\)/);
  assert.match(migration, /base\.phone_digits_search like '%' \|\| normalized\.phone_digits \|\| '%'/);
  assert.match(posActions, /rpc\("search_salon_customers"/);
  assert.match(customerService, /rpc\("search_salon_customers"/);
  assert.match(customerService, /searchRows\.length === 0 && from > 0/);
  assert.match(customerService, /p_limit: 1,\s*p_offset: 0/s);
  assert.match(migration, /from public\.search_salon_customers\(\s*target_salon_id,\s*search_query,\s*10,\s*0,\s*'active'/s);
});

test("paginated Explore search keeps counts when the current page has no rows", () => {
  const exploreSearch = read("lib/explore-search.ts");

  assert.match(exploreSearch, /let countRows = rows/);
  assert.match(exploreSearch, /rows\.length === 0 && page > 1/);
  assert.match(exploreSearch, /p_page: 1,\s*p_page_size: 1/s);
  assert.match(exploreSearch, /readGroupCounts\(countRows\)/);
  assert.match(exploreSearch, /readCount\(countRows\[0\]\?\.total_count\)/);
});

test("Explore header keeps keyword and location search separate", () => {
  const appHeader = read("app/navigation-shell.tsx");
  const guestHeader = read("app/guest-navigation-shell.tsx");

  assert.doesNotMatch(appHeader, /searchParams\.get\("q"\) \?\? searchParams\.get\("location"\)/);
  assert.doesNotMatch(guestHeader, /searchParams\.get\("q"\) \?\? searchParams\.get\("location"\)/);
});

test("client-side filters use shared normalized matching", () => {
  const helper = read("lib/search-normalization.ts");
  const posClient = read("app/pos/pos-desk-client.tsx");
  const servicesManager = read("app/services/services-manager.tsx");
  const bookingsClient = read("app/bookings/booking-workspace-client.tsx");
  const staffPage = read("app/(app)/staff/page.tsx");
  const ticketPage = read("app/(app)/pos-tickets/page.tsx");
  const portableTicketPage = read("app/(app)/pos/portable/ticket/page.tsx");

  assert.match(helper, /normalize\("NFD"\)/);
  assert.match(helper, /searchTextMatches/);
  assert.match(posClient, /searchTextMatches\(\[service\.name, service\.category\], serviceSearch\)/);
  assert.match(servicesManager, /searchTextMatches\(\s*\[config\.name, config\.category, config\.description\]/s);
  assert.match(bookingsClient, /searchTextMatches\(\[service\.name, service\.category\], query\)/);
  assert.match(staffPage, /return searchTextMatches\(\[/);
  assert.match(ticketPage, /return searchTextMatches\(searchableValues, query\)/);
  assert.match(portableTicketPage, /return searchTextMatches\(searchableValues, query\)/);
});
