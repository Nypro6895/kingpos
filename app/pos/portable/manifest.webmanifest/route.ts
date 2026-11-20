import { webAppManifestResponse } from "@/lib/web-app-manifest";

export function GET() {
  return webAppManifestResponse(true);
}
