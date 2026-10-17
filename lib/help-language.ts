import copy from "@/app/help/help-copy.json";
export type HelpLanguage = "en" | "vi";
const dictionary: Readonly<Record<string, string>> = copy;
export function resolveHelpLanguage(value: string | string[] | null | undefined): HelpLanguage {
  return value === "vi" ? "vi" : "en";
}
export function translateHelp(text: string, language: HelpLanguage = "en") {
  return language === "en" ? text : dictionary[text] ?? text;
}
export function helpHref(href: string, language: HelpLanguage) {
  if (!/^\/help(?:[/?#]|$)/.test(href)) return href;
  const url = new URL(href, "https://help.invalid");
  url.searchParams.set("lang", language);
  return url.pathname + url.search + url.hash;
}
