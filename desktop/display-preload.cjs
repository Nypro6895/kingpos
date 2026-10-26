'use strict';
const { contextBridge, ipcRenderer } = require('electron');
// Customer screen has no receipt-vault, filesystem, menu or operation access.
contextBridge.exposeInMainWorld('kingposDisplay', Object.freeze({ printCheckinReceipt: receipt => ipcRenderer.invoke('kingpos:print-checkin', receipt), getFullscreen: () => ipcRenderer.invoke('kingpos:fullscreen', false), fullscreen: toggle => ipcRenderer.invoke('kingpos:fullscreen', toggle === true) }));
