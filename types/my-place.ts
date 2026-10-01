import type { Location } from "@/types/location";

export type PlaceRequest = {
  id: string;
  kind:
    | "invitation"
    | "application"
    | "review"
    | "sent_invitation"
    | "account_invitation";
  label: string;
  detail: string | null;
  message: string | null;
  status: string;
  createdAt: string;
  expiresAt: string | null;
};

export type PlaceMember = {
  id: string;
  name: string;
  email: string | null;
  roleId: string;
  roleCode: string;
  status: string;
  isSelf: boolean;
};

export type PlaceAccountDetails = {
  members: PlaceMember[];
  roles: { id: string; name: string; code: string; permissions: string[] }[];
  canManage: boolean;
};

export type PlaceSalonDetails = {
  salon: Location;
  canEdit: boolean;
  canEditLogo: boolean;
};

export type PlaceResult<T> =
  { ok: true; data: T } | { ok: false; message: string };
