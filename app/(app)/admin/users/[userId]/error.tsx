"use client";
import Link from "next/link";
export default function UserDetailError({ reset }: { reset:()=>void }) {
  return <section role="alert" className="rounded-xl border border-red-200 bg-white p-6"><h1 className="text-xl font-semibold">This user profile could not load</h1><p className="mt-2 text-sm text-zinc-600">The record may be unavailable, or the data service could not complete the request. Retry, or return to the user list to select another account.</p><div className="mt-4 flex gap-3"><button onClick={reset} className="rounded-lg bg-orange-600 px-4 py-2 text-sm font-semibold text-white">Retry profile</button><Link href="/admin/users" className="rounded-lg border px-4 py-2 text-sm font-semibold">Back to users</Link></div></section>;
}
