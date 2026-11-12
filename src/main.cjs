const { app, BrowserWindow, ipcMain, shell, screen, dialog, nativeImage, protocol, net } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { pathToFileURL } = require('node:url');
const { version } = require('../package.json');
const releaseLinks = require('./release-links.json');
const { defaults, defaultSettings, loadSettings, validateSettings, readJson, writeJson, webUrl } = require('./preferences.cjs');
const { clientTarget, openClient, openWeb } = require('./launch.cjs');
const { createAudioLibrary } = require('./audio-library.cjs');

const appId = 'com.aicharacter.launcher';
const indexPath = path.join(__dirname, 'index.html');
const indexUrl = pathToFileURL(indexPath).href;
const imageName = /^[0-9a-f-]{36}\.png$/i;
const imageTypes = ['png', 'jpg', 'jpeg', 'webp', 'bmp'];
const loginOptions = {
  name: appId, path: process.execPath,
  args: app.isPackaged ? [] : [`"${app.getAppPath()}"`]
};

let window;
let settings;
let placementTimer;
let settingsFile;
let placementFile;
let imagesDir;
let audioLibrary;
const selectedImages = new Set();

app.setAppUserModelId(appId);
protocol.registerSchemesAsPrivileged([{
  scheme: 'launcher-image',
  privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true }
}, {
  scheme: 'launcher-audio',
  privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true }
}]);

function getAutoStart() {
  return app.getLoginItemSettings({ ...loginOptions,
    args: app.isPackaged ? [] : [app.getAppPath()]
  }).launchItems?.some((item) => item.name === appId && item.enabled) ?? false;
}

function setAutoStart(enabled) {
  app.setLoginItemSettings({ ...loginOptions, openAtLogin: enabled, enabled });
  if (getAutoStart() !== enabled) throw new Error('Windows 未能更新登录时自动启动设置。');
}

function currentState() {
  const roles = settings.roles.map((role) => {
    const original = defaults.find(({ id }) => id === role.id);
    const custom = imageName.test(role.image) && fs.existsSync(path.join(imagesDir, role.image));
    return { ...original, ...role, image: custom ? role.image : '',
      imageUrl: custom ? `launcher-image://portrait/${role.image}` : '' };
  });
  return { general: settings.general, audio: audioLibrary.visible(settings.audio),
    builtinAudio: audioLibrary.labels, roles, version, releaseLinks };
}

function importImage(file) {
  if (!selectedImages.has(file)) throw new Error('请通过文件选择器重新选择角色图。');
  if (fs.statSync(file).size > 30 * 1024 * 1024) throw new Error('角色图须小于 30 MB。');
  let image = nativeImage.createFromPath(file);
  if (image.isEmpty()) throw new Error('无法读取这张角色图，请选用 PNG、JPEG、WebP 或 BMP 图片。');
  const { width, height } = image.getSize();
  const scale = Math.min(1, 1800 / Math.max(width, height));
  if (scale < 1) image = image.resize({ width: Math.max(1, Math.round(width * scale)), quality: 'best' });
  const name = `${randomUUID()}.png`;
  fs.mkdirSync(imagesDir, { recursive: true });
  fs.writeFileSync(path.join(imagesDir, name), image.toPNG(), { flag: 'wx' });
  return name;
}

function removeImage(name) {
  if (!imageName.test(name)) return;
  try { fs.rmSync(path.join(imagesDir, name), { force: true }); } catch (error) {
    console.error(error.message);
  }
}

function saveSettings(input) {
  const previous = settings;
  const next = validateSettings({ ...input, audio: input?.audio ?? previous.audio });
  const created = [];
  const createdAudio = [];
  const autoChanged = previous.general.autoStart !== next.general.autoStart;
  let autoTouched = false;
  try {
    audioLibrary.prepare(next.audio, previous.audio, createdAudio);
    for (const role of next.roles) {
      if (selectedImages.has(role.image)) {
        role.image = importImage(role.image);
        created.push(role.image);
      } else if (role.image !== previous.roles.find(({ id }) => id === role.id).image) {
        if (role.image) throw new Error(`请重新选择 ${role.name} 的角色图。`);
      }
    }
    if (autoChanged) {
      autoTouched = true;
      setAutoStart(next.general.autoStart);
    }
    writeJson(settingsFile, next);
  } catch (error) {
    created.forEach(removeImage);
    createdAudio.forEach(audioLibrary.remove);
    if (autoTouched) {
      try { setAutoStart(previous.general.autoStart); } catch (rollback) { console.error(rollback.message); }
    }
    throw error;
  }
  settings = next;
  audioLibrary.commit(next.audio, previous.audio);
  selectedImages.clear();
  for (const { image } of previous.roles) {
    if (!next.roles.some((role) => role.image === image)) removeImage(image);
  }
  rememberPlacement();
  return currentState();
}

