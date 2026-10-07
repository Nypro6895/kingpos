import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync('lib/public-booking.ts', 'utf8');
const guard = source.slice(source.indexOf('  // Do not silently create a guest booking'), source.indexOf('  const supabase = authenticatedSupabase ??', source.indexOf('  // Do not silently create a guest booking')));
const checkSession = new Function('input', 'currentUser', 'publicBookingFailure', guard + '\nreturn null;');
const fail = (message, code) => ({ message, code });

test('an expired or switched account cannot become a guest booking', () => {
  assert.equal(checkSession({ expectedAccountId: 'tram' }, null, fail).code, 'account_session_changed');
  assert.equal(checkSession({ expectedAccountId: 'tram' }, { id: 'other' }, fail).code, 'account_session_changed');
  assert.equal(checkSession({ expectedAccountId: 'tram' }, { id: 'tram' }, fail), null);
  assert.equal(checkSession({}, null, fail), null);
});

test('a saved account with a single display name does not need a fabricated surname', () => {
  const validation = source.slice(source.indexOf('  const customerFirstName = input.customerFirstName'), source.indexOf('  if (customerEmail && !emailLooksValid', source.indexOf('  const customerFirstName = input.customerFirstName')));
  const validate = new Function('input', 'currentUser', 'phoneLooksValid', 'emailLooksValid', 'publicBookingFailure', validation + '\nreturn null;');
  assert.equal(validate({}, { display_name: 'Tram', phone: '4145556624', email: 'tram@example.com' }, () => false, () => false, fail), null);
  assert.equal(validate({}, null, () => false, () => false, fail).code, 'required_customer_details');
});
