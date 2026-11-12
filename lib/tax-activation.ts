export const TAX_SIGN_IN_URL = "https://reylumi.com/tax";

export function taxActivationHref(salonId: string, pendingPayment = false) {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      salonId,
    )
  )
    return undefined;
  const query = new URLSearchParams({ salon: salonId, setup: "1" });
  if (pendingPayment) query.set("activation", "payment");
  return `/payroll/tax-company/settings?${query}`;
}
