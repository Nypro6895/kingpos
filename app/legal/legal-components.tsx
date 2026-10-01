import {
  LEGAL_DATES,
  additionalPolicyLinks,
  legalPolicyGroups,
  type LegalInline,
  type LegalDocument,
  type LegalPolicyCard as LegalPolicyCardType,
  type LegalSection,
} from "@/lib/legal-policies";
import { REYLUMI_APP_NAME } from "@/lib/reylumi-config";
import { LegalTableOfContentsClient } from "@/app/legal/legal-table-of-contents";
import Link from "next/link";
import { Fragment } from "react";

function ArrowIcon() {
  return (
    <svg
      aria-hidden="true"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
    >
      <path d="M5 12h14" />
      <path d="m13 6 6 6-6 6" />
    </svg>
  );
}

function DocumentIcon() {
  return (
    <svg
      aria-hidden="true"
      className="h-5 w-5"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.8"
      viewBox="0 0 24 24"
    >
      <path d="M14 2H7a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7z" />
      <path d="M14 2v5h5" />
      <path d="M9 13h6" />
      <path d="M9 17h4" />
    </svg>
  );
}

function sectionNumber(index: number) {
  return String(index + 1).padStart(2, "0");
}

function LegalMeta() {
  return (
    <dl className="flex flex-wrap gap-x-5 gap-y-1 text-sm leading-6 text-text-secondary">
      <div className="flex gap-1.5">
        <dt className="font-semibold text-text-primary">Effective date:</dt>
        <dd>{LEGAL_DATES.effective}</dd>
      </div>
      <div className="flex gap-1.5">
        <dt className="font-semibold text-text-primary">Last updated:</dt>
        <dd>{LEGAL_DATES.lastUpdated}</dd>
      </div>
    </dl>
  );
}

function LegalPolicyCard({ policy }: { policy: LegalPolicyCardType }) {
  return (
    <Link
      className="group grid min-h-[10.5rem] content-between rounded-lg border border-border-subtle bg-white p-5 shadow-[var(--shadow-soft)] transition hover:-translate-y-0.5 hover:border-brand-orange/35 hover:shadow-[0_20px_46px_rgba(35,25,22,0.08)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange motion-reduce:transform-none"
      href={policy.href}
    >
      <span className="grid gap-3">
        <span className="grid h-11 w-11 place-items-center rounded-lg bg-brand-orange-soft text-brand-orange transition group-hover:bg-brand-orange group-hover:text-white">
          <DocumentIcon />
        </span>
        <span>
          <span className="block text-lg font-semibold text-text-primary">
            {policy.label}
          </span>
          <span className="mt-2 block text-sm leading-6 text-text-secondary">
            {policy.description}
          </span>
        </span>
      </span>
      <span className="mt-5 inline-flex items-center gap-2 text-sm font-bold text-brand-orange">
        Open policy
        <ArrowIcon />
      </span>
    </Link>
  );
}

function AdditionalPolicyLinks() {
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {additionalPolicyLinks.map((link) => (
        <Link
          className="group flex min-h-14 items-center justify-between gap-3 rounded-lg border border-border-subtle bg-white px-4 py-3 text-sm font-semibold text-text-primary shadow-sm transition hover:border-brand-orange/35 hover:text-brand-orange focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
          href={link.href}
          key={link.href}
        >
          <span>{link.label}</span>
          <span className="text-brand-orange transition group-hover:translate-x-0.5">
            <ArrowIcon />
          </span>
        </Link>
      ))}
    </div>
  );
}

export function LegalHub() {
  return (
    <main className="min-h-screen overflow-x-hidden bg-[linear-gradient(180deg,#fffaf5_0%,#ffffff_32%,#fbf8f5_100%)] text-text-primary">
      <section className="mx-auto grid w-full max-w-6xl gap-8 px-4 py-10 sm:px-6 lg:px-8 lg:py-14">
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,22rem)] lg:items-end">
          <div>
            <p className="text-xs font-extrabold uppercase text-brand-orange">
              {REYLUMI_APP_NAME}
            </p>
            <h1 className="mt-3 max-w-3xl text-4xl font-semibold leading-tight text-text-primary sm:text-5xl">
              Legal & Policies
            </h1>
            <p className="mt-4 max-w-2xl text-base leading-7 text-text-secondary sm:text-lg">
              Rules and policies that help keep ReyLUMI transparent, safe, and
              fair for clients, beauty professionals, and businesses.
            </p>
          </div>
          <LegalMeta />
        </div>

        <div className="grid gap-9">
          {legalPolicyGroups.map((group) => (
            <section aria-labelledby={`${group.id}-policies`} key={group.id}>
              <div className="mb-4 flex items-end justify-between gap-3 border-b border-divider-subtle pb-3">
                <h2
                  className="text-base font-extrabold text-text-primary"
                  id={`${group.id}-policies`}
                >
                  {group.title}
                </h2>
                <p className="text-xs font-bold uppercase text-text-muted">
                  {group.policies.length}{" "}
                  {group.policies.length === 1 ? "policy" : "policies"}
                </p>
              </div>
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {group.policies.map((policy) => (
                  <LegalPolicyCard key={policy.href} policy={policy} />
                ))}
              </div>
            </section>
          ))}

          <section aria-labelledby="additional-policies">
            <div className="mb-4 border-b border-divider-subtle pb-3">
              <h2
                className="text-base font-extrabold text-text-primary"
                id="additional-policies"
              >
                Additional Policies
              </h2>
              <p className="mt-1 max-w-2xl text-sm leading-6 text-text-secondary">
                These topics live as sections inside the four core legal
                documents.
              </p>
            </div>
            <AdditionalPolicyLinks />
          </section>
        </div>
      </section>
    </main>
  );
}

