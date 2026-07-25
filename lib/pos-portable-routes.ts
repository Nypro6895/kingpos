export const PORTABLE_POS_ROUTES = {
  book: "/pos/portable/book",
  pos: "/pos/portable",
  report: "/pos/portable/report",
  ticket: "/pos/portable/ticket",
} as const;

export type PortablePosRouteId = keyof typeof PORTABLE_POS_ROUTES;

export type PortablePosRouteLink = {
  href: string;
  icon: "book" | "calendar" | "report" | "store" | "ticket";
  id: PortablePosRouteId;
  label: string;
};

export const PORTABLE_POS_ROUTE_LINKS: PortablePosRouteLink[] = [
  {
    href: PORTABLE_POS_ROUTES.pos,
    icon: "store",
    id: "pos",
    label: "POS",
  },
  {
    href: PORTABLE_POS_ROUTES.ticket,
    icon: "ticket",
    id: "ticket",
    label: "Ticket",
  },
  {
    href: PORTABLE_POS_ROUTES.book,
    icon: "book",
    id: "book",
    label: "Book",
  },
  {
    href: PORTABLE_POS_ROUTES.report,
    icon: "report",
    id: "report",
    label: "Report",
  },
];

export function isPortablePosRoute(pathname: string, href: string) {
  if (href === PORTABLE_POS_ROUTES.pos) {
    return pathname === href;
  }

  return pathname === href || pathname.startsWith(`${href}/`);
}
