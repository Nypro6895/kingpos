import { HELP_GUIDES, type HelpGuide, type HelpRole } from "@/lib/help-guides";
import helpCopy from "@/app/help/help-copy.json";

export function normalizeHelpQuery(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[đĐ]/g, "d").toLowerCase().trim();
}
const dictionary: Readonly<Record<string, string>> = helpCopy;
const searchText = (guide: HelpGuide) => {
  const text = [guide.title, guide.summary, guide.prerequisite, guide.entry.label,
    ...guide.steps.flatMap(step => [step.title, step.body]), ...guide.notes,
    ...guide.sections.flatMap(section => [section.title, ...section.steps, section.check, section.example, ...section.issues]),
    ...guide.evidence.screenshots.flatMap(screen => [screen.caption, screen.alt])];
  return normalizeHelpQuery(text.flatMap(value => [value, dictionary[value] ?? ""]).join(" "));
};
const index = HELP_GUIDES.map(guide => ({ guide, text: searchText(guide) }));
export function searchHelpGuides(query: string, role: HelpRole | "all" = "all") {
  const terms = normalizeHelpQuery(query).split(/\s+/).filter(Boolean);
  return index.filter(({ guide, text }) => (role === "all" || guide.roles.includes(role)) && terms.every(term => text.includes(term))).map(({ guide }) => guide);
}
