import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import ts from "typescript";

test("own salon public link restores management route; staff, guests and other salons stay public", async () => {
  const source = readFileSync("app/(app)/explore/salons/[salonId]/page.tsx", "utf8");
  for (const [mode, salon, user, redirects] of [["manage", "salon", {}, true], ["staff", "salon", {}, false], ["manage", "other", {}, false], ["manage", "salon", null, false]]) {
    const exports = {};
    const require = name => {
      if (name === "next/navigation") return { redirect(path) { throw new Error(`redirect:${path}`); }, notFound() { throw new Error("notFound"); } };
      if (name.includes("current-context")) return { getCurrentBusinessContext: async () => ({ user, currentSalon: {id:salon}, salonMode:mode }), isSalonManageContext: context => context.salonMode === "manage" };
      if (name.includes("salon-profile-view")) return { SalonProfileView: () => null };
      if (name.includes("explore-account-actions")) return { ExploreAccountActionsProvider: ({children}) => children };
      if (name.includes("lib/salon-profile")) return { getPublicSalonProfileData: async () => ({profile:{operatingStatus:{kind:"open"}}}) };
      return createRequire(import.meta.url)(name);
    };
    new Function("require", "exports", ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText)(require, exports);
    if (redirects) await assert.rejects(exports.default({params:Promise.resolve({salonId:"salon"})}), /redirect:\/salon-profile/);
    else {
      const result = await exports.default({params:Promise.resolve({salonId:"salon"})});
      const profile = result.props.children.find(child => child?.props?.capabilities);
      assert.equal(profile.props.capabilities.canCreateContent, false);
      assert.equal(profile.props.capabilities.canEditProfile, false);
    }
  }
});
