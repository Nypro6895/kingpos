import { getMyReviewsData } from "@/lib/customer-reviews";
import { MyReviewsList } from "./my-reviews-list";

export async function MyReviews(input: { page: number; experienceId?: string }) {
  return <MyReviewsList {...await getMyReviewsData(input)} />;
}
