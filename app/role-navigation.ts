export type NavigationIcon =
  | "bell"
  | "book"
  | "briefcase"
  | "calendar"
  | "cash"
  | "check"
  | "chevron-down"
  | "compass"
  | "gear"
  | "grid"
  | "home"
  | "list"
  | "log-out"
  | "message"
  | "more"
  | "people"
  | "plus"
  | "receipt"
  | "scissors"
  | "search"
  | "star"
  | "store"
  | "user"
  | "x";

export type NavigationLink = {
  href: string;
  icon: NavigationIcon;
  id: string;
  label: string;
};

export type NavigationSection = {
  id: string;
  label: string;
  links: readonly NavigationLink[];
};

export type RoleNavigationKind = "owner" | "personal" | "staff";

export type RoleMoreIcon =
  | "badge"
  | "book"
  | "cash"
  | "flag"
  | "gift"
  | "gear"
  | "heart"
  | "list"
  | "receipt"
  | "scissors"
  | "star"
  | "store"
  | "users";

export type RoleMoreItem = {
  description: string;
  href: string;
  icon: RoleMoreIcon;
  id: string;
  label: string;
  navigationIcon: NavigationIcon;
};

export type RoleNavigationConfig = {
  ariaLabel: string;
  desktopAriaLabel: string;
  homeHref: string;
  kind: RoleNavigationKind;
  links: readonly NavigationLink[];
  moreLinks: readonly NavigationLink[];
  routePrefixes: readonly string[];
};

const PERSONAL_LINKS: NavigationLink[] = [
  { href: "/explore", icon: "compass", id: "explore", label: "Explore" },
  { href: "/my-bookings", icon: "calendar", id: "bookings", label: "Bookings" },
  { href: "/beauty", icon: "user", id: "beauty", label: "Beauty" },
  {
    href: "/notifications",
    icon: "bell",
    id: "notifications",
    label: "Notifications",
  },
  { href: "/more", icon: "more", id: "more", label: "More" },
];

const STAFF_LINKS: NavigationLink[] = [
  { href: "/staff/my-work", icon: "home", id: "staff-today", label: "Today" },
  {
    href: "/staff/appointments",
    icon: "calendar",
    id: "staff-schedule",
    label: "Schedule",
  },
  { href: "/salon-profile", icon: "store", id: "staff-post", label: "Post" },
  {
    href: "/notifications",
    icon: "bell",
    id: "staff-notifications",
    label: "Notifications",
  },
  { href: "/more", icon: "more", id: "staff-more", label: "More" },
];

const OWNER_LINKS: NavigationLink[] = [
  { href: "/staff/today", icon: "home", id: "owner-today", label: "Today" },
  { href: "/bookings", icon: "book", id: "owner-book", label: "Book" },
  { href: "/salon-profile", icon: "store", id: "owner-profile", label: "Profile" },
  {
    href: "/notifications",
    icon: "bell",
    id: "owner-notifications",
    label: "Notifications",
  },
  { href: "/more", icon: "more", id: "owner-more", label: "More" },
];

