"use client";
import { createContext, useContext, type ReactNode } from "react";
import type { ReceiptBrand } from "@/types/receipt-print";

export type ReceiptContext = { scope: string; brand: ReceiptBrand; timezone: string };
const Context = createContext<ReceiptContext | null>(null);
/** Context is supplied only from the already-authorized canonical salon scope. */
export function ReceiptContextProvider({ scope, brand, timezone, children }: ReceiptContext & { children: ReactNode }) {
  return <Context.Provider value={{ scope, brand, timezone }}>{children}</Context.Provider>;
}
export function useReceiptContext() { return useContext(Context); }
