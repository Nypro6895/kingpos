import "server-only";
import { checkWriterContext } from "./check-writer-server";
import { checkWriterSalesReady } from "./check-writer-readiness";
import { checkWriterSubscription } from "./check-writer-subscription";
export async function checkWriterMarketState() {
  try {
    const ctx = await checkWriterContext();
    return {
      ...(await checkWriterSubscription(ctx.service, ctx.salonId, ctx.user.id)),
      operationalReady: checkWriterSalesReady(),
    };
  } catch {
    return { active: false, subscribed: false };
  }
}
