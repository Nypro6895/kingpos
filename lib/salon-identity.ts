export type SalonIdentity = {
 identityVerified: boolean;
 popularServiceName: string | null;
 popularServiceMinimumPrice: number | null;
 popularServiceMaximumPrice: number | null;
 completedBookingCount: number;
};
export const EMPTY_SALON_IDENTITY: SalonIdentity = { identityVerified:false,popularServiceName:null,popularServiceMinimumPrice:null,popularServiceMaximumPrice:null,completedBookingCount:0 };
export function salonPopularPrice(identity: Partial<SalonIdentity>) {
 const { popularServiceName:name,popularServiceMinimumPrice:min,popularServiceMaximumPrice:max } = identity;
 if (!name || min == null || max == null) return null;
 const money = (n:number) => new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits: n % 1 ? 2 : 0}).format(n);
 return `${name} ${money(min)}${max > min ? `–${money(max)}` : ''}`;
}
export type SalonVerificationRequest = {
 id:string; salon_id:string; applicant_user_id:string; attempt:number; salon_name:string; address:string; phone:string;
 status:'otp_pending'|'waiting'|'approved'|'rejected'|'blocked'|'expired'; attachments:{path:string;name:string}[];
 created_at:string;submitted_at:string|null;reviewed_at:string|null;review_reason:string|null;
 decisions:{decision:string;reason:string|null;created_at:string}[];
};
