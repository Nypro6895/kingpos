import { randomInt } from "node:crypto";
import path from "node:path";
import sharp from "sharp";

export const SECURITY_CHALLENGE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const SECURITY_CHALLENGE_WIDTH = 360;
export const SECURITY_CHALLENGE_HEIGHT = 96;

/** Keep the answer server-side: only the finished raster leaves this module. */
export async function createSecurityChallengeImage(answer: string) {
  if (answer.length !== 6 || [...answer].some((letter) => !SECURITY_CHALLENGE_ALPHABET.includes(letter))) {
    throw new Error("Invalid security challenge.");
  }

  const width = SECURITY_CHALLENGE_WIDTH * 2;
  const height = SECURITY_CHALLENGE_HEIGHT * 2;
  // Background variation stays behind the characters, never obscuring a stroke.
  const background = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="#f8fafc"/>${Array.from({ length: 4 }, () => `<path d="M0 ${randomInt(height)} Q360 ${randomInt(height)} ${width} ${randomInt(height)}" stroke="#d6e0e8" stroke-width="2" fill="none"/>`).join("")}</svg>`);
  // A bundled font avoids unreadable missing-font glyphs on serverless Linux.
  const fontfile = path.join(process.cwd(), "app/fonts/GeistMono.ttf");
  const glyphs = await Promise.all([...answer].map(async (letter, index) => {
    const glyph = await sharp({ text: {
      text: `<span foreground="#172533">${letter}</span>`,
      font: "Geist Mono Bold 56", fontfile, dpi: 144, rgba: true,
    } }).png().toBuffer();
    const { data, info } = await sharp(glyph)
      .rotate(randomInt(-6, 7), { background: "#00000000" })
      .png().toBuffer({ resolveWithObject: true });
    return {
      input: data,
      left: 36 + index * 108 + Math.floor((108 - info.width) / 2),
      top: Math.floor((height - info.height) / 2) + randomInt(-4, 5),
    };
  }));
  return sharp(background).composite(glyphs).png().toBuffer();
}
