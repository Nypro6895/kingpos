export const NOTIFICATION_CATEGORIES = [
  {
    id: "booking",
    label: "Booking updates",
    description: "New, confirmed, changed or cancelled appointments.",
    enabled: true,
  },
  {
    id: "reminders",
    label: "Appointment reminders",
    description: "A reminder before your confirmed appointment.",
    enabled: true,
  },
  {
    id: "receipts",
    label: "Receipts",
    description:
      "Your receipt after checkout, with services and payment details.",
    enabled: true,
  },
  {
    id: "check_in",
    label: "Salon check-in",
    description:
      "Arrival updates. On by default for assigned staff; off for customers and managers.",
    enabled: false,
  },
  {
    id: "comments",
    label: "Comments and replies",
    description: "Replies and comments on your content.",
    enabled: true,
  },
  {
    id: "team",
    label: "Team and approvals",
    description: "Staff connections, ownership invitations and content review.",
    enabled: true,
  },
  {
    id: "likes",
    label: "Likes and public shares",
    description: "Optional social activity. Off by default.",
    enabled: false,
  },
  {
    id: "following",
    label: "Posts from people you follow",
    description: "A daily digest of new public posts. Off by default.",
    enabled: false,
  },
  {
    id: "marketing",
    label: "Offers and promotions",
    description: "Optional offers. Off by default.",
    enabled: false,
  },
] as const;
export type NotificationCategory =
  (typeof NOTIFICATION_CATEGORIES)[number]["id"];
export type NotificationPreferences = Partial<
  Record<NotificationCategory, boolean>
>;
export function notificationCategory(
  type: string,
): NotificationCategory | "security" {
  if (type === "login_alert" || type.startsWith("security_")) return "security";
  if (type === "booking_reminder") return "reminders";
  if (type === "payment_receipt") return "receipts";
  if (type === "salon_check_in") return "check_in";
  if (type.includes("booking")) return "booking";
  if (type.includes("comment") || type.includes("reply")) return "comments";
  if (type.includes("like") || type.includes("share")) return "likes";
  if (type.includes("follow")) return "following";
  if (type.includes("promotion") || type.includes("advert")) return "marketing";
  return "team";
}
