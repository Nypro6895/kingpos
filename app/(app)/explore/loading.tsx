import { FeedLoadingSkeleton, LoadingStatus } from "@/components/loading-feedback";

export default function ExploreLoading() {
  return (
    <section aria-busy="true" aria-label="Loading Explore" className="mx-auto grid w-full max-w-[40rem] gap-4 px-4 py-6">
      <LoadingStatus />
      <FeedLoadingSkeleton />
      <FeedLoadingSkeleton />
    </section>
  );
}
