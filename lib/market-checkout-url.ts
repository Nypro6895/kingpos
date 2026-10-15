// A checkout link is a short-lived payment capability, never an app login token.
export function isMarketCheckoutURL(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'checkout.stripe.com'
      && !url.username && !url.password && !url.port && url.pathname.startsWith('/c/pay/');
  } catch { return false; }
}
