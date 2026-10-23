import { PageLoadingSkeleton } from "@/components/loading-feedback";
import { LumiLoadingMark } from "@/components/lumi-loading-mark";

export default function AppPageLoading() {
  return <><div role="status" aria-label="Opening Reylumi" className="flex justify-center pt-6"><LumiLoadingMark /></div><PageLoadingSkeleton /></>;
}
