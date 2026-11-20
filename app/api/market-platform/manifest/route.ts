export function GET() {
  return Response.json({ schemaVersion: 1, type: "hosted-app", version: "1.0.0", name: "Your salon app", description: "Describe what your hosted app does for salon owners.", launchUrl: "https://your-company.com/app", privacyUrl: "https://your-company.com/privacy", supportUrl: "https://your-company.com/support", scopes: ["salon:identity:read"], price: { currency: "usd", amountCents: 0, billing: "one-time-version" } }, { headers: { "Content-Disposition": 'attachment; filename="reylumi-connection.json"', "Cache-Control": "no-store" } });
}
