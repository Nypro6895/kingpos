import { redirect } from "next/navigation";
import { withExperiencePage } from "@/components/experience-page";
import { getCurrentKingUser } from "@/lib/users/current-user";
import { forumRpc } from "@/lib/forum/server";
import type { ForumContext, ForumTopic } from "@/types/forum";
import Forum from "./forum";

async function ForumPage() {
  if (!await getCurrentKingUser()) redirect("/login?next=%2Fforum");
  let context: ForumContext | undefined;
  let topics: ForumTopic[] = [];
  let message = "";
  try {
    [context, topics] = await Promise.all([
      forumRpc<ForumContext>("forum_read", { mode: "context" }),
      forumRpc<ForumTopic[]>("forum_read", { mode: "feed" }),
    ]);
  } catch (error) {
    message = error instanceof Error ? error.message : "Unable to load forum.";
  }
  if (!context) return <section className="mx-auto max-w-xl px-5 py-12"><h1 className="text-2xl font-semibold">Owner forum</h1><p className="mt-4" role="alert">{message}</p><a className="mt-5 inline-block text-blue-600 underline" href="/forum">Try again</a></section>;
  return <Forum initialContext={context} initialTopics={topics} />;
}
export default withExperiencePage(ForumPage);
