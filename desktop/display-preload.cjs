'use strict';
const { contextBridge, ipcRenderer } = require('electron');
// Customer screen has no receipt-vault, filesystem, menu or operation access.
contextBridge.exposeInMainWorld('kingposDisplay', Object.freeze({ getFullscreen: () => ipcRenderer.invoke('kingpos:fullscreen', false), fullscreen: toggle => ipcRenderer.invoke('kingpos:fullscreen', toggle === true) }));
