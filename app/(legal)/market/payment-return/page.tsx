import { withExperiencePage } from "@/components/experience-page";
import { marketTargetHref } from "@/lib/market-target-url";
import Link from "next/link";
import { Suspense } from "react";
import { TaxPaymentReturnLinks } from "@/app/market/tax-payment-return-links";
import type { Metadata } from "next";
export const metadata: Metadata = {
  title: "Return to Reylumi",
  robots: { index: false, follow: false },
};
async function MarketPaymentReturn({
  searchParams,
}: {
  searchParams: Promise<{ salon?: string; cancelled?: string }>;
}) {
  const query = await searchParams;
  const salonId =
    query.salon &&
    /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(query.salon)
      ? query.salon
      : undefined;
  const marketHref = marketTargetHref(
    `/market?payment=${query.cancelled === "1" ? "cancelled" : "received"}`,
    salonId,
  );
  return (
    <main
      data-reylumi-shell-ready="true"
      className="mx-auto max-w-lg px-6 py-16"
    >
      <h1 className="text-2xl font-semibold">Return to Reylumi</h1>
      <p className="mt-4">
        You can return to Market to check your payment and subscription. Access
        is updated only after payment is confirmed.
      </p>
      <Suspense
        fallback={
          <>
            <a
              href={`reylumi://market${salonId ? `?salon=${encodeURIComponent(salonId)}` : ""}`}
              className="mt-6 inline-flex min-h-11 items-center rounded-xl bg-zinc-950 px-5 text-white"
            >
              Open Reylumi app
            </a>
            <p className="mt-4">
              <Link href={marketHref} className="underline">
                Continue on the website
              </Link>
            </p>
          </>
        }
      >
        <TaxPaymentReturnLinks />
      </Suspense>
      <p className="mt-6 text-sm text-zinc-600">
        If you cancelled checkout, no new access has been activated. If
        confirmation is still pending, check payment status in Market before
        paying again.
      </p>
    </main>
  );
}

export default withExperiencePage(MarketPaymentReturn);
