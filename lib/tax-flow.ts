const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function taxOwnerReturnPath(value: unknown, salonId: string) {
    if (!UUID.test(salonId) || typeof value !== "string")
        return undefined;
    try {
        const url = new URL(value, "https://reylumi.com");
        if (!value.startsWith("/") || url.origin !== "https://reylumi.com" ||
            !["/payroll/tax-company/settings", "/payroll/tax-company/workspace"].includes(url.pathname))
            return undefined;
        // A fixed allowlist keeps billing returns internal and scoped to their salon.
        return `${url.pathname}?${new URLSearchParams({ salon: salonId })}`;
    }
    catch {
        return undefined;
    }
}
export function taxPaymentReturnPath(value: unknown, salonId: string) {
    const path = taxOwnerReturnPath(value, salonId);
    return path ? `${path}&activation=payment` : undefined;
}
export function taxInvitePath(token: unknown) {
    return typeof token === "string" && /^[0-9a-f]{64}$/.test(token)
        ? `/tax/invite/${token}` : undefined;
}
