import type { PosLiveDraftView } from "@/types/pos-desk";

export type PortableWorkstationRole = "staff" | "customer";
export type PortableWorkstationEventKind = "preview" | "intent" | "ack" | "presence" | "revoked";
export type PortableWorkstationEnvelope = {
  version: 1;
  workstationId: string;
  generation: number;
  sequence: number;
  kind: PortableWorkstationEventKind;
  messageId: string;
  issuedAt: number;
  expiresAt: number;
  payload: Record<string, unknown>;
  signature: string;
};
export type PortableWorkstationSummary = {
  id: string;
  label: string;
  generation: number;
  customerPaired: boolean;
  staffOnline: boolean;
  canHandover: boolean;
};
export type PortableWorkstationDescriptor = PortableWorkstationSummary & {
  role: PortableWorkstationRole;
  sequence?: number;
  topic: string;
  verificationKey: string;
  latestEnvelope?: PortableWorkstationEnvelope | null;
};
export type PortableWorkstationSession = {
  role: PortableWorkstationRole | null;
  current: PortableWorkstationDescriptor | null;
  workstations?: PortableWorkstationSummary[];
  settings?: unknown;
  serviceCatalog?: unknown;
  snapshot?: Omit<PosLiveDraftView, "token"> | null;
  attention?: string;
};
export type PortableWorkstationHeartbeat = {
  dirty: boolean;
  pending: boolean;
  cartId: string | null;
  revision: string | null;
};
