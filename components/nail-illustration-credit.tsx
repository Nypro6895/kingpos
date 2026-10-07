import { DEFAULT_NAIL_IMAGE_CREDIT, isDefaultNailImage } from "@/lib/default-nail-images";

export function NailIllustrationCredit({ imageUrl, className = "" }: { imageUrl?: string | null; className?: string }) {
  if (!isDefaultNailImage(imageUrl)) return null;
  return <span title="Generic AI-generated nail-service image. This is not work or a photo from this business." className={`rounded-full bg-black/55 px-2 py-1 text-[10px] font-medium text-white ${className}`}>{DEFAULT_NAIL_IMAGE_CREDIT}</span>;
}
