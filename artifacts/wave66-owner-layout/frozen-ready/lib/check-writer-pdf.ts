import { readFile } from "node:fs/promises";
import path from "node:path";
import { PDFDocument, rgb, degrees, type PDFFont } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { amountWords } from "@/lib/check-writer-rules";
import { decryptBank } from "@/lib/check-writer-crypto";
import type { BankDetails, CheckRecord } from "@/types/check-writer";
const asset = (name: string) =>
  readFile(path.join(process.cwd(), "assets", "check-writer", name));
export async function checkPdf(
  records: CheckRecord[],
  salon: string,
  preview: boolean,
  offsets = { x: 0, y: 0 },
) {
  if (records.length < 1 || records.length > 100)
    throw Error("Invalid PDF page count.");
  if (
    ![offsets.x, offsets.y].every(
      (v) => Number.isFinite(v) && Math.abs(v) <= 12.7,
    )
  )
    throw Error("Invalid print alignment.");
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const font = await pdf.embedFont(await asset("NotoSans-Regular.ttf"), {
    subset: true,
  });
  const micr = await pdf.embedFont(await asset("micr-e13b.ttf"), {
    subset: true,
  });
  const face = fontkit.create(await asset("micr-e13b.ttf"));
  const black = rgb(0, 0, 0);
  const glyphs = new Set(font.getCharacterSet());
  for (const record of records) {
    if (record.status === "void" && !preview)
      throw Error("Void checks cannot be printed.");
    const s = record.snapshot,
      page = pdf.addPage([612, 792]);
    const dx = (offsets.x * 72) / 25.4,
      dy = (offsets.y * 72) / 25.4;
    function text(
      value: string,
      x: number,
      top: number,
      width: number,
      size = 10,
      minimum = 8,
      selected: PDFFont = font,
    ) {
      if ([...value].some((char) => !glyphs.has(char.codePointAt(0)!)))
        throw Error(
          "Check text contains unsupported characters. Use a supported legal payee name.",
        );
      let n = size;
      while (n > minimum && selected.widthOfTextAtSize(value, n) > width)
        n -= 0.25;
      if (selected.widthOfTextAtSize(value, n) > width)
        throw Error(
          "Check text does not fit. Shorten the payee, issuer, address or memo.",
        );
      if (
        !preview &&
        (x + dx < 0 ||
          x + dx + selected.widthOfTextAtSize(value, n) > 612 ||
          top + dy < 0 ||
          top + dy + n > (top < 252 ? 252 : 792))
      )
        throw Error(
          "Print alignment places check text outside the paper or check area.",
        );
      page.drawText(value, {
        x: x + dx,
        y: 792 - top - dy - n,
        size: n,
        font: selected,
        color: black,
      });
    }
    const line = (x: number, top: number, width: number) =>
      page.drawLine({
        start: { x: x + dx, y: 792 - top - dy },
        end: { x: x + width + dx, y: 792 - top - dy },
        thickness: 0.5,
        color: black,
      });
    const number = String(record.number).padStart(6, "0");
    const actualBank: BankDetails | undefined = s.bankEncrypted
      ? decryptBank<BankDetails>(salon, s.bankEncrypted)
      : undefined;
    const bank: BankDetails = preview
      ? {
          name: actualBank?.name ?? "SAMPLE BANK",
          city: actualBank?.city ?? "Sample city",
          routing: "000000000",
          account: "0000000000",
          fractional: actualBank?.fractional ?? "",
        }
      : actualBank!;
    if (s.stock === "blank" || preview) {
      text(s.issuer, 26, 20, 285, 13, 9);
      const address = s.address.split("\n");
      if (address.length > 4) throw Error("Use at most four address lines.");
      address.forEach((v, i) => text(v, 26, 42 + i * 12, 285, 9, 8));
      text(bank.name, 330, 23, 190, 10, 8);
      text(bank.city, 330, 40, 190, 8, 7);
      text(bank.fractional, 330, 54, 190, 8, 7);
      text(number, 530, 22, 60, 10);
      text("PAY TO THE ORDER OF", 26, 98, 80, 7, 6);
      text("DATE", 455, 75, 35, 7, 6);
      line(88, 129, 355);
      line(26, 162, 560);
      text("DOLLARS", 538, 166, 50, 7);
      text("MEMO", 26, 192, 30, 7);
      line(57, 215, 300);
      line(435, 215, 150);
      text("Authorized signature", 450, 218, 135, 7, 6);
    }
    text(s.date, 490, 88, 95, 10);
    text(s.payee, 90, 111, 350, 12, 8);
    text("$" + (s.amountCents / 100).toFixed(2), 455, 112, 130, 12, 9);
    text(amountWords(s.amountCents), 26, 143, 560, 10, 7);
    text(s.memo, 58, 198, 345, 9, 7);
    if (s.stock === "blank") {
      function cells(value: string, rightmost: number) {
        [...value].forEach((char, i) => {
          const box = rightmost + value.length - 1 - i,
            edge = 612 - 0.3125 * 72 - (box - 1) * 0.125 * 72;
          const glyph = face.glyphForCodePoint(char.codePointAt(0)!);
          if (!glyph || glyph.id === 0) throw Error("MICR font is incomplete.");
          const right = (glyph.bbox.maxX / face.unitsPerEm) * 12;
          page.drawText(char, {
            x: edge - right + dx,
            y: 792 - 252 + 0.1875 * 72 - dy,
            size: 12,
            font: micr,
            color: black,
          });
        });
      }
      cells("C" + number + "C", 45);
      cells("A" + bank.routing + "A", 33);
      cells(bank.account + "C", 14);
    }
    for (const [top, title, fields] of [
      [270, "PAYEE COPY", s.stubs.payee],
      [522, "SALON COPY", s.stubs.salon],
    ] as const) {
      text(title, 26, top, 270, 10);
      text("$" + (s.amountCents / 100).toFixed(2), 450, top + 24, 135, 11);
      text("Memo: " + s.memo, 26, top + 49, 560, 10, 7);
      let row = top + 78;
      if (s.payroll)
        for (const field of fields) {
          const labels = {
            check: "Check payout",
            cash: "Cash payout",
            tip: "Tip (included details)",
            bonus: "Bonus (included details)",
            gross: "Service sales (gross)",
          };
          text(labels[field], 26, row, 330, 10);
          text("$" + (s.payroll[field] / 100).toFixed(2), 450, row, 135, 10);
          row += 20;
        }
    }
    if (preview) {
      for (const top of [120, 370, 650])
        page.drawText(
          record.status === "void"
            ? "VOID — DO NOT CASH"
            : "PREVIEW — NOT NEGOTIABLE",
          {
            x: 70,
            y: 792 - top,
            size: 25,
            font,
            color: rgb(0.6, 0.6, 0.6),
            opacity: 0.35,
            rotate: degrees(16),
          },
        );
      for (const top of [252, 504])
        page.drawLine({
          start: { x: 0, y: 792 - top },
          end: { x: 612, y: 792 - top },
          thickness: 0.5,
          dashArray: [4, 4],
          color: rgb(0.7, 0.7, 0.7),
        });
    }
  }
  pdf.setTitle(preview ? "Check Writer preview" : "Check Writer");
  pdf.setProducer("Reylumi Check Writer");
  return pdf.save();
}
