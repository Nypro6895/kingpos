import { loginHrefForReturnPath } from "@/lib/auth-routing";
import { getCurrentBusinessContext } from "@/lib/current-context";
import { selectWorkspaceContext } from "@/lib/workspace-selection";
import { NextResponse } from "next/server";

function errorRedirect(requestUrl: URL, message: string) {
  const target = new URL("/my-place", requestUrl.origin);

  target.searchParams.set("error", message);
  return NextResponse.redirect(target);
}

function loginRedirect(requestUrl: URL) {
  const nextPath = `${requestUrl.pathname}${requestUrl.search}`;

  return NextResponse.redirect(
    new URL(loginHrefForReturnPath(nextPath), requestUrl.origin),
  );
}

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const context = await getCurrentBusinessContext();
  const result = await selectWorkspaceContext(context, requestUrl);
  if (!result.ok) return result.status === 401 ? loginRedirect(requestUrl) : errorRedirect(requestUrl, result.error);
  return NextResponse.redirect(result.destination);
}
