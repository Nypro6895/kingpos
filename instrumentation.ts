export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
  if (process.env.NODE_ENV !== "production" || process.env.KINGPOS_DISABLE_BACKGROUND_DISPATCH === "1") return;
  const { closeDuePayrollPeriods } = await import("@/lib/payroll-close-worker");
  const { dispatchBookingMessages } = await import("@/lib/booking-notifications");
  // Portable runs a persistent Node server. Serverless deployments can call the
  // authenticated worker endpoint on their scheduler instead.
  let running = false;
  const timer = setInterval(async () => {
    if (running) return;
    running = true;
    try { await Promise.all([dispatchBookingMessages(), closeDuePayrollPeriods()]); }
    catch { console.error("Background worker failed; queued work remains available for retry."); }
    finally { running = false; }
  }, 60000);
  timer.unref();
  }
}
