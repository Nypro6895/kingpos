import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import test from "node:test";

test("Explore inspiration never promotes a disabled booking link during content enrichment", { skip: !process.env.ESBUILD_MODULE_PATH }, async () => {
  const { build } = await import(pathToFileURL(process.env.ESBUILD_MODULE_PATH).href);
  const built = await build({ entryPoints: ["lib/explore-inspiration.ts"], bundle: true, write: false, format: "esm", platform: "node",
    plugins: [{ name: "public-data", setup(builder) {
      builder.onResolve({ filter: /^(server-only|@\/lib\/(content-booking|account-social|explore-decision-signals|explore-salon-logos|salon-operating-status|salon-profile|supabase\/server))$/ }, args => ({ path: args.path, namespace: "stub" }));
      builder.onLoad({ filter: /.*/, namespace: "stub" }, () => ({ loader: "js", contents: `
        export const createSupabaseServerClient=()=>({rpc:async()=>({data:globalThis.gateRows,error:null})});
        export const loadPublicContentBookingOptions=async()=>globalThis.gateOptions;
        export const contentBookingOptionKey=({sourceType,contentId})=>sourceType+':'+contentId;
        export const getAccountSavedPostStateKeys=async()=>new Set();
        export const getExploreDecisionSignalsBySalonId=async()=>new Map();
        export const exploreFeedTrustFromDecisionSignals=()=>({});
        export const loadPublicSalonLogoPaths=async()=>new Map();
        export const getPublicSalonOperatingStatusesBySalonId=async()=>new Map();
        export const operatingStatusFromMap=()=>null;
        export const getSalonProfileMediaUrl=path=>path?'https://example.com/image.webp':null;
      ` }));
    } }],
  });
  const { getExploreInspirationPage } = await import("data:text/javascript;base64," + Buffer.from(built.outputFiles[0].text).toString("base64"));
  const salonId = "1650370b-f86d-461e-8d97-6210052eeed7";
  const contentId = "2650370b-f86d-461e-8d97-6210052eeed7";
  const href = `/book/${salonId}?inspiration=${contentId}`;
  globalThis.gateRows = [{ salon_id: salonId, salon_name: "King Nails", content_id: contentId, content_type: "look", media_id: contentId, media_path: "photo.webp", published_at: "2026-10-05T10:00:00Z", booking_enabled: false, booking_href: href }];
  try {
    for (const [bookingEnabled, bookingCtaEnabled] of [[false, true], [true, false], [false, false], [true, true]]) {
      globalThis.gateOptions = [{ salonId, contentId, sourceType: "salon_profile_look", bookingEnabled, bookingCtaEnabled, bookingHref: href, primaryServiceId: salonId, primaryServiceName: "Full Set", readinessState: "quick_ready", ctaLabel: "Book this look" }];
      const result = await getExploreInspirationPage();
      assert.equal(result.error, null);
      assert.equal(result.items.length, 1);
      assert.equal(result.items[0].bookingEnabled, bookingEnabled && bookingCtaEnabled);
      assert.equal(result.items[0].bookingHref, bookingEnabled && bookingCtaEnabled ? href : null);
    }
  } finally { delete globalThis.gateRows; delete globalThis.gateOptions; }
});
