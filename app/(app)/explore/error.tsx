"use client";

export default function ExploreError({ unstable_retry }: { unstable_retry: () => void }) {
  return (
    <section role="alert" className="mx-auto grid max-w-lg gap-4 px-4 py-12 text-center">
      <h1 className="text-xl font-semibold">Explore could not be loaded</h1>
      <p className="text-sm text-zinc-600">Check your connection and try again. Your content may still be available.</p>
      <button onClick={unstable_retry} type="button" className="rounded-xl bg-zinc-950 px-4 py-3 font-semibold text-white">
        Try again
      </button>
    </section>
  );
}
