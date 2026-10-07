import { directoryCollectedOn, wisconsinBusinesses } from "@/lib/wisconsin-directory";
import { getDirectorySalonLinks } from "@/lib/salon-directory";

export async function GET() {
  const links = await getDirectorySalonLinks(wisconsinBusinesses.map((business) => business.id));
  return Response.json({
    collectedOn: directoryCollectedOn,
    coverage: "Partial Wisconsin coverage; listings are unclaimed and not owner verified.",
    businesses: wisconsinBusinesses.map((business) => ({
      ...business,
      linkedSalonId: links.get(business.id)?.salonId ?? null,
      verificationStatus: links.get(business.id)?.claimState ?? "unclaimed",
    })),
  }, { headers: { "Content-Disposition": 'attachment; filename="wisconsin-beauty-directory.json"' } });
}
