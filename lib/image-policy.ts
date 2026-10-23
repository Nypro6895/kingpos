/** Shared upload defaults. Keep aspect ratio; never enlarge a small original. */
export const IMAGE_POLICY = {
  maxEdge: 1600,
  targetBytes: 300 * 1024,
  maxBytes: 500 * 1024,
  quality: 80,
  minQuality: 62,
  maxInputBytes: 10 * 1024 * 1024,
  maxInputPixels: 40_000_000,
} as const;

export type ImageBounds = { maxWidth?: number; maxHeight?: number; targetBytes?: number };
