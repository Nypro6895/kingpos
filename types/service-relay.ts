export const SERVICE_RELAY_PLUGIN = "service-relay";
export type RelayLine = { id: string; offerId: string; staffId: string; staffName: string; serviceId: string; serviceName: string; amount: number };
export type RelayOffer = { id: string; staffId: string; staffName: string; serviceId: string | null; serviceName: string; status: "offered" | "working" | "done"; expiresAt: string };
export type RelayTicket = { visitId: string; queueNumber: number; customerName: string; status: string; revision: number; lines: RelayLine[]; offers: RelayOffer[]; requestedServices: { id: string; name: string }[] };
export type RelayWorkspace = { installed: boolean; staffId?: string; tickets: RelayTicket[]; services: { id: string; name: string; price: number }[] };
