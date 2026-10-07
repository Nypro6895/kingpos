export type BusinessClaimMatch = {
 salon_id: string; name: string; phone: string | null; address: string;
 unclaimed: boolean; phone_match: boolean; address_match: boolean; name_match: boolean; score: number;
};
export type BusinessClaimRequest = {
 id: string; salon_id: string; salon_name: string; address: string; applicant_user_id: string;
 applicant_name: string | null; applicant_email: string | null;
 status: 'otp_pending' | 'waiting' | 'approved' | 'rejected' | 'expired';
 channel: 'sms' | 'call' | 'support'; phone: string | null; last_sent_at: string | null;
 phone_verified_at: string | null; support_reason: string | null; review_reason: string | null; created_at: string;
 attachments: {path: string; name: string}[];
 events: {event: string; reason: string | null; created_at: string}[];
};
export type BusinessClaimInput = {name: string; phone: string; address: string; unit: string; city: string; state: string};
