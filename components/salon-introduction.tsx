import { WorkspaceText } from "@/components/workspace-language";

export function SalonIntroduction({ text, className }: { text: string; className?: string }) {
  if (text.length <= 220) return <p className={className}>{text}</p>;
  return <div>
    <p className={className}>{text.slice(0, 217).trimEnd()}…</p>
    <details>
      <summary className="cursor-pointer text-sm underline"><WorkspaceText text="Read more" /></summary>
      <p className={className}>{text}</p>
    </details>
  </div>;
}
