export type SocialTextReportTarget = {
  kind: "comment" | "review" | "experience" | "review_reply" | "experience_reply" | "own_review_reply" | "own_experience_reply";
  id: string;
  salonId?: string;
};
export type SocialTextReportEvidence =
  | {status:"unavailable"}
  | {status:"available";kind:string;contentId:string;parentId:string|null;salonId:string|null;body:string|null};
