import assert from "node:assert/strict";
import test from "node:test";
import { loadMembershipPermissionCodes } from "../lib/membership-permissions.ts";

function fixture({ roleError = null, permissionError = null, grants = [
  { role_id: "owner", permission_id: "refund" },
  { role_id: "owner", permission_id: "book" },
  { role_id: "staff", permission_id: "book" },
] } = {}) {
  const calls = [];
  const client = { from(table) {
    const query = { select() { return query; }, in(column, values) {
      calls.push({ table, column, values }); return query;
    }, returns: async () => table === "role_permissions"
      ? { data: grants, error: roleError }
      : { data: [{ id: "refund", code: "tickets.refund" }, { id: "book", code: "booking.view" }], error: permissionError },
    };
    return query;
  } };
  return { client, calls };
}

test("duplicate role grants use two reads while permissions remain separate by scope", async () => {
  const { client, calls } = fixture();
  const result = await loadMembershipPermissionCodes([
    { id: "account-owner", role_id: "owner" },
    { id: "salon-owner", role_id: "owner" },
    { id: "other-salon-staff", role_id: "staff" },
    { id: "no-role", role_id: null },
  ], client);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0].values, ["owner", "staff"]);
  assert.deepEqual(calls[1].values, ["refund", "book"]);
  assert.deepEqual([...result.get("account-owner")].sort(), ["booking.view", "tickets.refund"]);
  assert.deepEqual([...result.get("other-salon-staff")], ["booking.view"]);
  assert.equal(result.get("no-role").size, 0);
  result.get("account-owner").clear();
  assert.equal(result.get("salon-owner").size, 2);
});

test("each call reads fresh grants after a role is revoked", async () => {
  const membership = [{ id: "membership", role_id: "owner" }];
  assert.equal((await loadMembershipPermissionCodes(membership, fixture().client)).get("membership").size, 2);
  const empty = fixture({ grants: [] });
  assert.equal((await loadMembershipPermissionCodes(membership, empty.client)).get("membership").size, 0);
  assert.equal(empty.calls.length, 1);
});

test("missing roles or client cannot grant permissions", async () => {
  const { client, calls } = fixture();
  assert.equal((await loadMembershipPermissionCodes([{ id: "m", role_id: null }], client)).get("m").size, 0);
  assert.equal(calls.length, 0);
  assert.equal((await loadMembershipPermissionCodes([{ id: "m", role_id: "owner" }], null)).get("m").size, 0);
});

for (const failure of ["roleError", "permissionError"]) {
  test(`permission reads fail closed on ${failure}`, async () => {
    const { client } = fixture({ [failure]: { message: "Permission query unavailable" } });
    await assert.rejects(loadMembershipPermissionCodes([{ id: "m", role_id: "owner" }], client), /Permission query unavailable/);
  });
}
