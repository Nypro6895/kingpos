export default function ReportsLoading() {
  return (
    <main className="mx-auto grid w-full max-w-7xl gap-6 px-4 py-6 sm:px-6">
      <div className="grid gap-3">
        <div className="h-4 w-28 rounded bg-zinc-100" />
        <div className="h-9 w-72 max-w-full rounded bg-zinc-100" />
        <div className="h-4 w-full max-w-2xl rounded bg-zinc-100" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => (
          <div
            className="h-36 rounded-lg border border-zinc-200 bg-white p-4 shadow-sm"
            key={index}
          >
            <div className="h-3 w-24 rounded bg-zinc-100" />
            <div className="mt-4 h-8 w-32 rounded bg-zinc-100" />
            <div className="mt-5 h-6 w-40 rounded bg-zinc-100" />
          </div>
        ))}
      </div>
      <div className="h-72 rounded-lg border border-zinc-200 bg-white shadow-sm" />
    </main>
  );
}
