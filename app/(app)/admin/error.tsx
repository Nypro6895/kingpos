"use client";

export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="rounded-lg border border-red-200 bg-white p-6 shadow-sm">
      <p className="text-sm font-bold uppercase tracking-[0.14em] text-red-700">
        Admin request failed
      </p>
      <h2 className="mt-2 text-2xl font-black text-zinc-950">
        The admin page could not load.
      </h2>
      <p className="mt-2 text-sm text-zinc-600">
        {error.message || "Please retry the request."}
      </p>
      <button
        className="mt-4 rounded-md bg-zinc-950 px-4 py-2 text-sm font-bold text-white"
        onClick={() => reset()}
        type="button"
      >
        Retry
      </button>
    </div>
  );
}
