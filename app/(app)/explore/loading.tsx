export default function ExploreLoading() {
  return (
    <section aria-busy="true" aria-label="Loading Explore" className="mx-auto grid w-full max-w-[40rem] gap-4 px-4 py-6">
      <p role="status" className="text-sm text-zinc-600">Loading Explore...</p>
      {[0, 1].map((index) => (
        <div key={index} aria-hidden="true" className="overflow-hidden rounded-2xl border border-zinc-200 bg-white motion-safe:animate-pulse">
          <div className="m-4 h-10 w-48 rounded-lg bg-zinc-100" />
          <div className="aspect-[4/3] bg-zinc-100" />
          <div className="m-4 h-8 rounded-lg bg-zinc-100" />
        </div>
      ))}
    </section>
  );
}
