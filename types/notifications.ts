export type NotificationFeedAction =
  | {
      href: string;
      label: string;
      notificationId: string;
      type: "open-app";
      workspaceId: string | null;
    }
  | {
      requestId: string;
      type: "staff-invite";
    }
  | {
      requestId: string;
      type: "staff-application";
    }
  | {
      href: string;
      label: string;
      type: "manager-review";
    }
  | {
      href: string;
      label: string;
      type: "link";
    };

export type NotificationFeedItem = {
  action: NotificationFeedAction;
  body: string | null;
  createdAt: string;
  id: string;
  kindLabel: string;
  meta: string;
  source: "app" | "manager" | "staff";
  status: string | null;
  title: string;
  unread: boolean;
};

export type NotificationFeedGroupKey = "earlier" | "new" | "today";

export type NotificationFeedGroup = {
  id: NotificationFeedGroupKey;
  items: NotificationFeedItem[];
  title: string;
};
