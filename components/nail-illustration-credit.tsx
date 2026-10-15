import { WorkspaceElement } from "@/components/workspace-language";
import { DEFAULT_NAIL_IMAGE_CREDIT, isDefaultNailImage } from "@/lib/default-nail-images";

export function LumiAiWatermark({ className = "" }: { className?: string }) {
  const description = "lumiAi — AI-generated reference image created by ReyLUMI. Not actual salon work.";
  return <WorkspaceElement as="span" role="img" aria-label={description} title={description} translate="no" className={`select-none whitespace-nowrap rounded bg-black/45 px-1.5 py-0.5 text-[10px] font-medium leading-none text-white ${className}`}>{DEFAULT_NAIL_IMAGE_CREDIT}</WorkspaceElement>;
}

export function NailIllustrationCredit({ imageUrl, className = "" }: { imageUrl?: string | null; className?: string }) {
  if (!isDefaultNailImage(imageUrl)) return null;
  return <LumiAiWatermark className={className} />;
}
