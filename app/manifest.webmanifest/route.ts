import { webAppManifestResponse } from "@/lib/web-app-manifest";

// An explicit route avoids root file-based metadata overriding child manifests.
export function GET() {
  return webAppManifestResponse();
}
