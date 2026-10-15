import assert from "node:assert/strict";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";
import sharp from "sharp";

const exports = {};
const require = createRequire(import.meta.url);
vm.runInNewContext(ts.transpileModule(readFileSync("lib/security-challenge-image.ts", "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText, { exports, require, Buffer, process });

test("raster has six separated high-contrast readable glyphs at double mobile resolution", async () => {
  for (const answer of ["ABC234", "G8SZ5B", "MWNQ79"]) {
    const png = await exports.createSecurityChallengeImage(answer);
    const { data, info } = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    assert.equal(info.width, 720);
    assert.equal(info.height, 192);
    assert.equal(png.includes(Buffer.from(answer)), false, "no answer text embedded in the image");
    for (let cell = 0; cell < 6; cell++) {
      let dark = 0, minY = 192, maxY = 0;
      for (let x = 36 + cell * 108; x < 36 + (cell + 1) * 108; x++) {
        for (let y = 0; y < 192; y++) {
          const offset = (y * 720 + x) * info.channels;
          if (data[offset] < 80 && data[offset + 1] < 80 && data[offset + 2] < 80) {
            dark++; minY = Math.min(minY, y); maxY = Math.max(maxY, y);
          }
        }
      }
      assert.ok(dark > 500, `visible dark character in cell ${cell}`);
      assert.ok(maxY - minY >= 60, "large glyph height");
      assert.ok(minY >= 15 && maxY <= 177, "glyph is not clipped");
    }
    if (process.env.SIGNUP_QA_DIR) {
      mkdirSync(process.env.SIGNUP_QA_DIR, { recursive: true });
      writeFileSync(path.join(process.env.SIGNUP_QA_DIR, `captcha-${answer}.png`), png);
    }
  }
});

test("renderer accepts only six server-generated unambiguous characters", async () => {
  for (const answer of ["", "ABC", "ABCDEF7", "<svg/>", "OI01AB"]) {
    await assert.rejects(exports.createSecurityChallengeImage(answer), /Invalid security challenge/);
  }
  assert.equal(exports.SECURITY_CHALLENGE_ALPHABET.length, 32);
});
