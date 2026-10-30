import type { ComponentProps } from "react";
import type { NotificationCenterClient } from "@/app/notifications/notification-center-client";
import type { getSelfBeautyProfilePage } from "./beauty";
import type { getPostCommentViewer } from "./post-comments";
import type { CustomerBookingSummary } from "./customer-bookings";
export type AppLocalBeautyData = { profile: Extract<Awaited<ReturnType<typeof getSelfBeautyProfilePage>>, {ok:true}>["data"]; commentViewer: Awaited<ReturnType<typeof getPostCommentViewer>>; favorites?: Awaited<ReturnType<typeof import("./account-social").getAccountSavedPosts>> | null; booking: CustomerBookingSummary | null };
export type AppLocalNotificationData = ComponentProps<typeof NotificationCenterClient>;
export const APP_LOCAL_PERSONAL_READS = {
  "customer.reviews": { argumentKeys: ["page","experience"], cacheable: true },
  "page.beauty": { argumentKeys: [], cacheable: true },
  "page.notifications": { argumentKeys: ["filter"], cacheable: true },
  "http.notifications.feed": { argumentKeys: ["filter","limit","before","id"], cacheable: false },
} as const;
export const APP_LOCAL_PERSONAL_COMMANDS = { "http.notifications.viewed": { argumentKeys: ["input"] } } as const;
export const APP_LOCAL_PERSONAL_PATHS = ["/beauty","/beauty/library","/notifications","/more/reviews"];
