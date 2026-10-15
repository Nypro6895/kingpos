import { WorkspaceText } from "@/components/workspace-language";

export default function SupportConversationLoading() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-6 sm:px-8" aria-busy="true">
      <p role="status" className="text-sm text-zinc-500">
        <WorkspaceText text="Loading conversation…" />
      </p>
      <div aria-hidden="true" className="mt-5 space-y-4 animate-pulse">
        <div className="h-7 w-48 rounded bg-zinc-100" />
        <div className="h-24 rounded-xl bg-zinc-100" />
        <div className="h-24 rounded-xl bg-zinc-100" />
      </div>
    </main>
  );
}
