import { createAuthenticatedSupabaseServerClient } from "@/lib/supabase/server";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
export default async function VisitNotificationPage({
  params,
}: {
  params: Promise<{ visitId: string }>;
}) {
  const { visitId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(visitId)) notFound();
  const client = await createAuthenticatedSupabaseServerClient();
  if (!client) redirect("/login");
  const { data, error } = await client.rpc("get_notification_visit", {
    p_id: visitId,
  });
  if (error || !data) notFound();
  return (
    <main className="mx-auto max-w-xl space-y-4 p-4">
      <section className="content-surface border-zinc-200 bg-white p-5 rounded-none border-y shadow-none">
        <h1 className="text-xl font-bold">Salon visit</h1>
        <p className="mt-2 font-semibold">{data.salonName}</p>
        <p className="mt-3 text-sm capitalize">
          Status: {String(data.status).replaceAll("_", " ")}
        </p>
        <p className="mt-2 text-sm text-zinc-500">
          Checked in{" "}
          {new Date(data.checkedInAt).toLocaleString("en-US", {
            timeZone: data.timezone,
          })}
        </p>
        <p className="mt-3 text-sm text-zinc-600">
          This confirms your arrival. The salon updates your status as your
          visit progresses.
        </p>
        {data.bookingId && (
          <Link
            className="mt-4 block text-sm font-semibold text-blue-700"
            href={`/my-bookings/${data.bookingId}`}
          >
            View appointment →
          </Link>
        )}
        {data.isCustomer && data.salonPhone && (
          <a
            className="mt-3 block text-sm font-semibold text-blue-700"
            href={`tel:${String(data.salonPhone).replace(/[^+0-9]/g, "")}`}
          >
            Contact salon
          </a>
        )}
      </section>
      <Link
        className="block text-sm font-semibold text-blue-700"
        href="/notifications"
      >
        Back to notifications
      </Link>
    </main>
  );
}
