export type MyReview = { id: string; salon_id: string; salon_name: string; ticket_id: string | null; feedback_state: "good" | "issue" | null;
  source?: "experience" | "legacy_review"; body: string | null; issue_status: string; edited_at: string | null;
  created_at: string; reply_body: string | null; reply_created_at: string | null; verified: boolean; salon_public: boolean };
export type MyReviewsData = { rows: MyReview[]; page: number; focused: boolean; error: string | null };
