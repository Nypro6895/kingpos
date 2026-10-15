// Development-only: prepare a static dictionary with Chrome's on-device translator.
// The shipped app never calls a translation service or needs a downloaded model.
import fs from 'node:fs';
import { createServer } from 'node:http';
import { chromium } from 'playwright-core';

const input = JSON.parse(fs.readFileSync('artifacts/vietnamese-localization/missing-copy.json', 'utf8'));
const outputFile = 'lib/vietnamese-workspace-copy.json';
const translations = fs.existsSync(outputFile) ? JSON.parse(fs.readFileSync(outputFile, 'utf8')) : {};
const pending = [...new Set([...input.map(item => item.text), ...(process.argv.includes('--review-glossary') ? Object.keys(translations) : [])])].filter(text => process.argv.includes('--review-glossary') || !translations[text]);
const glossary = [
  [/credit cards?/gi, 'thẻ tín dụng'], [/display name/gi, 'tên hiển thị'],
  [/actual check paid/gi, 'số tiền séc thực trả'], [/wage check net/gi, 'lương séc thực nhận'],
  [/wage check/gi, 'lương trả bằng séc'], [/cash reported/gi, 'tiền mặt đã báo cáo'],
  [/net pay/gi, 'lương thực nhận'], [/gross pay/gi, 'lương trước thuế'],
  [/check[ -]?in/gi, 'check-in'], [/no[ -]?show/gi, 'không đến'],
  [/\bpayroll\b/gi, 'bảng lương'], [/\bsalons?\b/gi, 'tiệm'], [/\b(?:co-)?owners?\b/gi, 'chủ tiệm'],
  [/\bstaff\b/gi, 'nhân viên'], [/\bprofessionals?\b/gi, 'nhân viên'],
  [/\bappointments?\b/gi, 'lịch hẹn'], [/\bbookings?\b/gi, 'lịch hẹn'], [/\bbook\b/gi, 'đặt lịch'],
  [/\btickets?\b/gi, 'phiếu'], [/\bparts?\b/gi, 'phần chia'],
  [/\btips?\b/gi, 'tip'], [/\bcredits?\b/gi, 'credit'], [/\bcommission\b/gi, 'hoa hồng'],
  [/\bPOS\b/g, 'POS'], [/\bPortable\b/g, 'Portable'], [/\bReylumi\b/gi, 'Reylumi'],
  [/\blooks?\b(?!\s+(?:at|like|for|forward))/gi, 'mẫu'],
];
function prepare(text) {
  const tokens = [];
  let source = text.replace(/\{\d+\}/g, value => { const index = tokens.push(value) - 1; return `[[R${index}]]`; });
  for (const [pattern, replacement] of (process.argv.includes("--natural") ? [] : glossary)) source = source.replace(pattern, () => { const index = tokens.push(replacement) - 1; return `[[R${index}]]`; });
  // "check" means a bank cheque only in payout contexts; elsewhere it means verify.
  if (!process.argv.includes("--natural") && /(?:cash\s*[/&]\s*check|check (?:amount|number|net|paid|payout)|(?:by|in) check)/i.test(text)) source = source.replace(/\bchecks?\b/gi, () => { const index = tokens.push('séc') - 1; return `[[R${index}]]`; });
  return { text, source, tokens };
}
const server = createServer((_request, response) => { response.setHeader('Content-Type', 'text/html; charset=utf-8'); response.end('<button id="start">Prepare translation dictionary</button>'); });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const profile = process.argv.find(argument => argument.startsWith('--profile='))?.split('=')[1] ?? 'v3';
const context = await chromium.launchPersistentContext(`work/vietnamese-translation-profile-${profile}`, {
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true,
});
try {
  const page = await context.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  console.log('Translator:', await page.evaluate(() => Translator.availability({ sourceLanguage: 'en', targetLanguage: 'vi' })));
  page.on('console', message => { if (/^(Translation ready|Translation failed|Download)/.test(message.text())) console.log(message.text()); });
  await page.evaluate(() => {
    document.getElementById('start').onclick = async () => {
      try {
        let lastProgress = -1;
        window.translator = await Translator.create({ sourceLanguage: 'en', targetLanguage: 'vi', monitor(monitor) {
          monitor.addEventListener('downloadprogress', event => {
            const progress = Math.floor(event.loaded * 10) * 10;
            if (progress > lastProgress) { console.log('Download', progress + '%'); lastProgress = progress; }
          });
        } });
        window.ready = true; console.log('Translation ready');
      } catch (error) { window.failure = String(error); console.log('Translation failed', String(error)); }
    };
  });
  await page.click('#start');
  await page.waitForFunction(() => window.ready || window.failure, {}, { timeout: 600000 });
  const failure = await page.evaluate(() => window.failure);
  if (failure) throw new Error(failure);
  for (let offset = 0; offset < pending.length; offset += 40) {
    const batch = pending.slice(offset, offset + 40).map(prepare);
    const result = await page.evaluate(async entries => {
      const rows = [];
      for (const entry of entries) rows.push([entry.text, await window.translator.translate(entry.source), entry.tokens]);
      return rows;
    }, batch);
    for (const [source, resultText, tokens] of result) {
      let translated = resultText;
      let lost = false;
      for (let index = 0; index < tokens.length; index++) {
        const marker = new RegExp(`\\[+\\s*R${index}\\s*\\]+`, 'gi');
        if (!marker.test(translated)) { lost = true; break; }
        translated = translated.replace(marker, () => tokens[index]);
      }
      if (lost) {
        translated = await page.evaluate(text => window.translator.translate(text), source);
        translated = translated.replace(/thẩm mỹ viện|salon/gi, 'tiệm').replace(/\bđặt phòng\b/gi, 'đặt lịch').replace(/\bvé\b/gi, 'phiếu');
      }
      if(process.argv.includes('--natural')) translated = translated.replace(/thẩm mỹ viện|salon/gi, 'tiệm').replace(/chủ sở hữu/gi, 'chủ tiệm').replace(/đặt phòng/gi, 'đặt lịch').replace(/vé/gi, 'phiếu');
      translations[source] = translated.charAt(0).toUpperCase() + translated.slice(1);
    }
    fs.writeFileSync(outputFile, JSON.stringify(Object.fromEntries(Object.entries(translations).sort(([a], [b]) => a.localeCompare(b))), null, 2) + '\n');
    console.log(`Translated ${Math.min(offset + 40, pending.length)} / ${pending.length}`);
  }
} finally {
  await context.close(); await new Promise(resolve => server.close(resolve));
}
