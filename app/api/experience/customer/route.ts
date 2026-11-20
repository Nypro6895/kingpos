import { connection } from "next/server";
import { headers } from "next/headers";
import { getRequestBusinessContext } from "@/lib/request-business-context";
import { getExperienceContext } from "@/lib/experience-context";
import { createLiveResourceSnapshot, liveResourceResponse } from "@/lib/experience-live-resource-server";
import { CustomerExperienceReadError, loadCustomerExperienceResource } from "@/lib/customer-experience-resource-server";
import { runReadWithDeadline } from "@/lib/bounded-get";

const failure = (error: string, status: number) => Response.json({ error }, { status, headers: { "Cache-Control": "private, no-store", Vary: "Cookie" } });

export async function GET(request: Request) {
  await connection();
  try {
    if ((await headers()).get("x-reylumi-auth-unavailable") === "1") return failure("Authentication temporarily unavailable", 503);
    const context = await runReadWithDeadline(getRequestBusinessContext(), 12000);
    if (!context.user) return failure("Unauthorized", 401);
    const query = new URL(request.url).searchParams;
    if (query.get("scope") !== getExperienceContext(context).scope) return failure("Workspace changed", 409);
    const resource = await runReadWithDeadline(loadCustomerExperienceResource(query), 12000);
    return liveResourceResponse(request, createLiveResourceSnapshot(resource));
  } catch (error) {
    if (error instanceof CustomerExperienceReadError) return failure(error.message, error.status);
    console.error("Customer view read failed", error);
    return failure("Temporarily unavailable", 503);
  }
}
