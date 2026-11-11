// Upgrade only legacy built-in marketing copy; owner-authored copy is preserved.
const LEGACY_TITLE = "Stay connected with our beauty community";
const LEGACY_BODY = "Earn points & rewards. Exclusive member offers. Easy booking & reminders. Track your favorite services.";
export function checkinPromotionCopy(title: string, body: string) {
  return {title: !title.trim() || title === LEGACY_TITLE ? "A little time for you." : title,
    body: !body.trim() || body === LEGACY_BODY ? "Beauty. Connected. Rewarded." : body};
}
