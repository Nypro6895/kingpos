"use client";
import{WorkspaceText}from"@/components/workspace-language";import Link from"next/link";import type{AppLocalVisit}from"@/lib/app-local-secondary-metadata";
export function AppLocalVisitView({data}:{data:AppLocalVisit}){
return (
    <main className="mx-auto max-w-xl space-y-4 p-4">
      <section className="content-surface border-zinc-200 bg-white p-5 rounded-none border-y shadow-none">
        <h1 className="text-xl font-bold"><WorkspaceText text="Salon visit" /></h1>
        <p className="mt-2 font-semibold">{data.salonName}</p>
        <p className="mt-3 text-sm capitalize">
          <WorkspaceText text="Status:" /> <WorkspaceText text={String(data.status).replaceAll("_", " ")} />
        </p>
        <p className="mt-2 text-sm text-zinc-500">
          <WorkspaceText text="Checked in" />{" "}
          <WorkspaceText text={new Date(data.checkedInAt).toLocaleString("en-US", {
            timeZone: data.timezone,
          })} />
        </p>
        <p className="mt-3 text-sm text-zinc-600">
          <WorkspaceText text="This confirms your arrival. The salon updates your status as your visit progresses." />
        </p>
        {data.bookingId && (
          <Link
            className="mt-4 block text-sm font-semibold text-blue-700"
            href={`/my-bookings/${data.bookingId}`}
          >
            <WorkspaceText text="View appointment →" />
          </Link>
        )}
        {data.isCustomer && data.salonPhone && (
          <a
            className="mt-3 block text-sm font-semibold text-blue-700"
            href={`tel:${String(data.salonPhone).replace(/[^+0-9]/g, "")}`}
          >
            <WorkspaceText text="Contact salon" />
          </a>
        )}
      </section>
      <Link
        className="block text-sm font-semibold text-blue-700"
        href="/notifications"
      >
        <WorkspaceText text="Back to notifications" />
      </Link>
    </main>
  );
}
