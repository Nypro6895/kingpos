import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createRequire } from "node:module";
import vm from "node:vm";

const require = createRequire(import.meta.url);
const ts = require("typescript");

function read(path) {
  return readFileSync(path, "utf8");
}

function loadTrustModule() {
  const source = read("lib/reylumi-trust.ts");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  });
  const mod = { exports: {} };

  vm.runInNewContext(outputText, {
    Intl,
    console,
    exports: mod.exports,
    module: mod,
    require,
  });

  return mod.exports;
}

const trust = loadTrustModule();
const trustSource = read("lib/reylumi-trust.ts");
const trustComponent = read("components/reylumi-trust.tsx");
const exploreClient = read("app/explore/explore-client.tsx");
const exploreFeed = read("app/explore/explore-feed.tsx");
const exploreMap = read("app/explore/explore-map.tsx");
const salonProfile = read("app/salon-profile/salon-profile-view.tsx");
const legalPolicies = read("lib/legal-policies.ts");

function build(input, context) {
  return trust.buildReylumiTrustSummary(
    {
      averageRating: null,
      noIssueRate: null,
      sharedExperienceCount: 0,
      uniqueCustomerCount: 0,
      verifiedVisitCount: 0,
      ...input,
    },
    context,
  );
}

function evidence(overrides = {}) {
  return {
    ruleVersion: "lumi-trust-v2", asOf: "2026-10-05T00:00:00Z",
    feedbackDays: 180, returnDays: 90, cohortDays: 180,
    verifiedVisitCount: 240, uniqueVisitorCount: 100,
    feedbackCustomerCount: 100, goodFeedbackCount: 98, issueFeedbackCount: 2,
    eligibleReturnCustomerCount: 100, returningCustomerCount: 70,
    ...overrides,
  };
}
function withEvidence(overrides) { return build({ trustEvidence: evidence(overrides) }); }

test("resolver maps eligible evidence into five levels", () => {
  assert.equal(withEvidence({ verifiedVisitCount: 0, uniqueVisitorCount: 0, feedbackCustomerCount: 0, goodFeedbackCount: 0, issueFeedbackCount: 0, eligibleReturnCustomerCount: 0, returningCustomerCount: 0 }).level, "empty");
  assert.equal(withEvidence({ uniqueVisitorCount: 1, feedbackCustomerCount: 1, goodFeedbackCount: 1, issueFeedbackCount: 0, eligibleReturnCustomerCount: 0, returningCustomerCount: 0 }).level, "level_1");
  assert.equal(withEvidence({ feedbackCustomerCount: 10, goodFeedbackCount: 10, issueFeedbackCount: 0, eligibleReturnCustomerCount: 10, returningCustomerCount: 6 }).level, "level_2");
  assert.equal(withEvidence({ feedbackCustomerCount: 30, goodFeedbackCount: 29, issueFeedbackCount: 1, eligibleReturnCustomerCount: 30, returningCustomerCount: 20 }).level, "level_3");
  assert.equal(withEvidence().level, "full");
});
test("visits alone never confer quality, including long-established salons", () => {
  const a = withEvidence({ verifiedVisitCount: 10, uniqueVisitorCount: 10, feedbackCustomerCount: 0, goodFeedbackCount: 0, issueFeedbackCount: 0, eligibleReturnCustomerCount: 0, returningCustomerCount: 0 });
  const b = withEvidence({ verifiedVisitCount: 100000, feedbackCustomerCount: 0, goodFeedbackCount: 0, issueFeedbackCount: 0, eligibleReturnCustomerCount: 0, returningCustomerCount: 0 });
  assert.equal(a.level, "level_1"); assert.equal(b.level, a.level);
  assert.equal(a.qualityScore, null); assert.equal(b.qualityScore, null);
});
test("returning customers without feedback contribute, without fabricating good feedback", () => {
  const result = withEvidence({ feedbackCustomerCount: 0, goodFeedbackCount: 0, issueFeedbackCount: 0 });
  assert.equal(result.level, "level_3");
  assert.ok(result.evidence.returning); assert.equal(result.evidence.reputation, undefined);
});
test("missing return observation does not punish young salons and cannot yield Diamond", () => {
  const result = withEvidence({ eligibleReturnCustomerCount: 0, returningCustomerCount: 0 });
  assert.equal(result.level, "level_3");
  assert.match(result.evidence.returning.detail, /full 90 days/);
});
test("negative feedback cannot be erased by returning or resolved issues", () => {
  const negative = withEvidence({ goodFeedbackCount: 30, issueFeedbackCount: 70, returningCustomerCount: 100 });
  assert.equal(negative.level, "level_1");
  assert.match(negative.evidence.reputation.detail, /Resolved issues remain issues/);
  assert.equal(withEvidence({ goodFeedbackCount: 80, issueFeedbackCount: 20, returningCustomerCount: 100 }).level, "level_2");
});
test("volume, rating, followers and admin verification do not increase Trust", () => {
  const first = build({ averageRating: 1, trustEvidence: evidence() });
  const second = build({ averageRating: 5, trustEvidence: evidence({ verifiedVisitCount: 100000 }) }, { verifiedVisitState: true, isNew: false });
  assert.equal(first.qualityScore, second.qualityScore); assert.equal(first.level, second.level);
  assert.equal(first.evidence.recognition, undefined);
  assert.ok(!first.facts.some((fact) => fact.kind === "rating"));
});
test("Wilson adjusts confidence for small independent samples", () => {
  assert.ok(Math.abs(trust.lumiTrustWilsonLower(5, 5) - 0.6488) < 0.001);
  assert.ok(trust.lumiTrustWilsonLower(5, 5) < trust.lumiTrustWilsonLower(98, 100));
  assert.equal(trust.lumiTrustWilsonLower(0, 0), null);
  assert.equal(trust.lumiTrustWilsonLower(6, 5), null);
});
test("malformed/unknown evidence does not create a quality score", () => {
  for (const invalid of [{ ruleVersion: "future" }, { returningCustomerCount: 101 }, { goodFeedbackCount: 120 }, { feedbackCustomerCount: NaN }]) {
    assert.equal(withEvidence(invalid).qualityScore, null);
    assert.notEqual(withEvidence(invalid).level, "full");
  }
});
test("RPC failure is unknown, not an invented zero rate or quality tier", () => {
  const result = build({ trustEvidence: null, verifiedVisitCount: 500 });
  assert.equal(result.level, "empty"); assert.equal(result.qualityScore, null);
  assert.equal(result.mark.label, "Trust temporarily unavailable");
});
test("sorting follows resolved trust tiers and does not reward raw visit volume", () => {
  const a = { averageRating: null, trustEvidence: evidence() };
  const b = { averageRating: null, trustEvidence: evidence({ verifiedVisitCount: 100000 }) };
  assert.equal(trust.reylumiTrustScore(a), trust.reylumiTrustScore(b));
});

