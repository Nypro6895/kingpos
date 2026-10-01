'use strict';
const { contextBridge, ipcRenderer } = require('electron');
function storage(method, key, value) {
  const result = ipcRenderer.sendSync('kingpos:storage', { method, key, value });
  if (!result?.ok) throw Error('Unable to save on this device. Keep this ticket open.');
  return result.value;
}
contextBridge.exposeInMainWorld('kingposDesktop', Object.freeze({
  version: 4,
  recovery: Object.freeze({ retry: () => ipcRenderer.invoke('kingpos:retry-open') }),
  offline: Object.freeze({ prepare: (scope, assets) => ipcRenderer.invoke('kingpos:offline-prepare', {scope, assets}), lock: () => ipcRenderer.sendSync('kingpos:offline-lock') }),
  updates: Object.freeze({ state: () => ipcRenderer.invoke('kingpos:update', {method:'state'}), later: () => ipcRenderer.invoke('kingpos:update', {method:'later'}), schedule: at => ipcRenderer.invoke('kingpos:update', {method:'schedule', at}), now: () => ipcRenderer.invoke('kingpos:update', {method:'now'}) }),
  display: Object.freeze({ pair: token => ipcRenderer.invoke('kingpos:display', { method: 'pair', token }), open: () => ipcRenderer.invoke('kingpos:display', { method: 'open' }), close: () => ipcRenderer.invoke('kingpos:display', { method: 'close' }) }),
  windowControls: Object.freeze({
    fullscreen: toggle => ipcRenderer.invoke('kingpos:fullscreen', toggle),
    menu: () => ipcRenderer.send('kingpos:menu'),
    onFullscreen: callback => { const listener = (_event, value) => callback(value === true); ipcRenderer.on('kingpos:fullscreen-state', listener); return () => ipcRenderer.removeListener('kingpos:fullscreen-state', listener); },
  }),
  storage: Object.freeze({ get: key => storage('get', key), set: (key, value) => storage('set', key, value), remove: key => storage('remove', key) }),
  operations: Object.freeze({
    list: scope => ipcRenderer.invoke('kingpos:operations', { method: 'list', scope }),
    checkpoint: (scope, key) => ipcRenderer.invoke('kingpos:operations', { method: 'checkpoint', scope, key }),
    save: operation => ipcRenderer.invoke('kingpos:operations', { method: 'save', operation }),
  }),
}));
