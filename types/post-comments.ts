export const POST_COMMENT_TARGET_TYPES = [
  "beauty_post",
  "salon_profile_look",
  "salon_profile_update",
] as const;

export type PostCommentTargetType = (typeof POST_COMMENT_TARGET_TYPES)[number];

export type PostCommentTarget = {
  profileId?: string | null;
  salonId?: string | null;
  sourceId: string;
  sourceType: PostCommentTargetType;
  title?: string | null;
};

export type PostCommentViewer = {
  canModerate: boolean;
  canReplyAsSalon: boolean;
  isAuthenticated: boolean;
  userId: string | null;
};

export type PostComment = {
  authorDisplayName: string;
  authorUserId: string | null;
  beautyPostId: string | null;
  body: string;
  createdAt: string;
  editedAt: string | null;
  id: string;
  isSalonReply: boolean;
  lookId: string | null;
  parentCommentId: string | null;
  salonId: string | null;
  targetId: string;
  targetType: PostCommentTargetType;
  updatedAt: string;
  updateId: string | null;
};

export type PostCommentPage = {
  error: string | null;
  hasMore: boolean;
  items: PostComment[];
  nextOffset: number | null;
  rootCount: number;
  totalCount: number;
};
