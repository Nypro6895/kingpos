import { loadTaxWorkspace } from "@/lib/tax-workspace";
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ salonId: string }> },
) {
  try {
    const { salonId } = await params;
    const data = await loadTaxWorkspace(salonId);
    return Response.json(data, {
      headers: { "Cache-Control": "private, no-store, max-age=0" },
    });
  } catch {
    return Response.json(
      { error: "Business access ended." },
      { status: 403, headers: { "Cache-Control": "no-store" } },
    );
  }
}