test("Lumi Spark uses Common, Silver, Gold and Diamond materials with no empty mark", () => {
  assert.match(trustComponent, /export function LumiTrustSpark/);
  for (const name of ["Common", "Silver", "Gold", "Diamond"]) {
    assert.ok(trustComponent.includes(`name: "${name}"`));
  }
  assert.match(trustComponent, /if \(level === "empty"\) return null/);
  assert.equal((trustComponent.match(/if \(summary.level === "empty"\) return null/g) ?? []).length, 2);
  assert.match(trustComponent, /linearGradient/);
  assert.match(trustComponent, /radialGradient/);
  assert.match(trustComponent, /data-lumi-trust-material/);
  assert.doesNotMatch(trustComponent, /LUMI_TRUST_FILL_RATIO/);
});

test("presentation keeps trust compact and removes old badge semantics", () => {
  const combined = [
    trustSource,
    trustComponent,
    exploreClient,
    exploreFeed,
    exploreMap,
    salonProfile,
  ].join("\n\n");

  assert.match(exploreClient, /SalonTrustLine/);
  assert.match(exploreFeed, /SalonTrustLine/);
  assert.match(exploreMap, /SalonTrustLine/);
  assert.match(salonProfile, /SalonTrustLine/);
  assert.match(salonProfile, /id="lumi-trust"/);
  assert.match(salonProfile, /value === "lumi-trust"/);
  assert.match(salonProfile, /Current trust evidence/);
  assert.doesNotMatch(salonProfile, /ExperienceSignalStrip|Details below|Profile signal/);
  assert.doesNotMatch(combined, /LUMI PROFILE|LUMI VISIT|LUMI LINKED|Linked public salon|Booking connected/);
  assert.doesNotMatch(legalPolicies, /public profile state/);
});

test("rule configuration remains ordered and normalized for future edits", () => {
  const r = trust.LUMI_TRUST_RULES;
  assert.equal(r.feedbackWeight + r.returnWeight, 1);
  assert.ok(r.returnBenchmark > 0 && r.returnBenchmark <= 1);
  assert.ok(r.silverScore < r.goldScore && r.goldScore < r.diamondScore);
  assert.ok(r.bothSamples.silver < r.bothSamples.gold && r.bothSamples.gold < r.bothSamples.diamond);
  assert.ok(r.singleSamples.silver >= r.bothSamples.silver);
  assert.ok(r.singleSamples.gold >= r.bothSamples.gold);
});
test("an empty valid source still exposes zero visits and unknown return observation", () => {
  const result = withEvidence({ verifiedVisitCount: 0, uniqueVisitorCount: 0, feedbackCustomerCount: 0, goodFeedbackCount: 0, issueFeedbackCount: 0, eligibleReturnCustomerCount: 0, returningCustomerCount: 0 });
  assert.equal(result.level, "empty");
  assert.equal(result.evidence.verification.value, "0");
  assert.equal(result.evidence.returning.value, "Building evidence");
});

test("a first positive feedback does not collapse a mature return-only tier", () => {
  const before = withEvidence({ feedbackCustomerCount: 0, goodFeedbackCount: 0, issueFeedbackCount: 0 });
  const after = withEvidence({ feedbackCustomerCount: 1, goodFeedbackCount: 1, issueFeedbackCount: 0 });
  assert.equal(before.level, "level_3"); assert.equal(after.level, before.level);
});
test("a single newly matured customer does not dominate established feedback", () => {
  const before = withEvidence({ eligibleReturnCustomerCount: 0, returningCustomerCount: 0 });
  const after = withEvidence({ eligibleReturnCustomerCount: 1, returningCustomerCount: 0 });
  assert.equal(after.level, before.level);
  assert.notEqual(after.level, "full");
});

test("Next-facing Trust source and rule documentation remain valid UTF-8", () => {
  const decoder = new TextDecoder("utf-8", { fatal: true });
  for (const path of ["lib/reylumi-trust.ts", "lib/lumi-trust-data.ts", "docs/lumi-trust-rules.md"]) {
    assert.doesNotThrow(() => decoder.decode(readFileSync(path)), path);
  }
});
