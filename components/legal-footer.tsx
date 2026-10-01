import {
  LEGAL_FOOTER_LINKS,
  REYLUMI_APP_NAME,
  REYLUMI_COPYRIGHT_YEAR,
} from "@/lib/reylumi-config";
import Link from "next/link";

export function LegalFooter({ className = "" }: { className?: string }) {
  return (
    <footer
      className={[
        "border-t border-white/80 bg-white/82 px-4 py-4 backdrop-blur sm:px-6",
        className,
      ].join(" ")}
    >
      <div className="mx-auto flex w-full max-w-[92rem] flex-col items-center gap-3 text-center text-xs font-semibold text-text-secondary sm:flex-row sm:justify-between sm:text-left">
        <nav
          aria-label="Legal links"
          className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2 sm:justify-start"
        >
          {LEGAL_FOOTER_LINKS.map((link) => (
            <Link
              className="rounded-full px-1.5 py-1 transition hover:text-brand-orange focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
              href={link.href}
              key={link.href}
              prefetch={false}
            >
              {link.label}
            </Link>
          ))}
        </nav>
        <p className="text-text-secondary">
          &copy; {REYLUMI_COPYRIGHT_YEAR} {REYLUMI_APP_NAME}. All rights reserved.
        </p>
      </div>
    </footer>
  );
}
