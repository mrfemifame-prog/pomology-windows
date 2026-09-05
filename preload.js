// Runs in a privileged context bridging the sandboxed app to a single,
// narrow main-process capability — generating and saving a PDF —
// deliberately not exposing any broader Node.js/Electron access, keeping
// the app's own context fully isolated and sandboxed otherwise.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  isElectron: true,
  printToPDF: (fileName) => ipcRenderer.invoke('print-to-pdf', fileName),
});
