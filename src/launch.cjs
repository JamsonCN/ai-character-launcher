const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { shell } = require('electron');
const { filePath, webUrl } = require('./preferences.cjs');

function assertFile(file) {
  try {
    if (fs.statSync(file).isFile()) return;
  } catch (error) {
    if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') {
      throw new Error(`无法读取文件（${error.code ?? error.message}）。`);
    }
  }
  throw new Error('文件已移动、被删除或路径无效，请重新选择。');
}

function clientTarget(input) {
  if (!input) throw new Error('尚未配置客户端，请先选择应用程序或快捷方式。');
  const file = filePath(input, ['.exe', '.lnk'], '客户端');
  assertFile(file);
  if (path.extname(file).toLowerCase() === '.lnk') {
    let target;
    try { ({ target } = shell.readShortcutLink(file)); } catch {
      // Some Windows app shortcuts carry a shell item instead of a filesystem target.
      // Windows resolves these when opening the shortcut.
      return file;
    }
    if (target && path.isAbsolute(target)) {
      try { assertFile(target); } catch (error) {
        throw new Error(`快捷方式目标不可用。${error.message}`);
      }
    }
  }
  return file;
}

async function openClient(input) {
  const error = await shell.openPath(clientTarget(input));
  if (error) throw new Error(`Windows 无法打开客户端。${error}`);
}

async function openWeb(website, browserPath) {
  let url;
  try { url = webUrl(website); } catch (error) {
    error.section = 'roles';
    throw error;
  }
  if (!browserPath) {
    try { await shell.openExternal(url); } catch (error) {
      throw new Error(`Windows 默认浏览器未接受打开请求。${error.message}`);
    }
    return;
  }
  try {
    const browser = filePath(browserPath, ['.exe'], '浏览器');
    assertFile(browser);
    await new Promise((resolve, reject) => {
      const child = spawn(browser, [url], { cwd: path.dirname(browser), detached: true, stdio: 'ignore' });
      child.once('error', reject);
      child.once('spawn', () => { child.unref(); resolve(); });
    });
  } catch (error) {
    throw new Error(`无法启动指定的浏览器。${error.message}`);
  }
}

module.exports = { clientTarget, openClient, openWeb };
