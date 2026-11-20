import type { PostCommentTarget } from "./post-comments";

export type PostChange = {
  target: PostCommentTarget;
  action: "edit" | "archive" | "delete" | "feature" | "block";
  caption?: string | null;
  isPinned?: boolean;
  coverImageUrl?: string | null;
  coverMediaPath?: string | null;
};
