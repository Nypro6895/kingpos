"use client";
import { createContext, useContext } from "react";
import type { LanguageNotice, SalonLanguageState } from "@/lib/salon-language";
export type LanguagePreferences = {
  state: SalonLanguageState; effective: string; busy: boolean; error: string;
  choose: (code: string, activation?: string) => Promise<boolean>;
  seen: (notice: LanguageNotice) => Promise<void>;
};
export const PreferencesContext = createContext<LanguagePreferences | null>(null);
export const useSalonLanguage = () => useContext(PreferencesContext);
