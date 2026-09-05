// Electron main process — creates the app window and loads the app
// directly from the files bundled inside the installer. Nothing here
// fetches anything over the network; the only network calls the app
// itself ever makes are its own quiet background backup to Supabase.
const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const url = require('url');

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    icon: path.join(__dirname, 'icons', 'icon.ico'),
    backgroundColor: '#F7F3EA',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });
  win.setMenuBarVisibility(false);

  // TEMPORARY DIAGNOSTIC BUILD: opens the developer console automatically
  // and surfaces any load/crash errors directly in the window, so we can
  // see exactly what's happening on a machine where the app is showing a
  // blank page instead of loading normally. This will be removed once
  // the underlying issue is found — it's not meant to stay in the app
  // long-term.
  win.webContents.openDevTools({ mode: 'bottom' });

  win.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
    dialog.showErrorBox('Failed to load the app', `Error ${errorCode}: ${errorDescription}\nURL: ${validatedURL}`);
  });
  win.webContents.on('render-process-gone', (event, details) => {
    dialog.showErrorBox('The app crashed', `Reason: ${details.reason}`);
  });
  win.webContents.on('console-message', (event, level, message, line, sourceId) => {
    if (level >= 2) console.log(`[renderer ${level}] ${message} (${sourceId}:${line})`);
  });

  // Built as a properly-encoded file:// URL rather than via loadFile()
  // directly — the install folder name ("Pomology Business Manager")
  // contains spaces, which simpler path-to-URL approaches can mishandle.
  // pathToFileURL is built specifically for this conversion — it correctly
  // turns a real filesystem path (Windows backslashes, drive letters,
  // spaces, all of it) into a properly-formed, correctly-encoded file://
  // URL.
  const indexUrl = url.pathToFileURL(path.join(__dirname, 'index.html')).toString();
  win.loadURL(indexUrl).catch(err => {
    dialog.showErrorBox('loadURL failed', String(err) + '\nAttempted URL: ' + indexUrl);
  });
  return win;
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// Windows' modern print dialog shows "This app doesn't support print
// preview" for apps using Electron's standard print path — well-documented,
// expected Windows behavior, not a bug in this app or the user's printer.
// Rather than fight that limitation, this bypasses the OS print dialog
// entirely: generates a real PDF directly, lets the user choose where to
// save it, then opens it in their default PDF viewer — which DOES show a
// full preview, if they want to print a physical copy from there.
ipcMain.handle('print-to-pdf', async (event, fileName) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  try {
    const pdfBuffer = await win.webContents.printToPDF({ printBackground: true, pageSize: 'A4' });
    const { canceled, filePath } = await dialog.showSaveDialog(win, {
      title: 'Save as PDF',
      defaultPath: (fileName || 'document') + '.pdf',
      filters: [{ name: 'PDF Files', extensions: ['pdf'] }],
    });
    if (canceled || !filePath) return { saved: false };
    fs.writeFileSync(filePath, pdfBuffer);
    shell.openPath(filePath);
    return { saved: true, filePath };
  } catch (err) {
    return { saved: false, error: err.message || String(err) };
  }
});
