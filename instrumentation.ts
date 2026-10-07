export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
  if (process.env.NODE_ENV !== "production") return;
  const { dispatchBookingMessages } = await import("@/lib/booking-notifications");
  // Portable runs a persistent Node server. Serverless deployments can call the
  // authenticated worker endpoint on their scheduler instead.
  let running = false;
  const timer = setInterval(async () => {
    if (running) return;
    running = true;
    try { await dispatchBookingMessages(); }
    catch { console.error("Booking notification worker failed; queued messages remain available for review."); }
    finally { running = false; }
  }, 60000);
  timer.unref();
  }
}
