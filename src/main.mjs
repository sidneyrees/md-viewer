// .MD Viewer desktop app: Electron main process.
// Starts the local viewer server on a free port and shows it in a native window.
import { app, BrowserWindow, Menu, dialog, ipcMain, nativeTheme, shell } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { createViewerServer } from './server.mjs';

const REPO_URL = 'https://github.com/sidneyrees/md-viewer';
const here = import.meta.dirname;
const isExternal = (url) => /^(https?:|mailto:)/i.test(url);

let viewer = null;
let win = null;
let pendingFile = null; // macOS: file opened before the app was ready

app.setAppUserModelId('com.sidneyrees.mdviewer');

// First existing .md file among command-line arguments (the app is the `.md` handler).
function markdownFromArgv(argv, cwd) {
  return argv
    .slice(app.isPackaged ? 1 : 2)
    .filter((a) => !a.startsWith('-'))
    .map((a) => path.resolve(cwd, a))
    .find((a) => /\.md$/i.test(a) && fs.existsSync(a) && fs.statSync(a).isFile());
}

// Hash understood by the renderer: opens that file (path relative to the working folder).
const hashFor = (rel) => '#' + encodeURIComponent(rel.split(path.sep).join('/'));

// Make `file` visible: keep the current folder if it contains it, otherwise switch to its folder.
function relativeToViewer(file) {
  const abs = path.resolve(file);
  const rel = path.relative(viewer.getRoot(), abs);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    viewer.setRoot(path.dirname(abs));
    return path.basename(abs);
  }
  return rel;
}

function openFile(file) {
  const rel = relativeToViewer(file);
  win.loadURL(viewer.url + '/?t=' + Date.now() + hashFor(rel));
}

const boundsFile = () => path.join(app.getPath('userData'), 'window.json');

function readBounds() {
  try {
    return JSON.parse(fs.readFileSync(boundsFile(), 'utf8'));
  } catch {
    return {};
  }
}

function createWindow(hash = '') {
  const saved = readBounds();
  win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 700,
    minHeight: 450,
    ...saved.bounds,
    show: false,
    title: '.MD Viewer',
    icon: path.join(here, '..', 'build', 'icon.png'),
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0d1117' : '#ffffff',
    webPreferences: {
      preload: path.join(here, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });
  if (saved.maximized) win.maximize();
  win.once('ready-to-show', () => win.show());

  // External links open in the system browser; the window never leaves the local viewer.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isExternal(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    if (url.startsWith(viewer.url)) return;
    event.preventDefault();
    if (isExternal(url)) shell.openExternal(url);
  });

  // The page asks to keep unsaved edits (beforeunload): confirm with a native dialog.
  win.webContents.on('will-prevent-unload', (event) => {
    const choice = dialog.showMessageBoxSync(win, {
      type: 'question',
      buttons: ['Discard changes', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
      message: 'You have unsaved changes',
      detail: 'If you continue, they will be lost.',
    });
    if (choice === 0) event.preventDefault();
  });

  win.on('close', () => {
    try {
      fs.writeFileSync(
        boundsFile(),
        JSON.stringify({ bounds: win.getNormalBounds(), maximized: win.isMaximized() }),
      );
    } catch {
      // window position is optional
    }
  });
  win.on('closed', () => {
    win = null;
  });

  win.loadURL(viewer.url + '/' + hash);
}

function buildMenu() {
  const about = () =>
    dialog.showMessageBox(win, {
      type: 'info',
      title: 'About .MD Viewer',
      message: '.MD Viewer',
      detail: `Version ${app.getVersion()}\nElectron ${process.versions.electron}\n\n${REPO_URL}`,
    });
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: 'File',
        submenu: [
          {
            label: 'Open folder…',
            accelerator: 'CmdOrCtrl+O',
            click: () => win?.webContents.executeJavaScript("document.getElementById('btnRoot').click()"),
          },
          { type: 'separator' },
          { role: 'quit', label: 'Quit' },
        ],
      },
      {
        label: 'Edit',
        submenu: [
          { role: 'undo', label: 'Undo' },
          { role: 'redo', label: 'Redo' },
          { type: 'separator' },
          { role: 'cut', label: 'Cut' },
          { role: 'copy', label: 'Copy' },
          { role: 'paste', label: 'Paste' },
          { role: 'selectAll', label: 'Select all' },
        ],
      },
      {
        label: 'View',
        submenu: [
          { role: 'resetZoom', label: 'Actual size' },
          { role: 'zoomIn', label: 'Zoom in' },
          { role: 'zoomOut', label: 'Zoom out' },
          { type: 'separator' },
          { role: 'togglefullscreen', label: 'Full screen' },
          ...(app.isPackaged
            ? []
            : [{ role: 'reload', label: 'Reload' }, { role: 'toggleDevTools' }]),
        ],
      },
      {
        label: 'Help',
        submenu: [
          { label: 'Project website', click: () => shell.openExternal(REPO_URL) },
          { label: 'About', click: about },
        ],
      },
    ]),
  );
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  // A second launch (for example double-clicking another .md) reuses this window.
  app.on('second-instance', (_event, argv, cwd) => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
    const file = markdownFromArgv(argv, cwd);
    if (file) openFile(file);
  });

  app.on('open-file', (event, file) => {
    event.preventDefault();
    if (viewer && win) openFile(file);
    else pendingFile = file;
  });

  app.whenReady().then(async () => {
    const first = pendingFile ?? markdownFromArgv(process.argv, process.cwd());
    viewer = await createViewerServer({
      rendererDir: path.join(here, 'renderer'),
      root: first ? path.dirname(first) : undefined,
      configPath: path.join(app.getPath('userData'), 'config.json'),
      fallbackRoot: app.getPath('documents'),
    });

    ipcMain.handle('pick-folder', async (event) => {
      if (!event.senderFrame?.url.startsWith(viewer.url)) return null;
      const result = await dialog.showOpenDialog(win, {
        title: 'Choose working folder',
        properties: ['openDirectory'],
        defaultPath: viewer.getRoot(),
      });
      return result.canceled ? null : result.filePaths[0];
    });

    buildMenu();
    createWindow(first ? hashFor(path.basename(first)) : '');
  });

  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', () => viewer?.close());
}
