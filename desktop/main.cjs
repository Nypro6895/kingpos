'use strict';
const { app, BrowserWindow, Menu, dialog, ipcMain, session, safeStorage, screen } = require('electron');
const { join } = require('node:path');
const { pathToFileURL } = require('node:url');
const { createHash } = require('node:crypto');
const { validConfig, allowedPage } = require('./policy.cjs');
const { Vault } = require('./vault.cjs');
const { OfflineShell } = require('./offline-shell.cjs');
const { UpdatePlan } = require('./update-plan.cjs');
const config = validConfig({ ...require('./config.json'), ...(!app.isPackaged && process.env.KINGPOS_DESKTOP_TEST_ORIGIN ? { origin: process.env.KINGPOS_DESKTOP_TEST_ORIGIN, channel: 'test', updates: false } : {}) });
// Stable across upgrades; never inside the installation directory. Test and
// production have separate profiles and cannot accidentally share credentials.
const profile = config.channel === 'test' ? 'KingPOS Portable Test' : 'KingPOS Portable';
app.setPath('userData', !app.isPackaged && config.channel === 'test' && process.env.KINGPOS_DESKTOP_TEST_PROFILE || join(app.getPath('appData'), profile));
app.setPath('sessionData', app.getPath('userData'));
const originId = createHash('sha256').update(config.origin).digest('hex').slice(0, 20);
let offlineShell, recoveryTimer, openingPos = false;
let win, customerWindow, displayToken, vault, updater, updateReady = false, installing = false;
let updatePlan, updateVersion = '', updatePhase = 'unavailable', updateMessage = '', checkingUpdate = false;
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.show(); win.focus(); } });
  app.whenReady().then(start).catch(error => {
    dialog.showErrorBox('KingPOS could not open', 'Your saved tickets have not been deleted. Please contact support.\n' + error.message);
    app.quit();
  });
}
app.on('window-all-closed', () => app.quit());
app.on('will-quit', () => { clearInterval(recoveryTimer); vault?.close(); offlineShell?.close(); });
function trusted(event) {
  return win && event.sender === win.webContents && event.senderFrame === win.webContents.mainFrame && allowedPage(event.senderFrame.url, config.origin);
}
function displayPage(url) {
  try { const parsed = new URL(url); return parsed.origin === config.origin && parsed.pathname === '/pos/customer-display' && parsed.searchParams.get('token') === displayToken; } catch { return false; }
}
function trustedDisplay(event) {
  return customerWindow && event.sender === customerWindow.webContents && event.senderFrame === customerWindow.webContents.mainFrame && displayPage(event.senderFrame.url);
}
function closeDisplay() { customerWindow?.destroy(); customerWindow = null; }
async function openDisplay() {
  if (!displayToken) throw Error('Open the POS tab first.');
  if (customerWindow && !customerWindow.isDestroyed()) { customerWindow.show(); customerWindow.focus(); return; }
  const current = screen.getDisplayMatching(win.getBounds());
  const other = screen.getAllDisplays().find(item => item.id !== current.id);
  customerWindow = new BrowserWindow({ title: 'Customer Display', width: 1100, height: 800, show: false,
    ...(other ? { x: other.workArea.x + 24, y: other.workArea.y + 24, width: Math.min(1100, other.workArea.width - 48), height: Math.min(800, other.workArea.height - 48), fullscreen: true } : {}),
    autoHideMenuBar: true, backgroundColor: '#102d2a',
    webPreferences: { session: win.webContents.session, preload: join(__dirname, 'display-preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true, devTools: !app.isPackaged } });
  const display = customerWindow;
  display.setMenu(null);
  display.once('ready-to-show', () => display.show());
  display.on('closed', () => { if (customerWindow === display) customerWindow = null; });
  display.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  display.webContents.on('will-navigate', (event, url) => { if (!displayPage(url)) event.preventDefault(); });
  display.webContents.on('will-redirect', (event, url) => { if (!displayPage(url)) event.preventDefault(); });
  display.webContents.on('will-attach-webview', event => event.preventDefault());
  try { await display.loadURL(config.origin + '/pos/customer-display?token=' + encodeURIComponent(displayToken)); }
  catch { closeDisplay(); throw Error('Connect once to prepare the customer screen, then try again.'); }
}
async function start() {
  app.setAppUserModelId(config.channel === 'test' ? 'com.kingpos.portable.test' : 'com.kingpos.portable');
  if (!safeStorage.isEncryptionAvailable()) throw Error('Windows secure storage is unavailable.');
  vault = new Vault(join(app.getPath('userData'), 'data', originId), safeStorage);
  const partition = session.fromPartition(`persist:portable-${originId}`);
  offlineShell = new OfflineShell(join(app.getPath('userData'), 'data', originId), safeStorage, config.origin,
    request => {
      if (!app.isPackaged && process.env.KINGPOS_DESKTOP_TEST_OFFLINE === '1') return Promise.reject(Error('Test network disconnected'));
      const sameOrigin = new URL(request.url).origin === config.origin;
      const headers = new Headers(request.headers);
      if (sameOrigin && !['GET','HEAD'].includes(request.method) && request.initiatorOrigin === config.origin) headers.set('Origin', config.origin);
      return partition.fetch(sameOrigin ? new Request(request, {credentials:'include', headers}) : request, { bypassCustomProtocolHandlers: true });
    });
  // Restore only the app's own session cookies, encrypted under this Windows user.
  // Explicit sign-out removes them through the same cookie change listener.
  const names = ['kingpos-portable-pos-key-id', 'kingpos-portable-pos-session', 'kingpos-workspace-device'];
  for (const name of names) {
    const saved = offlineShell.meta('cookie:' + name);
    const current = (await partition.cookies.get({url:config.origin,name}))[0];
    if (current) offlineShell.setMeta('cookie:' + name, {url:config.origin, name, value:current.value, path:current.path, httpOnly:current.httpOnly, secure:current.secure, sameSite:current.sameSite});
    else if (saved) await partition.cookies.set(saved);
  }
  partition.cookies.on('changed', (_event, cookie, cause, removed) => {
    if (!names.includes(cookie.name) || ![new URL(config.origin).hostname, '.' + new URL(config.origin).hostname].includes(cookie.domain)) return;
    if (removed && cause === 'overwrite') return;
    offlineShell.setMeta('cookie:' + cookie.name, removed ? null : {url:config.origin, name:cookie.name, value:cookie.value, path:cookie.path, httpOnly:cookie.httpOnly, secure:cookie.secure, sameSite:cookie.sameSite});
  });
  // Native storage owns the installed shell; retire the evictable browser worker.
  await partition.clearStorageData({storages:['serviceworkers','cachestorage']});
  partition.protocol.handle(new URL(config.origin).protocol.slice(0,-1), request => offlineShell.handle(request));
  ipcMain.handle('kingpos:offline-prepare', (event, request) => {
    if (!trusted(event)) throw Error('Access denied');
    return offlineShell.prepare(request.scope, Array.isArray(request.assets) ? request.assets.slice(0, 500) : []).then(() => displayToken ? offlineShell.prepare(request.scope, [], '/pos/customer-display?token=' + encodeURIComponent(displayToken)) : undefined);
  });
  ipcMain.on('kingpos:offline-lock', event => {
    if (!trusted(event)) { event.returnValue = false; return; }
    offlineShell.lock(); event.returnValue = true;
  });

  if (!app.isPackaged && process.env.KINGPOS_DESKTOP_TEST_OFFLINE === '1') {
    partition.enableNetworkEmulation({ offline: true });
  }
  const canFullscreen = (wc, permission) => permission === 'fullscreen' &&
    ((wc === win?.webContents && allowedPage(wc.getURL(), config.origin)) || (wc === customerWindow?.webContents && displayPage(wc.getURL())));
  partition.setPermissionRequestHandler((wc, permission, callback) => callback(canFullscreen(wc, permission)));
  partition.setPermissionCheckHandler((wc, permission) => canFullscreen(wc, permission));
  partition.on('will-download', event => event.preventDefault());
  ipcMain.on('kingpos:storage', (event, request) => {
    try {
      if (!trusted(event)) throw Error('Access denied');
      if (!['get', 'set', 'remove'].includes(request?.method)) throw Error('Invalid action');
      event.returnValue = { ok: true, value: vault[request.method](request.key, request.value) };
    } catch { event.returnValue = { ok: false }; }
  });
  ipcMain.handle('kingpos:operations', (event, request) => {
    if (!trusted(event)) throw Error('Access denied');
    if (request?.method === 'list') return vault.list(request.scope);
    if (request?.method === 'checkpoint') return vault.checkpoint(request.scope, request.key);
    if (request?.method === 'save') return vault.save(request.operation);
    throw Error('Invalid action');
  });
  ipcMain.handle('kingpos:display', async (event, request) => {
    if (!trusted(event)) throw Error('Access denied');
    if (request?.method === 'pair') {
      const token = request.token;
      if (token !== null && (typeof token !== 'string' || !/^[A-Za-z0-9_-]{16,200}$/.test(token))) throw Error('Invalid display identity');
      if (displayToken !== token) closeDisplay();
      displayToken = token;
      const scope = offlineShell.meta('scope');
      if (token && scope) void offlineShell.prepare(scope, [], '/pos/customer-display?token=' + encodeURIComponent(token)).catch(() => {});
      return;
    }
    if (request?.method === 'open') return openDisplay();
    if (request?.method === 'close') { closeDisplay(); return; }
    throw Error('Invalid action');
  });
  ipcMain.handle('kingpos:fullscreen', (event, toggle) => {
    if (!trusted(event) && !trustedDisplay(event)) throw Error('Access denied');
    const target = BrowserWindow.fromWebContents(event.sender);
    if (toggle === true) target.setFullScreen(!target.isFullScreen());
    return target.isFullScreen();
  });
  updatePlan = new UpdatePlan(join(app.getPath('userData'), 'update-plan-' + originId + '.json'));
  updatePlan.set('', null); // Retire appointments from older versions.
  ipcMain.handle('kingpos:update', async (event, request) => {
    if (!trusted(event)) throw Error('Access denied');
    if (request?.method === 'state') return updateState();
    if (request?.method === 'later') { updatePlan.set('', null); return updateState(); }
    if (request?.method === 'now') { await installUpdate(true); return updateState(); }
    throw Error('Invalid action');
  });
  ipcMain.handle('kingpos:retry-open', event => {
    if (!win || event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame ||
        new URL(event.senderFrame.url).pathname !== new URL(pathToFileURL(join(__dirname, 'unavailable.html')).href).pathname ||
        !event.senderFrame.url.startsWith('file:')) throw Error('Access denied');
    return loadPos();
  });
  ipcMain.on('kingpos:menu' , event => { if (trusted(event)) Menu.getApplicationMenu()?.popup({ window: win }); });
  win = new BrowserWindow({ width: 1440, height: 960, minWidth: 900, minHeight: 650,
    title: profile, backgroundColor: '#f5f7fa', show: false, autoHideMenuBar: true,
    webPreferences: { session: partition, preload: join(__dirname, 'preload.cjs'), sandbox: true,
      contextIsolation: true, nodeIntegration: false, webSecurity: true, spellcheck: false, devTools: !app.isPackaged } });
  win.once('ready-to-show', () => win.show());
  win.on('closed', closeDisplay);
  win.on('enter-full-screen', () => win.webContents.send('kingpos:fullscreen-state', true));
  win.on('leave-full-screen', () => win.webContents.send('kingpos:fullscreen-state', false));
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event, url) => { if (!allowedPage(url, config.origin)) event.preventDefault(); });
  win.webContents.on('will-redirect', (event, url) => { if (!allowedPage(url, config.origin)) event.preventDefault(); });
  win.webContents.on('will-attach-webview', event => event.preventDefault());
  win.webContents.on('before-input-event', (event, input) => {
    if (input.key === 'F5' || ((input.control || input.meta) && input.key.toLowerCase() === 'r')) event.preventDefault();
  });
  win.webContents.on('render-process-gone', () => { void showUnavailable('KingPOS stopped unexpectedly. Saved tickets remain on this device.'); });
  // Older web clients retain their beforeunload guard. Never override it silently.
  win.webContents.on('will-prevent-unload', event => {
    const response = dialog.showMessageBoxSync(win, { type: 'question', buttons: ['Keep working', 'Close app'], defaultId: 0, cancelId: 0,
      message: 'A ticket is still open.', detail: 'Save it for later before closing if this version has not saved it automatically.' });
    if (response === 1) event.preventDefault();
  });
  setupMenu();
  win.setMenuBarVisibility(false);
  await loadPos();
  setupUpdater();
}
async function loadPos() {
  if (openingPos || !win || win.isDestroyed()) return;
  openingPos = true; clearInterval(recoveryTimer);
  try { await win.loadURL(config.origin + '/pos/portable'); }
  catch (error) {
    if (error.code === 'ERR_ABORTED' || error.errno === -3) return;
    await showUnavailable('Connect to open KingPOS or sign in again. Your saved tickets remain on this device.');
  } finally { openingPos = false; }
}
async function showUnavailable(message) {
  if (!win || win.isDestroyed()) return;
  await win.loadFile(join(__dirname, 'unavailable.html'), { query: { message } });
  win.show();
  clearInterval(recoveryTimer);
  recoveryTimer = setInterval(async () => {
    if (openingPos || !win || win.isDestroyed() || !win.webContents.getURL().startsWith('file:')) return;
    try {
      const response = await win.webContents.session.fetch(config.origin + '/api/pos/connection', {cache:'no-store', signal:AbortSignal.timeout(4000)});
      if (response.ok && (await response.json()).available === true) await loadPos();
    } catch { /* Keep the recovery screen usable while the server is unavailable. */ }
  }, 10000);
  recoveryTimer.unref();
}
function setupMenu() {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'KingPOS', submenu: [
      { label: 'Open POS again', click: async () => {
        const { response } = await dialog.showMessageBox(win, { buttons: ['Cancel', 'Open'], defaultId: 0, cancelId: 0, message: 'Open POS again?', detail: 'Saved tickets will remain on this device.' });
        if (response === 1) await loadPos();
      } },
      { label: 'Offline readiness', click: () => dialog.showMessageBox(win, { message: offlineShell.cached('/pos/portable') ? 'Ready for offline use' : 'Offline setup is not finished', detail: offlineShell.cached('/pos/portable') ? 'You can close and reopen this app without internet. Saved tickets will upload when the POS server is available.' : 'Connect to your POS server, sign in and keep the POS open while its files are saved.' }) },
      { label: 'Check for updates', click: () => checkUpdate(true) },
      { label: 'Install downloaded update', click: () => installUpdate() },
      { label: 'About KingPOS', click: () => dialog.showMessageBox(win, { message: `${profile} ${app.getVersion()}`, detail: config.channel === 'test' ? 'Test version. Connects to the test server; not a production release.' : 'Windows · one checkout. Saved tickets stay on this Windows account.' }) },
      { type: 'separator' }, { role: 'quit', label: 'Close app' },
    ] }, { label: 'View', submenu: [{ role: 'togglefullscreen' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }] },
  ]));
}
function updateState() {
  return { phase: updatePhase, version: updateVersion, scheduledAt: null, message: updateMessage };
}
function setupUpdater() {
  if (!app.isPackaged || !config.updates || (config.channel === 'release' && !config.publisher)) return;
  updater = require('electron-updater').autoUpdater;
  updater.autoDownload = false;
  updater.autoInstallOnAppQuit = false;
  updater.allowDowngrade = false;
  updater.disableWebInstaller = true;
  if (config.channel === 'test') updater.disableDifferentialDownload = true;
  updatePhase = 'idle';
  updater.on('error', () => { updateMessage = 'Unable to download the update. We will try again when connected.'; });
  updater.on('update-downloaded', () => { updateReady = true; updatePhase = 'ready'; updateMessage = ''; });
  void checkUpdate(false);
  setInterval(() => void checkUpdate(false), 30 * 60 * 1000).unref();
}
async function checkUpdate(manual) {
  if (!updater) {
    if (manual) await dialog.showMessageBox(win, { message: 'Automatic updates are unavailable for this edition.', detail: 'Download the latest Windows installer from ' + config.origin + '/download/windows. Your saved tickets will be kept.' });
    return;
  }
  if (checkingUpdate || updateReady || installing) return;
  checkingUpdate = true;
  try {
    const result = await updater.checkForUpdates();
    if (!result?.isUpdateAvailable) { updatePhase = 'idle'; if (manual) await dialog.showMessageBox(win, { message: 'KingPOS is up to date.' }); return; }
    updateVersion = result.updateInfo.version; updatePhase = 'downloading'; updateMessage = '';
    await updater.downloadUpdate();
  } catch { updatePhase = updateVersion ? 'available' : 'idle'; updateMessage = 'Unable to download the update. We will try again when connected.'; }
  finally { checkingUpdate = false; }
}
async function installUpdate(confirmed = false, scheduled = false) {
  if (installing) return;
  if (!updater || !updateReady) { updateMessage = 'The update is still downloading. You can keep working.'; return; }
  if (vault.pending()) { updateMessage = 'Waiting for saved tickets to finish uploading.'; return; }
  if (!confirmed) {
    const { response } = await dialog.showMessageBox(win, { buttons: ['Later', 'Update now'], defaultId: 0, cancelId: 0, message: 'Update and reopen KingPOS?', detail: 'Your saved tickets will be kept.' });
    if (response !== 1) return;
  }
  installing = true;
  try {
    // Freeze input before flushing/backup, with a fail-closed readiness check.
    const ready = await win.webContents.executeJavaScript(`(() => {
      if (${scheduled} && Date.now() - (window.__kingposLastInput || Date.now()) < 60000) return false;
      if (document.querySelector('[role="dialog"]')) return false;
      const request = new CustomEvent('kingpos:desktop-flush', { detail: { saved: false } });
      window.dispatchEvent(request);
      if (!request.detail.saved || (${scheduled} && request.detail.busy)) return false;
      document.body.inert = true;
      return true;
    })()`);
    if (!ready) { updateMessage = 'Waiting until you finish working. Your update reminder will stay here.'; return; }
    if (vault.pending()) { updateMessage = 'Waiting for saved tickets to finish uploading.'; return; }
    await vault.backup();
    await win.webContents.session.cookies.flushStore();
    win.webContents.session.flushStorageData();
    if (vault.pending()) return;
    updatePlan.set('', null);
    updater.quitAndInstall(true, true);
  } catch { updateMessage = 'Unable to prepare the update. Your app and tickets have been kept. Try again later.'; }
  finally {
    installing = false;
    if (win && !win.isDestroyed()) await win.webContents.executeJavaScript('document.body.inert = false').catch(() => {});
  }
}
