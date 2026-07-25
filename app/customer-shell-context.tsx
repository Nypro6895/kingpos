"use client";

import {
  createContext,
  useContext,
  type ReactNode,
} from "react";
import type { NotificationFeedItem } from "@/types/notifications";

export type CustomerNotificationSummary = {
  items: Array<{
    count: number;
    id: string;
    label: string;
  }>;
  bookingNotifications: number;
  managerApplications: number;
  previewItems: NotificationFeedItem[];
  reviewHref: string;
  staffApplications: number;
  staffInvites: number;
  total: number;
};

type CustomerShellContextValue = {
  isCustomerShell: boolean;
  notificationSummary: CustomerNotificationSummary;
};

const CustomerShellContext = createContext<CustomerShellContextValue | null>(null);

export function CustomerShellContextProvider({
  children,
  isCustomerShell,
  notificationSummary,
}: {
  children: ReactNode;
  isCustomerShell: boolean;
  notificationSummary: CustomerNotificationSummary;
}) {
  return (
    <CustomerShellContext.Provider
      value={{
        isCustomerShell,
        notificationSummary,
      }}
    >
      {children}
    </CustomerShellContext.Provider>
  );
}

export function useCustomerShellContext() {
  return useContext(CustomerShellContext);
}
