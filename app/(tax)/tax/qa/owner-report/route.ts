import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";

/** Local opt-in entry for the real owner page with isolated sample data. */
export function GET(request: Request) {
  const url = new URL(request.url);
  if (process.env.NODE_ENV === "production" || process.env.REYLUMI_TAX_LOCAL_QA !== "1" || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) {
    return new NextResponse(null, { status: 404 });
  }
  const response = NextResponse.redirect(new URL("/payroll/tax-company", url));
  response.headers.set("Cache-Control", "no-store");
  for (const [name, value] of [["reylumi-tax-qa-session", randomUUID()], ["reylumi-tax-qa-mode", "owner"]]) {
    response.cookies.set(name, value, { httpOnly: true, sameSite: "strict", path: "/", maxAge: 3600 });
  }
  return response;
}
