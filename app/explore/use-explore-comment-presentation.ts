"use client";
import { useState } from "react";
import { selectExploreCommentPresentation, type ExploreCommentCandidate, type ExploreCommentPlan } from "@/lib/explore-comment-presentation";

export function useExploreCommentPresentation(candidates: (ExploreCommentCandidate | null)[], seed: ExploreCommentPlan = {}) {
  // Counts and reaction events do not move open inputs. Append-only pagination
  // retains the choices already shown; a different queue starts a new selection.
  const signature = JSON.stringify(candidates.map(item => item && [item.key, item.previewAllowed, item.composerAllowed]));
  const [snapshot, setSnapshot] = useState(() => ({ signature, plan: selectExploreCommentPresentation(candidates, seed) }));
  if (snapshot.signature !== signature) {
    const previousKeys = JSON.parse(snapshot.signature) as ([string, boolean, boolean] | null)[];
    const append = previousKeys.every((item, index) => JSON.stringify(item) === JSON.stringify(candidates[index] && [candidates[index]!.key, candidates[index]!.previewAllowed, candidates[index]!.composerAllowed]));
    const next = { signature, plan: selectExploreCommentPresentation(candidates, append ? snapshot.plan : seed) };
    setSnapshot(next);
    return next.plan;
  }
  return snapshot.plan;
}