function LegalTableOfContents({
  sections,
  title,
}: {
  sections: readonly LegalSection[];
  title: string;
}) {
  return (
    <LegalTableOfContentsClient
      sections={sections.map((section) => ({
        id: section.id,
        title: section.title,
      }))}
      title={title}
    />
  );
}

function LegalRichText({ content }: { content: readonly LegalInline[] }) {
  return (
    <>
      {content.map((part, index) => {
        if (typeof part === "string") {
          return <Fragment key={index}>{part}</Fragment>;
        }

        if (part.type === "strong") {
          return (
            <strong className="font-semibold text-text-primary" key={index}>
              {part.text}
            </strong>
          );
        }

        return (
          <a
            className="font-semibold text-brand-orange underline decoration-brand-orange/35 underline-offset-4 transition hover:text-brand-orange-dark hover:decoration-brand-orange focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
            href={part.href}
            key={index}
          >
            {part.text}
          </a>
        );
      })}
    </>
  );
}

function LegalBlockView({ block }: { block: LegalSection["blocks"][number] }) {
  if (block.type === "subheading") {
    return (
      <h3 className="pt-2 text-base font-semibold leading-7 text-text-primary">
        {block.text}
      </h3>
    );
  }

  if (block.type === "list") {
    return (
      <ul className="grid gap-2 pl-5 text-base leading-7 text-text-secondary marker:text-brand-orange/70">
        {block.items.map((item, index) => (
          <li className="list-disc" key={index}>
            <LegalRichText content={item} />
          </li>
        ))}
      </ul>
    );
  }

  if (block.type === "note") {
    return (
      <aside className="border-l-2 border-brand-orange/45 pl-4">
        {block.title ? (
          <p className="text-sm font-semibold text-text-primary">
            {block.title}
          </p>
        ) : null}
        <p className="mt-1 text-sm leading-6 text-text-secondary">
          <LegalRichText content={block.content} />
        </p>
      </aside>
    );
  }

  return (
    <p className="text-base leading-7 text-text-secondary">
      <LegalRichText content={block.content} />
    </p>
  );
}

function LegalSectionView({
  section,
  sectionIndex,
}: {
  section: LegalSection;
  sectionIndex: number;
}) {
  return (
    <section
      aria-labelledby={`${section.id}-title`}
      className="scroll-mt-24 border-t border-divider-subtle py-9 first:border-t-0"
      id={section.id}
    >
      <div className="grid gap-2 sm:grid-cols-[2.5rem_minmax(0,1fr)]">
        <p className="pt-1 text-xs font-semibold uppercase text-brand-orange">
          {sectionNumber(sectionIndex)}
        </p>
        <div>
          <h2
            className="text-xl font-semibold leading-8 text-text-primary"
            id={`${section.id}-title`}
          >
            {section.title}
          </h2>
          <div className="mt-4 grid gap-4">
            {section.blocks.map((block, index) => (
              <LegalBlockView block={block} key={`${section.id}-${index}`} />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

export function LegalDocumentPage({ document }: { document: LegalDocument }) {
  return (
    <main className="min-h-screen overflow-x-hidden bg-white text-text-primary">
      <section className="mx-auto grid w-full max-w-7xl gap-10 px-4 py-8 sm:px-6 lg:grid-cols-[16rem_minmax(0,50rem)] lg:items-start lg:px-8 lg:py-12 xl:grid-cols-[17rem_minmax(0,52rem)]">
        <aside className="hidden lg:sticky lg:top-24 lg:block lg:max-h-[calc(100vh-7rem)] lg:overflow-y-auto lg:border-r lg:border-divider-subtle lg:pr-4">
          <div className="grid gap-4">
            <Link
              className="inline-flex min-h-10 items-center gap-2 rounded-md px-2 text-sm font-semibold text-brand-orange transition hover:bg-brand-orange-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
              href="/legal"
            >
              <ArrowIcon />
              All policies
            </Link>
            <div className="border-t border-divider-subtle pt-4">
              <p className="px-2 pb-2 text-[11px] font-bold uppercase text-text-muted">
                On this page
              </p>
              <LegalTableOfContents
                sections={document.sections}
                title={document.title}
              />
            </div>
          </div>
        </aside>

        <article className="min-w-0">
          <div className="border-b border-divider-subtle pb-5 lg:hidden">
            <Link
              className="inline-flex min-h-10 items-center gap-2 text-sm font-bold text-brand-orange focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
              href="/legal"
            >
              <ArrowIcon />
              Legal hub
            </Link>
            <details className="mt-3 rounded-md border border-divider-subtle bg-white px-3 py-2">
              <summary className="cursor-pointer text-sm font-extrabold text-text-primary">
                On this page
              </summary>
              <div className="mt-2 border-t border-divider-subtle pt-2">
                <LegalTableOfContents
                  sections={document.sections}
                  title={document.title}
                />
              </div>
            </details>
          </div>

          <header className="mt-7 border-b border-divider-subtle pb-8 lg:mt-0">
            <p className="text-xs font-extrabold uppercase text-brand-orange">
              {REYLUMI_APP_NAME} legal
            </p>
            <h1 className="mt-3 text-3xl font-semibold leading-tight text-text-primary sm:text-4xl">
              {document.title}
            </h1>
            <p className="mt-4 max-w-3xl text-base leading-7 text-text-secondary">
              {document.intro}
            </p>
            <div className="mt-5">
              <LegalMeta />
            </div>
          </header>

          <div>
            {document.sections.map((section, index) => (
              <LegalSectionView
                key={section.id}
                section={section}
                sectionIndex={index}
              />
            ))}
          </div>
        </article>
      </section>
    </main>
  );
}
