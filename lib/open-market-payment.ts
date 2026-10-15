'use client';

import {isReylumiIOSClient} from './ios-client';

/** Only Stripe's hosted pages may leave the native app through the payment bridge. */
export function openMarketPayment(value: string) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.port ||
      !['checkout.stripe.com', 'billing.stripe.com', 'connect.stripe.com'].includes(url.hostname)) {
    throw new Error('The secure payment link is invalid. Please try again.');
  }
  if (isReylumiIOSClient(navigator.userAgent)) {
    const native = window as unknown as {__reylumiNativePayments?: number; webkit?: {messageHandlers?: {reylumi?: {postMessage(message: unknown): void}}}};
    const bridge = native.webkit?.messageHandlers?.reylumi;
    if (!bridge || native.__reylumiNativePayments !== 1) {
      window.alert('Please update Reylumi to open subscription management and Stripe setup in Safari.');
      return false;
    }
    // Connect OAuth binds state to a browser cookie. Start it from the website
    // in the external browser, so a WKWebView cookie is never assumed shared.
    if (url.hostname === 'connect.stripe.com') bridge.postMessage({action: 'open-market-website'});
    else bridge.postMessage({action: 'open-payment', url: url.href});
  } else {
    window.location.assign(url.href);
  }
  return true;
}
