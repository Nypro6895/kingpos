export const PORTABLE_POS_CAPABILITIES = {
  bookCancel: "portable.book.cancel",
  bookCreate: "portable.book.create",
  bookView: "portable.book.view",
  posUse: "portable.pos.use",
  reportView: "portable.report.view",
  todayView: "portable.today.view",
} as const;

export type PortablePosCapability =
  (typeof PORTABLE_POS_CAPABILITIES)[keyof typeof PORTABLE_POS_CAPABILITIES];

export const DEFAULT_PORTABLE_POS_CAPABILITIES: PortablePosCapability[] = [
  PORTABLE_POS_CAPABILITIES.posUse,
  PORTABLE_POS_CAPABILITIES.todayView,
  PORTABLE_POS_CAPABILITIES.bookView,
  PORTABLE_POS_CAPABILITIES.bookCreate,
  PORTABLE_POS_CAPABILITIES.bookCancel,
  PORTABLE_POS_CAPABILITIES.reportView,
];

export const PORTABLE_POS_CAPABILITY_OPTIONS: {
  defaultEnabled: boolean;
  description: string;
  label: string;
  value: PortablePosCapability;
}[] = [
  {
    defaultEnabled: true,
    description: "Open the portable POS desk and submit receipts.",
    label: "POS",
    value: PORTABLE_POS_CAPABILITIES.posUse,
  },
  {
    defaultEnabled: true,
    description: "View the Portable Ticket list for the current salon day.",
    label: "Ticket",
    value: PORTABLE_POS_CAPABILITIES.todayView,
  },
  {
    defaultEnabled: true,
    description: "View salon appointments in Portable Book.",
    label: "Book view",
    value: PORTABLE_POS_CAPABILITIES.bookView,
  },
  {
    defaultEnabled: true,
    description: "Create appointments when Portable booking actions are enabled.",
    label: "Book create",
    value: PORTABLE_POS_CAPABILITIES.bookCreate,
  },
  {
    defaultEnabled: true,
    description: "Cancel appointments by status transition, not deletion.",
    label: "Book cancel",
    value: PORTABLE_POS_CAPABILITIES.bookCancel,
  },
  {
    defaultEnabled: true,
    description: "View the restricted operational sales report.",
    label: "Report",
    value: PORTABLE_POS_CAPABILITIES.reportView,
  },
];
