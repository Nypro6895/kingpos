import { loginHrefForReturnPath } from "@/lib/auth-routing";
import {
  getCurrentBusinessContext,
  getWorkspaceLandingHref,
  isWorkspaceDestinationAllowed,
  setNormalizedWorkspaceContext,
} from "@/lib/current-context";
import { revalidatePath } from "next/cache";
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

function safeDestinationUrl(requestUrl: URL, destination: string) {
  if (!destination.startsWith("/") || destination.startsWith("//")) {
    return null;
  }

  const target = new URL(destination, requestUrl.origin);

  if (target.origin !== requestUrl.origin) {
    return null;
  }

  return target;
}

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const workspaceId = requestUrl.searchParams.get("workspace_id")?.trim() ?? "";
  const context = await getCurrentBusinessContext();

  if (!context.user) {
    return loginRedirect(requestUrl);
  }

  if (!workspaceId) {
    return errorRedirect(requestUrl, "Choose a workspace before opening it.");
  }

  const workspace = context.workspaceOptions.find(
    (option) => option.id === workspaceId,
  );

  if (!workspace) {
    return errorRedirect(
      requestUrl,
      "You no longer have access to that workspace.",
    );
  }

  const requestedDestination =
    requestUrl.searchParams.get("destination")?.trim() ||
    getWorkspaceLandingHref(workspace);
  const destinationUrl = safeDestinationUrl(requestUrl, requestedDestination);

  if (!destinationUrl) {
    return errorRedirect(
      requestUrl,
      "That shortcut is no longer available for this workspace.",
    );
  }

  const destinationWithSearch = `${destinationUrl.pathname}${destinationUrl.search}`;
  const destinationPathOnly = destinationUrl.pathname;
  const destinationAllowed =
    isWorkspaceDestinationAllowed(workspace, destinationWithSearch) ||
    isWorkspaceDestinationAllowed(workspace, destinationPathOnly);

  if (!destinationAllowed) {
    return errorRedirect(
      requestUrl,
      "That shortcut is no longer available for this workspace.",
    );
  }

  try {
    await setNormalizedWorkspaceContext(workspace);
  } catch (error) {
    return errorRedirect(
      requestUrl,
      error instanceof Error
        ? error.message
        : "Workspace context could not be updated.",
    );
  }

  revalidatePath("/", "layout");
  return NextResponse.redirect(destinationUrl);
}
