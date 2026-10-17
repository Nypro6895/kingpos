import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import { transformSync } from 'esbuild';
import { createUnifiedExploreFixture, fixtureId, seedSalon, seedPost } from './fixtures/explore-unified-search-bootstrap.mjs';

function searchService(db) {
  const calls = [];
  const specifications = {
    get_public_explore_query_entities: ['p_query','p_original_query','p_city_query','p_preferred_state','p_state_constraint','p_limit'],
    get_public_explore_address_area: ['p_address','p_preferred_state'],
    search_public_explore_session: ['p_query','p_category','p_location','p_latitude','p_longitude','p_sort','p_limit','p_cursor','p_scope_policy','p_intent','p_content_query','p_query_kind','p_location_priority','p_filters','p_hydrate_ids'],
  };
  const client = { rpc(name, args) {
    calls.push({ name, args });
    const keys = specifications[name];
    if (!keys) throw new Error('Unexpected RPC: ' + name);
    const params = keys.map(key => key === 'p_cursor' || key === 'p_filters' ? args[key] == null ? null : JSON.stringify(args[key]) : args[key] ?? null);
    const request = db.query(`SELECT public.${name}(${keys.map((key, index) => `${key} => $${index + 1}`).join(',')}) AS result`, params)
      .then(result => ({ data: result.rows[0].result, error: null }), error => ({ data: null, error: { code: error.code, message: error.message } }));
    request.abortSignal = () => request;
    return request;
  } };
  function load(path, dependencies = {}) {
    const module = { exports: {} };
    vm.runInNewContext(transformSync(readFileSync(path, 'utf8'), { loader: 'ts', format: 'cjs' }).code, {
      module, exports: module.exports, DOMException, console: { warn() {} }, require: name => {
        if (!(name in dependencies)) throw new Error('Unbound dependency: ' + name);
        return dependencies[name];
      },
    });
    return module.exports;
  }
  const parser = load('lib/explore-query-intent.ts');
  const server = { createAuthenticatedSupabaseServerClient: async () => null, createSupabaseServerClient: () => client, getSupabaseConfig: () => ({ supabaseUrl: 'https://fixture.example' }) };
  const routing = load('lib/explore-query-routing.ts', { 'server-only': {}, '@/lib/explore-query-intent': parser, '@/lib/supabase/server': server });
  const rpc = load('lib/explore-search-rpc.ts');
  const defaults = load('lib/default-nail-images.ts');
  const nails = load('lib/nail-inspiration.ts', { '@/lib/nail-inspiration-catalog': load('lib/nail-inspiration-catalog.ts') });
  const media = load('lib/explore-search-media.ts', {
    '@/lib/default-nail-images': defaults, '@/lib/nail-inspiration': nails,
    '@/lib/salon-profile-media': load('lib/salon-profile-media.ts'), '@/lib/beauty-media': load('lib/beauty-media.ts'),
    '@/lib/salon-profile': { getSalonProfileMediaUrl: path => path ? 'https://fixture.example/storage/v1/object/public/salon-profile-media/' + path : null },
  });
  const service = load('lib/explore-search.ts', {
    'server-only': {}, '@/lib/explore-query-routing': routing, '@/lib/explore-query-intent': parser,
    '@/lib/explore-search-rpc': rpc, '@/lib/explore-search-media': media, '@/lib/supabase/server': server,
    '@/lib/default-nail-images': { resolveNailCoverImage: () => '/nail-styles/fixture.webp' },
    '@/lib/explore-decision-signals': { EMPTY_EXPLORE_DECISION_SIGNALS: {}, getExploreDecisionSignalsBySalonId: async () => new Map() },
    '@/lib/explore-salon-logos': { loadPublicSalonLogoPaths: async () => new Map() },
    '@/lib/salon-operating-status': { getPublicSalonOperatingStatusesBySalonId: async () => new Map(), operatingStatusFromMap: () => ({}) },
    '@/lib/salon-profile': { getSalonProfileMediaUrl: () => null }, '@/lib/current-context': {},
  });
  return { search: service.searchExploreSalons, calls };
}

