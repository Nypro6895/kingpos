"use client";

import { useEffect, useState } from "react";

type TocSection = {
  id: string;
  title: string;
};

function sectionNumber(index: number) {
  return String(index + 1).padStart(2, "0");
}

export function LegalTableOfContentsClient({
  sections,
  title,
}: {
  sections: readonly TocSection[];
  title: string;
}) {
  const [activeId, setActiveId] = useState(sections[0]?.id ?? "");

  function markSectionActive(id: string) {
    setActiveId(id);
    window.setTimeout(() => setActiveId(id), 250);
  }

  useEffect(() => {
    function updateActiveSection() {
      const candidates = sections
        .map((section) => {
          const element = document.getElementById(section.id);
          const rect = element?.getBoundingClientRect();

          if (!rect) {
            return null;
          }

          return {
            id: section.id,
            top: rect.top,
          };
        })
        .filter((candidate): candidate is { id: string; top: number } =>
          Boolean(candidate),
        );

      const active =
        candidates
          .filter((candidate) => candidate.top <= 180)
          .sort((a, b) => b.top - a.top)[0] ??
        candidates.sort((a, b) => Math.abs(a.top) - Math.abs(b.top))[0];

      if (active) {
        setActiveId(active.id);
      }
    }

    updateActiveSection();
    window.addEventListener("hashchange", updateActiveSection);
    window.addEventListener("scroll", updateActiveSection, { passive: true });
    window.addEventListener("resize", updateActiveSection);

    return () => {
      window.removeEventListener("hashchange", updateActiveSection);
      window.removeEventListener("scroll", updateActiveSection);
      window.removeEventListener("resize", updateActiveSection);
    };
  }, [sections]);

  return (
    <nav aria-label={`${title} sections`} className="grid gap-0.5">
      {sections.map((section, index) => {
        const isActive = activeId === section.id;

        return (
          <a
            aria-current={isActive ? "location" : undefined}
            className={`grid min-h-9 grid-cols-[2rem_minmax(0,1fr)] items-center gap-2 rounded-md px-2 text-sm font-medium transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange ${
              isActive
                ? "bg-brand-orange-soft text-brand-orange"
                : "text-text-secondary hover:bg-brand-orange-soft hover:text-brand-orange"
            }`}
            href={`#${section.id}`}
            key={section.id}
            onClick={() => markSectionActive(section.id)}
          >
            <span
              className={`text-xs font-bold ${
                isActive ? "text-brand-orange" : "text-text-muted"
              }`}
            >
              {sectionNumber(index)}
            </span>
            <span className="min-w-0 leading-5">{section.title}</span>
          </a>
        );
      })}
    </nav>
  );
}
