export default function AppPageLoading() {
  return <div role="status" aria-live="polite" className="mx-auto grid w-full max-w-6xl gap-4 px-4 py-6">
    <p className="text-sm text-zinc-500">Loading page…</p>
    <div aria-hidden="true" className="h-8 w-48 animate-pulse rounded bg-zinc-100"/>
    <div aria-hidden="true" className="h-40 animate-pulse rounded bg-zinc-100"/>
  </div>;
}
