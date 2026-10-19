import "server-only";
import { createHash } from "node:crypto";
import policy from "./app-local-command-policy.json";

// This original read already supports the abuse-signed guest device. No other
// action or moderation operation becomes a guest capability through this list.
const moduleName = "app/post-moderation/actions.ts";
const exportName = "loadHiddenPostIdentitiesAction";
if (!policy.modules[moduleName].includes(exportName)) {
  throw new Error("The guest hidden-post read must remain in the reviewed action policy.");
}

// Keep exactly the same module/export identity as build-app-local-bundle.mjs.
export const APP_LOCAL_GUEST_HIDDEN_POSTS_READ = "action." + createHash("sha256")
  .update(moduleName + "#" + exportName).digest("hex").slice(0, 24);
