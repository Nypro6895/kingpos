import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(path, "utf8");
}

function readFirst(paths) {
  for (const path of paths) {
    try {
      return read(path);
    } catch (error) {
      if (error?.code !== "ENOENT") {
        throw error;
      }
    }
  }

  return read(paths[0]);
}

const activityAction = read("app/activity/actions.ts");
const activityPage = readFirst(["app/(app)/activity/page.tsx", "app/activity/page.tsx"]);
const activityPrompt = read("app/activity/visit-experience-prompt.tsx");
const exploreClient = read("app/explore/explore-client.tsx");
const exploreFeed = read("lib/explore-feed.ts");
const exploreFeedClient = read("app/explore/explore-feed.tsx");
const explorePage = readFirst(["app/(app)/explore/page.tsx", "app/explore/page.tsx"]);
const trustComponent = read("components/reylumi-trust.tsx");
const reylumiTrust = read("lib/reylumi-trust.ts");
const salonProfile = read("app/salon-profile/salon-profile-view.tsx");
const salonProfileService = read("lib/salon-profile.ts");
const customerActivity = read("lib/customer-activity.ts");
const exploreTypes = read("types/explore.ts");
const salonProfileTypes = read("types/salon-profile.ts");

test("public reputation language centers Experiences and Verified Visits", () => {
  assert.match(salonProfile, /id:\s*"experiences",\s*label:\s*"Experiences"/);
  assert.match(salonProfile, /function renderExperiences\(\)/);
  assert.match(salonProfile, /All Experiences/);
  assert.match(salonProfile, /Verified Visits/);
  assert.match(salonProfile, /Feedback starts from a Verified Visit/);
  assert.doesNotMatch(salonProfile, /createSalonProfileReviewAction/);
  assert.doesNotMatch(salonProfile, /Write a review before posting/);
});

test("shop profile can fall back to legacy reviews without making them the main concept", () => {
  assert.match(salonProfileService, /get_public_salon_profile_reputation_summary/);
  assert.match(salonProfileService, /get_public_salon_profile_experiences/);
  assert.match(salonProfileService, /Optional public reputation RPC unavailable/);
  assert.match(salonProfileService, /reviews\.map\(mapReviewToExperience\)/);
  assert.match(salonProfileTypes, /PublicSalonProfileReputationSummary/);
  assert.match(salonProfileTypes, /PublicSalonProfileExperience/);
});

test("post-visit UX is lightweight and voluntary", () => {
  assert.match(activityPage, /Verified Visit/);
  assert.match(activityPage, /VisitExperiencePrompt/);
  assert.match(activityPrompt, /How was your experience\?/);
  assert.match(activityPrompt, /Good/);
  assert.match(activityPrompt, /Had an issue/);
  assert.match(activityPrompt, /Optional details/);
  assert.match(activityAction, /record_customer_visit_experience/);
  assert.match(activityAction, /reputation backend still needs to be enabled/);
  assert.match(customerActivity, /CustomerActivityVerifiedVisit/);
});

test("explore reputation signals use Experience volume and visit evidence confidence", () => {
  assert.match(exploreTypes, /sharedExperienceCount:\s*number/);
  assert.match(exploreTypes, /verifiedVisitCount:\s*number/);
  assert.match(reylumiTrust, /reylumiVerifiedVisitCountLabel/);
  assert.match(exploreClient, /ReyLUMI activity context/);
  assert.match(exploreClient, /Trusted first/);
  assert.match(exploreClient, /orderedSearchSections/);
  assert.match(exploreClient, /orderReylumiExploreResults/);
  assert.match(explorePage, /searchIntentFromGlobalQuery/);
  assert.match(reylumiTrust, /rightSignals\.verifiedVisitCount \/ 80/);
  assert.match(explorePage, /customer rating with ReyLUMI activity context/);
  assert.match(exploreTypes, /ExploreFeedTrustSignals/);
  assert.match(exploreFeedClient, /FeedSalonIdentityLine/);
  assert.match(exploreFeedClient, /presentation="spark"/);
  assert.match(exploreFeedClient, /entityName=\{item\.salon\.name\}/);
  assert.doesNotMatch(exploreFeedClient, /LinkedShopTrustRow/);
  assert.doesNotMatch(exploreFeedClient, /FeedTrustOverlay/);
  assert.match(trustComponent, /LumiTrustPopover/);
  assert.doesNotMatch(trustComponent, /Verification, stars, ranking, and linked state are separate signals/);
  assert.match(salonProfile, /LumiTrustPopover/);
  assert.match(exploreFeed, /salon\.sharedExperienceCount > 0/);
  assert.match(exploreFeed, /verifiedVisitScore/);
});
