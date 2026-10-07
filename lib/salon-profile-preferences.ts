export type SalonProfilePreferences = {
  layout: "booking" | "portfolio" | "balanced";
  show_customer_reviews: boolean;
  customer_review_count: 2 | 3;
  show_featured: boolean;
  show_services: boolean;
  show_team: boolean;
  allow_staff_posts: boolean;
  allow_sharing: boolean;
  allow_saves: boolean;
  allow_comments: boolean;
};
export const DEFAULT_PROFILE_PREFERENCES: SalonProfilePreferences = {
  layout: "balanced",
  show_customer_reviews: true, customer_review_count: 3,
  show_featured: true, show_services: true, show_team: true, allow_staff_posts: true,
  allow_sharing: true, allow_saves: true, allow_comments: true,
};
