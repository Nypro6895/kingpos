import { connection } from "next/server";
import { headers } from "next/headers";
import { getCurrentBusinessContext } from "@/lib/current-context";
import { admitServicesCatalog, ServicesCatalogAdmissionError } from "@/lib/services-catalog-admission-server";
import { servicesCatalogPilotEnabled } from "@/lib/services-catalog-pilot-flag";
import { runReadWithDeadline } from "@/lib/bounded-get";

/** Online services.view admission only. The response is never a disk/offline lease. */
export async function GET(request: Request) {
  const responseHeaders = { "Cache-Control": "private, no-store", Vary: "Cookie" };
  const reply = (body: unknown, status: number) => Response.json(body, { status, headers: responseHeaders });
  if (!servicesCatalogPilotEnabled()) return reply({ error: "Unavailable" }, 404);
  await connection();
  if ((await headers()).get("x-reylumi-auth-unavailable") === "1") return reply({ error: "Connect to verify your access." }, 503);
  try {
    const expected = new URL(request.url).searchParams.get("scope");
    const context = await runReadWithDeadline(getCurrentBusinessContext(), 10_000);
    return reply(await admitServicesCatalog(context, expected), 200);
  } catch (error) {
    if (error instanceof ServicesCatalogAdmissionError) return reply({ error: error.message }, error.status);
    // Never interpret a failed permission lookup as an offline authorization.
    return reply({ error: "Connect to verify your access." }, 503);
  }
}
