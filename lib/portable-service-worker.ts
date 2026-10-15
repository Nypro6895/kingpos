/** Resolve the POS worker from its own registration, independent of a root worker. */
export async function registerPortableServiceWorker(): Promise<ServiceWorker | null> {
  const registration = await navigator.serviceWorker.register("/portable-sw.js", { scope: "/pos/" });
  if (registration.active) return registration.active;
  const pending = registration.installing ?? registration.waiting;
  if (!pending) return null;

  return new Promise((resolve) => {
    const changed = () => {
      if (registration.active?.state === "activated") {
        pending.removeEventListener("statechange", changed);
        resolve(registration.active);
      } else if (pending.state === "redundant") {
        pending.removeEventListener("statechange", changed);
        resolve(null);
      }
    };
    pending.addEventListener("statechange", changed);
    changed();
  });
}