function constrainBounds(bounds) {
  const { workArea } = bounds ? screen.getDisplayMatching(bounds) : screen.getPrimaryDisplay();
  // Leave room for Windows rounding when a display uses fractional DPI scaling.
  const insetX = workArea.width >= 768 ? 4 : 0;
  const insetY = workArea.height >= 548 ? 4 : 0;
  const width = Math.min(workArea.width - insetX * 2, Math.max(760, bounds?.width ?? 1360));
  const height = Math.min(workArea.height - insetY * 2, Math.max(540, bounds?.height ?? 890));
  const x = Math.max(workArea.x + insetX, Math.min(workArea.x + workArea.width - insetX - width,
    bounds?.x ?? workArea.x + Math.floor((workArea.width - width) / 2)));
  const y = Math.max(workArea.y + insetY, Math.min(workArea.y + workArea.height - insetY - height,
    bounds?.y ?? workArea.y + Math.floor((workArea.height - height) / 2)));
  return { x, y, width, height };
}

function rememberPlacement() {
  if (!window || window.isDestroyed()) return;
  try {
    if (settings.general.rememberWindow) {
      writeJson(placementFile, { bounds: window.getNormalBounds(), maximized: window.isMaximized() });
    } else if (fs.existsSync(placementFile)) {
      fs.rmSync(placementFile);
    }
  } catch (error) { console.error(error.message); }
}

function schedulePlacement() {
  if (!settings.general.rememberWindow) return;
  clearTimeout(placementTimer);
  placementTimer = setTimeout(rememberPlacement, 220);
}

function ensureVisible() {
  if (!window || window.isDestroyed()) return;
  const original = window.getNormalBounds();
  const bounded = constrainBounds(original);
  const { workArea } = screen.getDisplayMatching(bounded);
  window.setMinimumSize(Math.min(760, workArea.width), Math.min(540, workArea.height));
  if (Object.keys(bounded).every((key) => bounded[key] === original[key])) return;
  const maximized = window.isMaximized();
  if (window.isFullScreen()) window.setFullScreen(false);
  if (maximized) window.unmaximize();
  window.setBounds(bounded);
  if (maximized) window.maximize();
}

function sendWindowState() {
  window.webContents.send('window:changed', { maximized: window.isMaximized(), minimized: window.isMinimized() });
}

function createWindow() {
  const placement = settings.general.rememberWindow ? readJson(placementFile) : null;
  const savedBounds = placement?.bounds;
  const bounds = constrainBounds(['x', 'y', 'width', 'height'].every((key) =>
    Number.isSafeInteger(savedBounds?.[key])) ? savedBounds : null);
  const { workArea } = screen.getDisplayMatching(bounds);
  window = new BrowserWindow({
    title: 'AI 角色启动器', ...bounds, frame: false,
    minWidth: Math.min(760, workArea.width), minHeight: Math.min(540, workArea.height),
    backgroundColor: '#100d18', show: false, autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true, nodeIntegration: false, sandbox: true,
      autoplayPolicy: 'no-user-gesture-required'
    }
  });
  window.webContents.on('will-navigate', (event) => event.preventDefault());
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    if (input.key !== 'F11' && !(input.key === 'Escape' && window.isFullScreen())) return;
    event.preventDefault();
    if (!input.isAutoRepeat) window.setFullScreen(input.key === 'F11' && !window.isFullScreen());
  });
  for (const event of ['resize', 'move', 'maximize', 'unmaximize']) window.on(event, schedulePlacement);
  for (const event of ['maximize', 'unmaximize', 'minimize', 'restore']) window.on(event, sendWindowState);
  window.on('close', () => { clearTimeout(placementTimer); rememberPlacement(); });
  window.once('ready-to-show', () => {
    if (placement?.maximized) window.maximize();
    window.show();
    sendWindowState();
  });
  window.loadFile(indexPath);
}

