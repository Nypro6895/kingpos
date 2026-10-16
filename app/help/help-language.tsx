import { createElement } from "react";
import copy from "@/app/help/help-copy.json";

const dictionary: Readonly<Record<string, string>> = copy;

// Help has its own Vietnamese content policy; it does not change app language.
export function translateHelp(text: string) {
  return dictionary[text] ?? text;
}

export function HelpText({ text }: { text: string }) {
  return translateHelp(text);
}

export function HelpElement({ as, ...props }: { as: "img" | "nav"; [key: string]: unknown }) {
  for (const key of ["alt", "title", "aria-label"]) {
    if (typeof props[key] === "string") props[key] = translateHelp(props[key]);
  }
  return createElement(as, props);
}
