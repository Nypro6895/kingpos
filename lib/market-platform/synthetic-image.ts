// Fixed in-memory test asset. Never accepts an external image or caller pixels.
import sharp from "sharp";
export const syntheticImageId = "00000000-0000-4000-8000-000000000003";
export async function syntheticImage() {
  return sharp({create:{width:160,height:96,channels:3,background:{r:20,g:89,b:70}}}).webp().toBuffer();
}
