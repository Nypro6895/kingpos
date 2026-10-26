'use strict';
function receiptHtml(receipt) {
  if (!receipt || !Number.isSafeInteger(receipt.queueNumber) || receipt.queueNumber < 1 || !/^\d{4}-\d{2}-\d{2}$/.test(receipt.businessDate) || !/^[0-9a-f-]{36}$/i.test(receipt.visitId) ||
      !Array.isArray(receipt.cells) || receipt.cells.length < 1 || receipt.cells.length > 1681 || receipt.cells.some(cell => !Array.isArray(cell) || cell.length !== 2 || cell.some(n => !Number.isInteger(n) || n < 0 || n > 40))) throw Error('Invalid check-in receipt');
  const escape = value => String(value ?? '').slice(0, 200).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const cells = receipt.cells.map(([x,y]) => `<rect x="${x}" y="${y}" width="1" height="1"/>`).join('');
  return `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><style>@page{size:80mm 160mm;margin:5mm}body{font:14px Arial;text-align:center;color:black}h1{font-size:48px;margin:12px}svg{width:44mm;height:44mm;padding:3mm;background:white}</style></head><body><p>${escape(receipt.salonName)}</p><p>Check-in · ${receipt.businessDate}</p><h1>#${receipt.queueNumber}</h1><p>${escape(receipt.customerName)}</p><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 41 41">${cells}</svg><p>Scan at the front desk to create your ticket.</p><p>By Reylumi</p></body></html>`;
}
module.exports = { receiptHtml };
