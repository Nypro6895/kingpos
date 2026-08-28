"use client";

export default function ReportsError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="mx-auto grid min-h-[60vh] w-full max-w-3xl place-items-center px-4 py-12">
      <section className="w-full rounded-lg border border-red-200 bg-red-50 p-5">
        <p className="text-xs font-semibold uppercase tracking-normal text-red-700">
          Report Error
        </p>
        <h1 className="mt-2 text-xl font-semibold text-red-950">
          Unable to load reports.
        </h1>
        <p className="mt-2 text-sm text-red-800">
          {error.message || "The report query failed. Try again."}
        </p>
        <button
          className="mt-4 min-h-10 rounded-md bg-red-900 px-4 text-sm font-semibold text-white"
          onClick={reset}
          type="button"
        >
          Try Again
        </button>
      </section>
    </main>
  );
}
