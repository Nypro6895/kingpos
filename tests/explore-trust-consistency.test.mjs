import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import test from 'node:test';
const require = createRequire(import.meta.url);
const ts = require('typescript');


const mod = { exports: {} };
const cache = new Map();
function load(path) {
  if (cache.has(path)) return cache.get(path);
  const m = { exports: {} };
  const { outputText: code } = ts.transpileModule(readFileSync(path, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } });
  vm.runInNewContext(code, { exports: m.exports, console, require: (name) => {
    if (name === 'server-only') return {};
    if (name === '@/lib/public-booking-routes') return { normalizePublicBookingHref: (href) => href };
    return load(name.replace('@/', '') + '.ts');
  } });
  cache.set(path, m.exports); return m.exports;
}
Object.assign(mod.exports, load('lib/explore-decision-signals.ts'));
test('Explore uses the same canonical reputation evidence as Profile', async () => {
  const calls = [];
  const result = await mod.exports.getExploreDecisionSignalsBySalonId(async (name, args) => {
    calls.push([name, args]);
    return { error: null, data: name === 'get_public_explore_decision_signals'
      ? [{ salon_id: 'salon-a', average_rating: null, review_count: 0, booking_enabled: true, booking_href: '/book/salon-a' }]
      : [{ average_rating: 4.7, experience_count: 80, no_issue_rate: 0.95, unique_customer_count: 40, verified_visit_count: 120 }] };
  }, ['salon-a', 'salon-a']);
  const signals = result.get('salon-a');
  assert.equal(signals.verifiedVisitCount, 120);
  assert.equal(signals.experienceCount, 80);
  assert.equal(signals.uniqueCustomerCount, 40);
  assert.equal(signals.averageRating, 4.7);
  assert.equal(signals.noIssueRate, 0.95);
  assert.equal(signals.bookingEnabled, true);
  assert.equal(calls.length, 4);
  assert.ok(calls.some(([name])=>name === "get_public_salon_identity"));
});
test('Explore preserves available signals if canonical reputation is unavailable', async () => {
  const result = await mod.exports.getExploreDecisionSignalsBySalonId(async (name) => name === 'get_public_explore_decision_signals'
    ? { error: null, data: [{ salon_id: 'salon-a', average_rating: 4, review_count: 3 }] }
    : { error: { message: 'Unavailable' }, data: null }, ['salon-a']);
  assert.equal(result.get('salon-a').experienceCount, 3);
});
test('Feed computes salon trust without post-specific verification and has no white icon cover', () => {
  const feed = readFileSync('app/explore/explore-feed.tsx', 'utf8');
  assert.match(feed, /<SalonTrustLine signals=\{item.salon.trust\}/);
  assert.doesNotMatch(feed, /markClassName="[^"]*(?:bg-white|ring-1|shadow-)/);
});

test('Explore and Profile preserve canonical return evidence through every adapter', async () => {
  const raw = { salon_id: 'salon-a', rule_version: 'lumi-trust-v2', as_of: '2026-10-05T00:00:00Z', feedback_days: 180, return_days: 90, cohort_days: 180, verified_visit_count: '240', unique_visitor_count: '100', feedback_customer_count: '100', good_feedback_count: '98', issue_feedback_count: '2', eligible_return_customer_count: '100', returning_customer_count: '70' };
  const result = await mod.exports.getExploreDecisionSignalsBySalonId(async (name) => ({ error: null, data: name === 'get_public_lumi_trust_signals' ? [raw] : name === 'get_public_explore_decision_signals' ? [{ salon_id: 'salon-a' }] : [{}] }), ['salon-a']);
  const evidence = result.get('salon-a').trustEvidence;
  assert.equal(evidence.returningCustomerCount, 70);
  const feed = mod.exports.exploreFeedTrustFromDecisionSignals(result.get('salon-a'));
  assert.equal(feed.trustEvidence, evidence);
  const trust = load('lib/reylumi-trust.ts');
  assert.equal(trust.buildReylumiTrustSummary(feed).level, 'full');
  assert.match(readFileSync('lib/salon-profile.ts','utf8'), /trustEvidence: trustEvidenceBySalon.get\(salonId\)/);
});
test('canonical data loader rejects malformed/version-mismatched aggregate rows', async () => {
  const loader = load('lib/lumi-trust-data.ts');
  const map = await loader.getLumiTrustEvidenceBySalonId(async () => ({ error: null, data: [{ salon_id: 'salon-a', rule_version: 'future' }] }), ['salon-a']);
  assert.equal(map.size, 0);
});
test('bookable display price matches its actual service rather than a global salon minimum',async()=>{
 const result=await mod.exports.getExploreDecisionSignalsBySalonId(async name=>({error:null,data:name==='get_public_explore_decision_signals'?[{salon_id:'salon-a',bookable_service_id:'deluxe',bookable_service_name:'Deluxe'}]:name==='get_public_salon_service_prices'?[{salon_id:'salon-a',service_id:'basic',service_name:'Basic',base_price:40},{salon_id:'salon-a',service_id:'deluxe',service_name:'Deluxe pedicure',base_price:100}]:[]}),['salon-a']);
 assert.equal(result.get('salon-a').bookableServicePrice,100);assert.equal(result.get('salon-a').bookableServiceName,'Deluxe pedicure');
});