export const ROLE_MORE_ITEMS: Record<RoleNavigationKind, RoleMoreItem[]> = {
  personal: [
    {
      description: "Appointments, receipts, and salon visits tied to your profile.",
      href: "/activity",
      icon: "receipt",
      id: "personal-activity",
      label: "Activity",
      navigationIcon: "receipt",
    },
    {
      description: "Posts saved from Explore and salon profiles.",
      href: "/more/saved-post",
      icon: "heart",
      id: "personal-saved-post",
      label: "Saved Post",
      navigationIcon: "star",
    },
    {
      description: "Customer profiles followed by this account.",
      href: "/more/favorite-customer",
      icon: "users",
      id: "personal-favorite-customer",
      label: "Favorite Customer",
      navigationIcon: "people",
    },
    {
      description: "Shops and salons followed by this account.",
      href: "/more/favorite-shop",
      icon: "store",
      id: "personal-favorite-shop",
      label: "Favorite Shop",
      navigationIcon: "store",
    },
    {
      description: "Customer memberships connected to your account.",
      href: "/more/memberships",
      icon: "badge",
      id: "personal-memberships",
      label: "Memberships",
      navigationIcon: "star",
    },
    {
      description: "Reviews you have posted as a customer.",
      href: "/more/reviews",
      icon: "star",
      id: "personal-reviews",
      label: "Reviews",
      navigationIcon: "star",
    },
    {
      description: "Gift cards available to your customer account.",
      href: "/more/gift-cards",
      icon: "gift",
      id: "personal-gift-cards",
      label: "Gift Cards",
      navigationIcon: "receipt",
    },
    {
      description: "Support updates and customer report history.",
      href: "/more/reports",
      icon: "flag",
      id: "personal-reports",
      label: "Reports",
      navigationIcon: "list",
    },
  ],
  staff: [
    {
      description: "Staff payroll, period totals, and paystub access.",
      href: "/staff/my-work?tab=payroll",
      icon: "cash",
      id: "staff-payroll",
      label: "Payroll",
      navigationIcon: "cash",
    },
    {
      description: "Personal performance and work statistics.",
      href: "/staff/my-work?tab=analysis",
      icon: "list",
      id: "staff-statistics",
      label: "Statistics",
      navigationIcon: "list",
    },
    {
      description: "Posts saved by this account.",
      href: "/more/saved-post",
      icon: "heart",
      id: "staff-saved-post",
      label: "Saved Post",
      navigationIcon: "star",
    },
    {
      description: "Customer profiles followed by this account.",
      href: "/more/favorite-customer",
      icon: "users",
      id: "staff-favorite-customer",
      label: "Favorite Customer",
      navigationIcon: "people",
    },
    {
      description: "Shops and salons followed by this account.",
      href: "/more/favorite-shop",
      icon: "store",
      id: "staff-favorite-shop",
      label: "Favorite Shop",
      navigationIcon: "store",
    },
  ],
  owner: [
    {
      description: "Open the POS workspace for the current salon.",
      href: "/pos",
      icon: "store",
      id: "owner-pos",
      label: "POS",
      navigationIcon: "store",
    },
    {
      description: "Reports and closing summaries for the current salon.",
      href: "/reports",
      icon: "list",
      id: "owner-report",
      label: "Report",
      navigationIcon: "list",
    },
    {
      description: "Payroll controls for the current salon.",
      href: "/payroll",
      icon: "cash",
      id: "owner-payroll",
      label: "Payroll",
      navigationIcon: "cash",
    },
    {
      description: "Team records and staff management.",
      href: "/staff",
      icon: "users",
      id: "owner-staff",
      label: "Staff",
      navigationIcon: "people",
    },
    {
      description: "Service catalog for online booking and POS.",
      href: "/services",
      icon: "scissors",
      id: "owner-services",
      label: "Services",
      navigationIcon: "scissors",
    },
    {
      description: "POS ticket history and corrections.",
      href: "/pos-tickets",
      icon: "receipt",
      id: "owner-ticket",
      label: "Ticket",
      navigationIcon: "receipt",
    },
    {
      description: "Salon settings and POS access management.",
      href: "/salon-settings",
      icon: "gear",
      id: "owner-setting",
      label: "Setting",
      navigationIcon: "gear",
    },
  ],
};

function moreNavigationLinks(kind: RoleNavigationKind): NavigationLink[] {
  return ROLE_MORE_ITEMS[kind].map((item) => ({
    href: item.href,
    icon: item.navigationIcon,
    id: item.id,
    label: item.label,
  }));
}

export const ROLE_NAVIGATION: Record<RoleNavigationKind, RoleNavigationConfig> = {
  personal: {
    ariaLabel: "Customer",
    desktopAriaLabel: "Customer desktop",
    homeHref: "/explore",
    kind: "personal",
    links: PERSONAL_LINKS,
    moreLinks: moreNavigationLinks("personal"),
    routePrefixes: [
      "/account",
      "/activity",
      "/beauty",
      "/businesses",
      "/explore",
      "/more",
      "/my-bookings",
      "/my-place",
      "/notifications",
      "/permissions",
      "/roles",
      "/salons",
      "/settings",
      "/staff/connections",
    ],
  },
  staff: {
    ariaLabel: "Staff",
    desktopAriaLabel: "Staff desktop",
    homeHref: "/staff/my-work",
    kind: "staff",
    links: STAFF_LINKS,
    moreLinks: moreNavigationLinks("staff"),
    routePrefixes: [
      "/staff/appointments",
      "/staff/my-work",
      "/staff/workday",
    ],
  },
  owner: {
    ariaLabel: "Owner",
    desktopAriaLabel: "Owner desktop",
    homeHref: "/staff/today",
    kind: "owner",
    links: OWNER_LINKS,
    moreLinks: moreNavigationLinks("owner"),
    routePrefixes: [
      "/bookings",
      "/customers",
      "/payroll",
      "/pos",
      "/pos-tickets",
      "/reports",
      "/salon-settings",
      "/services",
      "/staff",
      "/tickets",
    ],
  },
};
