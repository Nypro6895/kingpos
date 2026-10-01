export function isPosConnectionError(message: string) {
  return /failed to fetch|fetch failed|networkerror|network request failed|load failed|connection (?:refused|reset)|econn|enotfound|etimedout|timed? out|timeout/i.test(message);
}

export function posUserMessage(message: string) {
  if (isPosConnectionError(message)) return "Unable to connect right now. Please try again when you are online.";
  if (/passcode|\bpin\b/i.test(message)) return "Check the staff code and try again.";
  if (/session.*expir|not authorized|permission denied|jwt/i.test(message)) return "Please sign in again to continue.";
  if (/storage|quota|indexeddb/i.test(message)) return "This device could not save your ticket. Keep this window open and try again.";
  if (/constraint|duplicate key|violates|TypeError|ReferenceError|SyntaxError|PGRST|SQLSTATE|rpc|relation |column |schema|uuid/i.test(message))
    return "This change could not be saved. Please check the details and try again.";
  return message;
}
