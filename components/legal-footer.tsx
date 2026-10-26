import { WorkspaceElement, WorkspaceText } from "@/components/workspace-language";
import {
  LEGAL_FOOTER_LINKS,
  REYLUMI_APP_NAME,
  REYLUMI_COPYRIGHT_YEAR,
} from "@/lib/reylumi-config";
import Link from "@/components/feedback-link";

export function LegalFooter({ className = "" }: { className?: string }) {
  return (
    <footer
      className={[
        "border-t border-white/80 bg-white/82 px-4 py-4 backdrop-blur sm:px-6",
        className,
      ].join(" ")}
    >
      <div className="mx-auto flex w-full max-w-[92rem] flex-col items-center gap-3 text-center text-xs font-semibold text-text-secondary sm:flex-row sm:justify-between sm:text-left">
        <WorkspaceElement as="nav"
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
              <WorkspaceText text={link.label} />
            </Link>
          ))}
        </WorkspaceElement>
        <p className="text-text-secondary">
          <WorkspaceText text="&copy;" /> {REYLUMI_COPYRIGHT_YEAR} {REYLUMI_APP_NAME}<WorkspaceText text=". All rights reserved." />
        </p>
      </div>
    </footer>
  );
}
