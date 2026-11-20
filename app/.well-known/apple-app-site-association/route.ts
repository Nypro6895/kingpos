// Public operating-system association, independent of account/session state.
export function GET() {
  return Response.json({ applinks: { details: [{
    appIDs: ["WJ4VQ4529Z.com.reylumi.ios"],
    components: [{ "/": "/check-in/*", comment: "Customer Camera check-in; app validates the exact UUID path." }],
  }] } }, { headers: { "Cache-Control": "public, max-age=3600" } });
}
