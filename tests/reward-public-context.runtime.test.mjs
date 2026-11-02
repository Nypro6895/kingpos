import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

function moduleFromSource(path, imports = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, require: name => imports[name] ?? {}, Intl, Date, Map, Set, console });
  return exports;
}
const salon = '00000000-0000-4000-8000-000000000001';
const service = '00000000-0000-4000-8000-000000000002';
const staff = '00000000-0000-4000-8000-000000000003';
const validBooking = () => ({
  state: 'ready', profile: { salon_id: salon, name: 'Salon', public_discovery_enabled: true },
  settings: { timezone_iana: 'America/Chicago' },
  services: [{ id: service, name: 'Manicure', duration_minutes: 30 }],
  staff: [{ id: staff, display_name: 'Professional' }],
  assignments: [{ service_id: service, staff_id: staff }],
  availability_rules: [{ day_of_week: 1, rule_type: 'working' }],
});

test('reward booking CTA reuses the wizard readiness, without asserting slot availability', async () => {
  let payload = validBooking();
  const calls = [];
  const booking = moduleFromSource('lib/public-booking.ts', {
    '@/lib/supabase/server': { createSupabaseServerClient: () => ({ rpc: async (name, args) => { calls.push({ name, args }); return { data: payload, error: null }; } }) },
    '@/lib/salon-profile': { getSalonProfileMediaUrl: () => null },
    '@/lib/staff-profile': { getStaffProfileAvatarUrl: () => null },
  });
  assert.equal(await booking.getPublicBookingReadiness(salon), true);
  assert.equal(calls[0].name, 'get_public_booking_context');
  assert.equal(new Date(calls[0].args.p_range_end) - new Date(calls[0].args.p_range_start), 1);
  for (const patch of [{ state: 'booking_disabled' }, { state: 'not_public' }, { settings: { timezone_iana: 'invalid-zone' } }, { services: [] }, { assignments: [] }, { staff: [] }, { availability_rules: [] }]) {
    payload = { ...validBooking(), ...patch };
    assert.equal(await booking.getPublicBookingReadiness(salon), false, JSON.stringify(patch));
  }
});

test('public reward promotion selects only the same salon explicit cover and fails booking closed', async () => {
  const media = moduleFromSource('lib/salon-profile-media.ts');
  const defaults = moduleFromSource('lib/default-nail-images.ts');
  let cover = `${salon}/profile/cover/test.webp`, listing = null, operating = { status: { kind: 'open' } }, bookable = true;
  const helper = moduleFromSource('lib/reward-public-context.ts', {
    '@/lib/default-nail-images': defaults,
    '@/lib/public-booking': { getPublicBookingReadiness: async () => bookable },
    '@/lib/salon-profile': { getSalonProfileMediaUrl: path => `https://public.example/${path}` },
    '@/lib/salon-profile-media': media,
    '@/lib/salon-operating-status': { getPublicSalonOperatingHours: async () => operating },
  });
  const db = { rpc: async name => name === 'get_public_salon_profile'
    ? { data: [{ salon_id: salon, salon_name: 'Hair studio', cover_path: cover, service_categories: ['Hair'] }], error: null }
    : { data: listing ? [listing] : [], error: null } };
  let context = await helper.getRewardPublicSalonContext(db, salon);
  assert.equal(context.canBook, true);
  assert.equal(context.coverImageSource, 'salon');
  for (const invalid of [`${staff}/profile/cover/test.webp`, `${salon}/reviews/test.webp`, `${salon}/looks/${service}/test.webp`, 'https://private.example/client.webp', `${salon}/profile/cover/../test.webp`]) {
    cover = invalid;
    context = await helper.getRewardPublicSalonContext(db, salon);
    assert.equal(context.coverImageSource, 'illustration');
    assert.match(context.coverImageUrl, /^\/images\/business-defaults\/hair-/);
  }
  listing = { claim_state: 'unclaimed' };
  assert.equal((await helper.getRewardPublicSalonContext(db, salon)).canBook, false);
  listing = null; operating = { status: { kind: 'permanently_closed' } };
  assert.equal((await helper.getRewardPublicSalonContext(db, salon)).canBook, false);
  operating = null;
  assert.equal((await helper.getRewardPublicSalonContext(db, salon)).canBook, false);
  operating = { status: { kind: 'open' } }; bookable = false;
  assert.equal((await helper.getRewardPublicSalonContext(db, salon)).canBook, false);
});
