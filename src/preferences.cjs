const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const defaults = require('./characters.json');
const { defaultAudio, validateAudio } = require('./audio-library.cjs');

const actions = new Set(['keep', 'minimize', 'quit']);
const generalDefaults = {
  autoStart: false, browserPath: '', motion: 'system', rememberWindow: false,
  afterWeb: 'keep', afterClient: 'keep'
};
const defaultSettings = {
  general: generalDefaults,
  audio: defaultAudio,
  roles: defaults.map(({ id, name, accent, website }) =>
    ({ id, name, accent, website, clientPath: '', image: '' }))
};

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) console.error(error.message);
    return null;
  }
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporary, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(temporary, file);
  } finally {
    fs.rmSync(temporary, { force: true });
  }
}

function webUrl(input) {
  const value = String(input ?? '').trim();
  let url;
  try { url = new URL(value); } catch { /* Show the same input guidance for malformed URLs. */ }
  if (!/^https?:\/\//i.test(value) || !url || !['http:', 'https:'].includes(url.protocol) || !url.hostname) {
    throw new Error('请输入以 http:// 或 https:// 开头的完整网址。');
  }
  return url.href;
}

function localPath(input) {
  return typeof input === 'string' ? input.trim().replace(/^"(.*)"$/, '$1').trim() : '';
}

function filePath(input, extensions, label) {
  const value = localPath(input);
  if (!value || !path.isAbsolute(value) || !extensions.includes(path.extname(value).toLowerCase())) {
    throw new Error(`请选择或填写${label}的完整路径（${extensions.join('、')}）。`);
  }
  return path.normalize(value);
}

function validateSettings(input) {
  const general = { ...generalDefaults, ...input?.general };
  const browser = localPath(general.browserPath);
  if (!Array.isArray(input?.roles) || input.roles.length !== defaults.length ||
    new Set(input.roles.map((role) => role.id)).size !== defaults.length) {
    throw new Error('角色顺序无效，请恢复默认后重试。');
  }
  return {
    audio: validateAudio(input?.audio),
    general: {
      autoStart: general.autoStart === true,
      browserPath: browser ? filePath(browser, ['.exe'], '浏览器') : '',
      motion: general.motion === 'reduce' ? 'reduce' : 'system',
      rememberWindow: general.rememberWindow === true,
      afterWeb: actions.has(general.afterWeb) ? general.afterWeb : 'keep',
      afterClient: actions.has(general.afterClient) ? general.afterClient : 'keep'
    },
    roles: input.roles.map((role) => {
      const original = defaults.find((item) => item.id === role.id);
      if (!original) throw new Error('存在无效角色。');
      const name = String(role.name ?? '').trim();
      if (!name || name.length > 40) throw new Error(`${original.name} 的 AI 名称须为 1 至 40 个字符。`);
      if (!/^#[0-9a-f]{6}$/i.test(role.accent)) throw new Error(`${name} 的主题色无效。`);
      let website;
      let clientPath;
      try {
        website = webUrl(role.website);
        const client = localPath(role.clientPath);
        clientPath = client ? filePath(client, ['.exe', '.lnk'], '客户端') : '';
      } catch (error) {
        throw new Error(`${name}：${error.message}`);
      }
      return { id: role.id, name, accent: role.accent, website, clientPath,
        image: typeof role.image === 'string' ? role.image : '' };
    })
  };
}

function loadSettings(file) {
  const saved = readJson(file);
  if (!saved) return structuredClone(defaultSettings);
  const savedRoles = Array.isArray(saved.roles) ? saved.roles : [];
  const roles = defaultSettings.roles.map((fallback) => {
    const index = savedRoles.findIndex((role) => role?.id === fallback.id);
    try {
      return { value: validateSettings({ roles: defaultSettings.roles.map((role) =>
        role === fallback ? { ...fallback, ...savedRoles[index] } : role)
      }).roles.find((role) => role.id === fallback.id), index };
    } catch {
      return { value: fallback, index };
    }
  }).sort((a, b) => (a.index < 0 ? Infinity : a.index) - (b.index < 0 ? Infinity : b.index));
  try {
    return validateSettings({ general: saved.general, audio: saved.audio, roles: roles.map(({ value }) => value) });
  } catch {
    return { general: { ...generalDefaults }, audio: validateAudio(saved.audio), roles: roles.map(({ value }) => value) };
  }
}

module.exports = { defaults, defaultSettings, loadSettings, validateSettings, readJson, writeJson, webUrl, localPath, filePath };
