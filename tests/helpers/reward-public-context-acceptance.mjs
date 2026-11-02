import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

/** Called only with the owned isolated Supabase fixture. No production access. */
export function assertRewardPublicProgramContext(f, { salon, customer }) {
  const before = f.sql('select (select count(*) from reward_members)::text || \'/\' || (select count(*) from reward_ledger)::text');
  const anonymous = f.rpc(null, 'reward_public_program', { p_salon: salon });
  assert.ok(anonymous.salon);
  assert.equal(anonymous.joined, false);
  assert.equal(anonymous.available, null);
  assert.equal(anonymous.earningEligibility.welcome, false, 'anonymous first-time status is unknown');
  assert.equal(anonymous.earningEligibility.firstBooking, false, 'anonymous prior bookings are unknown');
  assert.equal(anonymous.earningEligibility.spend, anonymous.salon.spendPoints > 0);
  assert.equal(anonymous.earningEligibility.visit, anonymous.salon.visitPoints > 0);
  assert.equal(anonymous.earningEligibility.beforeAfter, anonymous.salon.conversionPoints > 0);

  const personal = f.rpc(customer, 'reward_public_program', { p_salon: salon });
  const member = f.sql(`select exists(select 1 from reward_members where salon_id='${salon}' and user_id='${customer.profileId}')`) === 't';
  const firstClaimed = f.sql(`select exists(select 1 from reward_ledger where salon_id='${salon}' and user_id='${customer.profileId}' and reason='First paid booking')`) === 't';
  assert.equal(personal.joined, member);
  assert.equal(personal.earningEligibility.welcome, !member && personal.salon.welcomePoints > 0);
  assert.equal(personal.earningEligibility.firstBooking, !firstClaimed && personal.salon.firstBookingPoints > 0);
  if (!member) assert.equal(personal.available, null);
  assert.equal(f.sql('select (select count(*) from reward_members)::text || \'/\' || (select count(*) from reward_ledger)::text'), before,
    'public promotion reads never enroll customers or award points');
}

/** Historical-ledger projection acceptance, not a claim of booking settlement.
 * Call only after the real financial journey, with that fixture's own ticket.
 * The original and offset rows model persisted consumed/reversed grant history.
 */
export function assertRewardOneTimeHistory(f, { salon, customer, ticketId }) {
  const initial = f.rpc(customer, 'reward_public_program', { p_salon: salon });
  assert.equal(initial.earningEligibility.firstBooking, true);
  const points = initial.salon.firstBookingPoints;
  assert.ok(points > 0);
  f.sql(`insert into reward_ledger(salon_id,user_id,delta,reason,event_key,ticket_id) values('${salon}','${customer.profileId}',${points},'First paid booking','first-booking:${salon}:${customer.profileId}','${ticketId}')`);
  const consumed = f.rpc(customer, 'reward_public_program', { p_salon: salon });
  assert.equal(consumed.earningEligibility.firstBooking, false);
  assert.equal(consumed.earningEligibility.welcome, false);
  f.sql(`insert into reward_ledger(salon_id,user_id,delta,reason,event_key,ticket_id) values('${salon}','${customer.profileId}',-${points},'First booking adjustment','first-adjust:${randomUUID()}','${ticketId}')`);
  const reversed = f.rpc(customer, 'reward_public_program', { p_salon: salon });
  assert.equal(reversed.earningEligibility.firstBooking, false, 'reversal does not create another first-booking grant');
  assert.equal(reversed.available, initial.available);
  assertRewardPublicProgramContext(f, { salon, customer });

  const zero = f.person('reward-projection-zero-first-booking');
  f.sql(`select reward_join('${salon}','${zero.profileId}');insert into reward_ledger(salon_id,user_id,delta,reason,event_key,ticket_id) values('${salon}','${zero.profileId}',0,'First paid booking','first-booking:${salon}:${zero.profileId}','${ticketId}')`);
  const zeroClaim = f.rpc(zero, 'reward_public_program', { p_salon: salon });
  assert.equal(zeroClaim.earningEligibility.firstBooking, false, 'an original zero-point row still consumes the canonical first-booking key');
  assertRewardPublicProgramContext(f, { salon, customer: zero });
}
