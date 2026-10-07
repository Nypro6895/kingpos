import Link from "next/link";
import Image from "next/image";

export function OwnerMarketPromo() {
  return (
    <Link
      href="/market"
      className="group flex flex-col gap-4 rounded-xl border border-orange-100 bg-gradient-to-r from-[#fff3e9] to-[#f0f8f3] p-5 transition hover:border-brand-orange/40 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand-orange sm:flex-row sm:items-center sm:justify-between sm:p-6"
      aria-label="Explore features to add to Reylumi"
    >
      <div className="flex min-w-0 items-start gap-4 sm:items-center">
        <Image src="/market/reylumi-features.webp" alt="" width={210} height={140} className="h-auto w-24 shrink-0 sm:w-40" />
        <div className="min-w-0">
          <p className="text-[10px] font-extrabold tracking-[0.16em] text-brand-teal">REYLUMI MARKET</p>
          <h2 className="mt-1 text-base font-extrabold text-text-primary sm:text-lg">Add more features to Reylumi</h2>
          <p className="mt-1 text-xs leading-6 text-text-secondary sm:text-sm">SMS, rewards, payroll and more—in your Reylumi workspace. No separate app download.</p>
        </div>
      </div>
      <span className="inline-flex min-h-11 shrink-0 items-center justify-center gap-3 self-start rounded-lg bg-white px-4 text-xs font-bold text-text-primary transition group-hover:text-brand-orange sm:self-auto">
        Discover features <span aria-hidden="true">→</span>
      </span>
    </Link>
  );
}
