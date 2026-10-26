import { initBotId } from "botid/client/core";

// Server actions post to their current page, including dynamic public profiles.
// Only social publishing and signup handlers perform server-side BotID checks.
initBotId({ protect: [{ path: "/*", method: "POST" }] });
