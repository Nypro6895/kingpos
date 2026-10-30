import { redirect } from "next/navigation";
import { withExperiencePage } from "@/components/experience-page";
import { getCurrentKingUser } from "@/lib/users/current-user";
import { loadPersonalQr, loadPersonalQrCatalog } from "@/app/qr/actions";
import { PersonalQrClient } from "@/app/qr/personal-qr-client";

async function PersonalQrPage({ searchParams }: { searchParams?: Promise<{ entry?: string; visit?: string; scan?: string }> }) {
  const params = await searchParams ?? {};
  const user = await getCurrentKingUser();
  if (!user) {
    const query = new URLSearchParams();
    if (params.entry) query.set("entry", params.entry);
    if (params.visit) query.set("visit", params.visit);
    if (params.scan === "1") query.set("scan", "1");
    redirect(`/login?next=${encodeURIComponent(`/qr${query.size ? `?${query}` : ""}`)}`);
  }
  const [workspace, catalog] = await Promise.all([loadPersonalQr(user.id), params.entry ? loadPersonalQrCatalog(user.id, params.entry) : null]);
  return <PersonalQrClient key={`${user.id}:${params.entry ?? ""}:${params.visit ?? ""}:${params.scan === "1"}`} viewerId={user.id} customerName={user.display_name ?? "Guest"} initial={workspace.data ?? null} initialError={workspace.error ?? catalog?.error} entry={params.entry} initialCatalog={catalog?.catalog} initialVisitId={params.visit} initialScan={params.scan === "1"} />;
}
export default withExperiencePage(PersonalQrPage);
