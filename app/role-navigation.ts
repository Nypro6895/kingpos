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
  | "qr"
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
  | "qr"
  | "badge"
  | "book"
  | "cash"
  | "flag"
  | "gift"
  | "gear"
  | "grid"
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

export const SHARED_CONTEXT_ROUTE_PREFIXES = [
  "/account",
  "/explore",
  "/help",
  "/more",
  "/market",
  "/my-place",
  "/notifications",
  "/settings",
  "/support",
] as const;

export function roleNavigationKindForContext(input: {
  salonMode: "manage" | "staff" | null;
  workspaceType: "account" | "personal" | "salon";
}): RoleNavigationKind {
  if (input.workspaceType === "salon" && input.salonMode === "staff") {
    return "staff";
  }

  if (input.workspaceType === "salon" && input.salonMode === "manage") {
    return "owner";
  }

  return "personal";
}

const PERSONAL_LINKS: NavigationLink[] = [
  { href: "/explore", icon: "compass", id: "explore", label: "Explore" },
  { href: "/my-bookings", icon: "calendar", id: "bookings", label: "Bookings" },
  { href: "/beauty", icon: "user", id: "beauty", label: "Beauty" },
  { href: "/beauty/library", icon: "grid", id: "beauty-library", label: "Library" },
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
    href: "/staff/scan",
    icon: "qr",
    id: "staff-scan",
    label: "Scan",
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
    { description: "Keep, use and share your gift cards.", href: "/gift-cards", icon: "star", id: "personal-gift-cards", label: "Gift Cards", navigationIcon: "star" },
    { description: "Points, rewards and activity at each salon.", href: "/rewards", icon: "star", id: "personal-rewards", label: "My Rewards", navigationIcon: "star" },
    {
      description: "Your Personal ID QR, salon check-in, and recent visits.",
      href: "/qr",
      icon: "qr",
      id: "personal-qr",
      label: "My QR",
      navigationIcon: "qr",
    },
    {
      description: "Switch between Personal, owner salons, staff workplaces, and accounts.",
      href: "/my-place",
      icon: "grid",
      id: "personal-my-place",
      label: "My Place",
      navigationIcon: "grid",
    },
    {
      description: "Past appointments, visits and receipts.",
      href: "/my-bookings?tab=history",
      icon: "receipt",
      id: "personal-activity",
      label: "Salon history",
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
      description: "Shops and Beauty profiles followed by this account.",
      href: "/more/following",
      icon: "users",
      id: "personal-following",
      label: "Following",
      navigationIcon: "people",
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
      description: "Report a problem, contact us and continue your support conversations.",
      href: "/support",
      icon: "flag",
      id: "personal-reports",
      label: "Report / Contact",
      navigationIcon: "list",
    },
  ],
  staff: [
    {
      description: "Switch workplaces, owner salons, accounts, and Personal mode.",
      href: "/my-place",
      icon: "grid",
      id: "staff-my-place",
      label: "My Place",
      navigationIcon: "grid",
    },
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
      description: "Shops and Beauty profiles followed by this account.",
      href: "/more/following",
      icon: "users",
      id: "staff-following",
      label: "Following",
      navigationIcon: "people",
    },
  ],
  owner: [
    { description: "Manage gift card sales, balances and activity.", href: "/gift-cards/manage", icon: "star", id: "owner-gift-cards", label: "Gift Cards", navigationIcon: "star" },
    { description: "Set earning rules and customer rewards.", href: "/reward-system", icon: "star", id: "owner-rewards", label: "Reward System", navigationIcon: "star" },
    { description: "Run ads for your salon.", href: "/campaigns", icon: "flag", id: "owner-campaigns", label: "Advertising", navigationIcon: "star" },
    {
      description: "Add messaging, payroll, rewards, and more to Reylumi.",
      href: "/market",
      icon: "store",
      id: "owner-market",
      label: "Market",
      navigationIcon: "store",
    },
    {
      description: "Switch salons, staff workplaces, accounts, and Personal mode.",
      href: "/my-place",
      icon: "grid",
      id: "owner-my-place",
      label: "My Place",
      navigationIcon: "grid",
    },
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
      description: "Salon customer profiles, duplicate cleanup, and visit history.",
      href: "/customers",
      icon: "users",
      id: "owner-customers",
      label: "Customers",
      navigationIcon: "people",
    },
    {
      description: "Profile, discovery, ownership, and setup for the current salon.",
      href: "/salon-settings",
      icon: "gear",
      id: "owner-setting",
      label: "Salon Settings",
      navigationIcon: "gear",
    },
  ],
};

for (const kind of ["personal", "owner", "staff"] as const) {
  ROLE_MORE_ITEMS[kind].push({id:`${kind}-help`,href:"/help",icon:"gear",navigationIcon:"list",label:"Help",description:"Read guides for customers, salon owners and staff."});
}

for (const kind of ["owner", "staff"] as const) {
  ROLE_MORE_ITEMS[kind].push({id:`${kind}-support`,href:"/support",icon:"gear",navigationIcon:"message",label:"Report / Contact",description:"Report an issue and view your requests."});
}

export const OWNER_MORE_GROUPS = [
  { id: "daily", title: "Daily operations", summary: "Sales, tickets, and customer visits.", ids: ["owner-pos", "owner-ticket", "owner-customers"] },
  { id: "business", title: "Business management", summary: "Performance, payroll, team, and services.", ids: ["owner-report", "owner-payroll", "owner-staff", "owner-services"] },
  { id: "growth", title: "Grow your salon", summary: "Reach more customers and add useful features.", ids: ["owner-campaigns", "owner-rewards", "owner-gift-cards", "owner-market"] },
  { id: "settings-support", title: "Settings & support", summary: "Salon setup, workspaces, and help.", ids: ["owner-setting", "owner-my-place", "owner-support", "owner-help"] },
];
const ownerPriority = OWNER_MORE_GROUPS.flatMap(group => group.ids);
ROLE_MORE_ITEMS.owner.sort((a,b) => {
  const ai=ownerPriority.indexOf(a.id),bi=ownerPriority.indexOf(b.id);
  return (ai<0?ownerPriority.length:ai)-(bi<0?ownerPriority.length:bi);
});

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
      "/qr",
      "/activity",
      "/beauty",
      "/claim",
      "/businesses",
      "/my-bookings",
      "/permissions",
      "/roles",
      "/salons",
      "/staff/connections",
    ],
  },
  staff: {
    ariaLabel: "Staff",
    desktopAriaLabel: "Staff desktop",
    homeHref: "/explore",
    kind: "staff",
    links: STAFF_LINKS,
    moreLinks: moreNavigationLinks("staff"),
    routePrefixes: [
      "/staff/appointments",
      "/staff/my-work",
      "/staff/workday",
      "/staff/scan",
    ],
  },
  owner: {
    ariaLabel: "Owner",
    desktopAriaLabel: "Owner desktop",
    homeHref: "/explore",
    kind: "owner",
    links: OWNER_LINKS,
    moreLinks: moreNavigationLinks("owner"),
    routePrefixes: [
      "/campaigns",
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
