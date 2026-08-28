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

test("resolver maps canonical public signals into five LUMI Trust levels", () => {
  assert.equal(build({}).level, "empty");
  assert.equal(
    build({
      averageRating: 5,
      sharedExperienceCount: 1,
      uniqueCustomerCount: 1,
    }).level,
    "level_1",
  );
  assert.equal(
    build({
      averageRating: 4.5,
      noIssueRate: 0.92,
      sharedExperienceCount: 18,
      uniqueCustomerCount: 12,
      verifiedVisitCount: 25,
    }).level,
    "level_2",
  );
  assert.equal(
    build({
      averageRating: null,
      noIssueRate: 0.94,
      sharedExperienceCount: 0,
      uniqueCustomerCount: 40,
      verifiedVisitCount: 180,
    }).level,
    "level_3",
  );
  assert.equal(
    build({
      averageRating: 4.7,
      noIssueRate: 0.96,
      sharedExperienceCount: 160,
      uniqueCustomerCount: 90,
      verifiedVisitCount: 240,
    }).level,
    "full",
  );
});

test("resolver separates insufficient evidence from negative reputation", () => {
  const empty = build({});
  const negativeInput = {
    averageRating: 2.8,
    noIssueRate: 0.65,
    sharedExperienceCount: 80,
    uniqueCustomerCount: 50,
    verifiedVisitCount: 120,
  };
  const fullInput = {
    averageRating: 4.7,
    noIssueRate: 0.96,
    sharedExperienceCount: 160,
    uniqueCustomerCount: 90,
    verifiedVisitCount: 240,
  };
  const negative = build(negativeInput);

  assert.equal(empty.level, "empty");
  assert.equal(empty.hasSufficientEvidence, false);
  assert.equal(empty.evidenceRows.length, 0);
  assert.match(empty.mark.detail, /does not have enough evidence yet/);

  assert.equal(negative.level, "level_1");
  assert.equal(negative.hasSufficientEvidence, true);
  assert.ok(negative.evidence.reputation);
  assert.ok(
    trust.reylumiTrustScore(negativeInput) < trust.reylumiTrustScore(fullInput),
  );
});

test("resolver caps small high ratings and does not fabricate recognition", () => {
  const tinyPerfectRating = build({
    averageRating: 5,
    sharedExperienceCount: 1,
    uniqueCustomerCount: 1,
  });
  const broadNoRank = build({
    averageRating: 4.7,
    noIssueRate: 0.96,
    sharedExperienceCount: 160,
    uniqueCustomerCount: 90,
    verifiedVisitCount: 240,
  });

  assert.equal(tinyPerfectRating.level, "level_1");
  assert.notEqual(tinyPerfectRating.level, "full");
  assert.equal(broadNoRank.evidence.recognition, undefined);
  assert.doesNotMatch(trustSource, /#\d+|Top 10|Signature|Top salon/);
  assert.doesNotMatch(trustSource, /hasPublicProfile|isLinked|isRecommended/);
});

test("Lumi Spark visual contract uses one orange four-point SVG with five fill states", () => {
  assert.match(trustComponent, /export function LumiTrustSpark/);
  assert.match(trustComponent, /type LumiTrustSparkSize = "lg" \| "md" \| "sm" \| "xs"/);
  assert.match(trustComponent, /empty:\s*0/);
  assert.match(trustComponent, /level_1:\s*0\.28/);
  assert.match(trustComponent, /level_2:\s*0\.52/);
  assert.match(trustComponent, /level_3:\s*0\.76/);
  assert.match(trustComponent, /full:\s*1/);
  assert.match(trustComponent, /const LUMI_SPARK_PATH/);
  assert.match(trustComponent, /clipPath/);
  assert.match(trustComponent, /data-lumi-trust-level/);
  assert.match(trustComponent, /fill="currentColor"/);
  assert.match(trustComponent, /stroke="currentColor"/);
  assert.match(trustComponent, /text-brand-orange/);
  assert.doesNotMatch(trustComponent, /(?<!&)#[0-9a-fA-F]{3,8}/);
  assert.doesNotMatch(trustComponent, /Shield|CheckCircle|BadgeCheck/);
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

  assert.match(exploreClient, /LumiTrustPopover/);
  assert.match(exploreFeed, /LumiTrustPopover/);
  assert.match(exploreMap, /LumiTrustPopover/);
  assert.match(salonProfile, /actionHref="#lumi-trust"/);
  assert.match(salonProfile, /id="lumi-trust"/);
  assert.match(salonProfile, /value === "lumi-trust"/);
  assert.match(salonProfile, /Current trust evidence/);
  assert.doesNotMatch(salonProfile, /ExperienceSignalStrip|Details below|Profile signal/);
  assert.doesNotMatch(combined, /LUMI PROFILE|LUMI VISIT|LUMI LINKED|Linked public salon|Booking connected/);
  assert.doesNotMatch(legalPolicies, /public profile state/);
});
