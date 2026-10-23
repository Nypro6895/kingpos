export async function GET() {
  return Response.json({
    error: "This directory export is no longer available.",
    exploreHref: "/explore?location=WI&scope=fixed",
  }, { status: 410, headers: { "Cache-Control": "no-store" } });
}
