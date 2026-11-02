// Exposes the single desktop capability the page needs: the native folder dialog.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktop', {
  pickFolder: () => ipcRenderer.invoke('pick-folder'),
});
