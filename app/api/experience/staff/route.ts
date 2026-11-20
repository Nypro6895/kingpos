import { connection } from "next/server";
import { headers } from "next/headers";
import { createLiveResourceSnapshot, liveResourceResponse } from "@/lib/experience-live-resource-server";
import { loadStaffExperienceResource, StaffExperienceReadError } from "@/lib/staff-experience-resource-server";
import { runReadWithDeadline } from "@/lib/bounded-get";

const failure = (error: string, status: number) => Response.json({ error }, { status, headers: { "Cache-Control": "private, no-store", Vary: "Cookie" } });

export async function GET(request: Request) {
  await connection();
  try {
    if ((await headers()).get("x-reylumi-auth-unavailable") === "1") return failure("Authentication temporarily unavailable", 503);
    const resource = await runReadWithDeadline(loadStaffExperienceResource(new URL(request.url).searchParams), 12000);
    return liveResourceResponse(request, createLiveResourceSnapshot(resource));
  } catch (error) {
    if (error instanceof StaffExperienceReadError) return failure(error.message, error.status);
    console.error("Staff view read failed", error);
    return failure("Temporarily unavailable", 503);
  }
}
