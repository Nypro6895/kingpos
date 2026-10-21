import { WorkspaceElement, WorkspaceText } from "@/components/workspace-language";
export default function StaffTodayLoading() {
  return <WorkspaceElement as="main" aria-busy="true" aria-label="Loading Staff Today" className="w-full min-w-0 px-4 py-4 sm:px-6 sm:py-5">
    <p className="text-sm text-zinc-500" role="status"><WorkspaceText text="Loading your work…" /></p>
    <div aria-hidden="true" className="mt-4 space-y-4 motion-safe:animate-pulse"><div className="h-8 w-56 rounded bg-zinc-100" /><div className="h-10 rounded bg-zinc-100" /><div className="h-32 rounded-xl bg-orange-50" /><div className="h-24 rounded-xl bg-zinc-100" /></div>
  </WorkspaceElement>;
}
