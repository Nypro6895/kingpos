"use client";

import { toggleBeautyProfileFollowAction } from "@/app/explore/actions";
import { useState, useTransition } from "react";

type BeautyFollowButtonProps = {
  followerCount: number;
  initialFollowing: boolean;
  profileId: string;
};

function countLabel(count: number) {
  return `${count} ${count === 1 ? "follower" : "followers"}`;
}

export function BeautyFollowButton({
  followerCount,
  initialFollowing,
  profileId,
}: BeautyFollowButtonProps) {
  const [isFollowing, setFollowing] = useState(initialFollowing);
  const [count, setCount] = useState(Math.max(0, followerCount));
  const [message, setMessage] = useState("");
  const [isPending, startTransition] = useTransition();

  function toggleFollow() {
    if (isPending) {
      return;
    }

    setMessage("");

    startTransition(async () => {
      const result = await toggleBeautyProfileFollowAction(profileId);

      if (result.error) {
        setMessage(result.error);
        return;
      }

      setCount((current) =>
        result.active
          ? current + (isFollowing ? 0 : 1)
          : Math.max(0, current - (isFollowing ? 1 : 0)),
      );
      setFollowing(result.active);
      setMessage(result.active ? "Beauty profile followed." : "Unfollowed.");
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        aria-pressed={isFollowing}
        className={[
          "inline-flex min-h-10 items-center justify-center rounded-full px-4 text-sm font-extrabold shadow-sm transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange disabled:cursor-wait disabled:opacity-70",
          isFollowing
            ? "bg-brand-teal text-white hover:bg-brand-teal/90"
            : "bg-brand-orange text-white hover:bg-brand-orange-hover",
        ].join(" ")}
        disabled={isPending}
        onClick={toggleFollow}
        type="button"
      >
        {isFollowing ? "Following" : "Follow"}
      </button>
      <span className="text-xs font-bold text-text-secondary">
        {countLabel(count)}
      </span>
      <span aria-live="polite" className="sr-only">
        {message}
      </span>
    </div>
  );
}
