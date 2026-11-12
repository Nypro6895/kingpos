// QA diagnostics are unavailable in every production build.
export function GET() {
  if (process.env.NODE_ENV === "production" || process.env.REYLUMI_QA_MODE !== "local" ||
      process.env.NEXT_PUBLIC_SUPABASE_URL !== "http://127.0.0.1:55421" ||
      process.env.NEXT_PUBLIC_APP_URL !== "http://localhost:3117") {
    return new Response(null, { status: 404 });
  }
  return Response.json({ qa: true, project: "reylumi-qa-20261111", sourceBaseline: "acb17696eabeb49fc03a680b2610d4b6d1dc92bc", simulation: true }, { headers: { "Cache-Control": "no-store" } });
}
