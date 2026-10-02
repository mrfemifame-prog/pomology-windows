// Electron main process — creates the app window and loads the app
// directly from the files bundled inside the installer. Nothing here
// fetches anything over the network; the only network calls the app
// itself ever makes are its own quiet background backup to Supabase.
const { app, BrowserWindow, ipcMain, dialog, shell, protocol, net } = require('electron');
const path = require('path');
const fs = require('fs');
const url = require('url');

// Loading the app over file:// proved unreliable on Windows: the first
// launch would fail with ERR_FAILED while a second instance opened on top
// of it worked, which points at Electron's own disk cache being locked or
// half-written rather than anything wrong with the files themselves.
// Serving the app through a custom internal protocol avoids the file://
// code path (and its cache) altogether, so that whole class of problem
// can't occur. Nothing here touches the network — "app://" is served
// straight off the local disk, inside the installed folder.
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
]);

// The disk cache is also disabled outright — this app has no need for it
// (every file it loads is local and tiny), and a corrupt or locked cache
// was the most likely cause of the original failure.
app.commandLine.appendSwitch('disable-http-cache');

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

  // Inject a Business Map launcher into the existing manager UI.
  win.webContents.on('did-finish-load', () => {
    if (win.webContents.getURL().endsWith('/index.html')) {
      win.webContents.executeJavaScript(\`(() => {
        if (document.getElementById('businessMapLauncher')) return;
        const b = document.createElement('button');
        b.id='businessMapLauncher'; b.textContent='Business Opportunity Map';
        Object.assign(b.style,{position:'fixed',right:'22px',bottom:'22px',zIndex:99999,background:'#1B5E20',color:'#fff',border:'0',borderRadius:'10px',padding:'11px 15px',fontWeight:'700',cursor:'pointer',boxShadow:'0 5px 18px rgba(0,0,0,.18)'});
        b.onclick=()=>{ window.location.href='app://bundle/business-map.html'; };
        document.body.appendChild(b);
      })()\`);
    }
  });

  // TEMPORARY DIAGNOSTIC: still reports a failure clearly rather than
  // leaving a blank window with no explanation. Removed once confirmed
  // working.
  win.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
    dialog.showErrorBox('Failed to load the app', `Error ${errorCode}: ${errorDescription}\nURL: ${validatedURL}`);
  });
  win.webContents.on('render-process-gone', (event, details) => {
    dialog.showErrorBox('The app crashed', `Reason: ${details.reason}`);
  });

  win.loadURL('app://bundle/index.html').catch(err => {
    dialog.showErrorBox('loadURL failed', String(err));
  });
  return win;
}

app.whenReady().then(() => {
  // Maps every app:// request to the matching file inside the installed
  // folder, refusing anything that tries to escape that folder.
  protocol.handle('app', (request) => {
    const requestPath = new URL(request.url).pathname;
    const safePath = path.normalize(decodeURIComponent(requestPath)).replace(/^(\.\.[/\\])+/, '');
    const fullPath = path.join(__dirname, safePath);
    if (!fullPath.startsWith(__dirname)) {
      return new Response('Not found', { status: 404 });
    }
    return net.fetch(url.pathToFileURL(fullPath).toString());
  });
  createWindow();
});

// Inject a Business Map entry into the existing manager without changing its UI source.
app.on('browser-window-created', (_event, win) => {
  win.webContents.on('did-finish-load', () => {
    if (win.webContents.getURL().endsWith('/index.html')) {
      win.webContents.executeJavaScript(\`(() => {
        if (document.getElementById('businessMapLauncher')) return;
        const b = document.createElement('button');
        b.id='businessMapLauncher'; b.textContent='Business Opportunity Map';
        Object.assign(b.style,{position:'fixed',right:'22px',bottom:'22px',zIndex:99999,background:'#1B5E20',color:'#fff',border:'0',borderRadius:'10px',padding:'11px 15px',fontWeight:'700',cursor:'pointer',boxShadow:'0 5px 18px rgba(0,0,0,.18)'});
        b.onclick=()=>{ window.location.href='app://bundle/business-map.html'; };
        document.body.appendChild(b);
      })()\`);
    }
  });
});

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
