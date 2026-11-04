export type ForumSection = { id: string; name: string; description: string; position: number; archived: boolean };
export type ForumContext = {
  user_id: string; display_name: string; can_moderate: boolean; can_manage: boolean;
  restriction: { scope: string; reason: string; expires_at: string | null } | null;
  sections: ForumSection[];
};
export type ForumTopic = {
  id: string; author_id: string | null; author_name: string; author_avatar?: string | null; section_id: string;
  title: string; body?: string; state: string | null; created_at: string; updated_at: string;
  following?: boolean; unread_replies?: number; pinned: boolean; locked: boolean; deleted_at: string | null; reply_count?: number; bookmarked: boolean;
};
export type ForumReply = { id: string; topic_id: string; author_id: string | null; author_name: string; author_avatar?: string | null; body: string; created_at: string; deleted_at: string | null };
export type ForumMessage = { id: string; author_id: string | null; author_name: string; author_avatar?: string | null; body: string; created_at: string };
export type ForumReport = { id: string; target_type: string; target_id: string; reason: string; reporter_name: string; author_id: string | null; topic_id: string | null; preview: string | null; created_at: string };
export type ForumRestriction = { user_id: string; display_name: string; scope: string; reason: string; expires_at: string | null };
export type ForumAudit = { id: string; action: string; target_type: string; target_id: string; reason: string; actor_name: string; created_at: string };
export type ForumInput = Record<string, string | boolean | null>;
export type ForumResult<T> = { data: T; error?: never } | { data?: never; error: string };