test('approved search flow: routing, stored address region, content, suggestions and continuation work together', { timeout: 180000 }, async t => {
  const fixture = await createUnifiedExploreFixture({ seed: false });
  const { db } = fixture;
  try {
    await seedSalon(db, 901, { name: 'King Nails Spa LLC', city: 'Milwaukee', latitude: null, longitude: null });
    await seedSalon(db, 902, { name: 'Nail Near Me', city: 'Elk Grove', state: 'CA', latitude: 38.4, longitude: -121.4 });
    await seedSalon(db, 903, { name: 'Lumi Studio', city: 'Milwaukee', latitude: null, longitude: null });
    await seedSalon(db, 904, { name: 'King Nails', city: 'Chicago', state: 'IL', latitude: 41.88, longitude: -87.63 });
    await seedSalon(db, 905, { name: 'Holiday Studio', city: 'Milwaukee', latitude: null, longitude: null });
    await seedPost(db, 1903, 903, { title: 'King Nails collection', caption: 'Red nails for Christmas', media: true });
    await seedPost(db, 1905, 905, { title: 'Christmas red nails', caption: 'Red holiday manicure', media: false });
    await seedPost(db, 1902, 902, { title: 'Christmas red nails', caption: 'Red holiday manicure', media: true });
    await db.query("UPDATE explore_salon_documents SET address_line1='8333 W Appleton Ave',address_line2='Suite 10',postal_code='53218',phone='414-555-0123',description='Private lavender sanctuary',search_document=search_document||' private lavender sanctuary 8333 w appleton ave 414 555 0123' WHERE salon_id=$1", [fixtureId(901)]);
    const api = searchService(db);
    async function run(input) {
      const result = await api.search({ pageSize: 20, ...input });
      assert.equal(result.error, null, result.error ?? '');
      assert.equal(result.target, 'salons');
      assert.equal(new Set(result.results.map(row => row.id)).size, result.results.length);
      return result;
    }
    for (const locationSource of ['manual','gps','saved','activity','workspace']) await t.test('Milwaukee address priority with ' + locationSource, async () => {
      const result = await run({ query: 'Nail near me', location: 'Milwaukee, WI', locationSource, latitude: 41.88, longitude: -87.63 });
      assert.equal(result.location, 'Milwaukee, WI');
      assert.equal(result.locationPriority, true);
      assert.equal(result.requiresGps, false);
      const primary = result.results.filter(row => row.isPrimaryMatch);
      assert.ok(primary.length >= 3, 'Milwaukee salons without coordinates remain eligible');
      assert.ok(primary.every(row => row.city === 'Milwaukee'));
      const firstOutside = result.results.findIndex(row => row.city !== 'Milwaukee');
      assert.ok(firstOutside < 0 || result.results.slice(firstOutside).every(row => row.city !== 'Milwaukee'));
    });
    await t.test('names precede post matches only after selected area', async () => {
      const result = await run({ query: 'King Nails', location: 'Milwaukee, WI', locationSource: 'manual' });
      assert.equal(result.results[0].id, fixtureId(901));
      assert.ok(result.results.findIndex(row => row.id === fixtureId(903)) < result.results.findIndex(row => row.id === fixtureId(904)));
    });
    for (const query of ['Christmas nail design','red nails']) await t.test('style query remains salon centered: ' + query, async () => {
      const result = await run({ query, location: 'Milwaukee, WI', locationSource: 'manual' });
      const primary = result.results.filter(row => row.isPrimaryMatch);
      assert.ok(primary.some(row => row.id === fixtureId(903)));
      assert.ok(primary.every(row => row.city === 'Milwaukee' && row.name));
      assert.ok(result.results.some(row => row.id === fixtureId(905)), 'text-only matching salon is retained');
      assert.ok(result.results.findIndex(row => row.id === fixtureId(903)) < result.results.findIndex(row => row.id === fixtureId(902)));
    });
    for (const query of ['414-555-0123','private lavender sanctuary']) await t.test('existing profile keyword survives: ' + query, async () => {
      const result = await run({ query, location: 'Milwaukee, WI', locationSource: 'manual' });
      assert.equal(result.results[0].id, fixtureId(901));
      assert.equal(result.results[0].isPrimaryMatch, true);
    });
    await t.test('street address resolves from public salon data without map providers', async () => {
      const result = await run({ query: 'nails at 8333 W Appleton Ave Milwaukee WI' });
      assert.equal(result.addressStatus, 'resolved');
      assert.equal(result.results[0].id, fixtureId(901));
      assert.equal(result.results[0].isPrimaryMatch, true);
      assert.ok(api.calls.some(call => call.name === 'get_public_explore_address_area'));
    });
    await t.test('unknown street never becomes a country-wide search', async () => {
      const before = api.calls.filter(call => call.name === 'search_public_explore_session').length;
      const result = await run({ query: 'nails at 999999 Imaginary Lane Milwaukee WI' });
      assert.equal(result.addressStatus, 'unmatched');
      assert.equal(result.results.length, 0);
      assert.equal(api.calls.filter(call => call.name === 'search_public_explore_session').length, before);
    });
    await t.test('nearby typo uses known city rather than Maine', async () => {
      const result = await run({ query: 'nails nearly me', location: 'Milwaukee, WI', locationSource: 'saved' });
      assert.equal(result.location, 'Milwaukee, WI');
      assert.ok(result.results.some(row => row.city === 'Milwaukee' && row.isPrimaryMatch));
    });
    await t.test('pagination preserves the chosen region and does not repeat salons', async () => {
      const first = await run({ query: 'nails near me', location: 'Milwaukee, WI', locationSource: 'saved', pageSize: 2 });
      assert.equal(first.hasMore, true);
      const second = await run({ ...first, cursor: first.nextCursor, page: 2, scopePolicy: first.scope.policy });
      assert.equal(second.location, 'Milwaukee, WI');
      assert.equal(second.locationPriority, true);
      assert.ok(second.results.every(row => !first.results.some(previous => previous.id === row.id)));
    });
  } finally { await fixture.close(); }
});
