import type { listBeautySalonPublicationRequests } from "./beauty-salon-publications";
export const APP_LOCAL_SECONDARY_ROUTES=["/","/pos/more","/bookings","/reports","/pos-tickets","/businesses/create","/explore/looks/:lookId","/explore/wisconsin","/explore/wisconsin/:businessId","/notifications/visits/:visitId","/salon-profile/client-transformations","/more/memberships","/more/reviews","/more/gift-cards","/more/reports"];
export const APP_LOCAL_SECONDARY_READS={
  "customer.visit":{argumentKeys:["visitId"],retention:"scoped"},
  "owner.transformations":{argumentKeys:[],retention:"scoped"},
  "public.directory":{argumentKeys:["businessId"],retention:"scoped"},
} as const;
export type AppLocalVisit={salonName:string;status:string;checkedInAt:string;timezone:string;bookingId:string|null;isCustomer:boolean;salonPhone:string|null};
export type AppLocalTransformations=Awaited<ReturnType<typeof listBeautySalonPublicationRequests>>;
