import {
  getPublicSalonOperatingStatusesBySalonId,
  normalizeSalonOperatingStatusSalonIds,
  operatingStatusFromMap,
} from "@/lib/salon-operating-status";
import { type NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

function requestedSalonIds(request: NextRequest) {
  const ids: string[] = [];

  for (const value of request.nextUrl.searchParams.getAll("salonId")) {
    ids.push(value);
  }

  for (const value of request.nextUrl.searchParams.getAll("salonIds")) {
    ids.push(...value.split(","));
  }

  return normalizeSalonOperatingStatusSalonIds(ids);
}

export async function GET(request: NextRequest) {
  const salonIds = requestedSalonIds(request);

  if (salonIds.length === 0) {
    return NextResponse.json(
      { error: "Provide at least one salonId." },
      { status: 400 },
    );
  }

  const statuses = await getPublicSalonOperatingStatusesBySalonId(salonIds);

  return NextResponse.json({
    statuses: salonIds.map((salonId) => ({
      salonId,
      status: operatingStatusFromMap(statuses, salonId),
    })),
  });
}
