import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();

function read(path) {
  return readFileSync(join(root, path), "utf8");
}

test("owner more menu exposes salon customers and customer list supports scoped duplicate merge", () => {
  const navigation = read("app/role-navigation.ts");
  const morePage = read("app/more/page.tsx");
  const customerPage = read("app/customers/page.tsx");
  const customerActions = read("app/customers/actions.ts");
  const customerLoader = read("lib/customers.ts");
  const customerDetail = read("app/customers/[customerId]/page.tsx");

  assert.match(navigation, /id: "owner-customers"/);
  assert.match(navigation, /href: "\/customers"/);
  assert.match(morePage, /"owner-customers"/);

  assert.match(customerPage, /function DuplicateMergeMenu/);
  assert.match(customerPage, /action=\{mergeDuplicateCustomers\}/);
  assert.match(customerPage, /group=walking/);
  assert.match(customerPage, /flex flex-col gap-3 lg:flex-row/);

  assert.match(customerLoader, /function isWalkingCustomer/);
  assert.match(customerLoader, /loadDuplicateCandidatesForCustomers/);
  assert.match(customerLoader, /\.eq\("location_id", salon\.id\)/);
  assert.match(customerLoader, /isWalkingGroup/);

  assert.match(customerActions, /export async function mergeDuplicateCustomers/);
  assert.match(customerActions, /requireCustomerMutationContext/);
  assert.match(customerActions, /\.eq\("location_id", salon\.id\)/);
  assert.match(customerActions, /\.from\("bookings"\)[\s\S]*\.in\("customer_id", sourceCustomerIds\)/);
  assert.match(customerActions, /\.from\("pos_tickets"\)[\s\S]*\.in\("customer_id", sourceCustomerIds\)/);
  assert.match(customerActions, /\.from\("pos_desk_sessions"\)[\s\S]*\.in\("customer_id", sourceCustomerIds\)/);
  assert.doesNotMatch(customerActions, /beauty_post_verifications/);

  assert.match(customerDetail, /historyFilterHref/);
  assert.match(customerDetail, /walkingGroup: group === "walking"/);
  assert.match(customerDetail, /grid content-start gap-6/);
  assert.match(customerDetail, /flex flex-wrap items-start gap-2/);
  assert.match(customerDetail, /inline-flex h-10 shrink-0 items-center/);
});