function handle(channel, callback) {
  ipcMain.handle(channel, async (event, ...args) => {
    if (event.sender !== window?.webContents || event.senderFrame?.url !== indexUrl) {
      return { ok: false, message: '请求来源无效。' };
    }
    try { return { ok: true, value: await callback(...args) }; } catch (error) {
      return { ok: false, message: error.message, section: error.section };
    }
  });
}

handle('app:state', currentState);
handle('settings:defaults', () => defaultSettings);
handle('settings:save', saveSettings);
handle('settings:cancel', () => {
  selectedImages.clear();
  audioLibrary.cancel();
});
handle('settings:pick', async (kind) => {
  const choices = {
    client: ['选择客户端或快捷方式', ['exe', 'lnk']],
    browser: ['选择浏览器程序', ['exe']],
    image: ['选择角色图', imageTypes],
    audio: ['选择音频', ['mp3', 'wav']]
  };
  const choice = Object.hasOwn(choices, kind) && choices[kind];
  if (!choice) throw new Error('文件类型无效。');
  const result = await dialog.showOpenDialog(window, {
    title: choice[0], properties: ['openFile'], filters: [{ name: '支持的文件', extensions: choice[1] }]
  });
  const file = result.canceled ? '' : result.filePaths[0];
  if (file && kind === 'audio') return audioLibrary.select(file);
  if (file && kind === 'image') selectedImages.add(file);
  return file;
});

handle('client:status', (id) => {
  const role = settings.roles.find((item) => item.id === id);
  clientTarget(role?.clientPath);
  return true;
});

handle('launch:test', async (kind, value, browserPath) => {
  if (kind === 'web') return openWeb(value, browserPath);
  if (kind === 'client') return openClient(value);
  throw new Error('启动类型无效。');
});

handle('launch:role', async (kind, id) => {
  const role = settings.roles.find((item) => item.id === id);
  if (!role) throw new Error('角色无效。');
  let action;
  if (kind === 'web') {
    try { await openWeb(role.website, settings.general.browserPath); } catch (error) {
      error.section ??= 'general';
      throw error;
    }
    action = settings.general.afterWeb;
  } else if (kind === 'client') {
    await openClient(role.clientPath);
    action = settings.general.afterClient;
  } else {
    throw new Error('启动类型无效。');
  }
  if (action === 'minimize') window.minimize();
  if (action === 'quit') setImmediate(() => app.quit());
});

handle('app:release-link', async (key) => {
  if (!Object.hasOwn(releaseLinks, key) || !releaseLinks[key]) throw new Error('发布链接尚未配置。');
  await shell.openExternal(webUrl(releaseLinks[key]));
});

handle('window:action', (action) => {
  if (action === 'minimize') window.minimize();
  if (action === 'maximize') {
    if (window.isFullScreen()) window.setFullScreen(false);
    else if (window.isMaximized()) window.unmaximize();
    else window.maximize();
  }
  if (action === 'close') window.close();
});

app.whenReady().then(() => {
  const directory = app.getPath('userData');
  settingsFile = path.join(directory, 'settings.json');
  placementFile = path.join(directory, 'window.json');
  imagesDir = path.join(directory, 'portraits');
  const trialAudio = app.isPackaged ? path.join(process.resourcesPath, 'trial-audio') :
    path.join(__dirname, '..', 'local-audio');
  audioLibrary = createAudioLibrary(path.join(directory, 'audio'), trialAudio);
  settings = loadSettings(settingsFile);
  audioLibrary.adoptDefaults(settings.audio);
  settings.general.autoStart = getAutoStart();
  protocol.handle('launcher-audio', (request) => audioLibrary.serve(request, settings.audio, net));
  protocol.handle('launcher-image', async (request) => {
    const url = new URL(request.url);
    const name = url.pathname.slice(1);
    if (url.host !== 'portrait' || !imageName.test(name) || !settings.roles.some((role) => role.image === name)) {
      return new Response(null, { status: 404 });
    }
    const result = await net.fetch(pathToFileURL(path.join(imagesDir, name)).href);
    return new Response(result.body, {
      status: result.status,
      headers: { 'Content-Type': 'image/png', 'Access-Control-Allow-Origin': '*' }
    });
  });
  for (const event of ['display-added', 'display-removed', 'display-metrics-changed']) screen.on(event, ensureVisible);
  createWindow();
});
app.on('window-all-closed', () => app.quit());
