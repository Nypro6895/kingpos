'use strict';
const { app, BrowserWindow } = require('electron');
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
  try {
    await win.loadURL('https://reylumi.com/pos/portable');
    const state = await win.webContents.executeJavaScript('({url:location.href,title:document.title,text:document.body.innerText.slice(0,300)})');
    console.log(JSON.stringify(state));
    if (!state.url.startsWith('https://reylumi.com/pos/portable') || !state.text) throw Error('Online POS did not load');
    app.exit(0);
  } catch (error) { console.error(error.message); app.exit(1); }
});
setTimeout(() => app.exit(1), 45000).unref();
