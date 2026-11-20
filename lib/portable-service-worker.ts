import { getExperienceOfflineWorker } from "./experience-offline-client";
import { getExperienceDeviceGeneration } from "./experience-persistent-cache";

/** Legacy display preparation also receives the current device generation. */
export async function registerPortableServiceWorker(): Promise<Pick<ServiceWorker, "postMessage"> | null> {
  const worker = await getExperienceOfflineWorker("/pos/portable");
  return worker ? { postMessage(message: unknown, transferOrOptions?: Transferable[] | StructuredSerializeOptions) {
    const value = message && typeof message === "object" ? { ...message, generation: getExperienceDeviceGeneration() } : message;
    if (Array.isArray(transferOrOptions)) worker.postMessage(value, transferOrOptions);
    else worker.postMessage(value, transferOrOptions);
  } } : null;
}
