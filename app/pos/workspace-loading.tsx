export function PosWorkspaceLoading({ compact = false }: { compact?: boolean }) {
  return (
    <main
      aria-label="Loading workspace"
      className="min-h-[60vh] bg-[#fbfaf8] px-4 py-5 sm:px-6"
    >
      <div className="mx-auto grid max-w-7xl animate-pulse gap-4">
        <div className="h-12 rounded-md bg-zinc-200" />
        <div className="flex items-center justify-between gap-4">
          <div className="h-6 w-48 rounded bg-zinc-200" />
          <div className="h-10 w-36 rounded bg-zinc-200" />
        </div>
        <div
          className={[
            "grid gap-3",
            compact ? "grid-cols-1" : "md:grid-cols-[minmax(0,1fr)_20rem]",
          ].join(" ")}
        >
          <div className="h-80 rounded-md border border-zinc-200 bg-white" />
          {compact ? null : (
            <div className="h-80 rounded-md border border-zinc-200 bg-white" />
          )}
        </div>
      </div>
    </main>
  );
}
