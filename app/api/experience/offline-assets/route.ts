/** Public build assets only. Generated after every successful production build. */
export function GET() {
  return new Response(null, { status: 307, headers: {
    Location: "/experience-build-assets.json", "Cache-Control": "no-store",
    "X-Reylumi-Portable-Offline": process.env.KINGPOS_PORTABLE_DRAFT_OUTBOX === "1" ? "enabled" : "disabled",
  } });
}
