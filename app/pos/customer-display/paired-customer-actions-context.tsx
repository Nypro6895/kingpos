"use client";

import { createContext, useContext, type ReactNode } from "react";

export type PairedCustomerActions = {
  command<T>(command: string, input: Record<string, unknown>): Promise<T>;
};
const PairedCustomerActionsContext = createContext<PairedCustomerActions | null>(null);
export function PairedCustomerActionsProvider({ value, children }: { value: PairedCustomerActions; children: ReactNode }) {
  return <PairedCustomerActionsContext.Provider value={value}>{children}</PairedCustomerActionsContext.Provider>;
}
export function usePairedCustomerActions() { return useContext(PairedCustomerActionsContext); }
