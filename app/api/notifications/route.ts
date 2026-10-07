import { getCurrentBusinessContext } from "@/lib/current-context";
import { getAppNotificationScopeForContext } from "@/lib/workspace-pending";
import { loadNotificationPage } from "@/lib/notification-center";
import { createAuthenticatedSupabaseServerClient } from "@/lib/supabase/server";
const headers = { "Cache-Control": "private, no-store" };
export async function GET(request: Request) {
  const url = new URL(request.url);
  const at = url.searchParams.get("before");
  const id = url.searchParams.get("id");
  if (
    (at || id) &&
    (!at ||
      !id ||
      !Number.isFinite(Date.parse(at)) ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        id,
      ))
  )
    return Response.json(
      { error: "Invalid cursor." },
      { status: 400, headers },
    );
  const limit = Number(url.searchParams.get("limit") ?? 10);
  if (!Number.isInteger(limit) || limit < 1 || limit > 50)
    return Response.json(
      { error: "Invalid page size." },
      { status: 400, headers },
    );
  try {
    const context = await getCurrentBusinessContext();
    if (!context.user)
      return Response.json(
        { error: "Please sign in again." },
        { status: 401, headers },
      );
    return Response.json(
      await loadNotificationPage(context, {
        unread: url.searchParams.get("filter") === "unread",
        cursor: at && id ? { at, id } : undefined,
        limit,
      }),
      { headers },
    );
  } catch {
    return Response.json(
      { error: "Could not load notifications. Please try again." },
      { status: 503, headers },
    );
  }
}
export async function POST(request: Request) {
  if (request.headers.get("origin") !== new URL(request.url).origin)
    return Response.json(
      { error: "Invalid origin." },
      { status: 403, headers },
    );
  try {
    const input = await request.json();
    if (input.all === true) {
      const context = await getCurrentBusinessContext();
      if (!context.user)
        return Response.json(
          { error: "Please sign in again." },
          { status: 401, headers },
        );
      const client = await createAuthenticatedSupabaseServerClient();
      if (!client) throw Error("Unauthorized");
      const scope = getAppNotificationScopeForContext(context);
      const { error } = await client.rpc("mark_all_center_notifications", {
        p_kind: scope.recipientKind as string,
        p_salon: scope.salonId ?? null,
        p_account: scope.accountId ?? null,
      });
      if (error) throw error;
      return Response.json({ ok: true }, { headers });
    }
    if (
      !Array.isArray(input.ids) ||
      input.ids.length > 50 ||
      input.ids.some(
        (id: unknown) =>
          typeof id !== "string" ||
          !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
            id,
          ),
      )
    )
      return Response.json(
        { error: "Invalid notifications." },
        { status: 400, headers },
      );
    const client = await createAuthenticatedSupabaseServerClient();
    if (!client)
      return Response.json(
        { error: "Please sign in again." },
        { status: 401, headers },
      );
    const { data, error } = await client.rpc("mark_visible_notifications", {
      p_ids: input.ids,
    });
    if (error) throw error;
    const context = await getCurrentBusinessContext();
    const page = context.user
      ? await loadNotificationPage(context, { limit: 1 }).catch(() => null)
      : null;
    return Response.json(
      {
        ids: data ?? [],
        unreadCount: page?.unreadCount,
        scopeKey: `${context.user?.id}:${context.currentWorkspace?.id ?? "personal"}`,
      },
      { headers },
    );
  } catch {
    return Response.json(
      { error: "Could not save viewed notifications." },
      { status: 503, headers },
    );
  }
}
