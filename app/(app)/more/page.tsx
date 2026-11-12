import styles from "./more-layout.module.css";
import { withExperiencePage } from "@/components/experience-page";
import { WorkspaceText } from "@/components/workspace-language";

import { WorkspaceNavigationIcon } from "@/components/workspace-navigation-icon";
import { getCurrentBusinessContext } from "@/lib/current-context";
import {
  roleNavigationKindForContext,
  type RoleMoreItem,
  type RoleNavigationKind,
} from "@/app/role-navigation";
import Link from "next/link";
import { roleMoreGroups } from "@/app/role-more-groups";
import { redirect } from "next/navigation";


type MoreItem = RoleMoreItem;
type MoreSection = {
  id: string;
  items: MoreItem[];
  summary: string;
  title: string;
};

type MoreContent = {
  sections: MoreSection[];
};



function formatItemCount(count: number) {
  return `${count} ${count === 1 ? "item" : "items"}`;
}

function roleMoreItems(roleKind: RoleNavigationKind): MoreContent {
  return { sections: roleMoreGroups(roleKind) };
}

function MoreItemLink({ item }: { item: MoreItem }) {
  const isSavedPostItem = item.href === "/more/saved-post";

  return (
    <Link
      className={`${styles.item} group grid min-h-[64px] grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 border-b border-border-subtle bg-surface px-4 text-left transition hover:border-brand-orange/40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange`}
      data-saved-post-target={isSavedPostItem ? "true" : undefined}
      href={item.href}
    >
      <span className="grid h-9 w-9 place-items-center rounded-lg bg-brand-orange-soft text-brand-orange transition group-hover:bg-brand-orange group-hover:text-white">
        <WorkspaceNavigationIcon name={item.navigationIcon} className="h-5 w-5" />
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-text-primary">
          <WorkspaceText text={item.label} />
        </span>
        <span className="mt-0.5 block text-xs font-normal leading-4 text-text-secondary">
          {item.description}
        </span>
      </span>
      <span
        aria-hidden="true"
        className="text-xl text-text-secondary transition group-hover:translate-x-0.5 group-hover:text-brand-orange"
      >
        {">"}
      </span>
    </Link>
  );
}

async function MorePage() {
  const context = await getCurrentBusinessContext();

  if (!context.user) {
    redirect("/login?next=/more");
  }

  const roleKind = roleNavigationKindForContext({
    salonMode: context.salonMode,
    workspaceType: context.workspaceType,
  });
  const more = roleMoreItems(roleKind);

  return (
    <main className={`${styles.page} min-h-screen px-4 py-5 sm:px-6 lg:px-8`}>
      <div className="mx-auto grid w-full max-w-5xl gap-5">
        <h1 className="text-xl font-semibold text-text-primary"><WorkspaceText text="More" /></h1>
        <div className="grid gap-5">
          {more.sections.map((section) => (
            <section
              aria-labelledby={`more-${section.id}-title`}
              className="grid gap-2"
              key={section.id}
            >
              <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <h2
                    className="text-xs font-semibold uppercase tracking-wide text-text-secondary"
                    id={`more-${section.id}-title`}
                  >
                    <WorkspaceText text={section.title} />
                  </h2>
                  <p className="sr-only">
                    {section.summary}
                  </p>
                </div>
                <p className="sr-only">
                  <WorkspaceText text={formatItemCount(section.items.length)} />
                </p>
              </div>
              <div className={styles.group}>
                {section.items.map((item) => (
                  <MoreItemLink item={item} key={item.href} />
                ))}
              </div>
            </section>
          ))}
        </div>
        <Link
          className="inline-flex min-h-11 w-fit items-center justify-center rounded-md border border-border-subtle bg-surface px-4 text-sm font-extrabold text-text-primary transition hover:border-brand-orange/40 hover:bg-brand-orange-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
          href="/settings"
        >
          <WorkspaceText text="All Settings" />
        </Link>
      </div>
    </main>
  );
}

export default withExperiencePage(MorePage);
