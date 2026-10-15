import { WorkspaceText } from "@/components/workspace-language";
export default function PortableLoading() {
  return <p className="p-6 text-sm text-zinc-600" role="status"><WorkspaceText text="Loading workspace…" /></p>;
}
