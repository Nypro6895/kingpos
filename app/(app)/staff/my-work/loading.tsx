export default function StaffTodayLoading() {
  return <main aria-busy="true" aria-label="Loading Staff Today" className="mx-auto w-full max-w-7xl px-4 py-4 sm:px-6 sm:py-5">
    <p className="text-sm text-zinc-500" role="status">Loading your work…</p>
    <div aria-hidden="true" className="mt-4 space-y-4 motion-safe:animate-pulse"><div className="h-8 w-56 rounded bg-zinc-100" /><div className="h-10 rounded bg-zinc-100" /><div className="h-32 rounded-xl bg-orange-50" /><div className="h-24 rounded-xl bg-zinc-100" /></div>
  </main>;
}
