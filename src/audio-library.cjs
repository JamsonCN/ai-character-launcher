const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { pathToFileURL } = require('node:url');
const characters = require('./characters.json');

const builtins = ['music', 'confirm', 'enter', 'back'];
const trialNames = {
  music: 'Champion_s_Gambit.mp3',
  confirm: 'juniorsoundays-ui-sound-54-527832.mp3',
  enter: 'juniorsoundays-ui-sound-90-527846.mp3',
  back: 'juniorsoundays-ui-sound-90-527846.mp3'
};
const slots = [...builtins, ...characters.map(({ id }) => id)];
const audioFile = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\.(?:wav|mp3)$/;
const maxAudioBytes = 30 * 1024 * 1024;
const defaultAudio = {
  muted: false,
  music: { enabled: true, volume: 40, source: 'builtin' },
  effects: { enabled: true, volume: 40 },
  voice: { enabled: true, volume: 65, autoplay: false },
  files: {}
};

function validateAudio(input) {
  const audio = structuredClone(defaultAudio);
  audio.muted = input?.muted === true;
  for (const group of ['music', 'effects', 'voice']) {
    const value = input?.[group];
    if (typeof value?.enabled === 'boolean') audio[group].enabled = value.enabled;
    if (Number.isFinite(value?.volume)) audio[group].volume = Math.round(Math.min(100, Math.max(0, value.volume)));
  }
  audio.voice.autoplay = input?.voice?.autoplay === true;
  audio.music.source = input?.music?.source === 'custom' ? 'custom' : 'builtin';
  for (const slot of slots) {
    const file = input?.files?.[slot];
    if (typeof file?.id === 'string' && audioFile.test(file.id)) {
      audio.files[slot] = { id: file.id, name: String(file.name ?? '').slice(0, 255) };
    }
  }
  return audio;
}

function createAudioLibrary(directory, trialDirectory) {
  const pending = new Map();
  const adopted = new Set();
  const bundled = new Map();
  const labels = {};
  for (const slot of builtins) {
    const trial = path.join(trialDirectory, trialNames[slot]);
    const available = fs.statSync(trial, { throwIfNoEntry: false })?.isFile();
    bundled.set(slot, available ? trial : path.join(__dirname, 'assets', 'audio', slot + '.wav'));
    labels[slot] = available ? trialNames[slot] : slot === 'music' ? '幻彩序曲 · 32 秒循环' : '内置音效';
  }

  // Existing imports with the exact default audio can use the bundled copy.
  function adoptDefaults(audio) {
    for (const [slot, entry] of Object.entries(audio.files)) {
      if (!bundled.has(slot) || labels[slot] !== entry.name) continue;
      const existing = path.join(directory, entry.id);
      try {
        const size = fs.statSync(existing).size;
        if (size <= maxAudioBytes && fs.statSync(bundled.get(slot)).size === size &&
          fs.readFileSync(existing).equals(fs.readFileSync(bundled.get(slot)))) adopted.add(entry.id);
      } catch { /* Unavailable local files are omitted from the active settings. */ }
    }
  }

  function select(file) {
    const extension = path.extname(file).toLowerCase();
    if (!['.mp3', '.wav'].includes(extension)) throw new Error('请选择 MP3 或 WAV 音频。');
    const stats = fs.statSync(file);
    if (!stats.isFile() || !stats.size || stats.size > maxAudioBytes) {
      throw new Error('请选择不超过 30 MB 的非空音频文件。');
    }
    const entry = { id: randomUUID() + extension, name: path.basename(file) };
    pending.set(entry.id, { ...entry, file, size: stats.size, modified: stats.mtimeMs });
    return entry;
  }

  function visible(audio) {
    const files = Object.fromEntries(Object.entries(audio.files).filter(([, { id }]) =>
      !adopted.has(id) && fs.existsSync(path.join(directory, id))
    ));
    return { ...audio, files, music: { ...audio.music, source: files.music ? audio.music.source : 'builtin' } };
  }

  function prepare(next, previous, created) {
    for (const [slot, entry] of Object.entries(next.files)) {
      const selection = pending.get(entry.id);
      if (!selection) {
        if (previous.files[slot]?.id !== entry.id) throw new Error('请通过文件选择器重新选择音频。');
        next.files[slot] = previous.files[slot];
        continue;
      }
      const stats = fs.statSync(selection.file, { throwIfNoEntry: false });
      if (!stats?.isFile() || stats.size !== selection.size || stats.mtimeMs !== selection.modified) {
        throw new Error(`音频「${selection.name}」已移动或更改，请重新选择。`);
      }
      fs.mkdirSync(directory, { recursive: true });
      if (!created.includes(selection.id)) {
        fs.copyFileSync(selection.file, path.join(directory, selection.id), fs.constants.COPYFILE_EXCL);
        created.push(selection.id);
      }
      next.files[slot] = { id: selection.id, name: selection.name };
    }
  }

  function remove(id) {
    if (!audioFile.test(id)) return;
    try { fs.rmSync(path.join(directory, id), { force: true }); } catch (error) {
      console.error(error.message);
    }
  }

  function commit(next, previous) {
    pending.clear();
    const retained = new Set(Object.values(next.files).map(({ id }) => id));
    for (const { id } of Object.values(previous.files)) if (!retained.has(id)) remove(id);
  }

  async function serve(request, saved, net) {
    const url = new URL(request.url);
    const id = url.pathname.slice(1);
    let file;
    if (url.hostname === 'builtin' && builtins.includes(id)) {
      file = bundled.get(id);
    } else if (url.hostname === 'local' && audioFile.test(id)) {
      file = pending.get(id)?.file;
      if (!file && Object.values(saved.files).some((entry) => entry.id === id)) file = path.join(directory, id);
    }
    if (!file || request.method !== 'GET') return new Response(null, { status: 404 });
    try {
      const stat = fs.statSync(file);
      if (!stat.isFile() || !stat.size || stat.size > maxAudioBytes) return new Response(null, { status: 413 });
      const result = await net.fetch(pathToFileURL(file).href);
      return new Response(result.body, { status: result.status, headers: {
        'Content-Type': path.extname(file).toLowerCase() === '.mp3' ? 'audio/mpeg' : 'audio/wav',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-store'
      } });
    } catch {
      return new Response(null, { status: 404 });
    }
  }

  return { select, visible, prepare, remove, commit, serve, adoptDefaults, labels, cancel: () => pending.clear() };
}

module.exports = { defaultAudio, validateAudio, createAudioLibrary };
