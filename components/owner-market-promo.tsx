import Link from "next/link";

export function OwnerMarketPromo() {
  return (
    <Link
      href="/market"
      className="group flex flex-col gap-4 rounded-xl border border-orange-100 bg-gradient-to-r from-[#fff3e9] to-[#f0f8f3] p-5 transition hover:border-brand-orange/40 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand-orange sm:flex-row sm:items-center sm:justify-between sm:p-6"
      aria-label="Explore Reylumi Market sample apps"
    >
      <div className="flex min-w-0 items-start gap-4 sm:items-center">
        <span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-white text-brand-orange" aria-hidden="true">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 10h18l-2-6H5zM4 10v10h16V10M9 20v-6h6v6M8 4v6M16 4v6" />
          </svg>
        </span>
        <div className="min-w-0">
          <p className="text-[10px] font-extrabold tracking-[0.16em] text-brand-teal">REYLUMI MARKET <span className="ml-2 font-medium tracking-normal text-text-secondary">Sample preview</span></p>
          <h2 className="mt-1 text-base font-extrabold text-text-primary sm:text-lg">More possibilities for your salon</h2>
          <p className="mt-1 text-xs leading-6 text-text-secondary sm:text-sm">Explore apps for SMS, custom payroll, rewards, online stores and more.</p>
        </div>
      </div>
      <span className="inline-flex min-h-11 shrink-0 items-center justify-center gap-3 self-start rounded-lg bg-white px-4 text-xs font-bold text-text-primary transition group-hover:text-brand-orange sm:self-auto">
        Explore Market <span aria-hidden="true">→</span>
      </span>
    </Link>
  );
}
